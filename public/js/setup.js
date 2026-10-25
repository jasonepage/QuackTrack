// public/js/setup.js: organizer first credential enrollment (SRS.md FR-01).
// The token comes only from this page's own address. Without a valid token
// the server refuses, and the button stays off.
import { startRegistration } from '/vendor/swa/index.js';

const token = new URLSearchParams(location.search).get('token') || '';
const button = document.getElementById('enroll');
const toConsole = document.getElementById('to-console');
const FRESH_MS = 90000; // options are valid for 120 s; refresh well before that

let prepared = null; // { mode, ceremonyId, options, at }

function chosenMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

async function prepare(mode) {
  const data = await api('/api/org/setup/options', { body: { token, mode } });
  prepared = { mode, ceremonyId: data.ceremonyId, options: data.options, at: Date.now() };
}

function stopFor(err) {
  // A used or invalid link can never work again on this page.
  button.disabled = true;
  if (err && err.code === 'SETUP_USED') toConsole.hidden = false;
}

// Ask the server about this link as soon as the page opens, so a used or
// wrong link shows its sentence right away.
prepare(chosenMode()).then(
  () => { button.disabled = false; },
  (err) => stopFor(err)
);

button.addEventListener('click', async () => {
  button.disabled = true;
  clearBanners();
  const mode = chosenMode();
  if (!prepared || prepared.mode !== mode || Date.now() - prepared.at > FRESH_MS) {
    try {
      await prepare(mode);
    } catch (err) {
      if (err.code === 'SETUP_INVALID' || err.code === 'SETUP_USED') return stopFor(err);
      button.disabled = false;
      return;
    }
  }
  const p = prepared;
  prepared = null; // each set of options is used once

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: p.options });
  } catch (err) {
    reportTapFailure(p.ceremonyId, err);
    showFail(QT_BANNER.ENROLL_CANCELLED);
    button.disabled = false;
    return;
  }

  try {
    await api('/api/org/setup/verify', { body: { ceremonyId: p.ceremonyId, response: attestation } });
  } catch (err) {
    if (err.code === 'SETUP_USED') return stopFor(err);
    button.disabled = false;
    return;
  }
  location.assign('/console');
});
