'use strict';
// src/store.js: the in-memory store. Nothing here is ever written to disk (NFR-03).
// A restart wipes the event. Entity shapes are in SDS.md section 3.

const store = {
  event: freshEvent(),
  teams: new Map(), // id -> Team
  credentials: new Map(), // base64url credential ID -> Credential (ACTIVE or REVOKED)
  prompts: new Map(), // id -> PromptAssignment
  sessions: new Map(), // sid -> Session
  pending: new Map(), // ceremony id -> PendingCeremony (includes PENDING sign ceremonies)
  messages: new Map(), // id -> ChatMessage (team chat and The Quad)
  submissions: new Map(), // id -> Submission (SIGNED only)
  unanswered: [], // UnansweredQuestion, newest last
  log: [], // ActionLogEntry, append only (src/log.js owns appends)
};

function freshEvent() {
  return {
    setupToken: null, // set at boot by organizer setup (T3)
    setupUsed: false,
    bundle: null,
    bundleHash: null,
    createdAt: new Date().toISOString(),
  };
}

// FR-35: wipe the event. With keepOrganizer, the organizer credential, the
// setup state, and the one organizer session named by keepSid survive.
// The caller reads the old log head before calling this, then appends
// event.reset to the new, empty log.
function resetStore({ keepOrganizer = false, keepSid = null } = {}) {
  const orgCreds = keepOrganizer
    ? [...store.credentials.values()].filter((c) => c.ownerKind === 'organizer')
    : [];
  const keptSession = keepOrganizer && keepSid ? store.sessions.get(keepSid) : null;
  const oldEvent = store.event;

  store.event = freshEvent();
  if (keepOrganizer) {
    store.event.setupToken = oldEvent.setupToken;
    store.event.setupUsed = oldEvent.setupUsed;
  }

  store.teams.clear();
  store.credentials.clear();
  for (const c of orgCreds) store.credentials.set(c.id, c);
  store.prompts.clear();
  store.sessions.clear();
  if (keptSession && keptSession.kind === 'organizer') store.sessions.set(keepSid, keptSession);
  store.pending.clear();
  store.messages.clear();
  store.submissions.clear();
  store.unanswered.length = 0;
  store.log.length = 0;
}

module.exports = { store, resetStore };
