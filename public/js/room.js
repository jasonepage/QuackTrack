// public/js/room.js: the team room (SRS.md FR-13, FR-14, FR-15, FR-38),
// the FAQ box and searchable event information list (FR-25 to FR-27),
// and the Sign form, locked signing panel, and receipt moment (FR-28,
// FR-29, FR-38). The team comes from this browser's session only. Every
// server string is rendered with textContent, never innerHTML. Polls every
// 2 seconds, except while a signing tap is open.
import { startAuthentication } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);
let room = null;
let lastJson = '';
let timer = null;
let tapping = false;
let signing = false; // FR-38: the page holds still until the sign tap ends

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function localTime(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function renderPrompt() {
  const card = $('prompt');
  card.replaceChildren();
  card.className = 'prompt-card prompt-' + room.promptState;
  if (room.promptState === 'sealed') {
    // FR-38 reveal moment.
    card.append(el('p', `Sealed prompt for ${room.name}. Tap your key to reveal.`, 'sealed-line'));
    if (tapping) {
      card.append(el('p', 'Tap your key now', 'tap-now'));
    } else {
      const b = el('button', 'Tap to reveal', 'action-button');
      b.type = 'button';
      b.addEventListener('click', reveal);
      card.append(b);
    }
  } else if (room.promptState === 'revealed') {
    card.append(el('p', 'Your prompt', 'step-num'));
    card.append(el('h2', room.prompt.track, 'prompt-track'));
    card.append(el('p', room.prompt.instructions, 'prompt-text'));
    card.append(el('p', 'Deadline: ' + localTime(room.prompt.deadline), 'prompt-deadline'));
    const d = el('button', 'Download instructions', 'small-button');
    d.type = 'button';
    d.addEventListener('click', download);
    card.append(d);
  } else {
    card.append(el('p', 'No prompt yet. This page updates by itself.', 'muted'));
  }
}

function render() {
  $('room').hidden = false;
  $('leave').hidden = false;
  $('no-session').hidden = true;

  const notices = $('notices');
  notices.replaceChildren(...room.notices.map((n) => el('p', n, 'notice-box')));
  $('team-name').textContent = room.name;

  const facts = $('team-facts');
  facts.replaceChildren();
  const rows = [['Credential', room.label], ['Key', room.keySourceText]];
  if (room.deadline) rows.push(['Deadline', localTime(room.deadline)]);
  for (const [k, v] of rows) facts.append(el('dt', k), el('dd', v || ''));

  renderPrompt();
  renderSubmit();
  renderFaq();
  renderChat();

  const members = $('members');
  members.replaceChildren();
  for (const m of room.roster) {
    const b = el('button', undefined, 'member-pick');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(room.member === m.handle));
    b.append(el('strong', m.handle), el('span', ` ${m.role}`));
    b.addEventListener('click', () => pickMember(m.handle));
    members.append(b);
  }

  $('roster').replaceChildren(
    ...room.roster.map((m) => {
      const li = el('li');
      li.append(el('strong', m.handle), document.createTextNode(` ${m.displayName}, ${m.role}`));
      return li;
    })
  );
}

function showNoSession(message) {
  if (timer) clearInterval(timer);
  timer = null;
  $('room').hidden = true;
  $('leave').hidden = true;
  $('no-session').hidden = false;
  showFail(message);
}

async function load() {
  if (signing) return;
  try {
    const data = await api('/api/team/room', { silent: true });
    const json = JSON.stringify(data.room);
    if (json === lastJson) return; // nothing changed: keep the page still
    lastJson = json;
    room = data.room;
    render();
  } catch (err) {
    if (err.status === 401) showNoSession(err.message);
    else showFail(err.message);
  }
}

async function reveal() {
  tapping = true;
  renderPrompt();
  const result = await teamTap(startAuthentication, { id: room.id, name: room.name }, () => {});
  tapping = false;
  lastJson = '';
  if (!result) renderPrompt();
  await load();
}

async function pickMember(handle) {
  try {
    const data = await api('/api/team/member', { body: { handle } });
    room = data.room;
    lastJson = JSON.stringify(room);
    clearBanners();
    render();
  } catch (_) {
    // the banner shows the server's sentence
  }
}

