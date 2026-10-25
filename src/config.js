'use strict';
// src/config.js: read the 8 environment variables from the locked stack list,
// apply defaults, and freeze. No other file reads environment variables (NFR-02).

const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN_RAW = process.env.ORIGIN || `http://localhost:${PORT}`;
const SESSION_SECRET_ENV = process.env.SESSION_SECRET || '';
const AI_PROVIDER = process.env.AI_PROVIDER || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e2b';

// ORIGIN is normalized to scheme://host[:port] so it compares equal to a
// browser Origin header (no trailing slash, no path).
let originUrl = null;
try {
  originUrl = new URL(ORIGIN_RAW);
} catch (_) {
  originUrl = null;
}
const ORIGIN = originUrl ? originUrl.origin : ORIGIN_RAW;
const ORIGIN_HOST = originUrl ? originUrl.host.toLowerCase() : null; // host:port, matched against the Host header
const ORIGIN_HOSTNAME = originUrl ? originUrl.hostname.toLowerCase() : null; // no port, matched against RP_ID

// NFR-02 boot check: WebAuthn refuses every tap unless the RP ID is the
// origin's host or a registrable suffix of it.
function rpIdMatchesOrigin() {
  if (!ORIGIN_HOSTNAME) return false;
  const rp = RP_ID.toLowerCase();
  return ORIGIN_HOSTNAME === rp || ORIGIN_HOSTNAME.endsWith('.' + rp);
}

const config = Object.freeze({
  PORT,
  RP_ID,
  ORIGIN,
  ORIGIN_HOST,
  ORIGIN_HOSTNAME,
  SECURE: ORIGIN.startsWith('https://'), // NFR-13: Secure cookies and one trusted proxy hop
  LOCAL_MODE: ORIGIN.startsWith('http://localhost'), // FR-12 shared laptop notice
  // Default: 32 random bytes per boot; server.js prints the notice from SDS.md section 7.
  SESSION_SECRET: SESSION_SECRET_ENV ? Buffer.from(SESSION_SECRET_ENV, 'utf8') : crypto.randomBytes(32),
  SESSION_SECRET_FROM_ENV: Boolean(SESSION_SECRET_ENV),
  AI_PROVIDER,
  GEMINI_API_KEY,
  OLLAMA_URL,
  OLLAMA_MODEL,
  rpIdMatchesOrigin,
});

module.exports = config;
