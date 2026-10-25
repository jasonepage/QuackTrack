// public/js/room.js: the team room (SRS.md FR-13, FR-14, FR-15, FR-38).
// The team comes from this browser's session only. Every server string is
// rendered with textContent, never innerHTML. Polls every 2 seconds.
import { startAuthentication } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);
let room = null;
let lastJson = '';
let timer = null;
let tapping = false;

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

$('leave').addEventListener('click', async () => {
  try {
    await api('/api/team/logout', { body: {} });
  } catch (_) {
    return;
  }
  location.assign('/team');
});

load();
timer = setInterval(load, 2000);
