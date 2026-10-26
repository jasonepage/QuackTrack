// public/js/console.js: the organizer console. Sign in, team rows with key
// source and the Enroll ceremony (T4), prompts (T5), submission columns
// (T6), and the live view (T7): one second polling, the at a glance strip
// (FR-39), log entries as plain sentences (D16), Reset, and Load demo data.
// A pure view of server state: nothing is cached in browser storage. All
// server text goes in with textContent.
import { startAuthentication, startRegistration } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);
const TAG_RULE =
  'Attach a bright tag to this key. Write only the team name and "Return to the organizer desk" on the tag. Never write a credential ID or PIN on it.';
const APPROVE_TEXT = 'I checked this team in person and approve their own key.';
// FR-32: green when the repo owner is on the signed roster, yellow when
// not, grey for repos that are not on GitHub.
const OWNER_CHECK = {
  match: ['Owner on roster', 'chip-green'],
  nomatch: ['Owner not on roster', 'chip-yellow-text'],
  notgithub: ['Not GitHub', 'chip-grey'],
};

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

function keySourceBlock(team, d = draftFor(team), radioPrefix = 'ks-') {
  const box = el('div', undefined, 'key-source');
  box.append(el('h4', 'Key source'));

  if (team.mode === 'key') {
    const choices = el('div', undefined, 'radio-row');
    for (const [value, text] of [['pool', 'Pool key'], ["own-key", "Team's own key"]]) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = radioPrefix + team.id;
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
  // FR-41 and FR-39: black on orange, until reset.
  if (team.overrideReason) head.append(el('span', `OVERRIDE ${team.overrideReason}`, 'override-tag'));
  card.append(head);

  if (team.state === 'DRAFT') {
    const draftFacts = el('dl', undefined, 'facts');
    draftFacts.append(el('dt', 'Credential'), el('dd', 'Not enrolled'));
    card.append(draftFacts);
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
    // FR-31 submission columns and FR-32 owner check (T6). Words on every chip.
    const submitted = el('dd');
    submitted.append(
      team.submittedAt
        ? el('span', 'Submitted ' + new Date(team.submittedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'chip chip-green')
        : el('span', 'Not submitted', 'chip chip-red')
    );
    if (!team.submittedAt && team.missedDeadline) {
      submitted.replaceChildren(el('span', 'Missed deadline', 'chip chip-red'));
    }
    facts.append(el('dt', 'Submitted'), submitted);
    if (team.submittedAt) {
      facts.append(el('dt', 'Hash'), el('dd', team.shortHash, 'hash-cell'));
      facts.append(el('dt', 'Commit'), el('dd', team.commitShort, 'hash-cell'));
      const owner = el('dd');
      const [text, cls] = OWNER_CHECK[team.ownerCheck] || OWNER_CHECK.notgithub;
      owner.append(el('span', text, 'chip ' + cls));
      facts.append(el('dt', 'Repo owner'), owner);
    }
    card.append(facts);
    if (team.state === 'ENROLLED' && lastData.prompts.length) card.append(assignForm(team));
    card.append(el('h4', 'Roster', 'roster-head'), rosterList(team, true));
    // FR-23: mute or unmute this team in The Quad.
    const mute = el('div', undefined, 'team-actions');
    if (team.muted) mute.append(el('span', 'Muted in The Quad', 'chip chip-red'));
    mute.append(button(team.muted ? 'Unmute' : 'Mute in The Quad', 'link-button', () => moderate(`/api/org/teams/${encodeURIComponent(team.id)}/mute`, { muted: !team.muted })));
    card.append(mute);
    if (team.state === 'ENROLLED' || team.state === 'REVEALED') card.append(replaceKeyBlock(team));
  }
  return card;
}

// ---------- FR-41 Replace key (OVERRIDE) ----------
// Panel state lives in memory so a poll does not close it or wipe typing.
const replaceOpen = new Set();
const overrideDraft = new Map();
let overrideStep = null; // { teamId, step: 'org' | 'key' } while a tap is open

function overrideDraftFor(team) {
  if (!overrideDraft.has(team.id)) {
    overrideDraft.set(team.id, { reason: 'lost', confirm: '', keySource: team.mode === 'key' ? 'pool' : 'own-passkey', tagColor: '', tagLabel: '', ownApproved: false });
  }
  return overrideDraft.get(team.id);
}

function replaceKeyBlock(team) {
  const box = el('div', undefined, 'replace-key');
  if (overrideStep && overrideStep.teamId === team.id) {
    box.append(el('p', overrideStep.step === 'org' ? 'OVERRIDE: tap the organizer key now' : 'OVERRIDE: tap the replacement key now', 'tap-now'));
    return box;
  }
  if (!replaceOpen.has(team.id)) {
    box.append(button('Replace key', 'link-button', () => { replaceOpen.add(team.id); render(lastData); }));
    return box;
  }
  const d = overrideDraftFor(team);
  box.append(el('h4', 'OVERRIDE: replace a lost or broken key', 'override-head'));
  const reasons = el('div', undefined, 'radio-row');
  for (const r of ['lost', 'broken']) {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'or-' + team.id;
    input.value = r;
    input.checked = d.reason === r;
    input.addEventListener('change', () => (d.reason = r));
    const label = el('label');
    label.append(input, document.createTextNode(' Key ' + r));
    reasons.append(label);
  }
  box.append(reasons, keySourceBlock(team, d, 'oks-'));
  const confirm = textInput(d.confirm, 8);
  confirm.addEventListener('input', () => (d.confirm = confirm.value));
  const actions = el('div', undefined, 'team-actions');
  actions.append(
    field('Type OVERRIDE to confirm', confirm),
    button('Replace key', 'small-button override-button', () => replaceKey(team)),
    button('Close', 'link-button', () => { replaceOpen.delete(team.id); render(lastData); })
  );
  box.append(actions);
  return box;
}

async function replaceKey(team) {
  const d = overrideDraftFor(team);
  clearBanners();
  const payload = { teamId: team.id, reason: d.reason, confirm: d.confirm, keySource: d.keySource };
  if (d.keySource === 'pool') {
    payload.tagColor = d.tagColor;
    payload.tagLabel = d.tagLabel;
  } else {
    payload.ownApproved = d.ownApproved;
  }
  const show = (step) => { overrideStep = step ? { teamId: team.id, step } : null; render(lastData); };
  let start;
  try {
    start = await api('/api/org/override/options', { body: payload });
  } catch (_) {
    return;
  }
  // Tap 1: the organizer credential (SDS.md 5.6 step 2).
  show('org');
  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON: start.options });
  } catch (err) {
    show(null);
    reportTapFailure(start.ceremonyId, err);
    showFail(QT_BANNER.ORG_TAP_CANCELLED); // E16
    return;
  }
  let second;
  try {
    second = await api('/api/org/override/authorize', { body: { ceremonyId: start.ceremonyId, response: assertion } });
  } catch (_) {
    show(null);
    return;
  }
  // Tap 2: the replacement key (step 4).
  show('key');
  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: second.options });
  } catch (err) {
    show(null);
    reportTapFailure(second.ceremonyId, err);
    showFail(err && err.name === 'InvalidStateError' ? QT_BANNER.KEY_TAKEN : qtFill(QT_BANNER.OVERRIDE_CANCELLED, { team: team.name }));
    return;
  }
  try {
    await api('/api/org/override/verify', { body: { ceremonyId: second.ceremonyId, response: attestation } });
    replaceOpen.delete(team.id);
    overrideDraft.delete(team.id);
  } catch (_) {
    // the banner shows the server's sentence
  } finally {
    show(null);
  }
  load();
}

