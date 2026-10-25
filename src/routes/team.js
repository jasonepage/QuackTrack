'use strict';
// src/routes/team.js: the read tier team room (SRS.md FR-13, FR-14, FR-15,
// FR-12 logout). The team always comes from the session, never from the
// request: no route here accepts a team ID (L1, INV-05).

const express = require('express');

const config = require('../config');
const { store } = require('../store');
const { failWith, notice } = require('../errors');
const { body, query } = require('../validate');
const log = require('../log');
const sessions = require('../sessions');
const { keySourceText } = require('./enroll');

const router = express.Router();

function sessionTeam(req, res) {
  const team = store.teams.get(req.session.teamId);
  if (!team) {
    sessions.logout(req, res, 'team');
    failWith(res, 'SESSION_ENDED');
    return null;
  }
  return team;
}

// FR-13 room object. The prompt is included only after this team revealed it (L2).
function roomView(team, session) {
  const cred = team.credentialId ? store.credentials.get(team.credentialId) : null;
  const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
  const revealed = team.state === 'REVEALED' || team.state === 'SUBMITTED';
  const promptState = !prompt ? 'none' : revealed ? 'revealed' : 'sealed';
  const notices = [];
  if (config.LOCAL_MODE) notices.push(notice('N04'));
  if (team.overrideCount > 0) notices.push(notice('N05'));
  if (promptState === 'none') notices.push(notice('N01', { team: team.name }));
  return {
    id: team.id,
    name: team.name,
    state: team.state,
    label: cred ? cred.label : null,
    keySourceText: keySourceText(team),
    roster: team.roster.map((m) => ({ handle: m.handle, displayName: m.displayName, role: m.role })),
    member: session.memberHandle,
    deadline: prompt ? prompt.deadline : null, // the deadline is public (PRODUCT.md open question 4)
    promptState,
    prompt: promptState === 'revealed' ? { track: prompt.track, instructions: prompt.instructions, deadline: prompt.deadline } : null,
    revealedAt: team.revealedAt,
    notices,
  };
}

router.get('/room', sessions.requireTeam, query({}), (req, res) => {
  const team = sessionTeam(req, res);
  if (!team) return;
  res.json({ ok: true, room: roomView(team, req.session) });
});

// FR-14: who is at the keyboard. The handle must be on this team's roster.
router.post('/member', sessions.requireTeam, body({ handle: { type: 'string', label: 'GitHub handle', min: 1, max: 39 } }), (req, res) => {
  const team = sessionTeam(req, res);
  if (!team) return;
  const member = team.roster.find((m) => m.handleKey === req.body.handle.toLowerCase());
  if (!member) return failWith(res, 'NOT_ON_ROSTER', { handle: req.body.handle, team: team.name });
  req.session.memberHandle = member.handle;
  res.json({ ok: true, room: roomView(team, req.session) });
});

// FR-15: download revealed instructions, logged.
router.get('/instructions.txt', sessions.requireTeam, query({}), (req, res) => {
  const team = sessionTeam(req, res);
  if (!team) return;
  const prompt = team.assignedPromptId ? store.prompts.get(team.assignedPromptId) : null;
  if (!prompt || (team.state !== 'REVEALED' && team.state !== 'SUBMITTED')) return failWith(res, 'DOWNLOAD_EARLY');
  log.append({ kind: 'team', id: team.id }, 'instructions.downloaded', { teamId: team.id, handle: req.session.memberHandle });
  const slug = team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
  res.setHeader('Content-Disposition', `attachment; filename="quacktrack-${slug}-instructions.txt"`);
  res.type('text/plain; charset=utf-8').send(`${prompt.track}\n\n${prompt.instructions}\n\nDeadline: ${prompt.deadline}\n`);
});

// FR-12: Leave room.
router.post('/logout', sessions.requireTeam, body({}), (req, res) => {
  sessions.logout(req, res, 'team');
  res.json({ ok: true });
});

module.exports = { router };
