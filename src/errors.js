'use strict';
// src/errors.js: the error envelope, fail(), the 500 handler, and the
// SRS.md section 4A error dictionary. Every sentence a person can see comes
// from this table. Never add a sentence here that is not in SRS.md section 4A.

// [number, code, HTTP status (null = banner or page only), exact sentence]
const ROWS = [
  ['E01', 'UNKNOWN_FIELD', 400, "This request has a field QuackTrack does not accept: {field}."],
  ['E02', 'BAD_LENGTH', 400, "{label} must be {min} to {max} characters."],
  ['E03', 'BAD_TYPE', 400, "{label} is missing or is not the right kind of value."],
  ['E04', 'TOO_LARGE', 413, "That request is too large."],
  ['E05', 'BLOCKED', 403, "Request blocked: it did not come from this QuackTrack page."],
  ['E06', 'WRONG_HOST', 421, "Open {origin} instead. Security keys only work on the exact address QuackTrack was set up for."],
  ['E07', 'RATE_TAP', 429, "Too many key taps from this network. Wait a minute and try again."],
  ['E08', 'SERVER', 500, "Something broke on the server. The organizer can check the terminal."],
  ['E09', 'SESSION_ENDED', 401, "Your session ended. Tap your key to come back in."],
  ['E10', 'NO_TEAM_SESSION', 401, "Tap your key to open your team room."],
  ['E11', 'NO_ORG_SESSION', 401, "Organizer sign-in required."],
  ['E12', 'SETUP_INVALID', 403, "This setup link is not valid. Use the link printed in the server terminal."],
  ['E13', 'SETUP_USED', 403, "This setup link was already used. Log in on the console instead."],
  ['E14', 'NO_ORGANIZER', 409, "No organizer is set up yet. Use the setup link printed in the server terminal."],
  ['E15', 'NOT_ORG_KEY', 401, "That key is not the organizer's key."],
  ['E16', 'ORG_TAP_CANCELLED', null, "The key tap was cancelled. Nothing changed."],
  ['E17', 'TEAM_NAME_TAKEN', 409, "A team named {team} already exists. Pick another name."],
  ['E18', 'TEAM_LIMIT', 409, "This event already has 40 teams, the most QuackTrack holds."],
  ['E19', 'TEAM_NOT_FOUND', 404, "That team does not exist."],
  ['E20', 'TEAM_NOT_DELETABLE', 409, "{team} is enrolled and cannot be deleted."],
  ['E21', 'NOT_ENROLLED', 409, "{team} is not enrolled yet. Enroll at the organizer desk."],
  ['E22', 'BAD_HANDLE', 400, "That is not a valid GitHub handle."],
  ['E23', 'HANDLE_TAKEN', 409, "{handle} is already on {team}'s roster."],
  ['E24', 'BAD_ROLE', 400, "Pick a role: Captain, Builder, Designer, or Presenter."],
  ['E25', 'SECOND_CAPTAIN', 409, "{team} already has a Captain."],
  ['E26', 'ROSTER_FULL', 409, "{team}'s roster is full."],
  ['E27', 'ROSTER_LOCKED', 409, "{team}'s roster is locked."],
  ['E30', 'TAG_MISSING', 400, "Enter the tag color and the key's pool label before enrolling a pool key."],
  ['E31', 'OWN_KEY_NOT_APPROVED', 400, "Tick the box that says you checked this team in person before enrolling their own key."],
  ['E32', 'KEY_TAKEN', 409, "This key is already enrolled to another team or the organizer. Use a different key."], // 409 and banner
  ['E33', 'NOT_A_KEY', 422, "This looks like a passkey, not a physical security key. Use the key, or create the team as Solo passkey."],
  ['E34', 'ENROLL_CANCELLED', null, "The key tap was cancelled. Nothing was enrolled."],
  ['E35', 'ENROLL_EXPIRED', 410, "This tap expired. Click Enroll again."],
  ['E36', 'ROSTER_CHANGED', 409, "{team}'s roster changed during enrollment. Click Enroll again."],
  ['E37', 'PROMPT_EMPTY', 400, "A prompt needs a track and instructions."],
  ['E38', 'DEADLINE_PAST', 400, "The deadline must be in the future."],
  ['E39', 'PROMPT_NOT_FOUND', 404, "That prompt does not exist."],
  ['E40', 'ALREADY_REVEALED', 409, "{team} already revealed its prompt. It cannot be reassigned."],
  ['E41', 'WRONG_KEY', 401, "That key is not {team}'s key. Nothing was revealed."],
  ['E42', 'WRONG_KEY_OR_CANCEL', null, "That was not {team}'s key, or the tap was cancelled. Nothing was revealed."],
  ['E43', 'TAP_USED', 410, "This tap was already used. Tap your key again."],
  ['E44', 'TAP_EXPIRED', 410, "This tap expired. Tap your key again."],
  ['E45', 'COUNTER_BACKWARDS', 401, "This key's counter went backwards, which can mean a cloned key. Ask the organizer."],
  ['E46', 'TAP_NOT_OPEN', 404, "That tap is no longer open."],
  ['E47', 'NOT_ON_ROSTER', 400, "{handle} is not on {team}'s roster."],
  ['E48', 'DOWNLOAD_EARLY', 403, "Reveal your prompt before you download it."],
  ['E49', 'PICK_MEMBER_CHAT', 400, "Pick who is at the keyboard before you chat."],
  ['E50', 'CHAT_SLOW', 429, "Slow down. Wait a second and send again."],
  ['E51', 'PICK_MEMBER_POST', 400, "Pick who is at the keyboard before you post."],
  ['E52', 'POST_SLOW', 429, "Slow down. Wait a few seconds and post again."],
  ['E53', 'MUTED', 403, "{team} is muted in The Quad by the organizer."],
  ['E54', 'TRADE_FIELDS', 400, "A trade offer needs both what you offer and what you want."],
  ['E55', 'POST_NOT_FOUND', 404, "That post does not exist."],
  ['E56', 'NO_BUNDLE', 409, "The organizer has not added event information yet."],
  ['E57', 'BUNDLE_TOO_LONG', 400, "The event information is too long. Keep it under 30000 characters."],
  ['E58', 'FAQ_SLOW', 429, "One question at a time. Wait a few seconds."],
  ['E59', 'REVEAL_FIRST', 409, "Reveal your prompt before you submit."],
  ['E60', 'DEADLINE_PASSED', 409, "The deadline has passed. Submissions are closed for {team}."],
  ['E61', 'ALREADY_SUBMITTED', 409, "{team} already submitted. Submissions cannot be changed."],
  ['E62', 'REPO_NOT_HTTPS', 400, "The repo link must start with https://."],
  ['E63', 'BAD_COMMIT', 400, "The commit must be the full 40 character ID from git rev-parse HEAD."],
  ['E64', 'NO_DECLARATION', 400, "Tick the build declaration before you sign."],
  ['E65', 'CONTENT_CHANGED', 409, "The submission changed after you started signing. Nothing was submitted."],
  ['E66', 'NOT_SIGNED', 401, "The submission was not signed. Nothing was submitted."], // 401 and banner
  ['E67', 'SIGN_EXPIRED', 410, "This signing tap expired. Click Sign submission again."],
  ['E68', 'NO_RECEIPT', 404, "There is no receipt with that ID."],
  ['E69', 'CHECK_FAILED', null, "This check failed. The receipt does not match its signature."], // page
  ['E70', 'RESET_CONFIRM', 400, "Type RESET to confirm."],
  ['E71', 'SEED_NOT_EMPTY', 409, "Demo data needs an empty event. Reset first."],
  ['E72', 'OVERRIDE_CONFIRM', 400, "Type OVERRIDE to confirm."],
  ['E73', 'OVERRIDE_NOT_NEEDED', 409, "{team} already submitted. A replacement key is not needed."],
  ['E74', 'OVERRIDE_EXPIRED', 410, "This tap expired. Click Replace key again."],
  ['E75', 'OVERRIDE_CANCELLED', null, "The key tap was cancelled. The old key still belongs to {team}."],
  ['E76', 'SECRET_BODY', 400, "A secret needs a body."], // FR-18, parked
  ['E77', 'SECRET_NOT_FOUND', 404, "That secret does not exist for {team}."], // FR-19, parked
  ['E78', 'ADD_AFTER_SUBMIT', 409, "{team} already submitted. New members cannot be added now."], // FR-42
  // E79 to E81 were retired in Session 3.
  ['E82', 'PICK_MEMBER_FAQ', 400, "Pick who is at the keyboard before you ask."], // FR-25 (added with T8)
];

