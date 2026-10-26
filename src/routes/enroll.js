'use strict';
// src/routes/enroll.js: draft teams, roster edits, key source, and the
// Enroll ceremony (SRS.md FR-03, FR-04, FR-05, FR-06, FR-40).
// and the OVERRIDE ceremony that replaces a lost or broken key (FR-41, T11).
// Every route needs the organizer session. A roster never changes after
// enrollment (INV-12).

const crypto = require('crypto');
const express = require('express');

const { store } = require('../store');
const { failWith } = require('../errors');
const { body, query, orgCeremonyLimit } = require('../validate');
const canon = require('../canon');
const log = require('../log');
const sessions = require('../sessions');
const wa = require('../webauthn');

const router = express.Router();
const ORG_ACTOR = Object.freeze({ kind: 'organizer', id: 'organizer' });
const MAX_TEAMS = 40;
const MAX_MEMBERS = 6;
const ROLES = ['Captain', 'Builder', 'Designer', 'Presenter'];
const TEAM_ID_RE = /^tm_[0-9a-f]{16}$/;

function newTeamId() {
  return 'tm_' + crypto.randomBytes(8).toString('hex');
}

function getTeam(teamId) {
  return typeof teamId === 'string' && TEAM_ID_RE.test(teamId) ? store.teams.get(teamId) || null : null;
}

// The roster hash the Enroll tap signs (SDS.md 6.2).
function currentRosterHash(team) {
  return canon.rosterHash(team.id, team.name, team.roster);
}

function keySourceText(team) {
  if (team.keySource === 'pool') return team.tagLabel && team.tagColor ? `${team.tagLabel} (${team.tagColor})` : 'Pool key';
  if (team.keySource === 'own-key') return "Team's own key";
  if (team.keySource === 'own-passkey') return 'Own passkey';
  return null;
}

// One console row (FR-31, T4 columns). Organizer session only.
function teamRow(team) {
  const cred = team.credentialId ? store.credentials.get(team.credentialId) : null;
  const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
  const sub = team.submissionId ? store.submissions.get(team.submissionId) : null;
  return {
    id: team.id,
    name: team.name,
    mode: team.mode,
    state: team.state,
    rosterState: team.rosterState,
    roster: team.roster.map((m) => ({ handle: m.handle, displayName: m.displayName, role: m.role })),
    label: cred ? cred.label : null,
    keySource: team.keySource,
    tagColor: team.tagColor,
    tagLabel: team.tagLabel,
    keySourceText: team.state === 'DRAFT' ? null : keySourceText(team),
    fingerprint: cred ? wa.formatFingerprint(cred.fingerprint) : null,
    enrolledAt: team.enrolledAt,
    assignedPromptId: team.assignedPromptId,
    assignedTrack: prompt ? prompt.track : null,
    deadline: prompt ? prompt.deadline : null,
    revealedAt: team.revealedAt,
    // FR-31 submission columns (T6): time, short hash, commit, owner check.
    submittedAt: sub ? sub.signedAt : null,
    shortHash: sub ? sub.contentHash.slice(0, 8) : null,
    commitShort: sub ? sub.commitSha.slice(0, 7) : null,
    ownerCheck: sub ? sub.ownerCheck : null,
    // FR-31: red "Missed deadline" once the team's deadline passes unsigned.
    missedDeadline: !sub && Boolean(prompt) && Date.now() >= Date.parse(prompt.deadline),
    // FR-41: `OVERRIDE lost` or `OVERRIDE broken` stays on the row until reset.
    overrideReason: team.lastOverride ? team.lastOverride.reason : null,
  };
}