// ---------- Whole page ----------
let lastData = null;

function render(data) {
  lastData = data;
  $('login').hidden = true;
  $('main').hidden = false;
  $('logout').hidden = false;

  // FR-39: submitted count and the log badge, or the broken chain at full size.
  const glance = $('glance');
  if (data.chain.ok) {
    glance.className = 'glance-strip';
    $('glance-count').textContent = `${data.glance.submitted} of ${data.glance.teams} submitted`;
    $('chain-badge').textContent = 'Log verified';
    $('chain-badge').hidden = false;
  } else {
    glance.className = 'glance-strip glance-broken';
    $('glance-count').textContent = `Chain BROKEN at entry ${data.chain.brokenAt}.`;
    $('chain-badge').textContent = '';
    $('chain-badge').hidden = true;
  }
  const head = data.chain.head || '';
  $('chain-head-short').textContent = head ? `${head.slice(0, 4)}...${head.slice(-4)}` : 'none';
  $('chain-head').textContent = head;
  $('memory-notice').textContent = data.notice;

  renderPrompts(data);
  renderFaq(data);
  renderQuad(data);

  const teams = $('teams');
  teams.replaceChildren(...(data.teams.length ? data.teams.map(teamCard) : [el('p', 'No teams yet.', 'muted')]));

  const body = $('log-rows');
  body.replaceChildren();
  const names = teamNames(data);
  const tracks = new Map(data.prompts.map((p) => [p.id, p.track]));
  for (const entry of [...data.log].reverse()) {
    const row = document.createElement('tr');
    const details = el('details', undefined, 'log-entry');
    details.open = openEntries.has(entry.entryHash);
    details.addEventListener('toggle', () => {
      if (details.open) openEntries.add(entry.entryHash);
      else openEntries.delete(entry.entryHash);
    });
    const summary = el('summary');
    if (entry.action === 'team.override') summary.append(el('span', 'OVERRIDE', 'override-tag'), document.createTextNode(' '));
    summary.append(document.createTextNode(logSentence(entry, names, tracks)));
    details.append(summary, el('pre', JSON.stringify(entry, null, 2), 'log-data'));
    row.append(el('td', entry.seq), el('td', new Date(entry.ts).toLocaleTimeString()), el('td', undefined));
    row.lastChild.append(details);
    body.append(row);
  }
}

