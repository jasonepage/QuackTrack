'use strict';
// src/routes/enroll.js: draft teams, roster edits, key source, and the
// Enroll ceremony (SRS.md FR-03, FR-04, FR-05, FR-06, FR-40).
// The override ceremony (FR-41) is added here by T11.
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
  };
}

function teamRows() {
  return [...store.teams.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map(teamRow);
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
    const now = new Date().toISOString();
    const team = {
      id: newTeamId(),
      name,
      nameKey,
      mode: req.body.mode,
      state: 'DRAFT',
      rosterState: 'OPEN',
      roster: [],
      rosterHash: null,
      credentialId: null,
      assignedPromptId: null,
      revealedAt: null,
      submissionId: null,
      muted: false,
      keySource: req.body.mode === 'key' ? 'pool' : 'own-passkey',
      tagColor: null,
      tagLabel: null,
      overrideCount: 0,
      lastOverride: null,
      warned10: false,
      createdAt: now,
      enrolledAt: null,
    };
    log.append(ORG_ACTOR, 'team.created', { teamId: team.id, teamName: team.name, mode: team.mode });
    store.teams.set(team.id, team);
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

// ---------- FR-04 Draft roster entry ----------
router.post(
  '/teams/:teamId/roster',
  sessions.requireOrg,
  body({
    handle: { type: 'string', label: 'GitHub handle', rule: 'handle' },
    displayName: { type: 'string', label: 'Display name', min: 1, max: 40 },
    role: { type: 'string', label: 'Role', oneOf: ROLES, oneOfCode: 'BAD_ROLE' },
  }),
  (req, res) => {
    const team = getTeam(req.params.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    if (team.state !== 'DRAFT' || team.rosterState !== 'OPEN') return failWith(res, 'ROSTER_LOCKED', { team: team.name });
    const handle = req.body.handle;
    const handleKey = handle.toLowerCase();
    for (const t of store.teams.values()) {
      if (t.roster.some((m) => m.handleKey === handleKey)) return failWith(res, 'HANDLE_TAKEN', { handle, team: t.name });
    }
    if (req.body.role === 'Captain' && team.roster.some((m) => m.role === 'Captain')) {
      return failWith(res, 'SECOND_CAPTAIN', { team: team.name });
    }
    const max = team.mode === 'passkey' ? 1 : MAX_MEMBERS;
    if (team.roster.length >= max) return failWith(res, 'ROSTER_FULL', { team: team.name });

    log.append(ORG_ACTOR, 'roster.added', { teamId: team.id, handle, role: req.body.role });
    team.roster.push({
      handle,
      handleKey,
      displayName: canon.norm(req.body.displayName),
      role: req.body.role,
      addedAt: new Date().toISOString(),
    });
    res.json({ ok: true, team: teamRow(team) });
  }
);

router.delete('/teams/:teamId/roster/:handle', sessions.requireOrg, query({}), (req, res) => {
  const team = getTeam(req.params.teamId);
  if (!team) return failWith(res, 'TEAM_NOT_FOUND');
  if (team.state !== 'DRAFT' || team.rosterState !== 'OPEN') return failWith(res, 'ROSTER_LOCKED', { team: team.name });
  const handleKey = String(req.params.handle).toLowerCase();
  const member = team.roster.find((m) => m.handleKey === handleKey);
  if (!member) return failWith(res, 'NOT_ON_ROSTER', { handle: String(req.params.handle).slice(0, 39), team: team.name });
  log.append(ORG_ACTOR, 'roster.removed', { teamId: team.id, handle: member.handle });
  team.roster = team.roster.filter((m) => m !== member);
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

// Roster rules at enrollment (FR-05). Returns a failure or null.
function checkRosterReady(team) {
  if (team.roster.length === 0) return { code: 'NEED_MEMBER', vars: { team: team.name } };
  if (team.roster.filter((m) => m.role === 'Captain').length !== 1) return { code: 'NEED_CAPTAIN', vars: { team: team.name } };
  const max = team.mode === 'passkey' ? 1 : MAX_MEMBERS;
  if (team.roster.length > max) return { code: 'ROSTER_FULL', vars: { team: team.name } };
  return null;
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
    const rosterProblem = checkRosterReady(team);
    if (rosterProblem) return failWith(res, rosterProblem.code, rosterProblem.vars);
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

module.exports = { router, teamRow, teamRows, getTeam, ROLES };