async function download() {
  let res;
  try {
    res = await fetch('/api/team/instructions.txt', { credentials: 'same-origin' });
  } catch (_) {
    showFail(QT_SERVER_SENTENCE);
    return;
  }
  if (!res.ok) {
    let msg = QT_SERVER_SENTENCE;
    try {
      msg = (await res.json()).error || msg;
    } catch (_) {
      // keep the server sentence
    }
    showFail(msg);
    return;
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name ? name[1] : 'quacktrack-instructions.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Team chat (FR-16) and The Quad (FR-20 to FR-22) ----------
function shortTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderChat() {
  const list = $('chat');
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
  list.replaceChildren();
  if (!room.chat.length) list.append(el('li', 'No messages yet.', 'muted'));
  for (const m of room.chat) {
    const li = el('li', undefined, 'chat-item');
    const meta = el('p', undefined, 'post-meta');
    meta.append(el('strong', m.handle), document.createTextNode(` ${m.role}, ${shortTime(m.createdAt)}`));
    li.append(meta, el('p', m.text, 'post-text'));
    list.append(li);
  }
  if (atBottom) list.scrollTop = list.scrollHeight; // newest at the bottom
}

let lastQuad = '';
function postItem(p) {
  const li = el('li', undefined, 'quad-item' + (p.pinned ? ' pinned' : '') + (p.kind === 'system' ? ' system' : ''));
  if (p.pinned) li.append(el('span', 'Pinned', 'chip'));
  if (p.kind === 'removed') {
    li.append(el('p', p.text, 'post-text muted'));
    return li;
  }
  if (p.kind === 'system') {
    // FR-22: the page fills {deadline} in this viewer's local time.
    li.append(el('p', p.deadline ? p.text.replace('{deadline}', shortTime(p.deadline)) : p.text, 'post-text'));
    li.append(el('p', shortTime(p.createdAt), 'post-meta'));
    return li;
  }
  const meta = el('p', undefined, 'post-meta');
  meta.append(el('strong', p.teamName), document.createTextNode(` ${p.handle}, ${p.role}, ${shortTime(p.createdAt)}`));
  li.append(meta);
  if (p.kind === 'trade') {
    const trade = el('p', undefined, 'trade-line');
    trade.append(el('span', 'TRADE OFFER', 'trade-tag'), document.createTextNode(` Offering: ${p.offer}. Want: ${p.want}.`));
    li.append(trade);
  }
  if (p.text) li.append(el('p', p.text, 'post-text'));
  return li;
}

function renderQuad(posts) {
  const list = $('quad');
  list.replaceChildren(...(posts.length ? posts.map(postItem) : [el('li', 'No posts yet.', 'muted')]));
}

async function loadQuad() {
  if (signing) return;
  try {
    const data = await api('/api/commons', { silent: true });
    const json = JSON.stringify(data.posts);
    if (json === lastQuad) return;
    lastQuad = json;
    renderQuad(data.posts);
  } catch (_) {
    // the room poll reports a lost session
  }
}

$('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanners();
  try {
    await api('/api/team/chat', { body: { text: $('chat-text').value } });
  } catch (_) {
    return;
  }
  $('chat-text').value = '';
  lastJson = '';
  await load();
  $('chat').scrollTop = $('chat').scrollHeight;
});

function quadKind() {
  return document.querySelector('input[name="quad-kind"]:checked').value;
}
for (const r of document.querySelectorAll('input[name="quad-kind"]')) {
  r.addEventListener('change', () => ($('quad-trade').hidden = quadKind() !== 'trade'));
}

$('quad-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanners();
  const kind = quadKind();
  const payload = { kind, text: $('quad-text').value };
  if (kind === 'trade') {
    payload.offer = $('quad-offer').value;
    payload.want = $('quad-want').value;
  }
  try {
    await api('/api/commons', { body: payload });
  } catch (_) {
    return;
  }
  $('quad-text').value = '';
  $('quad-offer').value = '';
  $('quad-want').value = '';
  lastQuad = '';
  loadQuad();
});

// ---------- FAQ assistant (FR-25 to FR-27) ----------
// The answer and the list live outside render(), so a poll never wipes them.
let sections = null; // [{heading, body}] once loaded
let sectionsFor = null; // the hasBundle value the list was loaded for
const STOP = new Set(['what', 'when', 'where', 'which', 'does', 'have', 'with', 'this', 'that', 'from', 'your', 'there', 'about', 'will', 'should', 'the', 'and', 'for', 'are', 'can', 'how', 'who', 'our']);

function words(q) {
  return String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}

function renderSections(queryText) {
  const box = $('faq-sections');
  box.replaceChildren();
  if (!sections) return;
  const want = words(queryText);
  const shown = sections.filter((s) => !want.length || want.some((w) => (s.heading + '\n' + s.body).toLowerCase().includes(w)));
  $('faq-empty').textContent = shown.length ? '' : 'No section matches. Try other words.';
  for (const s of shown) {
    const item = el('article', undefined, 'faq-section');
    if (s.heading) item.append(el('h3', s.heading));
    item.append(el('p', s.body, 'faq-body'));
    box.append(item);
  }
}

// FR-27: load the sections for the list. With no bundle the box shows the
// server's sentence (E56) instead of a banner.
async function showList(queryText) {
  $('faq-list').hidden = false;
  if (!sections || sectionsFor !== room.hasBundle) {
    sectionsFor = room.hasBundle;
    try {
      sections = (await api('/api/team/bundle', { silent: true })).sections;
    } catch (err) {
      sections = null;
      $('faq-sections').replaceChildren();
      $('faq-empty').textContent = err.message;
      return;
    }
  }
  if (queryText !== undefined) $('faq-search').value = queryText;
  renderSections($('faq-search').value);
}

function renderFaq() {
  if (room.faqMode === 'list' || !$('faq-list').hidden) showList();
}

$('faq-search').addEventListener('input', () => renderSections($('faq-search').value));