// ---------- The Quad moderation (FR-23) ----------
const shortTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

async function moderate(path, payload) {
  try {
    await api(path, { body: payload });
  } catch (_) {
    return;
  }
  clearBanners();
  load();
}

function renderQuad(data) {
  const list = $('quad-mod');
  list.replaceChildren();
  if (!data.commons.length) list.append(el('li', 'No posts yet.', 'muted'));
  for (const p of data.commons) {
    const li = el('li', undefined, 'quad-item' + (p.pinned ? ' pinned' : '') + (p.kind === 'system' ? ' system' : ''));
    if (p.pinned) li.append(el('span', 'Pinned', 'chip'));
    if (p.kind === 'removed') {
      li.append(el('p', p.text, 'post-text muted'));
    } else if (p.kind === 'system') {
      li.append(el('p', p.deadline ? p.text.replace('{deadline}', shortTime(p.deadline)) : p.text, 'post-text'));
    } else {
      const meta = el('p', undefined, 'post-meta');
      meta.append(el('strong', p.teamName), document.createTextNode(` ${p.handle}, ${p.role}, ${shortTime(p.createdAt)}`));
      li.append(meta);
      if (p.kind === 'trade') {
        const t = el('p', undefined, 'trade-line');
        t.append(el('span', 'TRADE OFFER', 'trade-tag'), document.createTextNode(` Offering: ${p.offer}. Want: ${p.want}.`));
        li.append(t);
      }
      if (p.text) li.append(el('p', p.text, 'post-text'));
    }
    if (p.kind !== 'removed') {
      const actions = el('div', undefined, 'team-actions');
      actions.append(
        button(p.pinned ? 'Unpin' : 'Pin', 'link-button', () => moderate(`/api/org/commons/${encodeURIComponent(p.id)}/pin`, { pinned: !p.pinned })),
        button('Delete', 'link-button', () => moderate(`/api/org/commons/${encodeURIComponent(p.id)}/delete`, {}))
      );
      li.append(actions);
    }
    list.append(li);
  }
}

