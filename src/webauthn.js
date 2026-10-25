'use strict';
// src/webauthn.js: wraps SimpleWebAuthn and owns the pending ceremony map.
// Rules from GENRE.md crypto heuristics:
//   1. takePending() deletes the record BEFORE any verify call, so every
//      challenge is single use even when verification throws (L4).
//   3. Expected challenges come from the stored record, never the client.
//   4. Every verify call passes requireUserVerification: false explicitly.
//   5. options.challenge is asserted equal to our base64url right after
//      generating options.
//   6. The counter is written back only after a successful verify; a
//      regression is detected before verify (SDS.md D11, section 6.5).

const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { parseAuthenticatorData, isoBase64URL } = require('@simplewebauthn/server/helpers');

const config = require('./config');
const { store } = require('./store');
const { sha256, b64u } = require('./canon');

const CHALLENGE_MS = 120000;

// ---------- Pending ceremonies ----------
function newPending(kind, fields) {
  const rec = {
    id: 'cr_' + crypto.randomBytes(8).toString('hex'),
    kind,
    purpose: null,
    teamId: null,
    secretId: null,
    challenge: null,
    nonce: null,
    rosterHash: null,
    contentHash: null,
    overrideHash: null,
    keyFields: null,
    reason: null,
    replacesSid: null,
    expiresAt: Date.now() + CHALLENGE_MS,
    ...fields,
  };
  store.pending.set(rec.id, rec);
  return rec;
}

// Delete first, then report. Returns { rec } or { status: 'used' | 'expired' }.
// A record of another kind counts as used, so one ceremony can never be
// finished through another ceremony's verify endpoint.
function takePending(id, kind) {
  const rec = typeof id === 'string' ? store.pending.get(id) : undefined;
  if (rec) store.pending.delete(id);
  if (!rec || rec.kind !== kind) return { status: 'used' };
  if (Date.now() >= rec.expiresAt) return { status: 'expired' };
  return { rec };
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of store.pending) if (now >= rec.expiresAt) store.pending.delete(id);
}, 60000);
sweep.unref();

function freshChallenge() {
  return crypto.randomBytes(32);
}

function assertChallenge(options, challengeBytes) {
  if (options.challenge !== b64u(challengeBytes)) {
    console.error('Challenge encoding mismatch');
    throw new Error('Challenge encoding mismatch');
  }
}

// ---------- Registration (SDS.md 6.4) ----------
// mode 'key': cross-platform, no resident key, the key's PIN asked for.
// mode 'passkey': no attachment set, so the browser offers this device's
// passkey and "use a phone".
async function registrationOptions({ ownerId, userName, mode, excludeCredentials = [] }, challengeBytes) {
  const authenticatorSelection =
    mode === 'key'
      ? // userVerification 'required': Firefox on macOS rejects a key's correct
        // PIN when this is 'discouraged' (SDS.md D7). The server still does not
        // require it: holding the key is the identity.
        { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'required' }
      : { residentKey: 'preferred', userVerification: 'preferred' };
  const options = await generateRegistrationOptions({
    rpName: 'QuackTrack',
    rpID: config.RP_ID,
    userName,
    userDisplayName: userName,
    userID: new Uint8Array(Buffer.from(ownerId, 'utf8')),
    timeout: CHALLENGE_MS,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection,
    challenge: new Uint8Array(challengeBytes),
  });
  assertChallenge(options, challengeBytes);
  return options;
}

let printedRegistrationKeys = false;

// Returns registrationInfo, or throws when the response does not verify.
async function verifyRegistration(response, expectedChallenge) {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.ORIGIN,
    expectedRPID: config.RP_ID,
    requireUserVerification: false,
  });
  if (!result.verified || !result.registrationInfo) throw new Error('registration not verified');
  if (!printedRegistrationKeys) {
    // SDS.md section 1: print the field names once so a library change shows up.
    console.log('registrationInfo keys:', Object.keys(result.registrationInfo).join(', '));
    printedRegistrationKeys = true;
  }
  return result.registrationInfo;
}