$('faq-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = $('faq-question').value;
  const ask = $('faq-ask');
  ask.disabled = true;
  clearBanners();
  const out = $('faq-answer');
  let data;
  try {
    data = await api('/api/team/faq', { body: { question } });
  } catch (_) {
    return; // the banner shows the server's sentence
  } finally {
    ask.disabled = false;
  }
  out.replaceChildren();
  if (data.answered) {
    if (room.faqMode === 'ai') $('faq-list').hidden = true; // fallback was for one question only
    out.append(el('p', data.answer, 'faq-answer-text'), el('p', 'From the event information:', 'step-num'), el('blockquote', data.quote, 'faq-quote'));
  } else {
    out.append(el('p', data.refusal, 'notice-box')); // N02, the refusal sentence
    if (data.mode === 'list') showList(question); // FR-27: filter by the question's words
  }
});

// ---------- Sign (FR-28, FR-29, FR-38) ----------
function formValues() {
  return {
    projectName: $('sign-project').value,
    repoUrl: $('sign-repo').value.trim(),
    commitSha: $('sign-commit').value.trim(),
    description: $('sign-description').value,
    declared: $('sign-declared').checked,
  };
}

function signedPanel(sub) {
  const panel = $('sign-panel');
  panel.className = 'sign-panel sign-done';
  const link = el('a', 'Open receipt', 'action-link');
  link.href = sub.receiptUrl;
  panel.replaceChildren(
    el('p', `Signed. Receipt ${sub.shortHash}.`, 'signed-line'),
    el('p', 'Signed ' + new Date(sub.signedAt).toLocaleString(), 'signed-time'),
    link
  );
  panel.hidden = false;
  $('sign-form').hidden = true;
}

// The form lives in the static page, so typed values survive every poll
// and a failed ceremony (FR-38 failure: the form keeps the typed values).
function renderSubmit() {
  if (signing) return;
  const section = $('submit');
  if (room.state === 'SUBMITTED' && room.submission) {
    section.hidden = false;
    signedPanel(room.submission);
  } else if (room.state === 'ENROLLED' || room.state === 'REVEALED') {
    section.hidden = false;
    $('sign-panel').hidden = true;
    $('sign-form').hidden = false;
  } else {
    section.hidden = true;
  }
}

// FR-38 sign moment: the five signed values as read only text and the hash.
function lockedPanel(v, shortHash) {
  const panel = $('sign-panel');
  panel.className = 'sign-panel sign-locked';
  const facts = el('dl', undefined, 'facts');
  // Shown as the server signs them: trimmed, commit in lowercase (SDS.md 6.1).
  for (const [k, val] of [['Project name', v.projectName.trim()], ['Repo link', v.repoUrl], ['Commit SHA', v.commitSha.toLowerCase()], ['Description', v.description.trim()]]) {
    facts.append(el('dt', k), el('dd', val));
  }
  const line = el('p', undefined, 'signing-line');
  line.append(document.createTextNode('You are signing hash '), el('span', shortHash, 'big-hash'), document.createTextNode('. Tap your key.'));
  panel.replaceChildren(facts, el('p', 'We declare that this project was built during this event.', 'declare-line'), line);
  $('sign-form').hidden = true;
  panel.hidden = false;
}

function unlock() {
  signing = false;
  $('sign-panel').hidden = true;
  $('sign-form').hidden = false;
  lastJson = '';
  load();
}

// tamperDescription is only for QT_TEST.tamperSign (INV-14): the verify
// request then carries a different description than the one signed.
async function signFlow(tamperDescription) {
  if (signing || !room) return;
  clearBanners();
  const values = formValues();
  let start;
  try {
    start = await api('/api/sign/options', { body: { teamId: room.id, ...values } });
  } catch (_) {
    return; // the banner shows the server's sentence; the form is unchanged
  }
  signing = true;
  lockedPanel(values, start.shortHash);
  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON: start.options });
  } catch (err) {
    reportTapFailure(start.ceremonyId, err);
    showFail(QT_BANNER.NOT_SIGNED); // FR-11: any error on a sign tap
    unlock();
    return;
  }
  const sent = tamperDescription === undefined ? values : { ...values, description: String(tamperDescription) };
  let result;
  try {
    result = await api('/api/sign/verify', { body: { ceremonyId: start.ceremonyId, ...sent, response: assertion } });
  } catch (_) {
    unlock(); // the banner shows the server's sentence
    return;
  }
  // FR-38 receipt moment.
  signedPanel(result);
  signing = false;
  lastJson = '';
  load();
}

$('sign-form').addEventListener('submit', (e) => {
  e.preventDefault();
  signFlow();
});

// SDS.md section 10: test hook for INV-14. Harmless, because the server
// re-hashes the content and is the only authority.
window.QT_TEST = Object.freeze({ tamperSign: (newDescription) => signFlow(newDescription === undefined ? '' : newDescription) });

$('leave').addEventListener('click', async () => {
  try {
    await api('/api/team/logout', { body: {} });
  } catch (_) {
    return;
  }
  location.assign('/team');
});

load();
loadQuad();
timer = setInterval(() => {
  load();
  loadQuad();
}, 2000);
