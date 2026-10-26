'use strict';
// src/routes/public.js: endpoints anyone may call, with no session.
// Never returns a prompt, a secret, chat, or a roster, except the roster
// handles a team signed, on that team's receipt (SRS.md FR-30). A receipt
// never shows the prompt (L2).

const express = require('express');
const { verifyAuthenticationResponse } = require('@simplewebauthn/server');

const config = require('../config');
const { store } = require('../store');
const { failWith } = require('../errors');
const { query } = require('../validate');
const canon = require('../canon');

const router = express.Router();
const RECEIPT_ID_RE = /^sb_[0-9a-f]{16}$/;

// Team names for the /team picker: enrolled teams only, id and name only.
router.get('/teams', query({}), (req, res) => {
  const teams = [...store.teams.values()]
    .filter((t) => t.state !== 'DRAFT')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((t) => ({ id: t.id, name: t.name }));
  res.json({ ok: true, teams });
});

// SDS.md 6.6 check 1. The roster hash is recomputed from the stored copy
// of the signed roster, so the handles a receipt shows are covered too.
function contentHashCheck(sub, team) {
  try {
    const rosterHashHex = canon.rosterHash(sub.teamId, team.name, sub.roster).toString('hex');
    const canonical = canon.submissionCanonical(sub, rosterHashHex, sub.declaration);
    return canon.contentHash(canonical).toString('hex') === sub.contentHash;
  } catch (_) {
    return false;
  }
}

// SDS.md 6.6 check 2: the challenge rebuilt from the content hash and the
// nonce must be the challenge inside the signed client data.
function challengeCheck(sub) {
  try {
    const want = canon.b64u(canon.signChallenge(Buffer.from(sub.contentHash, 'hex'), Buffer.from(sub.nonce, 'hex')));
    const clientData = JSON.parse(Buffer.from(sub.clientDataJSON, 'base64url').toString('utf8'));
    return want === sub.challenge && clientData.challenge === want;
  } catch (_) {
    return false;
  }
}

// SDS.md 6.6 check 3: re-verify the signature with counter 0, so the check
// does not depend on later taps.
async function signatureCheck(sub, cred) {
  if (!cred) return false;
  try {
    const result = await verifyAuthenticationResponse({
      response: {
        id: sub.credentialId,
        rawId: sub.credentialId,
        type: 'public-key',
        response: { authenticatorData: sub.authenticatorData, clientDataJSON: sub.clientDataJSON, signature: sub.signature },
        clientExtensionResults: {},
      },
      expectedChallenge: sub.challenge,
      expectedOrigin: config.ORIGIN,
      expectedRPID: config.RP_ID,
      credential: { id: cred.id, publicKey: cred.publicKey, counter: 0 },
      requireUserVerification: false,
    });
    return result.verified === true;
  } catch (_) {
    return false;
  }
}

// FR-30: the public receipt, with the three checks recomputed on each view.
router.get('/receipt/:id', query({}), async (req, res) => {
  const id = String(req.params.id);
  const sub = RECEIPT_ID_RE.test(id) ? store.submissions.get(id) : null;
  if (!sub) return failWith(res, 'NO_RECEIPT');
  const team = store.teams.get(sub.teamId);
  const cred = store.credentials.get(sub.credentialId);
  if (!team || !cred) return failWith(res, 'NO_RECEIPT');

  const checks = {
    contentHash: contentHashCheck(sub, team),
    challenge: challengeCheck(sub),
    signature: await signatureCheck(sub, cred),
  };
  res.json({
    ok: true,
    receipt: {
      id: sub.id,
      teamId: sub.teamId,
      teamName: team.name,
      roster: sub.roster.map((m) => m.handle), // handles only (privacy page)
      label: cred.label,
      projectName: sub.projectName,
      repoUrl: sub.repoUrl,
      commitSha: sub.commitSha,
      description: sub.description,
      declaration: sub.declaration,
      rosterHash: sub.rosterHash,
      canonical: sub.canonical,
      contentHash: sub.contentHash,
      shortHash: sub.contentHash.slice(0, 8),
      nonce: sub.nonce,
      challenge: sub.challenge,
      credentialId: sub.credentialId,
      publicKey: canon.b64u(cred.publicKey),
      authenticatorData: sub.authenticatorData,
      clientDataJSON: sub.clientDataJSON,
      signature: sub.signature,
      counter: sub.counter,
      signedAt: sub.signedAt,
      logSeq: sub.logSeq,
      logEntryHash: sub.logEntryHash,
      // FR-30: a key replaced before signing shows with its log entry. An
      // override is refused after SUBMITTED, so any override came first.
      overrideSeq: team.lastOverride && team.lastOverride.seq < sub.logSeq ? team.lastOverride.seq : null,
    },
    checks,
  });
});

module.exports = { router };
