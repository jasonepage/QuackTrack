'use strict';
// src/log.js: the append only, hash chained action log (L5, SDS.md section 8).
// Entries hold IDs, hashes, handles, team names, labels, counts, and times
// only. Prompt text, secret text, chat text, and question text have no key
// in the allowlist, so append() throws on them and nothing is written.
//
// This file imports only src/canon.js at load time, so scripts/verify-log.js
// can use verifyChain() without loading any other server file. append()
// reaches the in-memory store lazily, on first call.

const { canon, sha256hex, utf8 } = require('./canon');

const ZERO_HASH = '0'.repeat(64);

// SDS.md section 8 allowlist. Left out on purpose:
//   note.posted, secret.issued, secret.revealed: T10, cut by cut line 1.
const ALLOWLIST = Object.freeze({
  'event.created': [],
  'event.reset': ['previousHead'],
  'org.enrolled': ['credentialId', 'label', 'keyFingerprint'],
  'org.login': ['credentialId'],
  'team.created': ['teamId', 'teamName', 'mode'],
  'team.deleted': ['teamId', 'teamName'],
  'roster.added': ['teamId', 'handle', 'role'],
  'roster.removed': ['teamId', 'handle'],
  'roster.joined': ['teamId', 'handle', 'role', 'credentialId'],
  'team.enrolled': ['teamId', 'teamName', 'credentialId', 'label', 'rosterHash', 'keySource', 'tagColor', 'tagLabel', 'keyFingerprint'],
  'team.override': ['teamId', 'teamName', 'oldCredentialId', 'credentialId', 'label', 'keySource', 'tagColor', 'tagLabel', 'keyFingerprint', 'reason', 'rosterHash'],
  'prompt.created': ['promptId', 'deadline'],
  'prompt.assigned': ['teamId', 'promptId'],
  'tap.ok': ['teamId', 'purpose', 'credentialId', 'counter'],
  'tap.failed': ['teamId', 'purpose', 'reason'],
  'tap.counter_regression': ['teamId', 'credentialId', 'storedCounter', 'receivedCounter'],
  'tap.client_failed': ['teamId', 'kind', 'errorName', 'reportedBy'],
  'prompt.revealed': ['teamId', 'teamName', 'promptId', 'revealedAt'],
  'instructions.downloaded': ['teamId', 'handle'],
  'chat.posted': ['teamId', 'messageId', 'handle'],
  'commons.posted': ['teamId', 'postId', 'handle', 'kind'],
  'commons.pinned': ['postId'],
  'commons.unpinned': ['postId'],
  'commons.deleted': ['postId'],
  'team.muted': ['teamId'],
  'team.unmuted': ['teamId'],
  'bundle.updated': ['bundleHash'],
  'faq.answered': ['teamId', 'handle', 'provider'],
  'faq.unanswered': ['teamId', 'handle', 'questionId', 'reason', 'provider'],
  'sign.started': ['teamId', 'contentHash'],
  'sign.failed': ['teamId', 'reason'],
  'submission.signed': ['teamId', 'teamName', 'submissionId', 'contentHash', 'counter'],
  'deadline.warning': ['deadline', 'minutesLeft'],
  'deadline.unsubmitted': ['teamId', 'teamName', 'deadline'],
  'demo.seeded': [],
});

const ACTOR_KINDS = new Set(['organizer', 'team', 'system', 'client']);

function entryHash(seq, ts, actor, action, data, prevHash) {
  return sha256hex(utf8(canon(['quacktrack-log-v1', seq, ts, actor, action, data, prevHash])));
}

// Checks everything an entry needs, then builds it. Throws on an unknown
// action, an unlisted data key, a non plain value, or a bad actor.
function buildEntry(prev, actor, action, data = {}, ts = new Date().toISOString()) {
  const allowed = Object.prototype.hasOwnProperty.call(ALLOWLIST, action) ? ALLOWLIST[action] : null;
  if (!allowed) throw new Error(`log: action "${action}" is not in the allowlist`);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('log: data must be an object');
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.includes(key)) throw new Error(`log: data key "${key}" is not allowed for ${action}`);
    // Only flat values, so an allowed key can never carry a nested object.
    const t = typeof value;
    if (!(value === null || t === 'string' || t === 'boolean' || (t === 'number' && Number.isFinite(value)))) {
      throw new Error(`log: data key "${key}" must be a string, number, boolean, or null`);
    }
    clean[key] = value;
  }
  if (!actor || !ACTOR_KINDS.has(actor.kind) || !(actor.id === null || typeof actor.id === 'string')) {
    throw new Error('log: actor must be {kind, id}');
  }
  const cleanActor = { kind: actor.kind, id: actor.id };
  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.entryHash : ZERO_HASH;
  return {
    seq,
    ts,
    actor: cleanActor,
    action,
    data: clean,
    prevHash,
    entryHash: entryHash(seq, ts, cleanActor, action, clean, prevHash),
  };
}

// append(actor, action, data): build the entry first, push it last, so a
// throw leaves the log unchanged. Routes call this before writing state
// (FR-33) and write nothing if it throws.
function append(actor, action, data = {}) {
  const { store } = require('./store');
  const prev = store.log.length ? store.log[store.log.length - 1] : null;
  const entry = buildEntry(prev, actor, action, data);
  store.log.push(entry);
  return entry;
}

// Verify a whole chain: for each entry i, seq === i, prevHash equals the
// previous entryHash (64 zeros for entry 0), and the recomputed entryHash
// matches. An empty or unreadable chain is broken at entry 0.
// Returns { ok, count, head, brokenAt }.
function verifyChain(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, count: 0, head: null, brokenAt: 0 };
  }
  let prevHash = ZERO_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let good = false;
    try {
      good =
        e !== null &&
        typeof e === 'object' &&
        e.seq === i &&
        e.prevHash === prevHash &&
        typeof e.entryHash === 'string' &&
        entryHash(e.seq, e.ts, e.actor, e.action, e.data, e.prevHash) === e.entryHash;
    } catch (_) {
      good = false; // canon throws on values JSON cannot express exactly
    }
    if (!good) return { ok: false, count: entries.length, head: null, brokenAt: i };
    prevHash = e.entryHash;
  }
  return { ok: true, count: entries.length, head: prevHash, brokenAt: null };
}

function head() {
  const { store } = require('./store');
  return store.log.length ? store.log[store.log.length - 1].entryHash : ZERO_HASH;
}

function chainStatus() {
  const { store } = require('./store');
  return verifyChain(store.log);
}

module.exports = { ZERO_HASH, ALLOWLIST, buildEntry, append, verifyChain, head, chainStatus };
