'use strict';
// src/routes/org.js: organizer setup, login, logout, console, and log export.
// Setup and login are ceremony tier: identity comes only from a verified
// credential (L1). Every other route here needs the organizer session.

const crypto = require('crypto');
const express = require('express');

const config = require('../config');
const { store, resetStore } = require('../store');
const { failWith, notice } = require('../errors');
const { body, query, setupLimit, orgCeremonyLimit } = require('../validate');
const canon = require('../canon');
const { b64u } = canon;
const log = require('../log');
const sessions = require('../sessions');
const wa = require('../webauthn');
const { teamRows, getTeam, createDraftTeam } = require('./enroll');
const ai = require('../ai/askFAQ');

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

// FR-07: log prompt.created (ID and deadline only, L2), then store it.
function createPrompt(track, instructions, deadline) {
  const prompt = {
    id: 'pr_' + crypto.randomBytes(8).toString('hex'),
    track,
    instructions,
    deadline,
    warned30: false,
    createdAt: new Date().toISOString(),
  };
  log.append(ORG_ACTOR, 'prompt.created', { promptId: prompt.id, deadline: prompt.deadline });
  store.prompts.set(prompt.id, prompt);
  return prompt;
}

// ---------- FR-07 Create prompt assignment ----------
// Track and instructions are sealed (L2): they leave the server only in an
// organizer response or in that team's own reveal and room after its tap.
router.post(
  '/prompts',
  sessions.requireOrg,
  body({
    track: { type: 'string', label: 'Track' },
    instructions: { type: 'string', label: 'Instructions' },
    deadline: { type: 'string', label: 'Deadline', max: 40 },
  }),
  (req, res) => {
    const track = canon.norm(req.body.track);
    const instructions = canon.norm(req.body.instructions);
    if (!track || !instructions) return failWith(res, 'PROMPT_EMPTY');
    if ([...track].length > 60) return failWith(res, 'BAD_LENGTH', { label: 'Track', min: 1, max: 60 });
    if ([...instructions].length > 4000) return failWith(res, 'BAD_LENGTH', { label: 'Instructions', min: 1, max: 4000 });
    const when = Date.parse(req.body.deadline);
    if (!Number.isFinite(when)) return failWith(res, 'BAD_TYPE', { label: 'Deadline' });
    if (when <= Date.now()) return failWith(res, 'DEADLINE_PAST');
    const prompt = createPrompt(track, instructions, new Date(when).toISOString());
    res.json({ ok: true, prompt: { id: prompt.id, track: prompt.track, deadline: prompt.deadline } });
  }
);

// ---------- FR-08 Assign prompt ----------
router.post(
  '/assign',
  sessions.requireOrg,
  body({
    teamId: { type: 'string', label: 'Team', min: 1, max: 40 },
    promptId: { type: 'string', label: 'Prompt', min: 1, max: 40 },
  }),
  (req, res) => {
    const team = getTeam(req.body.teamId);
    if (!team) return failWith(res, 'TEAM_NOT_FOUND');
    const prompt = store.prompts.get(req.body.promptId);
    if (!prompt) return failWith(res, 'PROMPT_NOT_FOUND');
    if (team.state === 'DRAFT') return failWith(res, 'NOT_ENROLLED', { team: team.name });
    if (team.state !== 'ENROLLED') return failWith(res, 'ALREADY_REVEALED', { team: team.name });
    log.append(ORG_ACTOR, 'prompt.assigned', { teamId: team.id, promptId: prompt.id });
    team.assignedPromptId = prompt.id;
    res.json({ ok: true });
  }
);

// ---------- Read (org) ----------
router.post('/logout', sessions.requireOrg, body({}), (req, res) => {
  sessions.logout(req, res, 'organizer');
  res.json({ ok: true });
});

