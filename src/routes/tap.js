'use strict';
// src/routes/tap.js: the team tap ceremony, joining a team with its key,
// prompt reveal, and the client failure report (SRS.md FR-09, FR-10,
// FR-11, FR-42; SDS.md 5.2, 5.7).
// Ceremony tier: the cookie is never used for identity here. The team is
// the one whose ACTIVE credential produced the verified assertion (L1).

const express = require('express');

const { store } = require('../store');
const { failWith, notice } = require('../errors');
const { body, teamCeremonyLimit, clientFailureLimit } = require('../validate');
const canon = require('../canon');
const { b64u } = canon;
const log = require('../log');
const sessions = require('../sessions');
const wa = require('../webauthn');
const { getTeam, currentRosterHash, ROLES, MAX_MEMBERS } = require('./enroll');

const router = express.Router();
const SYSTEM = Object.freeze({ kind: 'system', id: null });

function activeCredential(team) {
  const c = team.credentialId ? store.credentials.get(team.credentialId) : null;
  return c && c.state === 'ACTIVE' ? c : null;
}

function isRevokedOf(team, credentialId) {
  const c = store.credentials.get(credentialId);
  return Boolean(c && c.ownerId === team.id && c.state === 'REVOKED');
}

// FR-04 roster rules for a join (FR-42). Returns a failure or null.
// A team with no Captain makes the joiner its Captain.
function joinProblem(team, handle, role) {
  if (team.state === 'SUBMITTED') return { code: 'ADD_AFTER_SUBMIT', vars: { team: team.name } };
  const key = handle.toLowerCase();
  for (const t of store.teams.values()) {
    if (t.roster.some((m) => m.handleKey === key)) return { code: 'HANDLE_TAKEN', vars: { handle, team: t.name } };
  }
  const max = team.mode === 'passkey' ? 1 : MAX_MEMBERS;
  if (team.roster.length >= max) return { code: 'ROSTER_FULL', vars: { team: team.name } };
  if (role === 'Captain' && team.roster.some((m) => m.role === 'Captain')) return { code: 'SECOND_CAPTAIN', vars: { team: team.name } };
  return null;
}

function roleFor(team, asked) {
  return team.roster.some((m) => m.role === 'Captain') ? asked : 'Captain';
}

