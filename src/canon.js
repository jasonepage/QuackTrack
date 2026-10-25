'use strict';
// src/canon.js: canonical text, hashing, and every hash and challenge
// derivation (SDS.md section 6). Pure functions only: this file never reads
// the store. Every hash input starts with a version prefix (GENRE.md crypto
// heuristic 8), so a hash made for one purpose is never valid for another.

const crypto = require('crypto');

const DECLARATION_V1 = 'We declare that this project was built during this event.';
const COMMIT_RE = /^[0-9a-f]{40}$/;

// SDS.md section 6: NFC, CRLF and CR to LF, trimmed.
function norm(s) {
  return String(s).normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

// JSON text with object keys sorted by code unit order at every depth,
// arrays in order, no whitespace. Anything JSON cannot say exactly throws:
// undefined, functions, symbols, bigint, NaN and Infinity, and objects that
// are not plain (Buffer, Date, Map), so two encodings never hash the same.
function canon(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canon: number is not finite');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error('canon: object is not a plain object');
      const keys = Object.keys(v).sort(); // default sort is code unit order
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    default:
      throw new Error(`canon: cannot encode ${typeof v}`);
  }
}

// Returns a 32 byte Buffer. Strings are hashed as UTF-8.
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}
function sha256hex(buf) {
  return sha256(buf).toString('hex');
}
function utf8(s) {
  return Buffer.from(s, 'utf8');
}
// base64url with no padding, the form browsers use for the challenge in
// client data. Compare challenges only in this form.
function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

function need32(name, buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error(`${name} must be a 32 byte Buffer`);
}

// ---------- 6.2 Enroll: roster hash and challenge ----------
// members: [{ handle, displayName, role }]. Sorted by handleKey (lowercase).
function rosterCanonical(teamId, teamName, members) {
  const rows = members
    .map((m) => [String(m.handle).toLowerCase(), norm(m.displayName), m.role])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return canon(['quacktrack-roster-v1', teamId, norm(teamName), rows]);
}
function rosterHash(teamId, teamName, members) {
  return sha256(utf8(rosterCanonical(teamId, teamName, members)));
}
function enrollChallenge(rosterHashBuf, nonce) {
  need32('rosterHash', rosterHashBuf);
  need32('nonce', nonce);
  return sha256(Buffer.concat([utf8('quacktrack-enroll-v1'), rosterHashBuf, nonce]));
}

// ---------- 6.1 Sign: content hash and challenge ----------
// fields: { teamId, projectName, repoUrl, commitSha, description }.
// declaration defaults to DECLARATION_V1; a receipt passes the stored text.
function submissionCanonical(fields, declaration = DECLARATION_V1) {
  const commitSha = norm(fields.commitSha).toLowerCase();
  if (!COMMIT_RE.test(commitSha)) throw new Error('commitSha must be 40 hex characters');
  return canon([
    'quacktrack-submission-v1',
    fields.teamId,
    norm(fields.projectName),
    norm(fields.repoUrl),
    commitSha,
    norm(fields.description),
    declaration,
  ]);
}
function contentHash(canonical) {
  return sha256(utf8(canonical));
}
function signChallenge(contentHashBuf, nonce) {
  need32('contentHash', contentHashBuf);
  need32('nonce', nonce);
  const input = Buffer.concat([utf8('quacktrack-sign-v1'), contentHashBuf, nonce]);
  if (input.length !== 82) throw new Error('sign challenge input must be 82 bytes');
  return sha256(input);
}

// ---------- 6.9 Join: a member joins a team with its key (D15) ----------
// member: { handle, displayName, role }. The tap approves exactly this
// member, with this role, on exactly this team.
function memberHash(teamId, member) {
  return sha256(utf8(canon(['quacktrack-member-v1', teamId, String(member.handle).toLowerCase(), norm(member.displayName), member.role])));
}
function joinChallenge(memberHashBuf, nonce) {
  need32('memberHash', memberHashBuf);
  need32('nonce', nonce);
  return sha256(Buffer.concat([utf8('quacktrack-join-v1'), memberHashBuf, nonce]));
}

// ---------- 6.8 Override: authorization and replacement ----------
function overrideHash(teamId, oldCredentialId, reason) {
  return sha256(utf8(canon(['quacktrack-override-v1', teamId, oldCredentialId, reason])));
}
function overrideAuthChallenge(overrideHashBuf, nonce) {
  need32('overrideHash', overrideHashBuf);
  need32('nonce', nonce);
  return sha256(Buffer.concat([utf8('quacktrack-override-auth-v1'), overrideHashBuf, nonce]));
}
function overrideRegChallenge(rosterHashBuf, overrideHashBuf, nonce2) {
  need32('rosterHash', rosterHashBuf);
  need32('overrideHash', overrideHashBuf);
  need32('nonce', nonce2);
  return sha256(Buffer.concat([utf8('quacktrack-override-reg-v1'), rosterHashBuf, overrideHashBuf, nonce2]));
}

module.exports = {
  DECLARATION_V1,
  COMMIT_RE,
  norm,
  canon,
  sha256,
  sha256hex,
  utf8,
  b64u,
  rosterCanonical,
  rosterHash,
  enrollChallenge,
  submissionCanonical,
  contentHash,
  signChallenge,
  memberHash,
  joinChallenge,
  overrideHash,
  overrideAuthChallenge,
  overrideRegChallenge,
};