// ---------- FAQ assistant (FR-24, FR-26, FR-27) ----------
const AI_NAMES = { gemini: 'Gemini', gemma: 'Gemma (Ollama)', none: 'None' };
const REASONS = {
  not_in_bundle: 'not in the event information',
  invalid_model_output: 'the model gave an unusable reply',
  quote_not_in_bundle: 'the model quote was not in the event information',
  provider_unavailable: 'no AI available',
};
let bundleShownHash; // the saved bundle the textarea was filled from

function renderFaq(data) {
  const s = data.ai;
  $('ai-status').textContent = `AI: ${AI_NAMES[s.provider]}, ${s.status || 'not used yet'}`;
  const list = $('unanswered');
  list.replaceChildren();
  if (!data.unanswered.length) list.append(el('li', 'None yet.', 'muted'));
  for (const q of data.unanswered) {
    const li = el('li');
    li.append(el('span', q.question, 'q'));
    li.append(document.createTextNode(`${q.teamName || 'A team'}, ${q.handle || 'unknown'}, ${new Date(q.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Why: ${REASONS[q.reason] || q.reason}. Provider: ${AI_NAMES[q.provider] || q.provider}.`));
    list.append(li);
  }
  // Fill the textarea from the server only when the saved text changed and
  // the organizer is not typing in it.
  const box = $('bundle-text');
  if (data.bundle.hash !== bundleShownHash && document.activeElement !== box) {
    bundleShownHash = data.bundle.hash;
    box.value = data.bundle.text || '';
  }
}

$('bundle-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/org/bundle', { body: { text: $('bundle-text').value } });
  } catch (_) {
    return;
  }
  bundleShownHash = undefined;
  clearBanners();
  load();
});

// ---------- D16: log entries as plain sentences ----------
const openEntries = new Set(); // raw entries the organizer opened, kept across polls

function teamNames(data) {
  const names = new Map(data.teams.map((t) => [t.id, t.name]));
  for (const e of data.log) if (e.data.teamId && e.data.teamName && !names.has(e.data.teamId)) names.set(e.data.teamId, e.data.teamName);
  return names;
}

function keyText(d) {
  if (d.keySource === 'pool') return `${d.tagLabel} (${d.tagColor})`;
  if (d.keySource === 'own-key') return 'its own key';
  if (d.keySource === 'own-passkey') return 'its own passkey';
  return 'a key';
}

const TAP_REASON = { wrong_credential: 'wrong key', revoked: 'replaced key', verify_failed: 'did not verify', content_changed: 'the content changed' };
const TAP_KIND = { tap: 'team', enroll: 'enroll', sign: 'sign', 'org-login': 'organizer login', 'org-setup': 'organizer setup', override: 'override', 'override-auth': 'override' };

