'use strict';
// src/routes/public.js: endpoints anyone may call, with no session.
// Never returns a prompt, a secret, a roster, or chat (L2).
// Receipts are added here by T6.

const express = require('express');
const { store } = require('../store');
const { query } = require('../validate');

const router = express.Router();

// Team names for the /team picker: enrolled teams only, id and name only.
router.get('/teams', query({}), (req, res) => {
  const teams = [...store.teams.values()]
    .filter((t) => t.state !== 'DRAFT')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((t) => ({ id: t.id, name: t.name }));
  res.json({ ok: true, teams });
});

module.exports = { router };
