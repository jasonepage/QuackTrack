'use strict';
// public/js/receipt.js: the public receipt (SRS.md FR-30, FR-38). The
// receipt ID comes from this page's own address. Every server string is
// rendered with textContent, never innerHTML. A receipt never shows the
// prompt: the endpoint does not return one.

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function addFact(list, label, value) {
    const dd = el('dd');
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value === null || value === undefined ? '' : String(value);
    list.append(el('dt', label), dd);
  }

  function isGitHub(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'github.com' || host === 'www.github.com';
    } catch (_) {
      return false;
    }
  }

  function link(text, href) {
    const a = el('a', text, 'text-link');
    a.href = href;
    a.rel = 'noopener noreferrer';
    return a;
  }

  // FR-38: each check is a row with PASS or FAIL in at least 32px.
  function checkRow(label, ok) {
    const row = el('div', undefined, 'check-item ' + (ok ? 'check-pass' : 'check-fail'));
    row.append(el('span', ok ? 'PASS' : 'FAIL', 'check-word'), el('span', label, 'check-label'));
    if (!ok) row.append(el('p', QT_BANNER.CHECK_FAILED, 'check-why')); // E69
    return row;
  }

  function render() {
    const r = data.receipt;
    document.title = `Receipt ${r.shortHash}: QuackTrack`;
    $('r-team').textContent = r.teamName;
    $('r-hash').textContent = `Receipt ${r.shortHash}`;

    $('checks').replaceChildren(
      checkRow('Content hash matches', data.checks.contentHash),
      checkRow('Challenge matches', data.checks.challenge),
      checkRow('Signature valid', data.checks.signature)
    );

    const facts = $('r-facts');
    facts.replaceChildren();
    addFact(facts, 'Roster signed', r.roster.length ? r.roster.join(', ') : 'No members');
    addFact(facts, 'Credential', r.label);
    addFact(facts, 'Project', r.projectName);
    addFact(facts, 'Repo', link(r.repoUrl, r.repoUrl));
    const commit = el('span');
    commit.append(el('code', r.commitSha));
    if (isGitHub(r.repoUrl)) {
      commit.append(document.createTextNode(' '), link('View commit', `${r.repoUrl.replace(/\/+$/, '')}/commit/${r.commitSha}`));
    }
    addFact(facts, 'Commit', commit);
    addFact(facts, 'Description', r.description);
    addFact(facts, 'Declaration', r.declaration);
    addFact(facts, 'Signed', new Date(r.signedAt).toLocaleString());

    const raw = $('r-raw');
    raw.replaceChildren();
    for (const [label, value] of [
      ['Canonical string', r.canonical],
      ['Content hash', r.contentHash],
      ['Roster hash', r.rosterHash],
      ['Nonce', r.nonce],
      ['Challenge', r.challenge],
      ['Credential ID', r.credentialId],
      ['Public key', r.publicKey],
      ['Authenticator data', r.authenticatorData],
      ['Client data JSON', r.clientDataJSON],
      ['Signature', r.signature],
      ['Counter', r.counter],
      ['Log entry', r.logSeq],
      ['Entry hash', r.logEntryHash],
    ]) {
      addFact(raw, label, value);
    }
    $('receipt').hidden = false;
  }

  $('download').addEventListener('click', () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ receipt: data.receipt, checks: data.checks }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quacktrack-receipt-${data.receipt.shortHash}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  async function load() {
    const id = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
    try {
      data = await api('/api/public/receipt/' + encodeURIComponent(id || 'none'));
    } catch (_) {
      return; // the banner shows the server's sentence (E68)
    }
    render();
  }

  load();
})();
