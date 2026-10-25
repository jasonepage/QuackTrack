'use strict';
// src/validate.js: request schema checks, unknown field rejection, handle and
// URL rules, and the rate limiter. This file never reads the store.

const express = require('express');
const { failWith } = require('./errors');

// NFR-10: JSON bodies over 32 KB get 413 E04 (mapped in errors.errorHandler).
const jsonBody = express.json({ limit: '32kb', type: 'application/json', strict: true });

// GitHub handle rule (SDS.md section 3, RosterMember): 1 to 39 characters,
// letters, digits, single hyphens, no leading or trailing hyphen.
const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
function isHandle(s) {
  return typeof s === 'string' && HANDLE_RE.test(s);
}

// Repo URL rule (FR-28): must parse and start with https://.
function isHttpsUrl(s) {
  if (typeof s !== 'string' || !s.trim().startsWith('https://')) return false;
  try {
    return new URL(s.trim()).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Length is counted on the same normalized text the hash uses
// (SDS.md section 6 norm: NFC, CRLF to LF, trimmed), in code points.
function normLength(s) {
  return [...String(s).normalize('NFC').replace(/\r\n?/g, '\n').trim()].length;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

// Spec format, one entry per allowed field:
//   { type: 'string'|'boolean'|'number'|'object', label, required (default true),
//     min, max (string lengths), oneOf: [...], oneOfCode (dictionary code
//     used instead of E03 when the value is not in oneOf), rule: 'handle'|'https' }
// Returns null when the input passes, or { code, vars } for errors.failWith.
// Order: unknown fields (E01), then each field in spec order.
function check(input, spec) {
  if (input === undefined || input === null) input = {};
  if (!isPlainObject(input)) return { code: 'BAD_TYPE', vars: { label: 'Request body' } };
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) {
      return { code: 'UNKNOWN_FIELD', vars: { field: key.slice(0, 40) } };
    }
  }
  for (const [key, rule] of Object.entries(spec)) {
    const label = rule.label || key;
    const value = input[key];
    const required = rule.required !== false;
    if (value === undefined) {
      if (required) return { code: 'BAD_TYPE', vars: { label } };
      continue;
    }
    if (rule.type === 'object' ? !isPlainObject(value) : typeof value !== rule.type) {
      return { code: 'BAD_TYPE', vars: { label } };
    }
    if (rule.type === 'number' && !Number.isFinite(value)) return { code: 'BAD_TYPE', vars: { label } };
    if (rule.rule === 'handle' && !isHandle(value)) return { code: 'BAD_HANDLE', vars: {} };
    if (rule.type === 'string' && rule.max !== undefined) {
      const len = normLength(value);
      if (len < (rule.min ?? 0) || len > rule.max) {
        return { code: 'BAD_LENGTH', vars: { label, min: rule.min ?? 0, max: rule.max } };
      }
    }
    if (rule.rule === 'https' && !isHttpsUrl(value)) return { code: 'REPO_NOT_HTTPS', vars: {} };
    if (rule.oneOf && !rule.oneOf.includes(value)) {
      return rule.oneOfCode ? { code: rule.oneOfCode, vars: {} } : { code: 'BAD_TYPE', vars: { label } };
    }
  }
  return null;
}

// Middleware: validate req.body against spec. Every POST route uses one.
function body(spec) {
  return (req, res, next) => {
    const problem = check(req.body, spec);
    if (problem) return failWith(res, problem.code, problem.vars);
    if (req.body === undefined) req.body = {};
    next();
  };
}

// Middleware: validate the query string. query({}) rejects every query field,
// which is how read tier routes refuse a teamId (FR-13, INV-05).
function query(spec = {}) {
  return (req, res, next) => {
    const problem = check({ ...req.query }, spec);
    if (problem) return failWith(res, problem.code, problem.vars);
    next();
  };
}

// ---------- Rate limiter (NFR-11) ----------
// Fixed one minute windows kept in this module's own map, swept every 60 s.
const windows = new Map(); // "bucket|key" -> { count, resetAt }

function hit(bucket, key, limit, windowMs) {
  const id = bucket + '|' + key;
  const now = Date.now();
  let w = windows.get(id);
  if (!w || now >= w.resetAt) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(id, w);
  }
  w.count += 1;
  return w.count <= limit;
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, w] of windows) if (now >= w.resetAt) windows.delete(id);
}, 60000);
sweep.unref();

// Generic factory for later tickets (chat, commons, FAQ use their own codes).
// keys(req) returns an array of [bucket, key, limit, windowMs]; every key is
// counted, and the request is refused when any key is over its limit.
function rateLimit(keys, code = 'RATE_TAP') {
  return (req, res, next) => {
    let allowed = true;
    for (const [bucket, key, limit, windowMs] of keys(req)) {
      if (!hit(bucket, key, limit, windowMs)) allowed = false;
    }
    if (!allowed) return failWith(res, code);
    next();
  };
}

const MINUTE = 60000;
const ipOf = (req) => req.ip || 'unknown';
// The team ID here is only a rate limit key, never identity (L1).
const teamKey = (req) => String((req.body && req.body.teamId) || '').slice(0, 64);

// Team tap options and sign options: 30 per minute per IP address and team ID
// together, plus 300 per minute per IP address in total, so teams behind one
// venue address do not block each other. Both endpoints share these buckets.
const teamCeremonyLimit = rateLimit((req) => [
  ['team-ceremony', ipOf(req) + '|' + teamKey(req), 30, MINUTE],
  ['team-ceremony-ip', ipOf(req), 300, MINUTE],
]);

// Organizer ceremony options: 30 per minute per IP address.
const orgCeremonyLimit = rateLimit((req) => [['org-ceremony', ipOf(req), 30, MINUTE]]);

// Client failure reports: 30 per minute per IP address.
const clientFailureLimit = rateLimit((req) => [['client-failure', ipOf(req), 30, MINUTE]]);

// Setup options: 5 per minute in total, from every address together, because
// the setup link is the one thing an attacker would try to guess.
const setupLimit = rateLimit(() => [['setup', 'all', 5, MINUTE]]);

module.exports = {
  jsonBody,
  HANDLE_RE,
  isHandle,
  isHttpsUrl,
  check,
  body,
  query,
  rateLimit,
  teamCeremonyLimit,
  orgCeremonyLimit,
  clientFailureLimit,
  setupLimit,
};