// ---------- FR-09 options (and FR-42 join) ----------
router.post(
  '/options',
  teamCeremonyLimit,
  body({
    teamId: { type: 'string', label: 'Team', min: 1, max: 40 },
    purpose: { type: 'string', label: 'Purpose', oneOf: ['enter', 'join'] },
    handle: { type: 'string', label: 'GitHub handle', rule: 'handle', required: false },
    displayName: { type: 'string', label: 'Display name', min: 1, max: 40, required: false },
    role: { type: 'string', label: 'Role', oneOf: ROLES, oneOfCode: 'BAD_ROLE', required: false },
  }),
  async (req, res) => {
    const team = getTeam(req.body.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const cred = activeCredential(team);
    if (team.state === 'DRAFT' || !cred) return failWith(res, 'NOT_ENROLLED', { team: team.name });

    const b = req.body;
    let member = null;
    let nonce = null;
    let challenge;
    if (b.purpose === 'join') {
      if (b.handle === undefined) return failWith(res, 'BAD_TYPE', { label: 'GitHub handle' });
      if (b.displayName === undefined) return failWith(res, 'BAD_TYPE', { label: 'Display name' });
      if (b.role === undefined) return failWith(res, 'BAD_TYPE', { label: 'Role' });
      const role = roleFor(team, b.role);
      const problem = joinProblem(team, b.handle, role);
      if (problem) return failWith(res, problem.code, problem.vars);
      member = { handle: b.handle, displayName: canon.norm(b.displayName), role };
      nonce = wa.freshChallenge();
      challenge = canon.joinChallenge(canon.memberHash(team.id, member), nonce); // SDS.md 6.9
    } else {
      challenge = wa.freshChallenge();
    }
    // SDS.md 5.2: discouraged for key mode (a tap), preferred for passkeys.
    const uv = team.mode === 'key' ? 'discouraged' : 'preferred';
    const options = await wa.authenticationOptions(cred, uv, challenge);
    // The team session already in this browser, if any, is replaced on success.
    const { sid } = sessions.sidFromCookie(req, 'team');
    const rec = wa.newPending('tap', { teamId: team.id, purpose: b.purpose, challenge: b64u(challenge), nonce, member, replacesSid: sid });
    res.json({ ok: true, ceremonyId: rec.id, options });
  }
);

// ---------- FR-09 and FR-10 verify ----------
router.post(
  '/verify',
  body({
    ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
    response: { type: 'object', label: 'Key response' },
  }),
  async (req, res) => {
    const taken = wa.takePending(req.body.ceremonyId, 'tap'); // deleted before verify (L4)
    if (!taken.rec) return failWith(res, taken.status === 'expired' ? 'TAP_EXPIRED' : 'TAP_USED');
    const rec = taken.rec;
    const team = store.teams.get(rec.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const response = req.body.response;
    const cred = activeCredential(team);
    const failed = (reason) => {
      log.append(SYSTEM, 'tap.failed', { teamId: team.id, purpose: rec.purpose, reason });
      return failWith(res, 'WRONG_KEY', { team: team.name });
    };

    if (!cred || response.id !== cred.id) return failed(isRevokedOf(team, response.id) ? 'revoked' : 'wrong_credential');

    let counter;
    try {
      counter = wa.counterCheck(cred, response);
    } catch (_) {
      return failed('verify_failed');
    }
    if (counter.regressed) {
      log.append(SYSTEM, 'tap.counter_regression', {
        teamId: team.id,
        credentialId: cred.id,
        storedCounter: cred.counter,
        receivedCounter: counter.received,
      });
      return failWith(res, 'COUNTER_BACKWARDS');
    }

    // A join recomputes its challenge from the stored member and nonce, so
    // the tap approves exactly that member (SDS.md 6.9).
    const expected = rec.purpose === 'join' ? b64u(canon.joinChallenge(canon.memberHash(team.id, rec.member), rec.nonce)) : rec.challenge;
    let newCounter;
    try {
      newCounter = await wa.verifyAuthentication(response, expected, cred);
    } catch (err) {
      console.error('[tap] assertion did not verify:', err.message);
      return failed('verify_failed');
    }

    // After the last await: re-check, then log, then write, in one block.
    if (!store.teams.has(team.id) || activeCredential(team) !== cred) return failed('revoked');
    if (rec.purpose === 'join') {
      const problem = joinProblem(team, rec.member.handle, rec.member.role);
      if (problem) return failWith(res, problem.code, problem.vars);
    }
    const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
    const reveal = team.state === 'ENROLLED' && Boolean(prompt);
    const actor = { kind: 'team', id: team.id };
    const now = new Date().toISOString();

    log.append(actor, 'tap.ok', { teamId: team.id, purpose: rec.purpose, credentialId: cred.id, counter: newCounter });
    if (rec.purpose === 'join') {
      log.append(actor, 'roster.joined', { teamId: team.id, handle: rec.member.handle, role: rec.member.role, credentialId: cred.id });
    }
    if (reveal) log.append(actor, 'prompt.revealed', { teamId: team.id, teamName: team.name, promptId: prompt.id, revealedAt: now });

    cred.counter = newCounter;
    if (rec.replacesSid) {
      const old = store.sessions.get(rec.replacesSid);
      if (old && old.kind === 'team') sessions.revoke(rec.replacesSid);
    }
    if (rec.purpose === 'join') {
      team.roster.push({
        handle: rec.member.handle,
        handleKey: rec.member.handle.toLowerCase(),
        displayName: rec.member.displayName,
        role: rec.member.role,
        addedAt: now,
      });
      team.rosterHash = currentRosterHash(team).toString('hex');
    }
    const session = sessions.mint(res, 'team', { teamId: team.id, credentialId: cred.id });
    if (rec.purpose === 'join') session.memberHandle = rec.member.handle;
    if (reveal) {
      team.revealedAt = now;
      team.state = 'REVEALED';
    }

    // L2: the prompt leaves the server here only, in this team's own reveal.
    res.json({
      ok: true,
      team: { id: team.id, name: team.name },
      notice: prompt ? null : notice('N01', { team: team.name }),
      prompt: reveal ? { track: prompt.track, instructions: prompt.instructions, deadline: prompt.deadline } : null,
      secret: null,
    });
  }
);

// ---------- FR-11 client reported tap failure ----------
// The browser refused or cancelled a tap, so no assertion reached the
// server. The page reports it so the console log shows the attempt.
router.post(
  '/client-failure',
  clientFailureLimit,
  body({
    ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
    errorName: { type: 'string', label: 'Error name', min: 1, max: 40 },
  }),
  (req, res) => {
    const rec = store.pending.get(req.body.ceremonyId);
    if (!rec || Date.now() >= rec.expiresAt) {
      if (rec) store.pending.delete(rec.id);
      return failWith(res, 'TAP_NOT_OPEN');
    }
    log.append({ kind: 'client', id: rec.teamId }, 'tap.client_failed', {
      teamId: rec.teamId,
      kind: rec.kind,
      errorName: req.body.errorName,
      reportedBy: 'client',
    });
    store.pending.delete(rec.id);
    res.json({ ok: true });
  }
);

module.exports = { router, activeCredential };
