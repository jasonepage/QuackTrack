'use strict';
// src/routes/org.js: organizer setup, login, logout, console, and log export.
// Setup and login are ceremony tier: identity comes only from a verified
// credential (L1). Every other route here needs the organizer session.

const crypto = require('crypto');
const express = require('express');

const config = require('../config');
const { store } = require('../store');
const { failWith } = require('../errors');
const { body, query, setupLimit, orgCeremonyLimit } = require('../validate');
const { b64u } = require('../canon');
const log = require('../log');
const sessions = require('../sessions');
const wa = require('../webauthn');

const router = express.Router();
const ORG_ACTOR = Object.freeze({ kind: 'organizer', id: 'organizer' });

const CEREMONY_VERIFY = {
  ceremonyId: { type: 'string', label: 'Ceremony ID', min: 1, max: 64 },
  response: { type: 'object', label: 'Key response' },
};

function organizerCredential() {
  for (const c of store.credentials.values()) {
    if (c.ownerKind === 'organizer' && c.state === 'ACTIVE') return c;
  }
  return null;
}

// Boot (SDS.md 5.5 step 1): make the one time setup token. server.js prints
// the link to the terminal only. It is never sent to any browser.
function bootSetup() {
  store.event.setupToken = crypto.randomBytes(32).toString('base64url');
  store.event.setupUsed = false;
  return `${config.ORIGIN}/setup?token=${store.event.setupToken}`;
}

function tokenMatches(given) {
  const want = store.event.setupToken;
  if (typeof given !== 'string' || !given || typeof want !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(want, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- FR-01 Organizer setup ----------
router.post(
  '/setup/options',
  setupLimit,
  body({
    token: { type: 'string', label: 'Setup token', required: false },
    mode: { type: 'string', label: 'Mode', oneOf: ['key', 'passkey'] },
  }),
  async (req, res) => {
    if (!tokenMatches(req.body.token)) return failWith(res, 'SETUP_INVALID');
    if (store.event.setupUsed || organizerCredential()) return failWith(res, 'SETUP_USED');
    const challenge = wa.freshChallenge();
    const options = await wa.registrationOptions(
      { ownerId: 'organizer', userName: 'Organizer', mode: req.body.mode },
      challenge
    );
    const rec = wa.newPending('org-setup', { challenge: b64u(challenge) });
    res.json({ ok: true, ceremonyId: rec.id, options });
  }
);

router.post('/setup/verify', body(CEREMONY_VERIFY), async (req, res) => {
  const taken = wa.takePending(req.body.ceremonyId, 'org-setup');
  if (!taken.rec) return failWith(res, 'ENROLL_EXPIRED');

  let info;
  try {
    info = await wa.verifyRegistration(req.body.response, taken.rec.challenge);
  } catch (err) {
    console.error('[setup] registration did not verify:', err.message);
    return failWith(res, 'SERVER');
  }

  // After the last await: re-check state in one synchronous block.
  if (store.event.setupUsed || organizerCredential()) return failWith(res, 'SETUP_USED');
  if (store.credentials.has(info.credential.id)) return failWith(res, 'KEY_TAKEN');
  const label = wa.organizerLabel(info, req.body.response);
  const cred = wa.credentialRecord(info, req.body.response, { ownerKind: 'organizer', ownerId: 'organizer', label });

  log.append(ORG_ACTOR, 'org.enrolled', { credentialId: cred.id, label, keyFingerprint: cred.fingerprint });
  store.credentials.set(cred.id, cred);
  store.event.setupUsed = true;
  sessions.mint(res, 'organizer', { credentialId: cred.id });
  res.json({ ok: true, label });
});

// ---------- FR-02 Organizer login ----------
router.post('/login/options', orgCeremonyLimit, body({}), async (req, res) => {
  const cred = organizerCredential();
  if (!cred) return failWith(res, 'NO_ORGANIZER');
  const challenge = wa.freshChallenge();
  const uv = cred.label === 'Organizer key' ? 'discouraged' : 'preferred';
  const options = await wa.authenticationOptions(cred, uv, challenge);
  const rec = wa.newPending('org-login', { challenge: b64u(challenge) });
  res.json({ ok: true, ceremonyId: rec.id, options });
});

router.post('/login/verify', body(CEREMONY_VERIFY), async (req, res) => {
  const taken = wa.takePending(req.body.ceremonyId, 'org-login');
  if (!taken.rec) return failWith(res, taken.status === 'expired' ? 'TAP_EXPIRED' : 'TAP_USED');
  const cred = organizerCredential();
  if (!cred) return failWith(res, 'NO_ORGANIZER');
  const response = req.body.response;
  if (response.id !== cred.id) return failWith(res, 'NOT_ORG_KEY');

  let counter;
  try {
    counter = wa.counterCheck(cred, response);
  } catch (_) {
    return failWith(res, 'NOT_ORG_KEY');
  }
  if (counter.regressed) {
    log.append(ORG_ACTOR, 'tap.counter_regression', {
      teamId: null,
      credentialId: cred.id,
      storedCounter: cred.counter,
      receivedCounter: counter.received,
    });
    return failWith(res, 'COUNTER_BACKWARDS');
  }

  let newCounter;
  try {
    newCounter = await wa.verifyAuthentication(response, taken.rec.challenge, cred);
  } catch (err) {
    console.error('[login] assertion did not verify:', err.message);
    return failWith(res, 'NOT_ORG_KEY');
  }

  log.append(ORG_ACTOR, 'org.login', { credentialId: cred.id });
  cred.counter = newCounter;
  sessions.mint(res, 'organizer', { credentialId: cred.id });
  res.json({ ok: true });
});

// ---------- Read (org) ----------
router.post('/logout', sessions.requireOrg, body({}), (req, res) => {
  sessions.logout(req, res, 'organizer');
  res.json({ ok: true });
});

// FR-31, T3 part: the log tail and chain status. Later tickets add rows.
router.get('/console', sessions.requireOrg, query({}), (req, res) => {
  const chain = log.chainStatus();
  res.json({
    ok: true,
    log: store.log.slice(-20),
    chain: { ok: chain.ok, head: chain.head, brokenAt: chain.brokenAt, count: chain.count },
  });
});

// FR-34: the full log as a file.
router.get('/log.json', sessions.requireOrg, query({}), (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="quacktrack-log.json"');
  res.type('application/json').send(JSON.stringify(store.log, null, 2));
});

module.exports = { router, bootSetup };
