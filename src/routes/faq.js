'use strict';
// src/routes/faq.js: the FAQ assistant for a team (SRS.md FR-25 to FR-27).
// Read tier: the team comes from the session only. The only state this
// file changes is the unanswered list and the log. Question text is kept
// on the unanswered list for the organizer, never in the log (L5 allowlist).

const crypto = require('crypto');
const express = require('express');

const { store } = require('../store');
const { failWith, notice } = require('../errors');
const { body, query, rateLimit } = require('../validate');
const log = require('../log');
const sessions = require('../sessions');
const { askFAQ } = require('../ai/askFAQ');

const router = express.Router();
const MAX_UNANSWERED = 500;

// FR-24: sections start with a line beginning "# ". Text before the first
// heading becomes a section with an empty heading.
function sections(bundle) {
  const out = [];
  let cur = null;
  for (const line of String(bundle).split('\n')) {
    if (line.startsWith('# ')) {
      cur = { heading: line.slice(2).trim(), lines: [] };
      out.push(cur);
    } else {
      if (!cur) {
        cur = { heading: '', lines: [] };
        out.push(cur);
      }
      cur.lines.push(line);
    }
  }
  return out
    .map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim() }))
    .filter((s) => s.heading || s.body);
}

function sessionTeam(req, res) {
  const team = store.teams.get(req.session.teamId);
  if (!team) {
    sessions.logout(req, res, 'team');
    failWith(res, 'SESSION_ENDED');
    return null;
  }
  return team;
}

// FR-25: one question per 5 seconds per session (E58).
const faqLimit = rateLimit((req) => [['faq', req.session.sid, 1, 5000]], 'FAQ_SLOW');

router.post(
  '/faq',
  sessions.requireTeam,
  body({ question: { type: 'string', label: 'Question', min: 1, max: 300 } }),
  (req, res, next) => {
    const team = sessionTeam(req, res);
    if (!team) return;
    if (!req.session.memberHandle) return failWith(res, 'PICK_MEMBER_FAQ');
    if (!store.event.bundle) return failWith(res, 'NO_BUNDLE');
    req.team = team;
    next();
  },
  faqLimit,
  async (req, res) => {
    const team = req.team;
    const handle = req.session.memberHandle;
    const question = req.body.question.trim();
    const bundle = store.event.bundle;
    const result = await askFAQ({ question, bundle });

    // After the await: the team may have been wiped by a reset meanwhile.
    if (!store.teams.has(team.id)) return failWith(res, 'SESSION_ENDED');
    if (result.answered) {
      log.append({ kind: 'team', id: team.id }, 'faq.answered', { teamId: team.id, handle, provider: result.provider });
      return res.json({ ok: true, answered: true, answer: result.answer, quote: result.quote, mode: 'ai' });
    }
    // FR-26: the refusal sentence, and the question goes to the organizers.
    const q = {
      id: 'uq_' + crypto.randomBytes(8).toString('hex'),
      teamId: team.id,
      handle,
      question,
      reason: result.reason,
      provider: result.provider,
      at: new Date().toISOString(),
    };
    log.append({ kind: 'team', id: team.id }, 'faq.unanswered', { teamId: team.id, handle, questionId: q.id, reason: q.reason, provider: q.provider });
    store.unanswered.push(q);
    if (store.unanswered.length > MAX_UNANSWERED) store.unanswered.splice(0, store.unanswered.length - MAX_UNANSWERED);
    // FR-27: a provider that is missing or failed means this question falls
    // back to the searchable list.
    res.json({ ok: true, answered: false, refusal: notice('N02'), mode: result.reason === 'provider_unavailable' ? 'list' : 'ai' });
  }
);

// FR-27: the event information as sections for the searchable list.
router.get('/bundle', sessions.requireTeam, query({}), (req, res) => {
  if (!sessionTeam(req, res)) return;
  if (!store.event.bundle) return failWith(res, 'NO_BUNDLE');
  res.json({ ok: true, sections: sections(store.event.bundle) });
});

module.exports = { router, sections };
