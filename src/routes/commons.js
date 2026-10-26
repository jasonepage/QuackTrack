'use strict';
// src/routes/commons.js: team chat (FR-16), The Quad and trade offers
// (FR-20, FR-21), and organizer moderation (FR-23). The team and the handle
// always come from the session, never from the request (L1, INV-02,
// INV-03). Text is stored and returned as plain strings; pages render it
// with textContent only. The log holds IDs and handles, never text.

const crypto = require('crypto');
const express = require('express');

const { store } = require('../store');
const { failWith } = require('../errors');
const { body, query, rateLimit } = require('../validate');
const canon = require('../canon');
const log = require('../log');
const sessions = require('../sessions');
const { getTeam } = require('./enroll');

const router = express.Router();
const ORG_ACTOR = Object.freeze({ kind: 'organizer', id: 'organizer' });
const CHAT_KEEP = 500; // per team
const CHAT_READ = 100;
const COMMONS_KEEP = 1000;
const COMMONS_READ = 200;
const REMOVED = 'Post removed by the organizer.';

const len = (s) => [...s].length;

// The selected member, only while they are still on this team's roster.
function sessionMember(req, team) {
  const handle = req.session.memberHandle;
  return handle ? team.roster.find((m) => m.handle === handle) || null : null;
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

function newMessage(fields) {
  const m = {
    id: 'ms_' + crypto.randomBytes(8).toString('hex'),
    teamId: null,
    teamName: null,
    handle: null,
    role: null,
    kind: 'chat',
    text: '',
    offer: null,
    want: null,
    pinned: false,
    deleted: false,
    deadline: null,
    createdAt: new Date().toISOString(),
    ...fields,
  };
  store.messages.set(m.id, m);
  return m;
}

// ---------- FR-16 Team chat ----------
function chatView(m) {
  return { id: m.id, handle: m.handle, role: m.role, text: m.text, createdAt: m.createdAt };
}
// The newest messages of one team, oldest first so the newest is at the bottom.
function teamChat(teamId) {
  const msgs = [...store.messages.values()].filter((m) => m.channel === 'team' && m.teamId === teamId);
  return msgs.slice(-CHAT_READ).map(chatView);
}

// The /chat page: the team's name, mute flag, who is at the keyboard, the
// roster handles to pick from, and the newest 100 messages. Read tier: the
// team comes from the session only.
router.get('/team/chat', sessions.requireTeam, query({}), (req, res) => {
  const team = sessionTeam(req, res);
  if (!team) return;
  const member = sessionMember(req, team);
  res.json({
    ok: true,
    teamName: team.name,
    muted: team.muted,
    member: member ? member.handle : null,
    roster: team.roster.map((m) => ({ handle: m.handle, role: m.role })),
    messages: teamChat(team.id),
  });
});

const chatLimit = rateLimit((req) => [['chat', req.session.sid, 1, 1000]], 'CHAT_SLOW');

router.post('/team/chat', sessions.requireTeam, body({ text: { type: 'string', label: 'Message', min: 1, max: 500 } }), (req, res, next) => {
  const team = sessionTeam(req, res);
  if (!team) return;
  const member = sessionMember(req, team);
  if (!member) return failWith(res, 'PICK_MEMBER_CHAT');
  req.team = team;
  req.member = member;
  next();
}, chatLimit, (req, res) => {
  const { team, member } = req;
  const id = 'ms_' + crypto.randomBytes(8).toString('hex');
  log.append({ kind: 'team', id: team.id }, 'chat.posted', { teamId: team.id, messageId: id, handle: member.handle });
  const m = newMessage({ id, channel: 'team', teamId: team.id, teamName: team.name, handle: member.handle, role: member.role, text: canon.norm(req.body.text) });
  const mine = [...store.messages.values()].filter((x) => x.channel === 'team' && x.teamId === team.id);
  for (let i = 0; i < mine.length - CHAT_KEEP; i++) store.messages.delete(mine[i].id);
  res.json({ ok: true, message: chatView(m) });
});

// ---------- FR-20, FR-21 The Quad ----------
function postView(m) {
  if (m.deleted) return { id: m.id, kind: 'removed', text: REMOVED, pinned: m.pinned, createdAt: m.createdAt };
  return { id: m.id, kind: m.kind, teamName: m.teamName, handle: m.handle, role: m.role, text: m.text, offer: m.offer, want: m.want, pinned: m.pinned, deadline: m.deadline, createdAt: m.createdAt };
}
// Newest 200, pinned first, then newest first.
function commonsFeed() {
  const all = [...store.messages.values()].filter((m) => m.channel === 'commons');
  const recent = all.slice(-COMMONS_READ).reverse();
  return [...recent.filter((m) => m.pinned), ...recent.filter((m) => !m.pinned)].map(postView);
}

router.get('/commons', sessions.requireTeam, query({}), (req, res) => {
  if (!sessionTeam(req, res)) return;
  res.json({ ok: true, posts: commonsFeed() });
});

const commonsLimit = rateLimit((req) => [['commons', req.session.sid, 1, 3000]], 'POST_SLOW');

router.post(
  '/commons',
  sessions.requireTeam,
  body({
    kind: { type: 'string', label: 'Kind', oneOf: ['chat', 'trade'] },
    text: { type: 'string', label: 'Post', required: false },
    offer: { type: 'string', label: 'Offer', required: false },
    want: { type: 'string', label: 'Want', required: false },
  }),
  (req, res, next) => {
    const team = sessionTeam(req, res);
    if (!team) return;
    if (team.muted) return failWith(res, 'MUTED', { team: team.name });
    const member = sessionMember(req, team);
    if (!member) return failWith(res, 'PICK_MEMBER_POST');
    const b = req.body;
    const text = canon.norm(b.text || '');
    if (b.kind === 'trade') {
      const offer = canon.norm(b.offer || '');
      const want = canon.norm(b.want || '');
      if (!offer || !want) return failWith(res, 'TRADE_FIELDS');
      if (len(offer) > 80) return failWith(res, 'BAD_LENGTH', { label: 'Offer', min: 1, max: 80 });
      if (len(want) > 80) return failWith(res, 'BAD_LENGTH', { label: 'Want', min: 1, max: 80 });
      if (len(text) > 280) return failWith(res, 'BAD_LENGTH', { label: 'Post', min: 0, max: 280 });
      req.post = { kind: 'trade', text, offer, want };
    } else {
      if (len(text) < 1 || len(text) > 280) return failWith(res, 'BAD_LENGTH', { label: 'Post', min: 1, max: 280 });
      if (b.offer !== undefined || b.want !== undefined) return failWith(res, 'UNKNOWN_FIELD', { field: b.offer !== undefined ? 'offer' : 'want' });
      req.post = { kind: 'chat', text, offer: null, want: null };
    }
    req.team = team;
    req.member = member;
    next();
  },
  commonsLimit,
  (req, res) => {
    const { team, member, post } = req;
    const id = 'ms_' + crypto.randomBytes(8).toString('hex');
    log.append({ kind: 'team', id: team.id }, 'commons.posted', { teamId: team.id, postId: id, handle: member.handle, kind: post.kind });
    const m = newMessage({ id, channel: 'commons', teamId: team.id, teamName: team.name, handle: member.handle, role: member.role, ...post });
    const commons = [...store.messages.values()].filter((x) => x.channel === 'commons');
    for (let i = 0; i < commons.length - COMMONS_KEEP; i++) store.messages.delete(commons[i].id);
    res.json({ ok: true, post: postView(m) });
  }
);

// ---------- FR-23 Moderation (organizer) ----------
function commonsPost(postId) {
  const m = typeof postId === 'string' ? store.messages.get(postId) : null;
  return m && m.channel === 'commons' ? m : null;
}

router.post('/org/commons/:postId/pin', sessions.requireOrg, body({ pinned: { type: 'boolean', label: 'Pinned' } }), (req, res) => {
  const m = commonsPost(req.params.postId);
  if (!m) return failWith(res, 'POST_NOT_FOUND');
  log.append(ORG_ACTOR, req.body.pinned ? 'commons.pinned' : 'commons.unpinned', { postId: m.id });
  m.pinned = req.body.pinned;
  res.json({ ok: true, post: postView(m) });
});

router.post('/org/commons/:postId/delete', sessions.requireOrg, body({}), (req, res) => {
  const m = commonsPost(req.params.postId);
  if (!m) return failWith(res, 'POST_NOT_FOUND');
  log.append(ORG_ACTOR, 'commons.deleted', { postId: m.id });
  // Removed for everyone: the text is dropped, not hidden.
  m.deleted = true;
  m.text = '';
  m.offer = null;
  m.want = null;
  res.json({ ok: true });
});

router.post('/org/teams/:teamId/mute', sessions.requireOrg, body({ muted: { type: 'boolean', label: 'Muted' } }), (req, res) => {
  const team = getTeam(req.params.teamId);
  if (!team) return failWith(res, 'TEAM_NOT_FOUND');
  if (team.state === 'DRAFT') return failWith(res, 'NOT_ENROLLED', { team: team.name });
  log.append(ORG_ACTOR, req.body.muted ? 'team.muted' : 'team.unmuted', { teamId: team.id });
  team.muted = req.body.muted;
  res.json({ ok: true });
});

module.exports = { router, teamChat, commonsFeed };
