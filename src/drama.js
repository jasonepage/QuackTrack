'use strict';
// src/drama.js: system posts in The Quad (SRS.md FR-22). Every post is
// built from an action log entry, using only the allowed fields: team
// name, credential label, short hash, and times. Never prompt text, secret
// text, chat, questions, handles, repo links, commits, credential IDs,
// fingerprints, tags, or failed taps (L2 by construction). The deadline
// timer reads only prompt deadlines, which are public.

const crypto = require('crypto');
const { store } = require('./store');
const log = require('./log');

const COMMONS_KEEP = 1000;
const SYSTEM = Object.freeze({ kind: 'system', id: null });

function addSystemPost(text, deadline = null) {
  const post = {
    id: 'ms_' + crypto.randomBytes(8).toString('hex'),
    channel: 'commons',
    teamId: null,
    teamName: null,
    handle: null,
    role: null,
    kind: 'system',
    text,
    offer: null,
    want: null,
    pinned: false,
    deleted: false,
    deadline,
    createdAt: new Date().toISOString(),
  };
  store.messages.set(post.id, post);
  trimCommons();
}

function trimCommons() {
  const commons = [...store.messages.values()].filter((m) => m.channel === 'commons');
  for (let i = 0; i < commons.length - COMMONS_KEEP; i++) store.messages.delete(commons[i].id);
}

// The only fields a system post may use, by action.
const ALLOWED = {
  'team.enrolled': ['teamName', 'label'],
  'prompt.revealed': ['teamName'],
  'submission.signed': ['teamName', 'contentHash'],
  'team.override': ['teamName'],
  'deadline.warning': ['deadline'],
  'deadline.unsubmitted': ['teamName'],
};
const TEXT = {
  'team.enrolled': (d) => `${d.teamName} enrolled with a ${d.label}.`,
  'prompt.revealed': (d) => `${d.teamName} revealed its prompt.`,
  'submission.signed': (d) => `${d.teamName} signed its submission. Hash ${d.contentHash.slice(0, 8)}.`,
  'team.override': (d) => `OVERRIDE: the organizer replaced ${d.teamName}'s key.`,
  // The page fills {deadline} in the viewer's local time (D14).
  'deadline.warning': () => '30 minutes left until the {deadline} deadline.',
  'deadline.unsubmitted': (d) => `${d.teamName} has not signed a submission. 10 minutes left.`,
};

function onEntry(entry) {
  const fields = ALLOWED[entry.action];
  if (!fields) return; // every other action stays out of The Quad
  const d = {};
  for (const k of fields) {
    if (typeof entry.data[k] !== 'string' || !entry.data[k]) {
      console.warn(`[drama] not posted: ${entry.action} is missing ${k}`);
      return;
    }
    d[k] = entry.data[k];
  }
  addSystemPost(TEXT[entry.action](d), entry.action === 'deadline.warning' ? d.deadline : null);
}
log.onAppend(onEntry);

// FR-22 deadline timer, every 15 seconds. 30 minutes before each distinct
// deadline: one warning. 10 minutes before: one post per unsubmitted team.
const MIN = 60 * 1000;
function tick(now = Date.now()) {
  const byDeadline = new Map();
  for (const p of store.prompts.values()) {
    if (!byDeadline.has(p.deadline)) byDeadline.set(p.deadline, []);
    byDeadline.get(p.deadline).push(p);
  }
  for (const [deadline, prompts] of byDeadline) {
    const left = Date.parse(deadline) - now;
    if (left > 0 && left <= 30 * MIN && prompts.some((p) => !p.warned30)) {
      log.append(SYSTEM, 'deadline.warning', { deadline, minutesLeft: 30 });
      for (const p of prompts) p.warned30 = true;
    }
  }
  for (const team of store.teams.values()) {
    if (team.warned10 || team.state === 'SUBMITTED' || team.state === 'DRAFT') continue;
    const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
    if (!prompt) continue;
    const left = Date.parse(prompt.deadline) - now;
    if (left > 0 && left <= 10 * MIN) {
      log.append(SYSTEM, 'deadline.unsubmitted', { teamId: team.id, teamName: team.name, deadline: prompt.deadline });
      team.warned10 = true;
    }
  }
}
const timer = setInterval(() => {
  try {
    tick();
  } catch (err) {
    console.error('[drama] deadline timer failed:', err.message);
  }
}, 15000);
timer.unref();

module.exports = { tick, addSystemPost };