// The three key checks (SRS.md FR-06). Device bound and not backed up come
// from signed flags. Attachment is client reported and can only narrow.
function passesKeyChecks(info, response) {
  return (
    info.credentialDeviceType === 'singleDevice' &&
    info.credentialBackedUp === false &&
    response.authenticatorAttachment === 'cross-platform'
  );
}

function organizerLabel(info, response) {
  return passesKeyChecks(info, response) ? 'Organizer key' : 'Organizer passkey';
}

// SRS.md FR-06 label rule for a team. Returns the label, or null when a
// 'key' mode team tapped something that is not a physical key (E33).
function teamLabel(mode, info, response) {
  const key = passesKeyChecks(info, response);
  if (mode === 'key') return key ? 'Security key' : null;
  if (key) return 'Security key';
  return info.credentialBackedUp ? 'Platform passkey (synced)' : 'Platform passkey';
}

// SDS.md D6: only physical key credentials (ACTIVE or REVOKED) go in
// excludeCredentials. Listing a platform passkey would make the laptop's
// whole platform authenticator refuse. The server still rejects every
// repeated credential ID of every type.
function excludeList() {
  const out = [];
  for (const c of store.credentials.values()) {
    if (c.label === 'Security key' || c.label === 'Organizer key') out.push({ id: c.id, transports: c.transports });
  }
  return out;
}

// SDS.md 6.7: first 16 hex characters of SHA-256 of the public key.
function fingerprint(publicKey) {
  return sha256(Buffer.from(publicKey)).toString('hex').slice(0, 16);
}
function formatFingerprint(fp) {
  return fp.match(/.{4}/g).join(' ');
}

// Build the stored Credential record from a verified registration.
function credentialRecord(info, response, { ownerKind, ownerId, label }) {
  const c = info.credential;
  return {
    id: c.id,
    ownerKind,
    ownerId,
    publicKey: c.publicKey,
    counter: c.counter,
    transports: c.transports || response.response?.transports || [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    attachment: response.authenticatorAttachment === 'platform' || response.authenticatorAttachment === 'cross-platform' ? response.authenticatorAttachment : null,
    label,
    state: 'ACTIVE',
    fingerprint: fingerprint(c.publicKey),
    fmt: info.fmt,
    aaguid: info.aaguid,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Authentication ----------
async function authenticationOptions(credential, userVerification, challengeBytes) {
  const options = await generateAuthenticationOptions({
    rpID: config.RP_ID,
    allowCredentials: [{ id: credential.id, transports: credential.transports }],
    userVerification,
    timeout: CHALLENGE_MS,
    challenge: new Uint8Array(challengeBytes),
  });
  assertChallenge(options, challengeBytes);
  return options;
}

// SDS.md 6.5. Returns { regressed, received }. Throws on unreadable data.
function counterCheck(credential, response) {
  const { counter } = parseAuthenticatorData(isoBase64URL.toBuffer(response.response.authenticatorData));
  const regressed = (counter > 0 || credential.counter > 0) && counter <= credential.counter;
  return { regressed, received: counter };
}

// Returns the new counter, or throws when the assertion does not verify.
// The caller writes the counter back only after this returns.
async function verifyAuthentication(response, expectedChallenge, credential) {
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.ORIGIN,
    expectedRPID: config.RP_ID,
    credential: { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports },
    requireUserVerification: false,
  });
  if (!result.verified) throw new Error('authentication not verified');
  return result.authenticationInfo.newCounter;
}

module.exports = {
  CHALLENGE_MS,
  newPending,
  takePending,
  freshChallenge,
  registrationOptions,
  verifyRegistration,
  passesKeyChecks,
  organizerLabel,
  teamLabel,
  excludeList,
  fingerprint,
  formatFingerprint,
  credentialRecord,
  authenticationOptions,
  counterCheck,
  verifyAuthentication,
};