function teamRows() {
  return [...store.teams.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map(teamRow);
}

// FR-03: build a DRAFT team with an empty OPEN roster, log team.created,
// then store it. The demo seed (FR-36) passes the key fields to prefill.
// The caller has already checked the name and the 40 team limit.
function createDraftTeam(name, mode, keyFields = null) {
  const team = {
    id: newTeamId(),
    name,
    nameKey: name.toLowerCase(),
    mode,
    state: 'DRAFT',
    rosterState: 'OPEN',
    roster: [],
    rosterHash: null,
    credentialId: null,
    assignedPromptId: null,
    revealedAt: null,
    submissionId: null,
    muted: false,
    keySource: keyFields ? keyFields.keySource : mode === 'key' ? 'pool' : 'own-passkey',
    tagColor: keyFields ? keyFields.tagColor : null,
    tagLabel: keyFields ? keyFields.tagLabel : null,
    overrideCount: 0,
    lastOverride: null,
    warned10: false,
    createdAt: new Date().toISOString(),
    enrolledAt: null,
  };
  log.append(ORG_ACTOR, 'team.created', { teamId: team.id, teamName: team.name, mode: team.mode });
  store.teams.set(team.id, team);
  return team;
}

// ---------- FR-03 Create and delete a draft team ----------
router.post(
  '/teams',
  sessions.requireOrg,
  body({
    name: { type: 'string', label: 'Team name', min: 1, max: 40 },
    mode: { type: 'string', label: 'Credential mode', oneOf: ['key', 'passkey'] },
  }),
  (req, res) => {
    const name = canon.norm(req.body.name);
    const nameKey = name.toLowerCase();
    for (const t of store.teams.values()) {
      if (t.nameKey === nameKey) return failWith(res, 'TEAM_NAME_TAKEN', { team: t.name });
    }
    if (store.teams.size >= MAX_TEAMS) return failWith(res, 'TEAM_LIMIT');
    const team = createDraftTeam(name, req.body.mode);
    res.json({ ok: true, team: teamRow(team) });
  }
);

router.delete('/teams/:teamId', sessions.requireOrg, query({}), (req, res) => {
  const team = getTeam(req.params.teamId);
  if (!team) return failWith(res, 'TEAM_NOT_FOUND');
  if (team.state !== 'DRAFT') return failWith(res, 'TEAM_NOT_DELETABLE', { team: team.name });
  log.append(ORG_ACTOR, 'team.deleted', { teamId: team.id, teamName: team.name });
  store.teams.delete(team.id);
  res.json({ ok: true });
});

// ---------- FR-43 Remove a member at any time ----------
// Members join themselves with the team's key (tap.js, D15). The organizer
// can remove anyone at any time with no tap: removing a person cannot let
// anyone act as the team. A receipt keeps the roster the team signed.
router.delete('/teams/:teamId/roster/:handle', sessions.requireOrg, query({}), (req, res) => {
  const team = getTeam(req.params.teamId);
  if (!team) return failWith(res, 'TEAM_NOT_FOUND');
  const handleKey = String(req.params.handle).toLowerCase();
  const member = team.roster.find((m) => m.handleKey === handleKey);
  if (!member) return failWith(res, 'NOT_ON_ROSTER', { handle: String(req.params.handle).slice(0, 39), team: team.name });
  log.append(ORG_ACTOR, 'roster.removed', { teamId: team.id, handle: member.handle });
  team.roster = team.roster.filter((m) => m !== member);
  if (team.state !== 'DRAFT') team.rosterHash = currentRosterHash(team).toString('hex');
  res.json({ ok: true, team: teamRow(team) });
});

// ---------- FR-40 key source rules ----------
// Returns { keyFields } or { code, vars } for failWith.
function checkKeySource(team, b) {
  const allowed = team.mode === 'key' ? ['pool', 'own-key'] : ['own-passkey'];
  if (!allowed.includes(b.keySource)) return { code: 'BAD_TYPE', vars: { label: 'Key source' } };
  if (b.keySource === 'pool') {
    const tagColor = canon.norm(b.tagColor || '');
    const tagLabel = canon.norm(b.tagLabel || '');
    if (!tagColor || !tagLabel) return { code: 'TAG_MISSING', vars: {} };
    if ([...tagColor].length > 20) return { code: 'BAD_LENGTH', vars: { label: 'Tag color', min: 1, max: 20 } };
    if ([...tagLabel].length > 20) return { code: 'BAD_LENGTH', vars: { label: 'Pool label', min: 1, max: 20 } };
    return { keyFields: { keySource: 'pool', tagColor, tagLabel } };
  }
  if (b.ownApproved !== true) return { code: 'OWN_KEY_NOT_APPROVED', vars: {} };
  return { keyFields: { keySource: b.keySource, tagColor: null, tagLabel: null } };
}

// ---------- FR-05 Enroll ceremony ----------
router.post(
  '/enroll/options',
  sessions.requireOrg,
  orgCeremonyLimit,
  body({
    teamId: { type: 'string', label: 'Team', min: 1, max: 40 },
    keySource: { type: 'string', label: 'Key source', oneOf: ['pool', 'own-key', 'own-passkey'] },
    tagColor: { type: 'string', label: 'Tag color', required: false },
    tagLabel: { type: 'string', label: 'Pool label', required: false },
    ownApproved: { type: 'boolean', label: 'Approval box', required: false },
  }),
  async (req, res) => {
    const team = getTeam(req.body.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    if (team.state !== 'DRAFT' || team.rosterState !== 'OPEN') return failWith(res, 'ROSTER_LOCKED', { team: team.name });
    const source = checkKeySource(team, req.body);
    if (source.code) return failWith(res, source.code, source.vars);

    const rosterHash = currentRosterHash(team);
    const nonce = crypto.randomBytes(32);
    const challenge = canon.enrollChallenge(rosterHash, nonce);
    const options = await wa.registrationOptions(
      { ownerId: team.id, userName: team.name, mode: team.mode, excludeCredentials: wa.excludeList() },
      challenge
    );
    const rec = wa.newPending('enroll', {
      teamId: team.id,
      challenge: canon.b64u(challenge),
      nonce,
      rosterHash: rosterHash.toString('hex'),
      keyFields: source.keyFields,
    });
    res.json({ ok: true, ceremonyId: rec.id, options, rosterHash: rec.rosterHash });
  }
);

router.post(
  '/enroll/verify',
  sessions.requireOrg,
  body({
    ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
    response: { type: 'object', label: 'Key response' },
  }),
  async (req, res) => {
    // Delete first: the challenge is spent whatever happens next (L4).
    const taken = wa.takePending(req.body.ceremonyId, 'enroll');
    if (!taken.rec) return failWith(res, 'ENROLL_EXPIRED');
    const rec = taken.rec;

    // Recompute the challenge from the stored roster hash and nonce. Never
    // accept a challenge from the client.
    const expected = canon.b64u(canon.enrollChallenge(Buffer.from(rec.rosterHash, 'hex'), rec.nonce));

    let info;
    try {
      info = await wa.verifyRegistration(req.body.response, expected);
    } catch (err) {
      console.error('[enroll] registration did not verify:', err.message);
      return failWith(res, 'SERVER');
    }

    // After the last await: every check and every write in one block.
    const team = store.teams.get(rec.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    if (team.state !== 'DRAFT' || team.rosterState !== 'OPEN') return failWith(res, 'ROSTER_LOCKED', { team: team.name });
    const rosterHash = currentRosterHash(team).toString('hex');
    if (rosterHash !== rec.rosterHash) return failWith(res, 'ROSTER_CHANGED', { team: team.name });
    if (store.credentials.has(info.credential.id)) return failWith(res, 'KEY_TAKEN');
    const label = wa.teamLabel(team.mode, info, req.body.response);
    if (!label) return failWith(res, 'NOT_A_KEY');

    const cred = wa.credentialRecord(info, req.body.response, { ownerKind: 'team', ownerId: team.id, label });
    const k = rec.keyFields;
    log.append(ORG_ACTOR, 'team.enrolled', {
      teamId: team.id,
      teamName: team.name,
      credentialId: cred.id,
      label,
      rosterHash,
      keySource: k.keySource,
      tagColor: k.tagColor,
      tagLabel: k.tagLabel,
      keyFingerprint: cred.fingerprint,
    });
    store.credentials.set(cred.id, cred);
    team.credentialId = cred.id;
    team.rosterHash = rosterHash;
    team.rosterState = 'BOUND';
    team.state = 'ENROLLED';
    team.enrolledAt = new Date().toISOString();
    team.keySource = k.keySource;
    team.tagColor = k.tagColor;
    team.tagLabel = k.tagLabel;
    res.json({ ok: true, team: teamRow(team) });
  }
);

// ---------- FR-41 Key override (SDS.md 5.6, 6.8, D13) ----------
// Two chained ceremonies: the organizer taps the organizer credential, with
// a challenge bound to the team, its old credential, and the reason; then
// the captain taps the replacement key, with a challenge bound to the
// team's stored roster hash and that authorization. The organizer cookie
// alone can never replace a key (L1). The old credential becomes REVOKED
// and stays stored, so it stays unique and excluded (L3).

function organizerCredential() {
  for (const c of store.credentials.values()) if (c.ownerKind === 'organizer' && c.state === 'ACTIVE') return c;
  return null;
}

// State checks shared by options and verify. Returns { code, vars } or null.
function overrideStateProblem(team) {
  if (team.state === 'DRAFT') return { code: 'NOT_ENROLLED', vars: { team: team.name } };
  if (team.state === 'SUBMITTED') return { code: 'OVERRIDE_NOT_NEEDED', vars: { team: team.name } };
  if (team.state !== 'ENROLLED' && team.state !== 'REVEALED') return { code: 'NOT_ENROLLED', vars: { team: team.name } };
  return null;
}

router.post(
  '/override/options',
  sessions.requireOrg,
  orgCeremonyLimit,
  body({
    teamId: { type: 'string', label: 'Team', min: 1, max: 40 },
    reason: { type: 'string', label: 'Reason', oneOf: ['lost', 'broken'] },
    confirm: { type: 'string', label: 'Confirm text', required: false },
    keySource: { type: 'string', label: 'Key source', oneOf: ['pool', 'own-key', 'own-passkey'] },
    tagColor: { type: 'string', label: 'Tag color', required: false },
    tagLabel: { type: 'string', label: 'Pool label', required: false },
    ownApproved: { type: 'boolean', label: 'Approval box', required: false },
  }),
  async (req, res) => {
    const b = req.body;
    const team = getTeam(b.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    if (b.confirm !== 'OVERRIDE') return failWith(res, 'OVERRIDE_CONFIRM');
    const problem = overrideStateProblem(team);
    if (problem) return failWith(res, problem.code, problem.vars);
    const source = checkKeySource(team, b);
    if (source.code) return failWith(res, source.code, source.vars);
    const org = organizerCredential();
    if (!org) return failWith(res, 'NO_ORGANIZER');

    const oHash = canon.overrideHash(team.id, team.credentialId, b.reason); // 6.8 step 1
    const nonce = crypto.randomBytes(32);
    const challenge = canon.overrideAuthChallenge(oHash, nonce); // 6.8 step 2
    const uv = org.label === 'Organizer key' ? 'discouraged' : 'preferred';
    const options = await wa.authenticationOptions(org, uv, challenge); // organizer credential only
    const rec = wa.newPending('override-auth', {
      teamId: team.id,
      challenge: canon.b64u(challenge),
      nonce,
      overrideHash: oHash.toString('hex'),
      reason: b.reason,
      keyFields: source.keyFields,
    });
    res.json({ ok: true, ceremonyId: rec.id, options });
  }
);

router.post(
  '/override/authorize',
  sessions.requireOrg,
  body({
    ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
    response: { type: 'object', label: 'Key response' },
  }),
  async (req, res) => {
    const taken = wa.takePending(req.body.ceremonyId, 'override-auth'); // deleted before verify (L4)
    if (!taken.rec) return failWith(res, 'OVERRIDE_EXPIRED');
    const rec = taken.rec;
    const team = store.teams.get(rec.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const org = organizerCredential();
    if (!org) return failWith(res, 'NO_ORGANIZER');
    const response = req.body.response;
    const refused = (reason) => {
      log.append(ORG_ACTOR, 'tap.failed', { teamId: team.id, purpose: 'override', reason });
      return failWith(res, 'NOT_ORG_KEY');
    };
    if (response.id !== org.id) return refused('wrong_credential');
    let counter;
    try {
      counter = wa.counterCheck(org, response);
    } catch (_) {
      return refused('verify_failed');
    }
    if (counter.regressed) {
      log.append(ORG_ACTOR, 'tap.counter_regression', { teamId: null, credentialId: org.id, storedCounter: org.counter, receivedCounter: counter.received });
      return failWith(res, 'COUNTER_BACKWARDS');
    }
    // Recompute from stored values; never accept a challenge from the client.
    const expected = canon.b64u(canon.overrideAuthChallenge(Buffer.from(rec.overrideHash, 'hex'), rec.nonce));
    let newCounter;
    try {
      newCounter = await wa.verifyAuthentication(response, expected, org);
    } catch (err) {
      console.error('[override] organizer assertion did not verify:', err.message);
      return refused('verify_failed');
    }
    org.counter = newCounter;

    // The authorization covers this team, its current key, and this reason.
    const problem = overrideStateProblem(team);
    if (problem) return failWith(res, problem.code, problem.vars);
    if (canon.overrideHash(team.id, team.credentialId, rec.reason).toString('hex') !== rec.overrideHash) return failWith(res, 'OVERRIDE_EXPIRED');

    const nonce2 = crypto.randomBytes(32);
    const regChallenge = canon.overrideRegChallenge(Buffer.from(team.rosterHash, 'hex'), Buffer.from(rec.overrideHash, 'hex'), nonce2); // 6.8 step 3
    const options = await wa.registrationOptions(
      { ownerId: team.id, userName: team.name, mode: team.mode, excludeCredentials: wa.excludeList() },
      regChallenge
    );
    const next = wa.newPending('override', {
      teamId: team.id,
      challenge: canon.b64u(regChallenge),
      nonce: nonce2,
      rosterHash: team.rosterHash,
      overrideHash: rec.overrideHash,
      reason: rec.reason,
      keyFields: rec.keyFields,
    });
    res.json({ ok: true, ceremonyId: next.id, options });
  }
);

router.post(
  '/override/verify',
  sessions.requireOrg,
  body({
    ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
    response: { type: 'object', label: 'Key response' },
  }),
  async (req, res) => {
    const taken = wa.takePending(req.body.ceremonyId, 'override'); // deleted before verify (L4)
    if (!taken.rec) return failWith(res, 'OVERRIDE_EXPIRED');
    const rec = taken.rec;
    const expected = canon.b64u(canon.overrideRegChallenge(Buffer.from(rec.rosterHash, 'hex'), Buffer.from(rec.overrideHash, 'hex'), rec.nonce));
    let info;
    try {
      info = await wa.verifyRegistration(req.body.response, expected);
    } catch (err) {
      console.error('[override] registration did not verify:', err.message);
      return failWith(res, 'SERVER');
    }

    // After the last await: every check and every write in one block.
    const team = store.teams.get(rec.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const problem = overrideStateProblem(team);
    if (problem) return failWith(res, problem.code, problem.vars);
    if (currentRosterHash(team).toString('hex') !== team.rosterHash) return failWith(res, 'OVERRIDE_EXPIRED');
    const oldCred = store.credentials.get(team.credentialId);
    if (!oldCred || canon.overrideHash(team.id, oldCred.id, rec.reason).toString('hex') !== rec.overrideHash) return failWith(res, 'OVERRIDE_EXPIRED');
    if (store.credentials.has(info.credential.id)) return failWith(res, 'KEY_TAKEN'); // ACTIVE or REVOKED, the lost key too
    const label = wa.teamLabel(team.mode, info, req.body.response);
    if (!label) return failWith(res, 'NOT_A_KEY');

    const cred = wa.credentialRecord(info, req.body.response, { ownerKind: 'team', ownerId: team.id, label });
    const k = rec.keyFields;
    const entry = log.append(ORG_ACTOR, 'team.override', {
      teamId: team.id,
      teamName: team.name,
      oldCredentialId: oldCred.id,
      credentialId: cred.id,
      label,
      keySource: k.keySource,
      tagColor: k.tagColor,
      tagLabel: k.tagLabel,
      keyFingerprint: cred.fingerprint,
      reason: rec.reason,
      rosterHash: team.rosterHash,
    });
    store.credentials.set(cred.id, cred);
    oldCred.state = 'REVOKED';
    team.credentialId = cred.id;
    team.keySource = k.keySource;
    team.tagColor = k.tagColor;
    team.tagLabel = k.tagLabel;
    team.overrideCount += 1;
    team.lastOverride = { at: entry.ts, seq: entry.seq, reason: rec.reason };
    // FR-41 step 5: every session of this team ends, and every open tap or
    // sign ceremony for this team is deleted. State, prompt, and revealedAt stay.
    for (const [sid, s] of store.sessions) if (s.teamId === team.id) store.sessions.delete(sid);
    for (const [id, p] of store.pending) if (p.teamId === team.id) store.pending.delete(id);
    res.json({ ok: true, team: teamRow(team) });
  }
);

module.exports = { router, teamRow, teamRows, getTeam, keySourceText, currentRosterHash, createDraftTeam, ROLES, MAX_MEMBERS };
