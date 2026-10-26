'use strict';
// public/js/chat.js: the /chat page, team chat (SRS.md FR-16) and The Quad
// (FR-20 to FR-22), apart from the team room. The team comes from this
// browser's session only. Every server string is rendered with
// textContent, never innerHTML. Polls every 2 seconds.

(function () {
  const $ = (id) => document.getElementById(id);
  let lastChat = '';
  let lastQuad = '';
  let timer = null;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  const shortTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function showNoSession(message) {
    if (timer) clearInterval(timer);
    timer = null;
    $('chat-page').hidden = true;
    $('no-session').hidden = false;
    showFail(message);
  }

  // ---------- Who is at the keyboard, and team chat (FR-14, FR-16) ----------
  function renderChat(data) {
    $('chat-page').hidden = false;
    $('team-name').textContent = data.teamName;
    const members = $('members');
    members.replaceChildren();
    if (!data.roster.length) members.append(el('p', 'No members yet. Join on /team with the team key.', 'muted'));
    for (const m of data.roster) {
      const b = el('button', undefined, 'member-pick');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(data.member === m.handle));
      b.append(el('strong', m.handle), el('span', ` ${m.role}`));
      b.addEventListener('click', () => pickMember(m.handle));
      members.append(b);
    }
    const list = $('chat');
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    list.replaceChildren();
    if (!data.messages.length) list.append(el('li', 'No messages yet.', 'muted'));
    for (const m of data.messages) {
      const li = el('li', undefined, 'chat-item');
      const meta = el('p', undefined, 'post-meta');
      meta.append(el('strong', m.handle), document.createTextNode(` ${m.role}, ${shortTime(m.createdAt)}`));
      li.append(meta, el('p', m.text, 'post-text'));
      list.append(li);
    }
    if (atBottom) list.scrollTop = list.scrollHeight; // newest at the bottom
  }

  async function loadChat() {
    try {
      const data = await api('/api/team/chat', { silent: true });
      const json = JSON.stringify(data);
      if (json === lastChat) return;
      lastChat = json;
      renderChat(data);
    } catch (err) {
      if (err.status === 401) showNoSession(err.message);
      else showFail(err.message);
    }
  }

  async function pickMember(handle) {
    try {
      await api('/api/team/member', { body: { handle } });
    } catch (_) {
      return; // the banner shows the server's sentence
    }
    clearBanners();
    lastChat = '';
    loadChat();
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
    lastChat = '';
    await loadChat();
    $('chat').scrollTop = $('chat').scrollHeight;
  });

  // ---------- The Quad (FR-20 to FR-22) ----------
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

  async function loadQuad() {
    try {
      const data = await api('/api/commons', { silent: true });
      const json = JSON.stringify(data.posts);
      if (json === lastQuad) return;
      lastQuad = json;
      $('quad').replaceChildren(...(data.posts.length ? data.posts.map(postItem) : [el('li', 'No posts yet.', 'muted')]));
    } catch (_) {
      // loadChat reports a lost session
    }
  }

  const quadKind = () => document.querySelector('input[name="quad-kind"]:checked').value;
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

  loadChat();
  loadQuad();
  timer = setInterval(() => {
    loadChat();
    loadQuad();
  }, 2000);
})();
