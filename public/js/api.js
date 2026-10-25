'use strict';
// public/js/api.js: the fetch wrapper and the banners every page uses.
// Classic script, so api(), showFail(), showNotice() and clearBanners() are
// globals that page modules and DevTools can call.
// Server text is always rendered with textContent, never innerHTML.

// E08 from SRS.md section 4A, copied verbatim. Used when the server cannot be
// reached or does not answer with the QuackTrack envelope.
const QT_SERVER_SENTENCE = 'Something broke on the server. The organizer can check the terminal.';

// Banner only rows from SRS.md section 4A, copied verbatim. A page shows
// these when the browser itself cancels or refuses a tap, so there is no
// server response to carry the sentence. Later tickets add their rows here.
const QT_BANNER = Object.freeze({
  ORG_TAP_CANCELLED: 'The key tap was cancelled. Nothing changed.', // E16
  ENROLL_CANCELLED: 'The key tap was cancelled. Nothing was enrolled.', // E34
});

class ApiError extends Error {
  constructor(status, code, sentence) {
    super(sentence);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function qtBanner(id, className, sentence) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = className;
    document.body.prepend(el);
  }
  el.setAttribute('role', id === 'qt-fail' ? 'alert' : 'status');
  el.textContent = String(sentence);
  el.hidden = false;
  return el;
}

// Full width red bar at the top of the page, one sentence, 32px or larger,
// bold white on red (SRS.md section 1, NFR-05).
function showFail(sentence) {
  const notice = document.getElementById('qt-notice');
  if (notice) notice.hidden = true;
  const el = qtBanner('qt-fail', 'fail-banner', sentence);
  el.scrollIntoView({ block: 'start' });
  return el;
}

// Yellow notice bar (SRS.md section 4A notices N01 to N05). Not a failure.
function showNotice(sentence) {
  return qtBanner('qt-notice', 'notice-banner', sentence);
}

function clearBanners() {
  for (const id of ['qt-fail', 'qt-notice']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
}

// api(path, { method, body, silent }) -> the parsed { ok: true, ... } object.
// On { ok: false } it shows the server's sentence in the fail banner (unless
// silent) and throws an ApiError carrying status, code, and sentence.
// It never swallows an error.
async function api(path, { method, body, silent = false } = {}) {
  const verb = (method || (body === undefined ? 'GET' : 'POST')).toUpperCase();
  const init = { method: verb, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (verb === 'POST') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body === undefined ? {} : body);
  }
  let res;
  let data = null;
  try {
    res = await fetch(path, init);
  } catch (_) {
    if (!silent) showFail(QT_SERVER_SENTENCE);
    throw new ApiError(0, 'SERVER', QT_SERVER_SENTENCE);
  }
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!data || typeof data.ok !== 'boolean' || (!data.ok && typeof data.error !== 'string')) {
    if (!silent) showFail(QT_SERVER_SENTENCE);
    throw new ApiError(res.status, 'SERVER', QT_SERVER_SENTENCE);
  }
  if (!data.ok) {
    if (!silent) showFail(data.error);
    throw new ApiError(res.status, data.code, data.error);
  }
  return data;
}
