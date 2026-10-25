// public/js/console.js: the organizer console. Sign in, team rows with
// roster entry, key source, and the Enroll ceremony (T4), log tail and
// chain status (T3). A pure view of server state: nothing is cached in
// browser storage. All server text goes in with textContent.
import { startAuthentication, startRegistration } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);
const ROLES = ['Captain', 'Builder', 'Designer', 'Presenter'];
const TAG_RULE =
  'Attach a bright tag to this key. Write only the team name and "Return to the organizer desk" on the tag. Never write a credential ID or PIN on it.';
const APPROVE_TEXT = 'I checked this team in person and approve their own key.';

// Key source fields typed on a draft row, kept in memory only until Enroll
// sends them, so a re-render does not wipe what the organizer typed.
const keyDraft = new Map();
let tappingTeamId = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function button(text, className, onClick) {
  const b = el('button', text, className);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function field(labelText, input) {
  const label = el('label', labelText);
  label.append(input);
  return label;
}

function textInput(value, maxLength) {
  const input = document.createElement('input');
  input.value = value || '';
  if (maxLength) input.maxLength = maxLength;
  return input;
}

function showLogin() {
  $('main').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
}

// ---------- Team rows ----------
function draftFor(team) {
  if (!keyDraft.has(team.id)) {
    keyDraft.set(team.id, {
      keySource: team.keySource || (team.mode === 'key' ? 'pool' : 'own-passkey'),
      tagColor: team.tagColor || '',
      tagLabel: team.tagLabel || '',
      ownApproved: false,
    });
  }
  return keyDraft.get(team.id);
}

function stateBadge(state) {
  return el('span', state, 'state-badge state-' + state.toLowerCase());
}

function rosterList(team, editable) {
  const list = el('ul', undefined, 'roster');
  if (!team.roster.length) list.append(el('li', 'No members yet.', 'muted'));
  for (const m of team.roster) {
    const item = el('li');
    item.append(el('strong', m.handle), document.createTextNode(` ${m.displayName}, ${m.role}`));
    if (editable) {
      item.append(
        button('Remove', 'link-button', async () => {
          try {
            await api(`/api/org/teams/${encodeURIComponent(team.id)}/roster/${encodeURIComponent(m.handle)}`, { method: 'DELETE' });
          } catch (_) {
            return;
          }
          clearBanners();
          load();
        })
      );
    }
    list.append(item);
  }
  return list;
}

function addMemberForm(team) {
  const form = el('form', undefined, 'inline-form');
  const handle = textInput('', 39);
  const display = textInput('', 40);
  const role = document.createElement('select');
  for (const r of ROLES) {
    const o = el('option', r);
    o.value = r;
    role.append(o);
  }
  const add = el('button', 'Add', 'small-button');
  add.type = 'submit';
  form.append(field('GitHub handle', handle), field('Display name', display), field('Role', role), add);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/org/teams/${encodeURIComponent(team.id)}/roster`, {
        body: { handle: handle.value.trim(), displayName: display.value, role: role.value },
      });
    } catch (_) {
      return;
    }
    clearBanners();
    load();
  });
  return form;
}

function keySourceBlock(team) {
  const d = draftFor(team);
  const box = el('div', undefined, 'key-source');
  box.append(el('h4', 'Key source'));

  if (team.mode === 'key') {
    const choices = el('div', undefined, 'radio-row');
    for (const [value, text] of [['pool', 'Pool key'], ["own-key", "Team's own key"]]) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'ks-' + team.id;
      input.value = value;
      input.checked = d.keySource === value;
      input.addEventListener('change', () => {
        d.keySource = value;
        render(lastData);
      });
      const label = el('label');
      label.append(input, document.createTextNode(' ' + text));
      choices.append(label);
    }
    box.append(choices);
  } else {
    d.keySource = 'own-passkey';
    box.append(el('p', 'Own passkey'));
  }

  if (d.keySource === 'pool') {
    box.append(el('p', TAG_RULE, 'tag-rule'));
    const color = textInput(d.tagColor, 20);
    color.addEventListener('input', () => (d.tagColor = color.value));
    const label = textInput(d.tagLabel, 20);
    label.addEventListener('input', () => (d.tagLabel = label.value));
    const row = el('div', undefined, 'inline-form');
    row.append(field('Tag color', color), field('Pool label', label));
    box.append(row);
  } else {
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = d.ownApproved;
    check.addEventListener('change', () => (d.ownApproved = check.checked));
    const label = el('label', undefined, 'check-row');
    label.append(check, document.createTextNode(' ' + APPROVE_TEXT));
    box.append(label);
  }
  return box;
}

async function enroll(team) {
  const d = draftFor(team);
  clearBanners();
  const payload = { teamId: team.id, keySource: d.keySource };
  if (d.keySource === 'pool') {
    payload.tagColor = d.tagColor;
    payload.tagLabel = d.tagLabel;
  } else {
    payload.ownApproved = d.ownApproved;
  }
  let start;
  try {
    start = await api('/api/org/enroll/options', { body: payload });
  } catch (_) {
    return;
  }
  tappingTeamId = team.id;
  render(lastData);
  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: start.options });
  } catch (err) {
    tappingTeamId = null;
    render(lastData);
    // SRS.md FR-05 and FR-11: an already enrolled key, or a cancel.
    showFail(err && err.name === 'InvalidStateError' ? QT_BANNER.KEY_TAKEN : QT_BANNER.ENROLL_CANCELLED);
    return;
  }
  try {
    await api('/api/org/enroll/verify', { body: { ceremonyId: start.ceremonyId, response: attestation } });
    keyDraft.delete(team.id);
  } catch (_) {
    // the banner already shows the server's sentence
  } finally {
    tappingTeamId = null;
  }
  load();
}

function teamCard(team) {
  const card = el('article', undefined, 'team-card');
  const head = el('div', undefined, 'team-head');
  head.append(stateBadge(team.state), el('h3', team.name));
  head.append(el('span', team.mode === 'key' ? 'Security key mode' : 'Solo passkey mode', 'muted'));
  card.append(head);

  if (team.state === 'DRAFT') {
    card.append(rosterList(team, true), addMemberForm(team), keySourceBlock(team));
    const actions = el('div', undefined, 'team-actions');
    if (tappingTeamId === team.id) {
      actions.append(el('p', 'Tap the key now', 'tap-now'));
    } else {
      actions.append(
        button('Enroll with key', 'small-button primary', () => enroll(team)),
        button('Delete team', 'link-button', async () => {
          try {
            await api(`/api/org/teams/${encodeURIComponent(team.id)}`, { method: 'DELETE' });
          } catch (_) {
            return;
          }
          keyDraft.delete(team.id);
          clearBanners();
          load();
        })
      );
    }
    card.append(actions);
  } else {
    const facts = el('dl', undefined, 'facts');
    for (const [k, v] of [['Credential', team.label], ['Key', team.keySourceText], ['Fingerprint', team.fingerprint]]) {
      facts.append(el('dt', k), el('dd', v || ''));
    }
    card.append(facts, rosterList(team, false), el('p', 'Roster locked', 'locked'));
  }
  return card;
}

// ---------- Whole page ----------
let lastData = null;

function render(data) {
  lastData = data;
  $('login').hidden = true;
  $('main').hidden = false;
  $('logout').hidden = false;

  const chain = $('chain');
  if (data.chain.ok) {
    chain.textContent = 'Chain OK';
    chain.className = 'chain-strip chain-ok';
  } else {
    chain.textContent = `Chain BROKEN at entry ${data.chain.brokenAt}.`;
    chain.className = 'chain-strip chain-broken';
  }
  $('chain-head').textContent = data.chain.head || 'none';

  const teams = $('teams');
  teams.replaceChildren(...(data.teams.length ? data.teams.map(teamCard) : [el('p', 'No teams yet.', 'muted')]));

  const body = $('log-rows');
  body.replaceChildren();
  for (const entry of [...data.log].reverse()) {
    const row = document.createElement('tr');
    row.append(
      el('td', entry.seq),
      el('td', new Date(entry.ts).toLocaleTimeString()),
      el('td', entry.actor.kind),
      el('td', entry.action, 'log-action'),
      el('td', Object.keys(entry.data).length ? JSON.stringify(entry.data) : '', 'log-data')
    );
    body.append(row);
  }
}

async function load() {
  try {
    render(await api('/api/org/console', { silent: true }));
  } catch (err) {
    showFail(err.message);
    if (err.status === 401) showLogin();
  }
}

$('new-team').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/org/teams', { body: { name: $('new-team-name').value, mode: $('new-team-mode').value } });
  } catch (_) {
    return;
  }
  $('new-team-name').value = '';
  clearBanners();
  load();
});

$('login-button').addEventListener('click', async () => {
  const loginButton = $('login-button');
  loginButton.disabled = true;
  clearBanners();
  try {
    let start;
    try {
      start = await api('/api/org/login/options', { body: {} });
    } catch (_) {
      return;
    }
    let assertion;
    try {
      assertion = await startAuthentication({ optionsJSON: start.options });
    } catch (_) {
      // SRS.md FR-02 and FR-11: any browser side failure on an organizer tap.
      showFail(QT_BANNER.ORG_TAP_CANCELLED);
      return;
    }
    try {
      await api('/api/org/login/verify', { body: { ceremonyId: start.ceremonyId, response: assertion } });
    } catch (_) {
      return;
    }
    await load();
  } finally {
    loginButton.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  try {
    await api('/api/org/logout', { body: {} });
  } catch (_) {
    return;
  }
  clearBanners();
  showLogin();
});

load();
