// public/js/team.js: pick a team and tap its key (SRS.md FR-09).
// Shows team names only. Nothing about any prompt is on this page (L2).
import { startAuthentication } from '/vendor/swa/index.js';

const list = document.getElementById('teams');
const tapNow = document.getElementById('tap-now');
let busy = false;

function waiting(on) {
  tapNow.hidden = !on;
  for (const b of list.querySelectorAll('button')) b.disabled = on;
}

async function load() {
  let data;
  try {
    data = await api('/api/public/teams');
  } catch (_) {
    return;
  }
  list.replaceChildren();
  if (!data.teams.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No teams are enrolled yet.';
    list.append(p);
    return;
  }
  for (const team of data.teams) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'team-pick';
    b.textContent = team.name;
    b.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      const result = await teamTap(startAuthentication, team, waiting);
      busy = false;
      if (result) location.assign('/room');
    });
    list.append(b);
  }
}

load();
