'use strict';
// src/sessions.js: mint, read, expire, and revoke sessions (SDS.md section 7).
// The cookie carries only "<sid>.<mac>". Everything else lives in
// store.sessions. A cookie that fails the HMAC check is never looked up.

const crypto = require('crypto');
const config = require('./config');
const { store } = require('./store');
const { failWith } = require('./errors');

const COOKIE = Object.freeze({ team: 'qt_team', organizer: 'qt_org' });
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours absolute, no sliding
const MAX_AGE_S = 28800;

function mac(sid) {
  return crypto.createHmac('sha256', config.SESSION_SECRET).update(sid, 'utf8').digest('base64url');
}

function cookieHeader(name, value, maxAge) {
  const parts = [`${name}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`];
  if (config.SECURE) parts.push('Secure');
  return parts.join('; ');
}

function setCookie(res, name, value, maxAge) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(cookieHeader(name, value, maxAge));
  res.setHeader('Set-Cookie', list);
}

function clearCookie(res, kind) {
  setCookie(res, COOKIE[kind], '', 0);
}

// Minimal cookie parser; no dependency beyond the stack.
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Returns the sid only when the cookie's HMAC is valid, else null.
function sidFromCookie(req, kind) {
  const raw = readCookie(req, COOKIE[kind]);
  if (!raw) return { present: false, sid: null };
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return { present: true, sid: null };
  const sid = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1), 'utf8');
  const want = Buffer.from(mac(sid), 'utf8');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return { present: true, sid: null };
  return { present: true, sid };
}

// Mint a session after a verified tap. Only routes that just verified an
// assertion or a registration call this (L1).
function mint(res, kind, { teamId = null, credentialId }) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = { sid, kind, teamId, credentialId, memberHandle: null, createdAt: now, expiresAt: now + SESSION_MS };
  store.sessions.set(sid, session);
  setCookie(res, COOKIE[kind], `${sid}.${mac(sid)}`, MAX_AGE_S);
  return session;
}

function revoke(sid) {
  store.sessions.delete(sid);
}

// SDS.md section 5.4. Returns { session } or { code } for failWith.
// noCookieCode is the sentence for a request that has no cookie at all.
function check(req, res, kind, noCookieCode) {
  const { present, sid } = sidFromCookie(req, kind);
  if (!present) return { code: noCookieCode };
  if (!sid) {
    clearCookie(res, kind);
    return { code: 'SESSION_ENDED' };
  }
  const session = store.sessions.get(sid);
  if (!session || session.kind !== kind) {
    clearCookie(res, kind);
    return { code: 'SESSION_ENDED' };
  }
  if (Date.now() >= session.expiresAt) {
    store.sessions.delete(sid);
    clearCookie(res, kind);
    return { code: 'SESSION_ENDED' };
  }
  return { session };
}

// Read tier guards. Identity comes only from the session (L1).
function requireOrg(req, res, next) {
  const r = check(req, res, 'organizer', 'NO_ORG_SESSION');
  if (r.code) return failWith(res, r.code);
  req.session = r.session;
  next();
}

function requireTeam(req, res, next) {
  const r = check(req, res, 'team', 'NO_TEAM_SESSION');
  if (r.code) return failWith(res, r.code);
  req.session = r.session;
  next();
}

// Logout: delete the session and clear the cookie.
function logout(req, res, kind) {
  if (req.session) store.sessions.delete(req.session.sid);
  clearCookie(res, kind);
}

// Expiry sweep every 60 seconds (NFR-18).
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of store.sessions) if (now >= s.expiresAt) store.sessions.delete(sid);
}, 60000);
sweep.unref();

module.exports = { COOKIE, mint, revoke, requireOrg, requireTeam, logout, sidFromCookie };
