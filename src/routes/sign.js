'use strict';
// src/routes/sign.js: the Sign ceremony and submission creation (SRS.md
// FR-28, FR-29, FR-32; SDS.md 5.3, 6.1).
// Ceremony tier: the cookie is never used for identity here. A submission
// exists only after a verified assertion from the team's ACTIVE credential
// whose challenge is derived from the content hash (L1, L3, L4). There is
// no unsigned fallback of any kind (L3).

const crypto = require('crypto');
const express = require('express');

const { store } = require('../store');
const { failWith } = require('../errors');
const { check, body, teamCeremonyLimit } = require('../validate');
const canon = require('../canon');
const { b64u } = canon;
const log = require('../log');
const sessions = require('../sessions');
const wa = require('../webauthn');
const { getTeam, currentRosterHash } = require('./enroll');
const { activeCredential } = require('./tap');

const router = express.Router();
const SYSTEM = Object.freeze({ kind: 'system', id: null });

// The four text fields of a submission, in form order. `declared` is
// checked by hand below, because FR-28 answers any value other than true
// with E64, not with the generic wrong type sentence.
const CONTENT_SPEC = {
  projectName: { type: 'string', label: 'Project name', min: 1, max: 80 },
  repoUrl: { type: 'string', label: 'Repo link', min: 1, max: 200, rule: 'https' },
  commitSha: { type: 'string', label: 'Commit' },
  description: { type: 'string', label: 'Description', min: 1, max: 1000 },
};

function withoutDeclared(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return b;
  const { declared, ...rest } = b; // eslint-disable-line no-unused-vars
  return rest;
}

// FR-28 content rules, in form order. Returns { code, vars } or null.
function contentProblem(b) {
  const commit = canon.norm(b.commitSha).toLowerCase();
  if (!canon.COMMIT_RE.test(commit)) return { code: 'BAD_COMMIT', vars: {} };
  if (b.declared !== true) return { code: 'NO_DECLARATION', vars: {} };
  return null;
}

// SDS.md 6.1 steps 1 and 2: canonical string and content hash, with the
// team's current roster hash as the last element (D15).
function contentOf(teamId, b, rosterHashHex) {
  const canonical = canon.submissionCanonical(
    { teamId, projectName: b.projectName, repoUrl: b.repoUrl, commitSha: b.commitSha, description: b.description },
    rosterHashHex
  );
  return { canonical, hash: canon.contentHash(canonical) };
}

function deadlinePassed(team) {
  const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
  return !prompt || Date.now() >= Date.parse(prompt.deadline);
}

