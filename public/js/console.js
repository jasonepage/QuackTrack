// public/js/console.js: the organizer console. Sign in, team rows with
// roster entry, key source, and the Enroll ceremony (T4), log tail and
// chain status (T3). A pure view of server state: nothing is cached in
// browser storage. All server text goes in with textContent.
import { startAuthentication, startRegistration } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);
const TAG_RULE =
  'Attach a bright tag to this key. Write only the team name and "Return to the organizer desk" on the tag. Never write a credential ID or PIN on it.';
const APPROVE_TEXT = 'I checked this team in person and approve their own key.';

// One click presets for the pool key fields. Both fields stay free text
// (FR-40: 1 to 20 characters). Red and green are left out on purpose:
// on the console they mean Not submitted and Submitted.
const TAG_COLORS = [
  { name: 'yellow', swatch: '#ffd23f' },
  { name: 'blue', swatch: '#1f5fd6' },
  { name: 'orange', swatch: '#ff8c1a' },
  { name: 'purple', swatch: '#7a3fc2' },
  { name: 'pink', swatch: '#ff6fae' },
  { name: 'white', swatch: '#ffffff' },
];

// The next free pool labels (Pool 01, Pool 02, ...), skipping labels an
// enrolled team already holds this event.
function freePoolLabels(count) {
  const used = new Set(
    (lastData ? lastData.teams : [])
      .filter((t) => t.state !== 'DRAFT' && t.keySource === 'pool' && t.tagLabel)
      .map((t) => t.tagLabel.toLowerCase())
  );
  const out = [];
  for (let n = 1; n <= 40 && out.length < count; n++) {
    const name = 'Pool ' + String(n).padStart(2, '0');
    if (!used.has(name.toLowerCase())) out.push(name);
  }
  return out;
}

function markPressed(row, value) {
  for (const b of row.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.value.toLowerCase() === String(value).trim().toLowerCase()));
  }
}

function presetRow(values, current, onPick, swatchFor) {
  const row = el('div', undefined, 'preset-row');
  for (const v of values) {
    const b = el('button', undefined, 'preset');
    b.type = 'button';
    b.dataset.value = v;
    if (swatchFor) {
      const dot = el('span', undefined, 'swatch');
      dot.style.background = swatchFor(v);
      b.append(dot);
    }
    b.append(document.createTextNode(v));
    b.addEventListener('click', () => {
      onPick(v);
      markPressed(row, v);
    });
    row.append(b);
  }
  markPressed(row, current || '');
  return row;
}

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
  if (!team.roster.length) list.append(el('li', team.state === 'DRAFT' ? 'No members yet. After enrolling, members join on /team with the team\'s key.' : 'No members yet. Members join on /team with the team\'s key.', 'muted'));
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
    const label = textInput(d.tagLabel, 20);
    const colorPresets = presetRow(TAG_COLORS.map((c) => c.name), d.tagColor, (v) => {
      d.tagColor = color.value = v;
    }, (v) => TAG_COLORS.find((c) => c.name === v).swatch);
    const labelPresets = presetRow(freePoolLabels(6), d.tagLabel, (v) => {
      d.tagLabel = label.value = v;
    });
    color.addEventListener('input', () => {
      d.tagColor = color.value;
      markPressed(colorPresets, color.value);
    });
    label.addEventListener('input', () => {
      d.tagLabel = label.value;
      markPressed(labelPresets, label.value);
    });
    const row = el('div', undefined, 'preset-fields');
    const colorCol = el('div');
    colorCol.append(field('Tag color', color), colorPresets);
    const labelCol = el('div');
    labelCol.append(field('Pool label', label), labelPresets);
    row.append(colorCol, labelCol);
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
    reportTapFailure(start.ceremonyId, err);
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

// FR-08: assign or reassign a prompt until the team reveals it.
function assignForm(team) {
  const form = el('form', undefined, 'inline-form');
  const select = document.createElement('select');
  for (const p of lastData.prompts) {
    const o = el('option', p.track);
    o.value = p.id;
    o.selected = p.id === team.assignedPromptId;
    select.append(o);
  }
  const go = el('button', team.assignedPromptId ? 'Reassign' : 'Assign', 'small-button');
  go.type = 'submit';
  form.append(field('Prompt', select), go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/org/assign', { body: { teamId: team.id, promptId: select.value } });
    } catch (_) {
      return;
    }
    clearBanners();
    load();
  });
  return form;
}

function renderPrompts(data) {
  const list = $('prompts');
  list.replaceChildren();
  if (!data.prompts.length) list.append(el('li', 'No prompts yet.', 'muted'));
  for (const p of data.prompts) {
    const li = el('li');
    li.append(el('strong', p.track), document.createTextNode(' due ' + new Date(p.deadline).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })));
    list.append(li);
  }
}

function teamCard(team) {
  const card = el('article', undefined, 'team-card');
  const head = el('div', undefined, 'team-head');
  head.append(stateBadge(team.state), el('h3', team.name));
  head.append(el('span', team.mode === 'key' ? 'Security key mode' : 'Solo passkey mode', 'muted'));
  card.append(head);

  if (team.state === 'DRAFT') {
    if (team.roster.length) card.append(el('h4', 'Roster', 'roster-head'), rosterList(team, true));
    card.append(keySourceBlock(team));
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
    facts.append(el('dt', 'Prompt'), el('dd', team.assignedTrack || 'None assigned'));
    if (team.assignedTrack) {
      const status = el('dd');
      status.append(
        team.revealedAt
          ? el('span', 'Revealed ' + new Date(team.revealedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'chip chip-green')
          : el('span', 'Not revealed', 'chip chip-red')
      );
      facts.append(el('dt', 'Revealed'), status);
    }
    card.append(facts);
    if (team.state === 'ENROLLED' && lastData.prompts.length) card.append(assignForm(team));
    card.append(el('h4', 'Roster', 'roster-head'), rosterList(team, true));
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

  renderPrompts(data);

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

// Default deadline: two hours from now, in this browser's local time.
function defaultDeadline() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
$('prompt-deadline').value = defaultDeadline();

$('new-prompt').addEventListener('submit', async (e) => {
  e.preventDefault();
  const local = $('prompt-deadline').value;
  const deadline = local ? new Date(local).toISOString() : '';
  try {
    await api('/api/org/prompts', { body: { track: $('prompt-track').value, instructions: $('prompt-instructions').value, deadline } });
  } catch (_) {
    return;
  }
  $('prompt-track').value = '';
  $('prompt-instructions').value = '';
  $('prompt-deadline').value = defaultDeadline();
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
    } catch (err) {
      reportTapFailure(start.ceremonyId, err);
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