function logSentence(entry, names, tracks) {
  const d = entry.data;
  const team = names.get(d.teamId) || d.teamName || 'A team';
  const track = tracks.get(d.promptId) || 'A prompt';
  const short = d.contentHash ? d.contentHash.slice(0, 8) : '';
  switch (entry.action) {
    case 'event.created': return 'The server started a new event.';
    case 'event.reset': return 'The organizer reset the event.';
    case 'org.enrolled': return `The organizer enrolled with an ${d.label}.`;
    case 'org.login': return 'The organizer logged in.';
    case 'team.created': return `${team} was created.`;
    case 'team.deleted': return `${team} was deleted.`;
    case 'roster.added': return `${d.handle} was added to ${team} as ${d.role}.`;
    case 'roster.removed': return `${d.handle} was removed from ${team}.`;
    case 'roster.joined': return `${d.handle} joined ${team} as ${d.role}.`;
    case 'team.enrolled': return `${team} enrolled with ${keyText(d)}.`;
    case 'team.override': return `The organizer replaced ${team}'s key (${d.reason}). New key: ${keyText(d)}.`; // shown after a black on orange OVERRIDE tag
    case 'prompt.created': return `The prompt ${track} was created.`;
    case 'prompt.assigned': return `${track} was assigned to ${team}.`;
    case 'prompt.revealed': return `${team} revealed its prompt.`;
    case 'tap.ok': return d.purpose === 'join' ? `${team} tapped its key to add a member.` : `${team} tapped in with its key.`;
    case 'tap.failed':
      return `${d.purpose === 'override' ? 'An organizer override tap' : 'A tap'} for ${team} was refused: ${TAP_REASON[d.reason] || d.reason}.`;
    case 'tap.client_failed':
      return `The browser stopped a ${TAP_KIND[d.kind] || d.kind} tap for ${d.teamId ? team : 'the organizer'} (${d.errorName}).`;
    case 'tap.counter_regression':
      return `${d.teamId ? team + "'s key" : "The organizer's key"} counter went backwards, which can mean a cloned key.`;
    case 'instructions.downloaded': return `${d.handle || 'Someone'} on ${team} downloaded the instructions.`;
    case 'bundle.updated': return 'The event information was updated.';
    case 'faq.answered': return `The FAQ assistant answered ${d.handle || 'someone'} on ${team} (${AI_NAMES[d.provider] || d.provider}).`;
    case 'faq.unanswered': return `The FAQ assistant could not answer ${d.handle || 'someone'} on ${team}: ${REASONS[d.reason] || d.reason}.`;
    case 'sign.started': return `${team} started signing hash ${short}.`;
    case 'sign.failed': return `${team}'s signing tap failed: ${TAP_REASON[d.reason] || d.reason}.`;
    case 'submission.signed': return `${team} signed its submission. Hash ${short}.`;
    case 'demo.seeded': return 'Demo data was loaded.';
    case 'chat.posted': return `${d.handle} posted in ${team}'s team chat.`;
    case 'commons.posted': return `${d.handle} on ${team} posted ${d.kind === 'trade' ? 'a trade offer' : 'a message'} in The Quad.`;
    case 'commons.pinned': return 'The organizer pinned a post in The Quad.';
    case 'commons.unpinned': return 'The organizer unpinned a post in The Quad.';
    case 'commons.deleted': return 'The organizer removed a post from The Quad.';
    case 'team.muted': return `${team} was muted in The Quad.`;
    case 'team.unmuted': return `${team} was unmuted in The Quad.`;
    case 'deadline.warning': return `30 minutes left until the ${shortTime(d.deadline)} deadline.`;
    case 'deadline.unsubmitted': return `${team} has not signed a submission. 10 minutes left.`;
    default: return entry.action;
  }
}

// ---------- Polling (FR-31: every second) ----------
let timer = null;
let lastJson = '';
let loading = false;

async function load() {
  if (loading) return;
  loading = true;
  try {
    const data = await api('/api/org/console', { silent: true });
    const json = JSON.stringify(data);
    if (json !== lastJson) {
      lastJson = json;
      render(data);
    }
    if (!timer) timer = setInterval(load, 1000);
  } catch (err) {
    lastJson = '';
    if (timer) clearInterval(timer);
    timer = null;
    showFail(err.message);
    if (err.status === 401) showLogin();
  } finally {
    loading = false;
  }
}

// ---------- FR-36 Load demo data, FR-35 Reset ----------
$('seed').addEventListener('click', async () => {
  try {
    await api('/api/org/seed', { body: {} });
  } catch (_) {
    return;
  }
  clearBanners();
  window.scrollTo(0, 0); // the demo starts from the strip and the team rows
  load();
});

$('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/org/reset', { body: { confirm: $('reset-confirm').value } });
  } catch (_) {
    return;
  }
  $('reset-confirm').value = '';
  keyDraft.clear();
  openEntries.clear();
  clearBanners();
  load();
});

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