// FR-32: informational only, never blocks. Compared with the signed roster.
function ownerCheck(repoUrl, roster) {
  let url;
  try {
    url = new URL(repoUrl);
  } catch (_) {
    return 'notgithub';
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return 'notgithub';
  const owner = url.pathname.split('/').filter(Boolean)[0];
  if (!owner) return 'notgithub';
  return roster.some((m) => m.handleKey === owner.toLowerCase()) ? 'match' : 'nomatch';
}

// ---------- FR-28 Sign options ----------
router.post(
  '/options',
  teamCeremonyLimit,
  (req, res, next) => {
    const problem = check(withoutDeclared(req.body), { teamId: { type: 'string', label: 'Team', min: 1, max: 40 }, ...CONTENT_SPEC });
    if (problem) return failWith(res, problem.code, problem.vars);
    const bad = contentProblem(req.body);
    if (bad) return failWith(res, bad.code, bad.vars);
    next();
  },
  async (req, res) => {
    const b = req.body;
    const team = getTeam(b.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    if (team.state === 'SUBMITTED') return failWith(res, 'ALREADY_SUBMITTED', { team: team.name });
    if (team.state !== 'REVEALED') return failWith(res, 'REVEAL_FIRST');
    if (deadlinePassed(team)) return failWith(res, 'DEADLINE_PASSED', { team: team.name });
    const cred = activeCredential(team);
    if (!cred) return failWith(res, 'NOT_ENROLLED', { team: team.name });

    const rosterHashHex = currentRosterHash(team).toString('hex');
    const { hash } = contentOf(team.id, b, rosterHashHex);
    const nonce = crypto.randomBytes(32);
    const challenge = canon.signChallenge(hash, nonce); // SDS.md 6.1 step 4, 82 byte input
    // Same user verification rule as the team tap (SDS.md 5.2).
    const uv = team.mode === 'key' ? 'discouraged' : 'preferred';
    const options = await wa.authenticationOptions(cred, uv, challenge); // asserts the encoding (6.1 step 7)

    const contentHashHex = hash.toString('hex');
    // After the last await: the state may have moved on while options were built.
    if (team.state === 'SUBMITTED') return failWith(res, 'ALREADY_SUBMITTED', { team: team.name });
    log.append({ kind: 'team', id: team.id }, 'sign.started', { teamId: team.id, contentHash: contentHashHex });
    // Several pending sign ceremonies may exist for one team; each expires on
    // its own, so a stranger cannot cancel the team's real one (FR-28).
    const { sid } = sessions.sidFromCookie(req, 'team');
    const rec = wa.newPending('sign', {
      teamId: team.id,
      challenge: b64u(challenge),
      nonce,
      contentHash: contentHashHex,
      rosterHash: rosterHashHex,
      replacesSid: sid,
    });
    res.json({ ok: true, ceremonyId: rec.id, options, contentHash: contentHashHex, shortHash: contentHashHex.slice(0, 8) });
  }
);

// ---------- FR-29 Sign verify and submission creation ----------
router.post(
  '/verify',
  body({
    ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
    projectName: { type: 'string', label: 'Project name' },
    repoUrl: { type: 'string', label: 'Repo link' },
    commitSha: { type: 'string', label: 'Commit' },
    description: { type: 'string', label: 'Description' },
    declared: { type: 'boolean', label: 'Build declaration' },
    response: { type: 'object', label: 'Key response' },
  }),
  async (req, res) => {
    // Delete first: the challenge is spent whatever happens next (L4).
    const taken = wa.takePending(req.body.ceremonyId, 'sign');
    if (!taken.rec) return failWith(res, 'SIGN_EXPIRED');
    const rec = taken.rec;
    const team = store.teams.get(rec.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const actor = { kind: 'team', id: team.id };
    const signFailed = (reason, code, vars = {}) => {
      log.append(SYSTEM, 'sign.failed', { teamId: team.id, reason });
      return failWith(res, code, vars);
    };

    // Re-hash what was sent with the assertion, with the team's current
    // roster hash. Anything that differs from the issued content, including
    // a roster change, is a changed submission (SDS.md 5.3 step 6).
    const b = req.body;
    const rosterHashHex = currentRosterHash(team).toString('hex');
    const content = { projectName: b.projectName, repoUrl: b.repoUrl, commitSha: b.commitSha, description: b.description };
    let hash = null;
    if (!check(content, CONTENT_SPEC) && !contentProblem(b)) {
      try {
        hash = contentOf(team.id, b, rosterHashHex).hash;
      } catch (_) {
        hash = null;
      }
    }
    if (!hash || hash.toString('hex') !== rec.contentHash) return signFailed('content_changed', 'CONTENT_CHANGED');

    const response = b.response;
    const cred = activeCredential(team);
    if (!cred || response.id !== cred.id) return signFailed('wrong_credential', 'NOT_SIGNED');

    let counter;
    try {
      counter = wa.counterCheck(cred, response);
    } catch (_) {
      return signFailed('verify_failed', 'NOT_SIGNED');
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

    // Recompute the challenge from the re-hashed content and the stored
    // nonce. Never accept a challenge from the client (SDS.md 6.1 step 8).
    const expected = b64u(canon.signChallenge(hash, rec.nonce));
    let newCounter;
    try {
      newCounter = await wa.verifyAuthentication(response, expected, cred);
    } catch (err) {
      console.error('[sign] assertion did not verify:', err.message);
      return signFailed('verify_failed', 'NOT_SIGNED');
    }

    // After the last await, in one synchronous block: re-check, log, write.
    if (!store.teams.has(team.id) || activeCredential(team) !== cred) return signFailed('wrong_credential', 'NOT_SIGNED');
    if (team.state === 'SUBMITTED') return failWith(res, 'ALREADY_SUBMITTED', { team: team.name });
    if (team.state !== 'REVEALED') return failWith(res, 'REVEAL_FIRST');
    if (deadlinePassed(team)) return failWith(res, 'DEADLINE_PASSED', { team: team.name });
    // A join or removal finished during the await: the roster is no longer
    // the one inside the signed content.
    if (currentRosterHash(team).toString('hex') !== rosterHashHex) return signFailed('content_changed', 'CONTENT_CHANGED');

    const id = 'sb_' + crypto.randomBytes(8).toString('hex');
    const contentHashHex = hash.toString('hex');
    const entry = log.append(actor, 'submission.signed', {
      teamId: team.id,
      teamName: team.name,
      submissionId: id,
      contentHash: contentHashHex,
      counter: newCounter,
    });

    const roster = team.roster.map((m) => ({ handle: m.handle, handleKey: m.handleKey, displayName: m.displayName, role: m.role, addedAt: m.addedAt }));
    const repoUrl = canon.norm(b.repoUrl);
    const signedAt = entry.ts;
    const submission = {
      id,
      teamId: team.id,
      projectName: canon.norm(b.projectName),
      repoUrl,
      commitSha: canon.norm(b.commitSha).toLowerCase(),
      description: canon.norm(b.description),
      declaration: canon.DECLARATION_V1,
      canonical: contentOf(team.id, b, rosterHashHex).canonical,
      contentHash: contentHashHex,
      nonce: rec.nonce.toString('hex'),
      challenge: expected,
      credentialId: cred.id,
      authenticatorData: response.response.authenticatorData,
      clientDataJSON: response.response.clientDataJSON,
      signature: response.response.signature,
      counter: newCounter,
      ownerCheck: ownerCheck(repoUrl, roster),
      rosterHash: rosterHashHex,
      roster,
      signedAt,
      logSeq: entry.seq,
      logEntryHash: entry.entryHash,
    };
    store.submissions.set(id, submission);
    team.submissionId = id;
    team.state = 'SUBMITTED';
    cred.counter = newCounter;
    // FR-29: a team session is minted as in FR-09.
    if (rec.replacesSid) {
      const old = store.sessions.get(rec.replacesSid);
      if (old && old.kind === 'team') sessions.revoke(rec.replacesSid);
    }
    sessions.mint(res, 'team', { teamId: team.id, credentialId: cred.id });

    res.json({ ok: true, submissionId: id, receiptUrl: `/receipt/${id}`, shortHash: contentHashHex.slice(0, 8), signedAt });
  }
);

module.exports = { router };
