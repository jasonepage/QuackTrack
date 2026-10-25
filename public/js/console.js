// public/js/console.js: the organizer console, T3 part: sign in, log tail,
// chain status, log download, log out. A pure view of server state: nothing
// is cached in the browser. All server text goes in with textContent.
import { startAuthentication } from '/vendor/swa/index.js';

const $ = (id) => document.getElementById(id);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function showLogin() {
  $('main').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
}

function render(data) {
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

$('login-button').addEventListener('click', async () => {
  const button = $('login-button');
  button.disabled = true;
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
    button.disabled = false;
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