// Notices (yellow, not failures) and the one terminal only line, from SRS.md section 4A.
const NOTICES = Object.freeze({
  N01: "No prompt is assigned to {team} yet.",
  N02: "I can't find that in the event information, so I've sent your question to the organizers.",
  N03: "In-memory event: a restart wipes everything.",
  N04: "Shared laptop: click Leave room when you are done.",
  N05: "Your key was replaced by organizer override.",
});
const TERMINAL_RP_ID = 'RP_ID must match the host in ORIGIN. QuackTrack stopped.';

const DICT = Object.freeze(
  Object.fromEntries(ROWS.map(([no, code, http, text]) => [code, Object.freeze({ no, code, http, text })]))
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// A template like "{team} already has a Captain." becomes a pattern that a
// filled sentence must match, so fail() can refuse sentences not in the table.
const PATTERNS = Object.fromEntries(
  ROWS.map(([, code, , text]) => {
    const src = text.split(/(\{[a-z]+\})/).map((part) => (/^\{[a-z]+\}$/.test(part) ? '.+' : escapeRegex(part))).join('');
    return [code, new RegExp('^' + src + '$', 's')];
  })
);

// Fill {placeholders} in a dictionary sentence. A missing variable throws,
// so a half filled sentence never reaches a person.
function say(code, vars = {}) {
  const row = DICT[code];
  if (!row) throw new Error(`Unknown error code ${code}`);
  return row.text.replace(/\{([a-z]+)\}/g, (_, name) => {
    if (vars[name] === undefined || vars[name] === null) throw new Error(`Missing {${name}} for ${code}`);
    return String(vars[name]);
  });
}

function notice(id, vars = {}) {
  const text = NOTICES[id];
  if (!text) throw new Error(`Unknown notice ${id}`);
  return text.replace(/\{([a-z]+)\}/g, (_, name) => String(vars[name]));
}

function sendServerError(res) {
  const row = DICT.SERVER;
  res.status(500).json({ ok: false, code: row.code, error: row.text });
}

// fail(res, status, code, sentence): the only way a route reports a failure.
// The code must be in the dictionary and the sentence must be that code's
// sentence (with placeholders filled). Anything else becomes E08, and the
// mistake is printed to the terminal, never to the page.
function fail(res, status, code, sentence) {
  const row = DICT[code];
  if (!row || !PATTERNS[code].test(String(sentence)) || (row.http !== null && row.http !== status)) {
    console.error(`[errors] refused a failure that is not in the dictionary: ${status} ${code}`);
    return sendServerError(res);
  }
  return res.status(status).json({ ok: false, code, error: sentence });
}

// Convenience: status and sentence both come from the dictionary row.
function failWith(res, code, vars = {}) {
  const row = DICT[code];
  if (!row || row.http === null) {
    console.error(`[errors] ${code} has no HTTP status in the dictionary`);
    return sendServerError(res);
  }
  let sentence;
  try {
    sentence = say(code, vars);
  } catch (err) {
    console.error(`[errors] ${err.message}`);
    return sendServerError(res);
  }
  return fail(res, row.http, code, sentence);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// A plain page with one dictionary sentence in the fail banner style.
// Used only where no QuackTrack page can load (the wrong host page, FR-37).
function sendPlainPage(res, status, sentence) {
  res
    .status(status)
    .type('html')
    .send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>QuackTrack</title></head>' +
        '<body style="margin:0;background:#fff;font-family:system-ui,sans-serif">' +
        '<div role="alert" style="background:#b00020;color:#fff;font-weight:700;font-size:40px;line-height:1.25;padding:32px 24px">' +
        escapeHtml(sentence) +
        '</div></body></html>'
    );
}

// Express error middleware. Body parser errors map to dictionary sentences;
// everything else is E08 with the details printed to the terminal only.
// No stack trace ever goes into a response (NFR-05).
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') return failWith(res, 'TOO_LARGE');
  if (err && typeof err.type === 'string' && err.status >= 400 && err.status < 500) {
    // Malformed or unreadable JSON body. SRS.md 4A has no row for this case,
    // so it uses E03 with the body as the field.
    return failWith(res, 'BAD_TYPE', { label: 'Request body' });
  }
  console.error('[server error]', err);
  return sendServerError(res);
}

module.exports = { DICT, NOTICES, TERMINAL_RP_ID, say, notice, fail, failWith, sendPlainPage, errorHandler };
