// public/js/team.js: pick a team, then tap its key (SRS.md FR-09). A new
// member types their own GitHub handle and the same tap adds them to the
// roster (FR-42). Team names only on this page: nothing about any prompt
// or roster is shown before a tap (L2).
import { startAuthentication } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);
let team = null;
let busy = false;

function waiting(on) {
  $('tap-now').hidden = !on;
  for (const b of document.querySelectorAll('#who button')) b.disabled = on;
}

function showPick() {
  team = null;
  $('who').hidden = true;
  $('pick').hidden = false;
  clearBanners();
}

function showWho(t) {
  team = t;
  $('who-team').textContent = t.name;
  $('join').hidden = true;
  $('who-choice').hidden = false;
  $('pick').hidden = true;
  $('who').hidden = false;
  clearBanners();
}

async function tap(join) {
  if (busy) return;
  busy = true;
  const result = await teamTap(startAuthentication, team, waiting, join);
  busy = false;
  if (result) location.assign('/room');
}

async function load() {
  let data;
  try {
    data = await api('/api/public/teams');
  } catch (_) {
    return;
  }
  const list = $('teams');
  list.replaceChildren();
  if (!data.teams.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No teams are enrolled yet.';
    list.append(p);
    return;
  }
  for (const t of data.teams) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'team-pick';
    b.textContent = t.name;
    b.addEventListener('click', () => showWho(t));
    list.append(b);
  }
}

$('existing').addEventListener('click', () => tap(null));
$('new').addEventListener('click', () => {
  $('who-choice').hidden = true;
  $('join').hidden = false;
  $('join-handle').focus();
});
$('join').addEventListener('submit', (e) => {
  e.preventDefault();
  tap({ handle: $('join-handle').value.trim(), displayName: $('join-name').value, role: $('join-role').value });
});
$('back').addEventListener('click', showPick);

load();