// FR-31 and FR-39: team rows, the at a glance counts, prompts, the log
// tail, chain status, and the in-memory notice. Polled every second.
router.get('/console', sessions.requireOrg, query({}), (req, res) => {
  const chain = log.chainStatus();
  const teams = teamRows();
  res.json({
    ok: true,
    teams,
    glance: {
      teams: teams.length,
      enrolled: teams.filter((t) => t.state !== 'DRAFT').length,
      revealed: teams.filter((t) => t.state === 'REVEALED' || t.state === 'SUBMITTED').length,
      submitted: teams.filter((t) => t.state === 'SUBMITTED').length,
    },
    notice: notice('N03'),
    // FR-26: unanswered questions, newest first, for the organizer to answer out loud.
    unanswered: store.unanswered
      .slice()
      .reverse()
      .map((q) => ({ id: q.id, teamName: (store.teams.get(q.teamId) || {}).name || null, handle: q.handle, question: q.question, reason: q.reason, provider: q.provider, at: q.at })),
    // FR-27: provider and status from the last call.
    ai: ai.status(),
    // FR-24: the saved event information, so the form shows what teams see.
    bundle: { text: store.event.bundle, hash: store.event.bundleHash },
    prompts: [...store.prompts.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((p) => ({ id: p.id, track: p.track, deadline: p.deadline })),
    log: store.log.slice(-20),
    chain: { ok: chain.ok, head: chain.head, brokenAt: chain.brokenAt, count: chain.count },
  });
});

// ---------- FR-24 Context bundle ----------
// The event information the FAQ assistant may quote. Sections start with a
// line beginning "# ". Logged by hash only.
const BUNDLE_MAX = 30000;
router.post('/bundle', sessions.requireOrg, body({ text: { type: 'string', label: 'Event information' } }), (req, res) => {
  const text = canon.norm(req.body.text);
  if ([...text].length > BUNDLE_MAX) return failWith(res, 'BUNDLE_TOO_LONG');
  if (!text) return failWith(res, 'BAD_LENGTH', { label: 'Event information', min: 1, max: BUNDLE_MAX });
  const bundleHash = canon.sha256hex(canon.utf8(text));
  log.append(ORG_ACTOR, 'bundle.updated', { bundleHash });
  store.event.bundle = text;
  store.event.bundleHash = bundleHash;
  res.json({ ok: true, bundleHash });
});

// ---------- FR-35 Reset event ----------
// Wipes everything except the organizer credential and this organizer
// session. The new chain starts with event.reset carrying the old head (L5).
router.post('/reset', sessions.requireOrg, body({ confirm: { type: 'string', label: 'Confirm text', required: false } }), (req, res) => {
  if (req.body.confirm !== 'RESET') return failWith(res, 'RESET_CONFIRM');
  const previousHead = log.head();
  resetStore({ keepOrganizer: true, keepSid: req.session.sid });
  log.append(ORG_ACTOR, 'event.reset', { previousHead });
  res.json({ ok: true });
});

// ---------- FR-36 Demo data seed ----------
// Two prompts, two DRAFT teams with their key fields prefilled, and the
// demo event information. Rosters stay empty: since Session 3 a person joins
// a roster only by tapping that team's key (INV-12, L1). On stage the
// presenter joins Team Mallard as jasonepage with key A.
const DEMO_BUNDLE = [
  '# Schedule',
  'Check-in and key handout start at 9:00 AM at the organizer desk.',
  'Hacking starts at 10:00 AM when teams reveal their prompts.',
  'Submissions close at the deadline shown in your team room.',
  'Judging starts at 5:00 PM in the main hall.',
  '',
  '# Rules',
  'Every project must be built during this event.',
  'Each team submits once by signing with its security key. Submissions cannot be changed.',
  'Return your pool key to the organizer desk when you leave.',
  '',
  '# Judging criteria',
  'Judges score each project on idea, technical depth, design, and the demo.',
  'Each team gets 3 minutes to demo and 2 minutes for questions.',
  '',
  '# FAQ',
  'Lost your key? Go to the organizer desk. The organizer can replace it with a logged override.',
  'Wi-Fi: the network name and password are posted at the organizer desk.',
  'Food: lunch is at 12:30 PM and dinner is at 6:00 PM.',
].join('\n');

router.post('/seed', sessions.requireOrg, body({}), (req, res) => {
  if (store.teams.size > 0) return failWith(res, 'SEED_NOT_EMPTY');
  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  createPrompt(
    'Duck Pond Sensors',
    'Build a sensor that reports the duck pond water level and temperature to a live page. Your check phrase is PINEAPPLE42.',
    deadline
  );
  createPrompt(
    'Quack Commons',
    'Build a shared board where visitors leave notes for each other near the pond. Your check phrase is KIWI19.',
    deadline
  );
  createDraftTeam('Team Mallard', 'key', { keySource: 'pool', tagColor: 'yellow', tagLabel: 'Pool 01' });
  createDraftTeam('Team Teal', 'key', { keySource: 'pool', tagColor: 'blue', tagLabel: 'Pool 02' });
  const bundleHash = canon.sha256hex(canon.utf8(DEMO_BUNDLE));
  log.append(ORG_ACTOR, 'bundle.updated', { bundleHash });
  store.event.bundle = DEMO_BUNDLE;
  store.event.bundleHash = bundleHash;
  log.append(ORG_ACTOR, 'demo.seeded', {});
  res.json({ ok: true });
});

// FR-34: the full log as a file.
router.get('/log.json', sessions.requireOrg, query({}), (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="quacktrack-log.json"');
  res.type('application/json').send(JSON.stringify(store.log, null, 2));
});

module.exports = { router, bootSetup };
