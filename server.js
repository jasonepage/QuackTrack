'use strict';
// server.js: build the Express app, run the guards, serve static files and
// /vendor/swa/, mount routes, start listening. No business logic lives here.

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('./src/config');
const { say, failWith, sendPlainPage, errorHandler, TERMINAL_RP_ID } = require('./src/errors');
const { jsonBody } = require('./src/validate');
const log = require('./src/log');
const org = require('./src/routes/org');
const enroll = require('./src/routes/enroll');
const publicRoutes = require('./src/routes/public');
const tap = require('./src/routes/tap');
const team = require('./src/routes/team');
const sign = require('./src/routes/sign');
const faq = require('./src/routes/faq');

// NFR-02 boot check: stop before listening if WebAuthn would refuse every tap.
if (!config.rpIdMatchesOrigin()) {
  console.error(TERMINAL_RP_ID);
  process.exit(1);
}

// L5: the action log starts with a genesis entry at boot (SDS.md section 8).
const genesis = log.append({ kind: 'system', id: null }, 'event.created', {});
// SDS.md 5.5 step 1: the one time organizer setup link, printed to the terminal only.
const setupLink = org.bootSetup();

const app = express();
app.disable('x-powered-by');
// NFR-13: behind Render's proxy, trust exactly one hop so req.ip is the client.
if (config.SECURE) app.set('trust proxy', 1);

// FR-37 host guard: every request must use the exact host in ORIGIN.
// Security keys are bound to that address, so any other host gets E06.
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (host === config.ORIGIN_HOST) return next();
  const sentence = say('WRONG_HOST', { origin: config.ORIGIN });
  if (req.path.startsWith('/api/')) return failWith(res, 'WRONG_HOST', { origin: config.ORIGIN });
  return sendPlainPage(res, 421, sentence);
});

// FR-37 origin guard. POST must be Content-Type application/json, and any
// state changing request with an Origin header must come from ORIGIN.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== config.ORIGIN) return failWith(res, 'BLOCKED');
  if (req.method === 'POST') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return failWith(res, 'BLOCKED');
  }
  next();
});

// NFR-10: 32 KB JSON limit. Oversize bodies become 413 E04 in errorHandler.
app.use(jsonBody);

// SimpleWebAuthn browser library: serve the package's ESM build directory,
// found from the "exports" import condition or the "module" field.
function swaEsmDir() {
  const pkgDir = path.join(__dirname, 'node_modules', '@simplewebauthn', 'browser');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const dot = pkg.exports && pkg.exports['.'];
  let entry = null;
  if (dot && typeof dot === 'object') {
    entry = typeof dot.import === 'string' ? dot.import : dot.import && (dot.import.default || dot.import.browser);
  }
  entry = entry || pkg.module;
  if (!entry) throw new Error('@simplewebauthn/browser has no ESM entry in package.json');
  return { dir: path.dirname(path.join(pkgDir, entry)), file: path.basename(entry) };
}
const swa = swaEsmDir();
app.use('/vendor/swa', express.static(swa.dir, { index: false }));

// Static pages. Every page is static HTML plus static JavaScript; the server
// never puts data into them (CLAUDE.md rule 10). /console serves console.html.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Routes. Later tickets mount theirs here.
app.use('/api/org', org.router);
app.use('/api/org', enroll.router);
app.use('/api/public', publicRoutes.router);
app.use('/api/tap', tap.router);
app.use('/api/team', team.router);
app.use('/api/team', faq.router);
app.use('/api/sign', sign.router);

// FR-30 receipt page: the same static file for every receipt ID. The page
// reads the ID from its own address and fetches /api/public/receipt/:id.
app.get('/receipt/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'receipt.html'));
});

// Unknown paths: a bare 404 with no body. SRS.md 4A has no sentence for an
// unknown path, so none is invented.
app.use((req, res) => {
  res.status(404).end();
});

app.use(errorHandler);

app.listen(config.PORT, () => {
  if (!config.SESSION_SECRET_FROM_ENV) {
    console.log('SESSION_SECRET not set: sessions end when the server restarts.');
  }
  console.log(`Action log genesis head: ${genesis.entryHash}`);
  console.log(`Organizer setup: ${setupLink}`);
  console.log(`QuackTrack running at ${config.ORIGIN}`);
});
