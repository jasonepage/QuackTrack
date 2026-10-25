'use strict';
// src/routes/tap.js: the team tap ceremony, prompt reveal, and the client
// failure report (SRS.md FR-09, FR-10, FR-11; SDS.md 5.2).
// Ceremony tier: the cookie is never used for identity here. The team is
// the one whose ACTIVE credential produced the verified assertion (L1).

const express = require('express');

const { store } = require('../store');
const { failWith, notice } = require('../errors');
const { body, teamCeremonyLimit, clientFailureLimit } = require('../validate');
const { b64u } = require('../canon');
const log = require('../log');
const sessions = require('../sessions');
const wa = require('../webauthn');
const { getTeam } = require('./enroll');

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

// ---------- FR-09 options ----------
router.post(
  '/options',
  teamCeremonyLimit,
  body({
    teamId: { type: 'string', label: 'Team', min: 1, max: 40 },
    purpose: { type: 'string', label: 'Purpose', oneOf: ['enter'] },
  }),
  async (req, res) => {
    const team = getTeam(req.body.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const cred = activeCredential(team);
    if (team.state === 'DRAFT' || !cred) return failWith(res, 'NOT_ENROLLED', { team: team.name });

    const challenge = wa.freshChallenge();
    // SDS.md 5.2: discouraged for key mode (a tap), preferred for passkeys.
    const uv = team.mode === 'key' ? 'discouraged' : 'preferred';
    const options = await wa.authenticationOptions(cred, uv, challenge);
    // The team session already in this browser, if any, is replaced on success.
    const { sid } = sessions.sidFromCookie(req, 'team');
    const rec = wa.newPending('tap', { teamId: team.id, purpose: 'enter', challenge: b64u(challenge), replacesSid: sid });
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

    let newCounter;
    try {
      newCounter = await wa.verifyAuthentication(response, rec.challenge, cred);
    } catch (err) {
      console.error('[tap] assertion did not verify:', err.message);
      return failed('verify_failed');
    }

    // After the last await: re-check, then log, then write, in one block.
    if (!store.teams.has(team.id) || activeCredential(team) !== cred) return failed('revoked');
    const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
    const reveal = team.state === 'ENROLLED' && Boolean(prompt);
    const actor = { kind: 'team', id: team.id };
    const now = new Date().toISOString();

    log.append(actor, 'tap.ok', { teamId: team.id, purpose: rec.purpose, credentialId: cred.id, counter: newCounter });
    if (reveal) log.append(actor, 'prompt.revealed', { teamId: team.id, teamName: team.name, promptId: prompt.id, revealedAt: now });

    cred.counter = newCounter;
    if (rec.replacesSid) {
      const old = store.sessions.get(rec.replacesSid);
      if (old && old.kind === 'team') sessions.revoke(rec.replacesSid);
    }
    sessions.mint(res, 'team', { teamId: team.id, credentialId: cred.id });
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
