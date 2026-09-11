/* ══════════════════════════════════════════════════════════════════════════
   📱 THE HANDSET — the player's phone, in the main game.
   Registers window.MythicHandset. Classic script, no imports.

   Asked for: "Change this button (the 🔔 bell) to Phone and the modal to the
   phone modal from the city builder; add the chat button and chat in the
   phone; turn the tabs into apps and make the phone look and act like a real
   cell phone."

   WHAT IT IS. One device — the same titanium 19.5:9 handset the city's
   Emergency Broadcast phone draws — with a HOME SCREEN of apps instead of a
   row of tabs. Tap an app, it opens full-screen with its own top bar and a
   back arrow; the home bar at the bottom returns to the grid; the status bar
   keeps a real clock and a real battery reading. Every app is something the
   game already had, re-homed:
     🔔 Notifications — the bell's list (window.MythicNotify).
     💬 Chat          — the world / trades / friends chat. The existing chat
                        overlay is REPARENTED into the phone screen and given
                        the screen's geometry, so every handler, poll and
                        input it already has keeps working untouched.
     📣 Broadcast     — the city's Emergency Broadcast feed, read from the
                        city's save (the feed rides the save shelf under
                        ext.broadcast), newest first. Read-only here; liking
                        and hiring live in the city, and the app says so.

   🔴 THE GLOBALS TRAP (CLAUDE.md). index.html's `Chat`, `_notif` and `App`
      are top-level consts and invisible here. Everything this file needs
      comes through three window seams: MythicNotify (list / clear), the
      chat function declarations (chatOpen / chatClose are functions, hence
      globals) plus MythicChatSeam (unread / open), and localStorage for the
      city save. A missing seam degrades that one app to a message, never a
      throw.
   ⚠ NOTHING HERE IS GAME STATE. The phone is a view. Closing it closes the
     chat (chatClose) so the poll stops, and nothing else.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  const APPS = [
    { id: 'notif', name: 'Notifications', ico: '🔔', hue: '#c9a227', sub: 'What your camp and holdings need' },
    { id: 'chat',  name: 'Chat',          ico: '💬', hue: '#8a5cff', sub: 'World · Trades · Friends' },
    { id: 'bcast', name: 'Broadcast',     ico: '📣', hue: '#ff7a2f', sub: 'Your city, in its own words' },
    /* 📒 the wallet's receipt roll and 🏦 the bank, both through window.MythicBank
       (index.html): the same deposit / withdraw / vault functions the Bank of
       Ethos page calls, so the phone can never move money a different way. */
    { id: 'ledger', name: 'Ledger',        ico: '📒', hue: '#3fa46b', sub: 'Every Cinder in and out of your wallet' },
    { id: 'bank',   name: 'Bank of Ethos', ico: '🏦', hue: '#4aa3ff', sub: 'Balance · Cinder · Aza · Vault' },
    /* 📈 asked for: "make a Crash Exchange app for the phone" — live prices,
       a tap-to-trade ticket and the portfolio, through window.MythicExchange. */
    { id: 'cx',     name: 'Crash Exchange', ico: '📈', hue: '#2fb8a6', sub: 'Live prices · Buy · Sell · Portfolio' },
    /* 🛒 asked for: "a Luni app for the phone where players can list resources
       and items and buy stuff from the player market" — through
       window.MythicLuni, which routes to the market screen's own functions. */
    { id: 'luni',   name: 'Luni',          ico: '🛒', hue: '#d4af37', sub: 'The player market — browse, buy, list' },
    /* ⚔ asked for: "setup this system and add it as an app on the phone" —
       the escrow job board, through window.MythicMercenaries (an ES module
       that already publishes itself, so there is no index.html seam here). */
    { id: 'merc',   name: 'Mercenaries',   ico: '⚔', hue: '#ff8a4b', sub: 'Contracts · escrow · collect what you earned' },
    /* 🏛 asked for: "a mayor dashboard … all of the cities that they are mayors
       for, their clients gamer names and … how much they are making from each
       city. Give each city a profile." Through window.MythicMayorDash. */
    { id: 'mayor',  name: 'Mayor',         ico: '🏛', hue: '#c9a227', sub: 'Your client cities · terms · what each one pays' },
    /* 🏆 asked for: a leaderboard for the cities making the most cinder, the
       most of each resource and the most population, plus a battle board for
       wins, ranked PvP wins and the unit with the most kills. Every figure is
       derived server-side (sql/124) — there is no score to submit. */
    { id: 'board',  name: 'Leaderboards',  ico: '🏆', hue: '#6cc4ff', sub: 'Top cities and top fighters' },
    /* 🖼 asked for: "players can change their phone's wallpaper by uploading a
       photo to the phone." Kept on this device per account (a JPEG resized to
       the screen, ~150 KB), painted behind the home screen. */
    { id: 'wall',   name: 'Wallpaper',     ico: '🖼', hue: '#e0567a', sub: 'Your photo behind the home screen' },
  ];
  let open = false, app = null, clockT = null, battery = null, obs = null;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── the seams ── */
  const notify = () => { try { return window.MythicNotify || null; } catch (e) { return null; } };
  const chatSeam = () => { try { return window.MythicChatSeam || null; } catch (e) { return null; } };
  const bank = () => { try { return window.MythicBank || null; } catch (e) { return null; } };
  /* ── 🖼 wallpaper ── */
  const wallKey = () => { let u = 'guest'; try { const b = window.MythicBridge; u = (b && b.userId && b.userId()) || 'guest'; } catch (e) {} return 'mythic_phone_wall:' + u; };
  const wallGet = () => { try { return localStorage.getItem(wallKey()) || ''; } catch (e) { return ''; } };
  const wallSet = (v) => { try { if (v) localStorage.setItem(wallKey(), v); else localStorage.removeItem(wallKey()); return true; } catch (e) { return false; } };
  function paintWall() {
    const home = $('mgp-home'); if (!home) return;
    const w = wallGet();
    home.style.backgroundImage = w ? 'linear-gradient(180deg,rgba(8,7,6,.35),rgba(8,7,6,.15) 30%,rgba(8,7,6,.55) 100%),url(' + w + ')' : '';
    home.style.backgroundSize = 'cover'; home.style.backgroundPosition = 'center';
    home.classList.toggle('has-wall', !!w);
  }
  /* the photo is shrunk to the screen (540×1170 max) and re-encoded as JPEG so
     it fits the device's storage and paints instantly */
  function wallFromFile(file) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) { rej(new Error('Pick a photo (PNG, JPG, WebP or GIF).')); return; }
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const MW = 540, MH = 1170; const k = Math.min(1, MW / img.width, MH / img.height);
          const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let q = 0.86, out = c.toDataURL('image/jpeg', q);
          while (out.length > 380000 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
          URL.revokeObjectURL(url); res(out);
        } catch (e) { URL.revokeObjectURL(url); rej(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file could not be read as a photo.')); };
      img.src = url;
    });
  }
  const fmt = (n) => (n | 0).toLocaleString();
  const signed = (n) => (n > 0 ? '+' : '') + fmt(n);
  const when = (t) => { try { const d = new Date(+t || 0); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  function badgeOf(id) {
    try {
      if (id === 'notif') { const n = notify(); return n ? (n.state().unread | 0) : 0; }
      if (id === 'chat') { const c = chatSeam(); return c ? (c.unread() | 0) : 0; }
      if (id === 'bcast') { const f = readFeed(); return f ? f.unread : 0; }
    } catch (e) {}
    return 0;
  }

  /* ── the city feed, off the save ──
     The city keeps its save in localStorage under mythic_node_city_v2[:owner]
     and the broadcast module registers its blob on the save shelf, which
     serialises under `ext`. Newest save wins when a browser holds several. */
  function readFeed() {
    try {
      let best = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('mythic_node_city_v2') !== 0) continue;
        let s = null; try { s = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { s = null; }
        if (!s || typeof s !== 'object') continue;
        const blob = (s.ext && s.ext.broadcast) || s.broadcast || null;
        if (!blob || !Array.isArray(blob.p)) continue;
        const at = +s.savedAt || 0;
        if (!best || at > best.at) best = { at, blob };
      }
      if (!best) return null;
      const rows = best.blob.p.filter((r) => r && typeof r.b === 'string' && typeof r.n === 'string').slice().reverse();
      const read = +best.blob.r || 0;
      const unread = rows.filter((r) => (+r.q || 0) > read).length;
      return { rows, unread, follow: Array.isArray(best.blob.fw) ? best.blob.fw : [] };
    } catch (e) { return null; }
  }
  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - (+t || 0)) / 1000));
    if (!t) return '';
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  };
  const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();

  /* ── the device ── */
  function ensureDom() {
    if ($('mgphone')) return;
    const st = document.createElement('style'); st.id = 'mgphone-css'; st.textContent = CSS; document.head.appendChild(st);
    const w = document.createElement('div'); w.id = 'mgphone'; w.setAttribute('aria-hidden', 'true');
    w.innerHTML =
      '<div id="mgp-shell" role="dialog" aria-label="Phone">' +
        '<i class="mgp-vol up" aria-hidden="true"></i><i class="mgp-vol dn" aria-hidden="true"></i><i class="mgp-pwr" aria-hidden="true"></i>' +
        '<div id="mgp-screen">' +
          '<div class="mgp-notch" aria-hidden="true"><i class="spk"></i><i class="cam"></i></div>' +
          '<div id="mgp-status"><span class="mgp-clk" id="mgp-clk">--:--</span><span class="mgp-sysr"><span id="mgp-sig">▂▄▆</span><span class="mgp-batt" id="mgp-batt"><i style="width:100%"></i></span><span class="mgp-bp" id="mgp-bp">100%</span></span></div>' +
          '<div id="mgp-home"><div class="mgp-date" id="mgp-date"></div><div class="mgp-grid" id="mgp-grid"></div><div class="mgp-hint">Tap an app · swipe the bar to go home</div></div>' +
          '<div id="mgp-app" hidden><div class="mgp-bar"><button type="button" id="mgp-back" aria-label="Back">‹</button><div class="mgp-ttl"><b id="mgp-app-name"></b><small id="mgp-app-sub"></small></div><button type="button" id="mgp-x" aria-label="Close phone">✕</button></div><div id="mgp-pane"></div></div>' +
          '<button type="button" id="mgp-homebar" aria-label="Home"><i></i></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(w);
    w.addEventListener('click', (e) => { if (e.target === w) close(); });
    $('mgp-x').onclick = close;
    $('mgp-back').onclick = home;
    $('mgp-homebar').onclick = () => { if (app) home(); else close(); };
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { if (app) home(); else close(); } }, true);
    try {
      if (navigator.getBattery) navigator.getBattery().then((b) => { battery = b; paintStatus(); b.addEventListener('levelchange', paintStatus); b.addEventListener('chargingchange', paintStatus); });
    } catch (e) {}
  }
  function paintStatus() {
    const d = new Date();
    const clk = $('mgp-clk'); if (clk) clk.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dt = $('mgp-date'); if (dt) dt.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const lvl = battery ? Math.round(battery.level * 100) : 100;
    const bp = $('mgp-bp'); if (bp) bp.textContent = (battery && battery.charging ? '⚡' : '') + lvl + '%';
    const bt = $('mgp-batt'); if (bt) { bt.firstChild.style.width = lvl + '%'; bt.classList.toggle('low', lvl <= 20 && !(battery && battery.charging)); }
    const sig = $('mgp-sig'); if (sig) sig.textContent = navigator.onLine === false ? '✕' : '▂▄▆';
  }
  function paintHome() {
    const g = $('mgp-grid'); if (!g) return;
    g.innerHTML = APPS.map((a) => {
      const n = badgeOf(a.id);
      return '<button type="button" class="mgp-appbtn" data-app="' + a.id + '" data-tip="' + esc(a.name + ' — ' + a.sub) + '" style="--hue:' + a.hue + '">' +
        '<span class="mgp-ico">' + a.ico + (n ? '<i class="mgp-badge">' + (n > 99 ? '99+' : n) + '</i>' : '') + '</span>' +
        '<span class="mgp-lbl">' + esc(a.name) + '</span></button>';
    }).join('');
    g.querySelectorAll('[data-app]').forEach((b) => { b.onclick = () => openApp(b.dataset.app); });
  }

  /* ── apps ── */
  function openApp(id) {
    const a = APPS.find((x) => x.id === id); if (!a) return;
    if (app === 'chat' && id !== 'chat') leaveChat();
    app = id;
    $('mgp-home').hidden = true;
    const box = $('mgp-app'); box.hidden = false;
    box.className = 'is-' + id;
    $('mgp-app-name').textContent = a.name;
    $('mgp-app-sub').textContent = a.sub;
    const pane = $('mgp-pane'); pane.innerHTML = '';
    if (id === 'notif') renderNotif(pane);
    else if (id === 'chat') renderChat(pane);
    else if (id === 'ledger') renderLedger(pane);
    else if (id === 'bank') renderBank(pane);
    else if (id === 'wall') renderWall(pane);
    else if (id === 'cx') renderCx(pane);
    else if (id === 'luni') { luniLoaded = false; renderLuni(pane); }
    else if (id === 'merc') { mercLoaded = false; mercTab = 'board'; mercPick = null; mercMsg = ''; renderMerc(pane); }
    else if (id === 'mayor') { mdLoaded = false; mdPick = null; mdPayouts = null; renderMayor(pane); }
    else if (id === 'board') { lbLoaded = false; lbRows = null; lbState = ''; renderBoard(pane); }
    else renderBcast(pane);
    try { box.animate([{ transform: 'scale(.94)', opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: 'ease-out' }); } catch (e) {}
  }
  function home() {
    if (app === 'chat') leaveChat();
    app = null;
    $('mgp-app').hidden = true;
    $('mgp-home').hidden = false;
    paintHome();
  }

  function renderNotif(pane) {
    const n = notify();
    pane.innerHTML = '<div id="notif-list" class="notif-body mgp-notif"></div>' +
      '<div class="mgp-foot"><button type="button" id="mgp-notif-clear" class="mgp-btn">Clear all</button></div>';
    if (n && typeof n.render === 'function') n.render(); else pane.firstChild.innerHTML = '<div class="notif-empty">Notifications are not available on this build.</div>';
    try { if (n && n.markRead) n.markRead(); } catch (e) {}
    const c = $('mgp-notif-clear'); if (c) c.onclick = () => { try { n && n.clear && n.clear(); } catch (e) {} };
  }

  /* The chat overlay is the game's own; it is moved into the pane and told to
     fill it. chatClose() removes it, so leaving the app is one call. */
  function renderChat(pane) {
    pane.innerHTML = '<div class="mgp-chat-host" id="mgp-chat-host"></div>';
    if (typeof window.chatOpen !== 'function') { pane.innerHTML = '<div class="mgp-empty">Chat is not available on this build.</div>'; return; }
    try { window.chatOpen(); } catch (e) {}
    adoptChat();
    if (obs) { try { obs.disconnect(); } catch (e) {} }
    obs = new MutationObserver(() => adoptChat());
    obs.observe(document.body, { childList: true });
  }
  function adoptChat() {
    const ov = $('chat-overlay'), host = $('mgp-chat-host');
    if (!ov || !host || app !== 'chat') return;
    if (ov.parentElement !== host) host.appendChild(ov);
    ov.style.cssText = 'position:absolute;inset:0;width:auto;height:auto;max-width:none;max-height:none;display:flex;flex-direction:column;background:#0e0b16;border:0;border-radius:0;box-shadow:none;z-index:1;';
    /* The chat's own ✕ closed the overlay out from under the app; the phone's
       back arrow and home bar are the way out now. */
    try { ov.querySelectorAll('#chat-close').forEach((b) => { b.style.display = 'none'; }); } catch (e) {}
  }
  function leaveChat() {
    if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; }
    try { if (typeof window.chatClose === 'function') window.chatClose(); } catch (e) {}
  }

  function renderBcast(pane) {
    const f = readFeed();
    if (!f || !f.rows.length) {
      pane.innerHTML = '<div class="mgp-empty">📣<br>No broadcast yet.<br><small>Open your city and the Emergency Broadcast fills as the city lives.</small></div>';
      return;
    }
    pane.innerHTML = '<div class="mgp-feed">' + f.rows.slice(0, 80).map((r) => {
      const dept = r.k === 'dept', co = r.k === 'company';
      const hue = Number.isFinite(+r.h) ? +r.h : 210;
      const av = r.g ? '<span class="mgp-av ico">' + esc(r.g) + '</span>' : '<span class="mgp-av" style="--h:' + hue + '">' + esc(initials(r.n)) + '</span>';
      const body = esc(r.b).replace(/#([a-z0-9_]+)/gi, '<span class="mgp-tag">#$1</span>');
      return '<div class="mgp-post' + (r.o === 'good' ? ' good' : '') + '">' + av +
        '<div class="mgp-pb"><div class="mgp-ph"><b>' + esc(r.n) + '</b>' + (r.s ? '<small>' + esc(r.s) + '</small>' : '') + '<span class="mgp-when">' + esc(ago(r.t)) + '</span></div>' +
        '<div class="mgp-body">' + body + '</div>' +
        '<div class="mgp-pf">' + (dept ? '<span class="mgp-kind">Department</span>' : co ? '<span class="mgp-kind">Business</span>' : '<span class="mgp-kind">Resident</span>') +
        '<span class="mgp-likes">' + ((+r.l || 0) + (r.m ? 1 : 0)) + ' ♡</span></div></div></div>';
    }).join('') + '</div>' +
      '<div class="mgp-foot"><span class="mgp-note">' + f.rows.length + ' posts · ♡ = citizens it is true for · like and hire from inside the city</span></div>';
  }

  /* ── 📒 Ledger ── every Cinder in and out of the wallet, newest first.
     The device diary is instant; "Server audit" swaps in the tamper-proof
     wallet_ledger rows for the signed-in account. */
  /* 🌐 The account's own record first — this is an online game. The device
     diary stays one tap away and is the fallback when the audit RPC is absent. */
  let ledgerMode = 'server';
  function renderLedger(pane) {
    const B = bank();
    if (!B) { pane.innerHTML = '<div class="mgp-empty">📒<br>The ledger is not available on this build.</div>'; return; }
    const rows = B.ledger();
    const st = B.state();
    let inSum = 0, outSum = 0; rows.forEach((e) => { if (e.d > 0) inSum += e.d; else outSum -= e.d; });
    pane.innerHTML =
      '<div class="mgp-ldg-head"><div class="mgp-bal"><small>Wallet</small><b>🔥 ' + fmt(st.walletCinder) + '</b></div>' +
        '<div class="mgp-sums"><span class="in">+' + fmt(inSum) + ' received</span><span class="out">−' + fmt(outSum) + ' spent</span></div></div>' +
      '<div class="mgp-seg"><button type="button" data-lm="server" class="' + (ledgerMode === 'server' ? 'on' : '') + '">Account record</button><button type="button" data-lm="wallet" class="' + (ledgerMode === 'wallet' ? 'on' : '') + '">This device</button></div>' +
      '<div class="mgp-ldg" id="mgp-ldg"></div>' +
      '<div class="mgp-foot"><span class="mgp-note" id="mgp-ldg-note"></span><button type="button" id="mgp-ldg-full" class="mgp-btn">Bank ›</button></div>';
    pane.querySelectorAll('[data-lm]').forEach((b) => { b.onclick = () => { ledgerMode = b.dataset.lm; renderLedger(pane); }; });
    const full = $('mgp-ldg-full'); if (full) full.onclick = () => openApp('bank');
    const list = $('mgp-ldg'), note = $('mgp-ldg-note');
    const paint = (list0, src) => {
      if (!list) return;
      if (!list0.length) { list.innerHTML = '<div class="mgp-empty">📒<br>Nothing yet.<br><small>' + (src === 'server' ? 'Server-recorded Cinder moves show here.' : 'Every Cinder you earn or spend from now on is written here.') + '</small></div>'; return; }
      list.innerHTML = list0.slice(0, 200).map((e) => '<div class="mgp-ldr ' + (e.d > 0 ? 'in' : 'out') + (e.k === 'sync' ? ' sync' : '') + '"><span class="ic">' + (e.k === 'bank' ? '🏦' : e.k === 'sync' ? '☁' : e.d > 0 ? '💰' : '💸') + '</span>' +
        '<div class="mgp-ldb"><b>' + esc(e.r) + (e.n > 1 ? ' <i class="mgp-n">×' + e.n + '</i>' : '') + '</b><small>' + esc(when(e.t)) + (e.b != null ? ' · after 🔥 ' + fmt(e.b) : '') + '</small></div><span class="d">' + signed(e.d) + '</span></div>').join('');
    };
    if (ledgerMode === 'wallet') { paint(rows, 'wallet'); if (note) note.textContent = rows.length + ' entries on this device · newest first'; }
    else {
      if (list) list.innerHTML = '<div class="mgp-empty">Loading the server audit…</div>';
      B.serverLedger().then((r) => {
        if (app !== 'ledger' || ledgerMode !== 'server') return;
        if (!r.ok && r.reason === 'missing') { paint(rows, 'wallet'); if (note) note.textContent = rows.length + ' entries on this device · the account record is not installed yet'; return; }
        if (!r.ok) { if (list) list.innerHTML = '<div class="mgp-empty">' + (r.reason === 'signin' ? 'Sign in to read the server audit.' : r.reason === 'missing' ? 'The server ledger is not installed on this build.' : 'Could not load the server audit.') + '</div>'; return; }
        paint(r.rows, 'server'); if (note) note.textContent = r.rows.length + ' server rows · tamper-proof';
      });
    }
  }

  /* ── 🏦 Bank of Ethos ── balance, then three drawers: Cinder, Aza, Vault. */
  let bankTab = 'cinder', bankBusy = false;
  function renderBank(pane) {
    const B = bank();
    if (!B) { pane.innerHTML = '<div class="mgp-empty">🏦<br>The bank is not available on this build.</div>'; return; }
    const st = B.state();
    if (!st.signedIn) { pane.innerHTML = '<div class="mgp-empty">🏦<br>Sign in to use the Bank of Ethos.<br><small>Your balance and vault live on your account.</small></div>'; return; }
    if (!st.ready) {
      pane.innerHTML = '<div class="mgp-empty">🏦<br>' + (st.err === 'setup' ? 'The bank is not set up on this build yet.' : 'Opening your account…') + '</div>';
      if (st.err !== 'setup') B.ensure().then(() => { if (app === 'bank') renderBank(pane); });
      return;
    }
    const tab = (id, lbl) => '<button type="button" data-bt="' + id + '" class="' + (bankTab === id ? 'on' : '') + '">' + lbl + '</button>';
    pane.innerHTML =
      '<div class="mgp-bank-head"><div class="mgp-bal big"><small>Account balance' + (st.handle ? ' · @' + esc(st.handle) : '') + '</small><b>🔥 ' + fmt(st.balance) + '</b><i>👑 ' + fmt(st.aza) + ' Aza · vault ' + fmt(st.vaultUsed) + ' / ' + fmt(st.vaultCap) + '</i></div>' +
        '<div class="mgp-bal"><small>Wallet</small><b>🔥 ' + fmt(st.walletCinder) + '</b><i>👑 ' + fmt(st.walletAza) + '</i></div></div>' +
      '<div class="mgp-seg">' + tab('cinder', '🔥 Cinder') + tab('aza', '👑 Aza') + tab('vault', '📦 Vault') + '</div>' +
      '<div class="mgp-bank" id="mgp-bank"></div>' +
      '<div class="mgp-foot"><span class="mgp-note">Same rules as the Bank of Ethos desk</span><button type="button" id="mgp-bank-full" class="mgp-btn">Open the bank ›</button></div>';
    pane.querySelectorAll('[data-bt]').forEach((b) => { b.onclick = () => { bankTab = b.dataset.bt; renderBank(pane); }; });
    const full = $('mgp-bank-full'); if (full) full.onclick = () => { try { close(); B.openFull(); } catch (e) {} };
    const box = $('mgp-bank'); if (!box) return;
    const act = async (fn, btn) => {
      if (bankBusy) return; bankBusy = true; if (btn) btn.disabled = true;
      try { await fn(); } catch (e) {}
      bankBusy = false; if (app === 'bank') renderBank(pane);
    };
    if (bankTab === 'cinder' || bankTab === 'aza') {
      const aza = bankTab === 'aza';
      const cur = aza ? '👑' : '🔥', wallet = aza ? st.walletAza : st.walletCinder, inBank = aza ? st.aza : st.balance;
      box.innerHTML =
        '<div class="mgp-mv"><label>Amount</label><div class="mgp-amt"><input type="number" id="mgp-amt" min="1" step="1" inputmode="numeric" placeholder="0"><span>' + cur + '</span></div>' +
          '<div class="mgp-quick"><button type="button" data-q="100">100</button><button type="button" data-q="1000">1,000</button><button type="button" data-q="10000">10,000</button><button type="button" data-q="max-w">All wallet</button><button type="button" data-q="max-b">All bank</button></div>' +
          '<div class="mgp-mvb"><button type="button" id="mgp-dep" class="mgp-btn go">⇩ Deposit</button><button type="button" id="mgp-wd" class="mgp-btn go">⇧ Withdraw</button></div>' +
          '<p class="mgp-hint">Deposit moves ' + cur + ' from your wallet (' + fmt(wallet) + ') into the bank (' + fmt(inBank) + '); withdraw brings it back. ' + (aza ? 'No fee.' : 'No fee on Cinder.') + (aza && !st.extCols ? '<br><b>Aza banking needs the updated api.sql on this build.</b>' : '') + '</p></div>' +
        (st.bankLedger.length ? '<div class="mgp-sub">Recent bank activity</div><div class="mgp-ldg short">' + st.bankLedger.filter((e) => aza ? e.aza : e.cinder).slice(0, 12).map((e) => { const v = aza ? e.aza : e.cinder; return '<div class="mgp-ldr ' + (v > 0 ? 'in' : 'out') + '"><span class="ic">🏦</span><div class="mgp-ldb"><b>' + esc(e.note || e.kind) + '</b><small>' + esc(when(e.t)) + '</small></div><span class="d">' + signed(v) + '</span></div>'; }).join('') + '</div>' : '');
      const inp = $('mgp-amt');
      box.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => { const q = b.dataset.q; inp.value = q === 'max-w' ? wallet : q === 'max-b' ? inBank : q; inp.focus(); }; });
      const amt = () => Math.floor(+inp.value || 0);
      $('mgp-dep').onclick = (e) => act(() => aza ? B.depositAza(amt()) : B.deposit(amt()), e.currentTarget);
      $('mgp-wd').onclick = (e) => act(() => aza ? B.withdrawAza(amt()) : B.withdraw(amt()), e.currentTarget);
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('mgp-dep').click(); };
    } else {
      const rs = st.resources;
      box.innerHTML =
        '<div class="mgp-vault-sum"><b>' + fmt(st.vaultUsed) + '</b> of ' + fmt(st.vaultCap) + ' units in the vault · deposit fee 🔥 ' + fmt(st.depositFee) + ' per deposit' + (!st.extCols ? '<br><b>Resource banking needs the updated api.sql on this build.</b>' : '') + '</div>' +
        (rs.length ? rs.map((x) => '<div class="mgp-vr" data-res="' + esc(x.id) + '"><span class="ic">' + esc(x.icon) + '</span><div class="mgp-ldb"><b>' + esc(x.name) + '</b><small>you ' + fmt(x.have) + ' · vault ' + fmt(x.banked) + '</small></div>' +
          '<input type="number" min="1" step="1" inputmode="numeric" placeholder="qty" class="mgp-vq">' +
          '<button type="button" data-act="in" title="Put into the vault" ' + (x.have > 0 ? '' : 'disabled') + '>⇩</button><button type="button" data-act="out" title="Take out of the vault" ' + (x.banked > 0 ? '' : 'disabled') + '>⇧</button></div>').join('')
          : '<div class="mgp-empty">📦<br>No resources to bank yet.</div>');
      box.querySelectorAll('.mgp-vr').forEach((row) => {
        const id = row.dataset.res, q = row.querySelector('.mgp-vq');
        q.onkeydown = (e) => e.stopPropagation();
        row.querySelector('[data-act="in"]').onclick = (e) => act(() => B.depositRes(id, Math.floor(+q.value || 0)), e.currentTarget);
        row.querySelector('[data-act="out"]').onclick = (e) => act(() => B.withdrawRes(id, Math.floor(+q.value || 0)), e.currentTarget);
      });
    }
  }

  /* ── 📈 Crash Exchange ── live prices, a tap-to-trade ticket, and the
     portfolio, all through window.MythicExchange (index.html): the same
     catalog / quote / buy / sell the Crash Exchange screen runs. */
  const cxSeam = () => { try { return window.MythicExchange || null; } catch (e) { return null; } };
  let cxTab = 'market', cxPick = null, cxQuery = '', cxBusy = false, cxTimer = null;
  const cxSpark = (arr, w, h, up) => {
    const a = (arr || []).filter((v) => isFinite(v)); if (a.length < 2) return '';
    const min = Math.min.apply(null, a), max = Math.max.apply(null, a), span = (max - min) || 1;
    const pts = a.map((v, i) => (i / (a.length - 1) * w).toFixed(1) + ',' + (h - ((v - min) / span) * (h - 2) - 1).toFixed(1)).join(' ');
    const col = up ? '#3fd08a' : '#ff6b6b';
    return '<svg class="mgp-cx-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline fill="none" stroke="' + col + '" stroke-width="1.6" points="' + pts + '"/></svg>';
  };
  const cxDelta = (d) => '<span class="mgp-cx-d ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲' : '▼') + ' ' + Math.abs(d).toFixed(1) + '%</span>';
  function renderCx(pane) {
    const X = cxSeam();
    if (!X) { pane.innerHTML = '<div class="mgp-empty">📈<br>The exchange is not available on this build.</div>'; return; }
    const tab = (id, lbl) => '<button type="button" data-ct="' + id + '" class="' + (cxTab === id ? 'on' : '') + '">' + lbl + '</button>';
    const hold = X.holdings();
    const held = hold.reduce((s, h) => s + h.value, 0);
    pane.innerHTML =
      '<div class="mgp-ldg-head"><div class="mgp-bal"><small>Wallet</small><b>🔥 ' + fmt(X.wallet()) + '</b></div>' +
        '<div class="mgp-bal" style="text-align:right"><small>Positions</small><b>' + X.fmt(held) + ' CR</b></div></div>' +
      '<div class="mgp-seg">' + tab('market', '📈 Market') + tab('port', '💼 Portfolio') + '</div>' +
      '<div class="mgp-cx-body" id="mgp-cx"></div>' +
      '<div class="mgp-foot"><span class="mgp-note" id="mgp-cx-note">Prices move with every player\'s trades</span><button type="button" id="mgp-cx-full" class="mgp-btn">Open the exchange ›</button></div>';
    pane.querySelectorAll('[data-ct]').forEach((b) => { b.onclick = () => { cxTab = b.dataset.ct; cxPick = null; renderCx(pane); }; });
    const full = $('mgp-cx-full'); if (full) full.onclick = () => { try { close(); X.open(cxPick); } catch (e) {} };
    const box = $('mgp-cx'); if (!box) return;
    if (cxTab === 'port') {
      box.innerHTML = hold.length
        ? '<div class="mgp-ldg">' + hold.map((h) => '<div class="mgp-ldr ' + (h.pnl >= 0 ? 'in' : 'out') + '" data-cx-pick="' + esc(h.id) + '"><span class="ic">' + esc(h.icon) + '</span>' +
            '<div class="mgp-ldb"><b>' + esc(h.name) + '</b><small>' + fmt(h.qty) + ' sh · avg ' + X.fmt(h.avgCost) + ' · now ' + X.fmt(h.price) + '</small></div>' +
            '<span class="d">' + (h.pnl >= 0 ? '+' : '−') + X.fmt(Math.abs(h.pnl)) + '<br><small>' + (h.pnlPct >= 0 ? '+' : '') + h.pnlPct.toFixed(1) + '%</small></span></div>').join('') + '</div>'
        : '<div class="mgp-empty">💼<br>No positions yet.<br><small>Buy shares on the Market tab. Shares are speculation — real resources never leave your stores.</small></div>';
      box.querySelectorAll('[data-cx-pick]').forEach((r) => { r.onclick = () => { cxPick = r.dataset.cxPick; cxTab = 'market'; renderCx(pane); }; });
      return;
    }
    if (cxPick) { renderCxTicket(box, pane, X); return; }
    const rows = X.list().filter((r) => !cxQuery || (r.name + ' ' + r.id + ' ' + r.cat).toLowerCase().indexOf(cxQuery) >= 0);
    box.innerHTML =
      '<div class="mgp-cx-search"><input type="search" id="mgp-cx-q" placeholder="Search resources" value="' + esc(cxQuery) + '"></div>' +
      (rows.length ? '<div class="mgp-ldg">' + rows.slice(0, 80).map((r) => '<div class="mgp-ldr ' + (r.delta >= 0 ? 'in' : 'out') + '" data-cx-pick="' + esc(r.id) + '"><span class="ic">' + esc(r.icon) + '</span>' +
          '<div class="mgp-ldb"><b>' + esc(r.name) + '</b><small>' + esc(r.cat) + (r.qty ? ' · you hold ' + fmt(r.qty) : '') + '</small></div>' +
          '<span class="d">' + X.fmt(r.price) + '<br>' + cxDelta(r.delta) + '</span></div>').join('') + '</div>'
        : '<div class="mgp-empty">📈<br>Nothing matches.</div>');
    const q = $('mgp-cx-q');
    if (q) { q.onkeydown = (e) => e.stopPropagation(); q.oninput = () => { cxQuery = q.value.trim().toLowerCase(); const keep = q.selectionStart; renderCx(pane); const q2 = $('mgp-cx-q'); if (q2) { q2.focus(); try { q2.setSelectionRange(keep, keep); } catch (e) {} } }; }
    box.querySelectorAll('[data-cx-pick]').forEach((r) => { r.onclick = () => { cxPick = r.dataset.cxPick; renderCx(pane); }; });
  }
  function renderCxTicket(box, pane, X) {
    const qte = X.quote(cxPick);
    if (!qte) { cxPick = null; renderCx(pane); return; }
    const up = qte.delta >= 0;
    box.innerHTML =
      '<div class="mgp-cx-tk">' +
        '<button type="button" class="mgp-cx-back" id="mgp-cx-back">‹ Market</button>' +
        '<div class="mgp-cx-head"><span class="ic">' + esc(qte.icon) + '</span><div><b>' + esc(qte.name) + '</b><small>' + esc(qte.id) + ' · vol ' + fmt(qte.vol) + '</small></div></div>' +
        '<div class="mgp-cx-px"><b>' + X.fmt(qte.price) + ' CR</b>' + cxDelta(qte.delta) + '</div>' +
        cxSpark(qte.series, 260, 56, up) +
        '<div class="mgp-cx-pos">' + (qte.qty ? 'You hold <b>' + fmt(qte.qty) + '</b> share' + (qte.qty === 1 ? '' : 's') + ' at avg ' + X.fmt(qte.avgCost) : 'No position') + ' · wallet 🔥 ' + fmt(X.wallet()) + '</div>' +
        '<div class="mgp-mv"><label>Shares</label><div class="mgp-amt"><input type="number" id="mgp-cx-qty" min="1" step="1" inputmode="numeric" value="1"><span>sh</span></div>' +
          '<div class="mgp-quick"><button type="button" data-q="1">1</button><button type="button" data-q="10">10</button><button type="button" data-q="100">100</button><button type="button" data-q="max">Max</button></div>' +
          '<div class="mgp-mvb"><button type="button" id="mgp-cx-buy" class="mgp-btn go">Buy ≈ <span id="mgp-cx-cost">' + X.fmt(qte.buyPx) + '</span></button><button type="button" id="mgp-cx-sell" class="mgp-btn go" ' + (qte.qty ? '' : 'disabled') + '>Sell</button></div>' +
          '<p class="mgp-hint">A buy pays the reserve\'s quote (spread and slip included, 0.4% fee); a sell pays out at the quote. Every order moves the price for everyone.</p></div>' +
        '<div class="mgp-note" id="mgp-cx-msg"></div>' +
      '</div>';
    $('mgp-cx-back').onclick = () => { cxPick = null; renderCx(pane); };
    const inp = $('mgp-cx-qty'), cost = $('mgp-cx-cost'), msg = $('mgp-cx-msg');
    const qty = () => Math.max(1, Math.floor(+inp.value || 0));
    const paintCost = () => { if (cost) cost.textContent = X.fmt(qte.buyPx * qty()); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('mgp-cx-buy').click(); };
    inp.oninput = paintCost;
    box.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => { const v = b.dataset.q; inp.value = v === 'max' ? Math.max(1, Math.floor(X.wallet() / Math.max(1e-9, qte.buyPx * 1.004))) : v; paintCost(); }; });
    const act = (fn) => {
      if (cxBusy) return; cxBusy = true;
      let r = null; try { r = fn(); } catch (e) { r = { ok: false, msg: (e && e.message) || 'failed' }; }
      cxBusy = false;
      if (msg) { msg.textContent = (r && r.msg) || (r && r.ok ? 'Done.' : 'Refused.'); msg.className = 'mgp-note ' + (r && r.ok ? 'ok' : 'bad'); }
      if (r && r.ok) setTimeout(() => { if (app === 'cx' && cxPick) renderCx(pane); }, 900);
    };
    $('mgp-cx-buy').onclick = () => act(() => X.buy(cxPick, qty()));
    $('mgp-cx-sell').onclick = () => act(() => X.sell(cxPick, Math.min(qty(), qte.qty || qty())));
  }
  /* ── 🛒 Luni ── the player market in the pocket: browse and buy what other
     players listed, put your own resources and items up, pull them back down.
     Every call goes through window.MythicLuni (index.html), which is a thin
     router over the market screen's OWN post / take / cancel functions — the
     phone cannot price, escrow or grant differently from the Forge. */
  /* ⚔ MERCENARIES — the escrow job board, on the phone.
     ───────────────────────────────────────────────────────────────────────
     Reads window.MythicMercenaries directly. Unlike Luni and the Exchange
     this needs no index.html seam: the feature is already an ES module that
     publishes itself on window, so a second wrapper would only be a second
     place for the two to disagree.

     ⚠ SAME FETCH RULE AS LUNI. Merc.state is filled by loadAll() and by
       nothing else, so a player who opens the phone without visiting the hub
       is reading empty arrays. This asks on every open and says so while it
       waits, rather than drawing "no contracts" over an unanswered fetch.

     ⚠ COLLECT CHECKS FOR ROOM FIRST. A claim is a one-shot insert on the
       server: goods that do not fit the stash after the fact are goods that
       exist nowhere. The button is disabled with the numbers spelled out,
       exactly as the full board does it — this is not a place to be terser
       than the desktop. */
  /* 🏛 MAYOR — every city you run for someone else, and what each one pays.
     ───────────────────────────────────────────────────────────────────────
     Two screens: the list of clients, and one city's profile. Through
     window.MythicMayorDash, which wraps two SECURITY DEFINER RPCs scoped to
     the caller as mayor — there is no user id to pass, so the phone cannot
     ask about a city that is not theirs.

     ⚠ SAME FETCH RULE AS LUNI. Nothing else fills this state, so it asks on
       every open and says "Reading your contracts…" while it waits. Drawing
       "you are not a mayor anywhere" over an unanswered request is the bug
       that shipped on the market app once already.

     ⚠ AND "NOT SET UP" IS NOT "NONE". If sql/123 has not been applied the RPC
       is absent, and a mayor with six clients would otherwise be told they
       have none — which reads as their contracts having vanished. */
  /* 🏆 LEADERBOARDS — who is at the top, cities and fighters.
     ───────────────────────────────────────────────────────────────────────
     Through window.MythicLeaderboard, which reads sql/124's three read-only
     RPCs. Nothing here submits a score: the numbers are derived from saves the
     game already syncs, which is what stops a modified client typing its way
     to the top.

     ⚠ SAME FETCH RULE AS EVERY OTHER APP HERE. A board fetches on open and
       says so while it waits; "nobody has scored yet" is the LAST branch, not
       the one an unanswered request falls into.

     ⚠ RANKED IS THE HONEST ONE, and the app says so. It is counted from the
       ladder's own match rows; the other boards read the player's own save,
       which a determined cheat can edit. Better to print that than to imply
       every board is equally hard to fake. */
  const lbSeam = () => { try { return window.MythicLeaderboard || null; } catch (e) { return null; } };
  const LB_CITY = [
    { id: 'cinder',     label: '🔥 Cinder',     note: 'Lifetime Cinder the city has earned' },
    { id: 'population', label: '👥 Population', note: 'People living in the city right now' },
  ];
  const LB_PLAYER = [
    { id: 'wins',   label: '🏅 Wins',   note: 'Battles won, from the player record' },
    { id: 'ranked', label: '⚔ Ranked',  note: 'Ranked PvP wins, counted from the ladder’s own matches' },
    { id: 'kills',  label: '🗡 Kills',  note: 'The single unit with the most kills' },
    { id: 'rr',     label: '📈 Rating', note: 'Ranked rating' },
  ];
  let lbSide = 'city', lbBoard = 'cinder', lbRows = null, lbState = '', lbResList = null;
  let lbLoaded = false, lbLoading = false;
  function lbEnsure(pane, L) {
    if (lbLoaded || lbLoading) return;
    lbLoading = true;
    const done = (r) => {
      lbLoading = false; lbLoaded = true;
      lbRows = (r && r.rows) || [];
      lbState = (r && (r.missing ? 'missing' : r.offline ? 'offline' : r.error ? 'error' : '')) || '';
      if (app === 'board') renderBoard(pane);
    };
    try {
      const p = (lbSide === 'city') ? L.cities(lbBoard, 25) : L.players(lbBoard, 25);
      Promise.resolve(p).then(done, () => done(null));
    } catch (e) { done(null); }
    /* The resource boards are whatever some city actually holds — asked once
       so the tab strip cannot drift from the city builder. */
    if (lbResList === null) {
      lbResList = [];
      try { Promise.resolve(L.resources()).then((r) => { lbResList = (r && r.rows) || []; if (app === 'board') renderBoard(pane); }, () => {}); } catch (e) {}
    }
  }
  function lbGo(pane, side, board) {
    lbSide = side; lbBoard = board; lbRows = null; lbLoaded = false; lbState = '';
    renderBoard(pane);
  }
  function renderBoard(pane) {
    const L = lbSeam();
    if (!L) { pane.innerHTML = '<div class="mgp-empty">🏆<br>Leaderboards are not available on this build.</div>'; return; }
    if (!L.signedIn()) { pane.innerHTML = '<div class="mgp-empty">🏆<br>Sign in to see the boards.</div>'; return; }
    lbEnsure(pane, L);
    const defs = (lbSide === 'city')
      ? LB_CITY.concat((lbResList || []).map((r) => ({ id: r.resource, label: L.resIcon(r.resource) + ' ' + L.resName(r.resource), note: 'Held in city stores' })))
      : LB_PLAYER;
    const cur = defs.find((d) => d.id === lbBoard) || defs[0] || { label: '', note: '' };
    const side = (id, lbl) => '<button type="button" data-lbs="' + id + '" class="' + (lbSide === id ? 'on' : '') + '">' + lbl + '</button>';
    pane.innerHTML =
      '<div class="mgp-seg">' + side('city', '🏙 Cities') + side('player', '⚔ Fighters') + '</div>' +
      '<div class="mgp-cx-search" style="gap:6px;flex-wrap:wrap;display:flex;padding:6px 10px">' +
        defs.map((d) => '<button type="button" class="mgp-btn' + (d.id === lbBoard ? ' go' : '') + '" data-lbb="' + esc(d.id) + '">' + d.label + '</button>').join('') +
      '</div>' +
      '<div class="mgp-cx-body" id="mgp-lb"></div>' +
      '<div class="mgp-foot"><span class="mgp-note" id="mgp-lb-note">' + esc(cur.note || '') + '</span>' +
        '<button type="button" id="mgp-lb-refresh" class="mgp-btn" title="Read the board again">↻</button></div>';
    pane.querySelectorAll('[data-lbs]').forEach((b) => {
      b.onclick = () => lbGo(pane, b.dataset.lbs, b.dataset.lbs === 'city' ? 'cinder' : 'wins');
    });
    pane.querySelectorAll('[data-lbb]').forEach((b) => { b.onclick = () => lbGo(pane, lbSide, b.dataset.lbb); });
    const rf = $('mgp-lb-refresh'); if (rf) rf.onclick = () => { lbLoaded = false; lbEnsure(pane, L); const n = $('mgp-lb-note'); if (n) n.textContent = 'Reading the board…'; };
    const box = $('mgp-lb'); if (!box) return;
    const rows = lbRows || [];
    if (!rows.length) {
      box.innerHTML = '<div class="mgp-empty">🏆<br>' + (
        lbLoading ? 'Reading the board…'
        : lbState === 'missing' ? 'Leaderboards are not set up on this world yet.<br><small>An admin still has to apply the migration.</small>'
        : lbState === 'error' ? 'Could not read the board.<br><small>Try again in a moment.</small>'
        : 'Nobody is on this board yet.'
      ) + '</div>';
      return;
    }
    const me = L.me();
    const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1));
    box.innerHTML = '<div class="mgp-ldg">' + rows.map((r, i) => {
      const mine = me && String(r.owner_id || r.user_id || '') === String(me);
      const who = (lbSide === 'city')
        ? esc(L.nodeName(r.node_id)) + ' <i class="mgp-n">' + esc(r.owner_name || 'Survivor') + '</i>'
        : esc(r.name || 'Survivor');
      const sub = (lbSide === 'city')
        ? 'owner · ' + esc(r.owner_name || 'Survivor')
        : (lbBoard === 'kills' ? esc(L.unitName(r.detail)) : esc(r.detail || ''));
      return '<div class="mgp-ldr' + (mine ? ' in' : '') + '"><span class="ic">' + medal(i) + '</span>' +
        '<div class="mgp-ldb"><b>' + who + (mine ? ' <i class="mgp-n">you</i>' : '') + '</b>' +
        '<small>' + sub + '</small></div>' +
        '<span class="d">' + L.fmt(r.value) + '</span></div>';
    }).join('') + '</div>' +
      (lbSide === 'player' && lbBoard !== 'ranked'
        ? '<p class="mgp-hint">Read from each player’s own save. <strong>Ranked</strong> is counted from the ladder’s match rows instead, so it is the one board a save cannot flatter.</p>'
        : '');
    /* 🧍 Owner's ask (2026-09-10): "make sure the leaderboard stats on the
       little phone" — the board now says where YOU stand: your row is marked
       above, and when you are not in the top it says so instead of nothing. */
    try {
      const myIdx = me ? rows.findIndex((r) => String(r.owner_id || r.user_id || '') === String(me)) : -1;
      const you = document.createElement('p'); you.className = 'mgp-hint mgp-you';
      you.innerHTML = myIdx >= 0
        ? '🧍 You are <strong>#' + (myIdx + 1) + '</strong> of the ' + rows.length + ' ranked on this board.'
        : (me ? '🧍 You are not in the top ' + rows.length + ' on this board yet.' : '🧍 Sign in to see where you stand.');
      box.appendChild(you);
    } catch (e) {}
    const note = $('mgp-lb-note'); if (note) note.textContent = cur.note || (rows.length + ' ranked');
  }
  const mdSeam = () => { try { return window.MythicMayorDash || null; } catch (e) { return null; } };
  let mdRows = null, mdState = '', mdPick = null, mdPayouts = null;
  let mdLoaded = false, mdLoading = false;
  function mdEnsure(pane, D) {
    if (mdLoaded || mdLoading) return;
    mdLoading = true;
    const done = (r) => {
      mdLoading = false; mdLoaded = true;
      mdRows = (r && r.rows) || [];
      mdState = (r && (r.missing ? 'missing' : r.offline ? 'offline' : r.error ? 'error' : '')) || '';
      if (app === 'mayor') renderMayor(pane);
    };
    try { Promise.resolve(D.load()).then(done, () => done(null)); } catch (e) { done(null); }
  }
  const mdAgo = (ts) => {
    try {
      if (!ts) return 'never';
      const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (s < 90) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    } catch (e) { return '—'; }
  };
  const mdSplit = (pct) => { const p = Math.round(Number(pct) || 0); return p + '% you · ' + (100 - p) + '% owner'; };
  function renderMayor(pane) {
    const D = mdSeam();
    if (!D) { pane.innerHTML = '<div class="mgp-empty">🏛<br>The mayor dashboard is not available on this build.</div>'; return; }
    if (!D.signedIn()) { pane.innerHTML = '<div class="mgp-empty">🏛<br>Sign in to see your contracts.<br><small>Mayoralties live on your account.</small></div>'; return; }
    mdEnsure(pane, D);
    if (mdPick) { renderMayorCity(pane, D); return; }
    const rows = mdRows || [];
    const total = rows.reduce((n, r) => n + (Number(r.earned_total) || 0), 0);
    const d30 = rows.reduce((n, r) => n + (Number(r.earned_30d) || 0), 0);
    pane.innerHTML =
      '<div class="mgp-ldg-head"><div class="mgp-bal"><small>Earned as mayor</small><b>🔥 ' + D.fmt(total) + '</b>' +
        (D.usd(total) ? '<i>≈ ' + esc(D.usd(total)) + '</i>' : '') + '</div>' +
        '<div class="mgp-bal" style="text-align:right"><small>Last 30 days</small><b>🔥 ' + D.fmt(d30) + '</b>' +
        '<i>' + rows.length + ' ' + (rows.length === 1 ? 'city' : 'cities') + '</i></div></div>' +
      '<div class="mgp-cx-body" id="mgp-md"></div>' +
      '<div class="mgp-foot"><span class="mgp-note" id="mgp-md-note"></span>' +
        '<button type="button" id="mgp-md-refresh" class="mgp-btn" title="Read your contracts again">↻</button></div>';
    const rf = $('mgp-md-refresh'); if (rf) rf.onclick = () => { mdLoaded = false; mdEnsure(pane, D); const n = $('mgp-md-note'); if (n) n.textContent = 'Reading your contracts…'; };
    const box = $('mgp-md'); if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<div class="mgp-empty">🏛<br>' + (
        mdLoading ? 'Reading your contracts…'
        : mdState === 'missing' ? 'The dashboard is not set up on this world yet.<br><small>An admin still has to apply the migration.</small>'
        : mdState === 'error' ? 'Could not read your contracts.<br><small>Try again in a moment.</small>'
        : 'You are not a mayor anywhere yet.<br><small>Apply in Mayor Hall — owners hire from there.</small>'
      ) + '</div>';
      const n = $('mgp-md-note'); if (n) n.textContent = '';
      return;
    }
    box.innerHTML = '<div class="mgp-ldg">' + rows.map((r) => {
      const paid = Number(r.earned_total) || 0;
      return '<div class="mgp-ldr in" data-md-pick="' + esc(r.node_id) + '"><span class="ic">🏛</span>' +
        '<div class="mgp-ldb"><b>' + esc(D.nodeName(r.node_id)) + '</b>' +
        '<small>' + esc(r.owner_name || 'Survivor') + ' · ' + esc(mdSplit(r.player_pct)) + '</small></div>' +
        '<span class="d">' + (paid ? D.fmt(paid) + ' 🔥' : '—') + '</span></div>';
    }).join('') + '</div>';
    box.querySelectorAll('[data-md-pick]').forEach((el) => {
      el.onclick = () => { mdPick = el.dataset.mdPick; mdPayouts = null; renderMayor(pane); };
    });
    const note = $('mgp-md-note'); if (note) note.textContent = 'Tap a city for its profile';
  }
  /* One city's profile: who the client is, the contract as agreed, what it has
     paid, and the way in. */
  function renderMayorCity(pane, D) {
    const r = (mdRows || []).find((x) => x && String(x.node_id) === String(mdPick));
    if (!r) { mdPick = null; renderMayor(pane); return; }
    if (mdPayouts === null) {
      mdPayouts = [];
      try { Promise.resolve(D.payouts(r.node_id, 20)).then((p) => { mdPayouts = (p && p.rows) || []; if (app === 'mayor' && mdPick) renderMayor(pane); }, () => {}); } catch (e) {}
    }
    const total = Number(r.earned_total) || 0, d30 = Number(r.earned_30d) || 0;
    const policy = (v) => esc(v || 'not stated');
    pane.innerHTML =
      '<div class="mgp-cx-tk">' +
        '<button type="button" class="mgp-cx-back" id="mgp-md-back">‹ My cities</button>' +
        '<div class="mgp-cx-head"><span class="ic">🏛</span><div><b>' + esc(D.nodeName(r.node_id)) + '</b>' +
          '<small>client · ' + esc(r.owner_name || 'Survivor') + '</small></div></div>' +
        '<div class="mgp-cx-px"><b>' + D.fmt(total) + ' 🔥</b>' +
          (D.usd(total) ? '<span class="mgp-cx-d" style="color:#9be0c4">≈ ' + esc(D.usd(total)) + '</span>' : '') + '</div>' +
        '<div class="mgp-cx-pos">' + D.fmt(d30) + ' in the last 30 days · ' + (Number(r.payouts) || 0) + ' payout' + ((Number(r.payouts) || 0) === 1 ? '' : 's') +
          ' · last ' + esc(mdAgo(r.last_paid_at)) + '</div>' +
        '<div class="mgp-ldg" style="margin-top:10px">' +
          '<div class="mgp-ldr"><span class="ic">🤝</span><div class="mgp-ldb"><b>Revenue split</b><small>' + esc(mdSplit(r.player_pct)) + '</small></div></div>' +
          '<div class="mgp-ldr"><span class="ic">💱</span><div class="mgp-ldb"><b>Paid in</b><small>' + esc(String(r.currency || 'cinder')) + '</small></div></div>' +
          '<div class="mgp-ldr"><span class="ic">⏱</span><div class="mgp-ldb"><b>Hours per month</b><small>' + ((Number(r.hours_per_month) || 0) || 'not stated') + '</small></div></div>' +
          '<div class="mgp-ldr"><span class="ic">🃏</span><div class="mgp-ldb"><b>Cards found on shift</b><small>' + policy(r.card_policy) + '</small></div></div>' +
          '<div class="mgp-ldr"><span class="ic">📦</span><div class="mgp-ldb"><b>Resources found on shift</b><small>' + policy(r.resource_policy) + '</small></div></div>' +
          '<div class="mgp-ldr"><span class="ic">📅</span><div class="mgp-ldb"><b>Mayor since</b><small>' + esc(mdAgo(r.started_at)) + '</small></div></div>' +
        '</div>' +
        (mdPayouts && mdPayouts.length
          ? '<div class="mgp-note" style="padding:10px 2px 2px">Recent payouts</div><div class="mgp-ldg">' +
            mdPayouts.slice(0, 12).map((p) => '<div class="mgp-ldr"><span class="ic">🔥</span>' +
              '<div class="mgp-ldb"><b>+' + D.fmt(p.amount) + '</b><small>' + esc(mdAgo(p.created_at)) + '</small></div>' +
              '<span class="d">' + Math.round(Number(p.pct) || 0) + '%</span></div>').join('') + '</div>'
          : '<p class="mgp-hint">' + (total ? 'Payout history is loading…' : 'This city has not paid out yet. Your share arrives automatically as it earns — there is no button to press.') + '</p>') +
        '<div class="mgp-mvb"><button type="button" id="mgp-md-open" class="mgp-btn go">🏛 Open this city</button></div>' +
      '</div>';
    $('mgp-md-back').onclick = () => { mdPick = null; mdPayouts = null; renderMayor(pane); };
    const go = $('mgp-md-open');
    if (go) go.onclick = () => { try { close(); D.openCity(r.node_id); } catch (e) {} };
  }
  const mercSeam = () => { try { return window.MythicMercenaries || null; } catch (e) { return null; } };
  let mercTab = 'board', mercPick = null, mercBusy = false, mercMsg = '';
  let mercLoaded = false, mercLoading = false;
  function mercEnsure(pane, M) {
    if (mercLoaded || mercLoading) return;
    mercLoading = true;
    const done = () => { mercLoading = false; mercLoaded = true; if (app === 'merc') renderMerc(pane); };
    try { Promise.resolve(M.loadAll()).then(done, done); } catch (e) { done(); }
  }
  const mercWhen = (ts) => {
    try {
      const ms = new Date(ts).getTime() - Date.now();
      if (!isFinite(ms)) return '';
      if (ms <= 0) return 'deadline passed';
      const h = Math.round(ms / 3600000);
      return h < 48 ? (h + 'h left') : (Math.round(h / 24) + 'd left');
    } catch (e) { return ''; }
  };
  function mercSummary(M, c) {
    try { return M.manifest.summary(c.manifest, M.ctx(), 3); } catch (e) { return 'see the full board'; }
  }
  function renderMerc(pane) {
    const M = mercSeam();
    if (!M) { pane.innerHTML = '<div class="mgp-empty">⚔<br>The Mercenary board is not available on this build.</div>'; return; }
    const S = M.state || {};
    mercEnsure(pane, M);
    if (S.offline) { pane.innerHTML = '<div class="mgp-empty">⚔<br>Sign in to take contracts.<br><small>Escrow and payouts live on your account.</small></div>'; return; }
    if (S.missing) { pane.innerHTML = '<div class="mgp-empty">⚔<br>The board is not set up on this world yet.<br><small>An admin still has to apply the migration. Nothing else is affected.</small></div>'; return; }
    const waiting = (() => { try { return M.claimCount(); } catch (e) { return 0; } })();
    const purse = (() => { try { return M.ctx().gems(); } catch (e) { return 0; } })();
    const tab = (id, lbl) => '<button type="button" data-mt="' + id + '" class="' + (mercTab === id ? 'on' : '') + '">' + lbl + '</button>';
    pane.innerHTML =
      '<div class="mgp-ldg-head"><div class="mgp-bal"><small>Wallet</small><b>🔥 ' + fmt(purse) + '</b></div>' +
        '<div class="mgp-bal" style="text-align:right"><small>Waiting to collect</small><b>' + waiting + '</b></div></div>' +
      '<div class="mgp-seg">' + tab('board', '⚔ Board') + tab('jobs', '📄 Mine') + tab('collect', '📦 Collect' + (waiting ? ' (' + waiting + ')' : '')) + '</div>' +
      '<div class="mgp-cx-body" id="mgp-merc"></div>' +
      '<div class="mgp-foot"><span class="mgp-note" id="mgp-merc-note"></span>' +
        '<button type="button" id="mgp-merc-refresh" class="mgp-btn" title="Read the board again">↻</button>' +
        '<button type="button" id="mgp-merc-full" class="mgp-btn">Open board ›</button></div>';
    pane.querySelectorAll('[data-mt]').forEach((b) => { b.onclick = () => { mercTab = b.dataset.mt; mercPick = null; mercMsg = ''; renderMerc(pane); }; });
    const full = $('mgp-merc-full'); if (full) full.onclick = () => { try { close(); M.open(); } catch (e) {} };
    const rf = $('mgp-merc-refresh'); if (rf) rf.onclick = () => { mercLoaded = false; mercMsg = ''; mercEnsure(pane, M); const n = $('mgp-merc-note'); if (n) n.textContent = 'Reading the board…'; };
    const box = $('mgp-merc'); if (!box) return;
    if (mercTab === 'collect') { renderMercCollect(box, pane, M); return; }
    if (mercTab === 'jobs') { renderMercJobs(box, pane, M); return; }
    if (mercPick) { renderMercTicket(box, pane, M); return; }
    const rows = (S.open || []);
    box.innerHTML = rows.length
      ? '<div class="mgp-ldg">' + rows.slice(0, 80).map((c) => '<div class="mgp-ldr in" data-merc-pick="' + esc(c.id) + '"><span class="ic">⚔</span>' +
          '<div class="mgp-ldb"><b>' + esc(c.title || 'Contract') + '</b><small>' + esc(mercSummary(M, c)) + '</small></div>' +
          '<span class="d">' + fmt(c.reward) + ' 🔥</span></div>').join('') + '</div>'
      : '<div class="mgp-empty">⚔<br>' + (mercLoading ? 'Reading the board…' : 'No open contracts.') + (mercLoading ? '' : '<br><small>Posting needs the full board — it picks from your stash.</small>') + '</div>';
    box.querySelectorAll('[data-merc-pick]').forEach((el) => { el.onclick = () => { mercPick = el.dataset.mercPick; mercMsg = ''; renderMerc(pane); }; });
    const note = $('mgp-merc-note'); if (note) note.textContent = rows.length ? (rows.length + ' open contract' + (rows.length === 1 ? '' : 's')) : 'Escrow is held until the goods land';
  }
  function renderMercTicket(box, pane, M) {
    const c = (M.state.open || []).find((x) => x && x.id === mercPick);
    if (!c) { mercPick = null; renderMerc(pane); return; }
    const mine = (() => { try { return c.employer_id === M.ctx().userId(); } catch (e) { return false; } })();
    const already = (() => { try { return M.state.applied.get(c.id) || null; } catch (e) { return null; } })();
    box.innerHTML =
      '<div class="mgp-cx-tk">' +
        '<button type="button" class="mgp-cx-back" id="mgp-merc-back">‹ Board</button>' +
        '<div class="mgp-cx-head"><span class="ic">⚔</span><div><b>' + esc(c.title || 'Contract') + '</b><small>' + esc(mercWhen(c.deadline_at) || 'no deadline') + '</small></div></div>' +
        '<div class="mgp-cx-px"><b>' + fmt(c.reward) + ' 🔥</b></div>' +
        (c.brief ? '<p class="mgp-hint">' + esc(c.brief) + '</p>' : '') +
        '<div class="mgp-cx-pos">Deliver: ' + esc(mercSummary(M, c)) + '</div>' +
        '<div class="mgp-mvb">' + (mine
          ? '<button type="button" class="mgp-btn" disabled>Your own contract</button>'
          : already
            ? '<button type="button" class="mgp-btn" disabled>Applied · ' + esc(already) + '</button>'
            : '<button type="button" id="mgp-merc-apply" class="mgp-btn go">⚔ Apply</button>') + '</div>' +
        '<p class="mgp-hint">The reward is already in escrow. It releases itself the moment the manifest is met — the employer has no button to withhold it.</p>' +
        '<div class="mgp-note" id="mgp-merc-msg">' + esc(mercMsg) + '</div>' +
      '</div>';
    $('mgp-merc-back').onclick = () => { mercPick = null; mercMsg = ''; renderMerc(pane); };
    const btn = $('mgp-merc-apply'); if (!btn) return;
    btn.onclick = async () => {
      if (mercBusy) return; mercBusy = true; btn.disabled = true;
      let r = null;
      try { r = await M.api.apply(c.id, ''); } catch (e) { r = null; }
      mercBusy = false;
      const msg = $('mgp-merc-msg');
      if (r && r.ok) {
        mercMsg = 'Applied. The employer is notified — watch Mine for the hire.';
        mercLoaded = false; mercEnsure(pane, M);
      } else {
        mercMsg = (r && (r.error || (r.missing ? 'The board is not set up on this world yet.' : '') || (r.offline ? 'Sign in first.' : ''))) || 'Could not apply.';
        btn.disabled = false;
      }
      if (msg) msg.textContent = mercMsg;
    };
  }
  function renderMercJobs(box, pane, M) {
    let posts = [], jobs = [];
    try { posts = M.myPostings() || []; jobs = M.myJobs() || []; } catch (e) {}
    const line = (c, role) => '<div class="mgp-ldr in"><span class="ic">' + (role === 'employer' ? '📜' : '⚔') + '</span>' +
      '<div class="mgp-ldb"><b>' + esc(c.title || 'Contract') + '</b><small>' + esc(c.status || '') +
        (c.status === 'hired' ? ' · ' + esc(mercWhen(c.deadline_at)) : '') + '</small></div>' +
      '<span class="d">' + fmt(c.reward) + ' 🔥</span></div>';
    box.innerHTML = (posts.length || jobs.length)
      ? (jobs.length ? '<div class="mgp-note" style="padding:8px 12px 2px">Jobs you took</div><div class="mgp-ldg">' + jobs.map((c) => line(c, 'merc')).join('') + '</div>' : '')
        + (posts.length ? '<div class="mgp-note" style="padding:10px 12px 2px">Contracts you posted</div><div class="mgp-ldg">' + posts.map((c) => line(c, 'employer')).join('') + '</div>' : '')
      : '<div class="mgp-empty">📄<br>' + (mercLoading ? 'Reading the board…' : 'Nothing yet.') + (mercLoading ? '' : '<br><small>Apply for a contract on the Board tab.</small>') + '</div>';
    const note = $('mgp-merc-note'); if (note) note.textContent = 'Delivering needs the full board — it picks from your stash';
  }
  function renderMercCollect(box, pane, M) {
    const rows = (M.state.claims || []);
    if (!rows.length) {
      box.innerHTML = '<div class="mgp-empty">📦<br>' + (mercLoading ? 'Reading the board…' : 'Nothing waiting.') + (mercLoading ? '' : '<br><small>Finished contracts drop their Cinder and their goods here.</small>') + '</div>';
      const n0 = $('mgp-merc-note'); if (n0) n0.textContent = ''; return;
    }
    const c = M.ctx();
    box.innerHTML = '<div class="mgp-ldg">' + rows.map((k, i) => {
      let items = k.items;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
      items = Array.isArray(items) ? items : [];
      const cash = k.party === 'merc_cinder';
      const what = cash ? ('🔥 ' + fmt(k.reward) + ' Cinder') : (function () { try { return M.manifest.summary(items, c, 4); } catch (e) { return 'goods'; } })();
      const fit = cash ? { ok: true } : (function () { try { return M.manifest.acceptable(items, c); } catch (e) { return { ok: true }; } })();
      const why = cash ? 'Contract paid out' : k.party === 'employer_goods' ? 'Delivered to you' : 'Returned — contract cancelled';
      return '<div class="mgp-ldr"><span class="ic">' + (cash ? '🔥' : '📦') + '</span>' +
        '<div class="mgp-ldb"><b>' + esc(k.title || 'Contract') + '</b><small>' + esc(why) + ' · ' + esc(what) + '</small>' +
        (fit.ok ? '' : '<small style="color:#ff9b84">Stash has room for ' + fmt(fit.room) + ', this is ' + fmt(fit.units) + ' — make room first.</small>') + '</div>' +
        '<button type="button" class="mgp-btn go" data-merc-claim="' + i + '"' + (fit.ok ? '' : ' disabled') + '>Collect</button></div>';
    }).join('') + '</div>' + (mercMsg ? '<div class="mgp-note">' + esc(mercMsg) + '</div>' : '');
    box.querySelectorAll('[data-merc-claim]').forEach((el) => {
      el.onclick = async () => {
        if (mercBusy) return;
        const k = rows[el.dataset.mercClaim | 0]; if (!k) return;
        mercBusy = true; el.disabled = true; el.textContent = '…';
        let r = null;
        try { r = await M.api.claim(k.contract_id, k.party, M.io()); } catch (e) { r = null; }
        mercBusy = false;
        if (r && r.ok) {
          mercMsg = r.already ? 'That one was already collected.' : 'Collected.';
          mercLoaded = false; mercEnsure(pane, M);
          try { if (typeof window.render === 'function') window.render(); } catch (e) {}
        } else {
          mercMsg = (r && r.error) || 'Could not collect — try the full board.';
          el.disabled = false; el.textContent = 'Collect';
        }
        renderMerc(pane);
      };
    });
    const note = $('mgp-merc-note'); if (note) note.textContent = rows.length + ' waiting';
  }
  const luniSeam = () => { try { return window.MythicLuni || null; } catch (e) { return null; } };
  let luniTab = 'browse', luniPick = null, luniSell = null, luniQuery = '', luniBusy = false;
  /* 🔴 THE PHONE HAS TO ASK THE MARKET, NOT WAIT FOR IT. Reported: the market
     screen showed fifteen listings and the app showed "Nothing is listed right
     now." Nothing was wrong with the board — ResMarket.open and CardMarket.open
     are only filled by resMarketFetch / cardMarketFetch, and the only caller
     was the market SCREEN's render. A player who opened the phone without
     visiting that screen first was reading two empty arrays. So the app fetches
     on every open (luniLoaded is reset by openApp), says so while it waits, and
     never draws "nothing is listed" over a fetch that has not answered. */
  let luniLoaded = false, luniLoading = false;
  function luniEnsure(pane, L) {
    if (luniLoaded || luniLoading) return;
    luniLoading = true;
    const done = () => { luniLoading = false; luniLoaded = true; if (app === 'luni') renderLuni(pane); };
    try { Promise.resolve(L.refresh()).then(done, done); } catch (e) { done(); }
  }
  const luniUsd = (L, n) => { const u = L.usd(n); return u ? '<span class="mgp-cx-d" style="color:#9be0c4">≈ ' + esc(u) + '</span>' : ''; };
  function renderLuni(pane) {
    const L = luniSeam();
    if (!L) { pane.innerHTML = '<div class="mgp-empty">🛒<br>The market is not available on this build.</div>'; return; }
    if (!L.signedIn()) { pane.innerHTML = '<div class="mgp-empty">🛒<br>Sign in to trade on Luni.<br><small>Listings and purchases live on your account.</small></div>'; return; }
    luniEnsure(pane, L);
    const slots = L.slots();
    const tab = (id, lbl) => '<button type="button" data-lt="' + id + '" class="' + (luniTab === id ? 'on' : '') + '">' + lbl + '</button>';
    pane.innerHTML =
      '<div class="mgp-ldg-head"><div class="mgp-bal"><small>Wallet</small><b>🔥 ' + fmt(L.wallet()) + '</b></div>' +
        '<div class="mgp-bal" style="text-align:right"><small>Your listings</small><b>' + slots.used + ' / ' + slots.max + '</b></div></div>' +
      '<div class="mgp-seg">' + tab('browse', '🛒 Browse') + tab('sell', '🏷 Sell') + tab('mine', '📄 Mine') + '</div>' +
      '<div class="mgp-cx-body" id="mgp-luni"></div>' +
      '<div class="mgp-foot"><span class="mgp-note" id="mgp-luni-note">Everything here is listed by other players</span>' +
        '<button type="button" id="mgp-luni-refresh" class="mgp-btn" title="Read the market again">↻</button>' +
        '<button type="button" id="mgp-luni-full" class="mgp-btn">Open Luni ›</button></div>';
    pane.querySelectorAll('[data-lt]').forEach((b) => { b.onclick = () => { luniTab = b.dataset.lt; luniPick = null; luniSell = null; renderLuni(pane); }; });
    const full = $('mgp-luni-full'); if (full) full.onclick = () => { try { close(); L.openFull(); } catch (e) {} };
    const rf = $('mgp-luni-refresh'); if (rf) rf.onclick = () => { luniLoaded = false; luniEnsure(pane, L); const n = $('mgp-luni-note'); if (n) n.textContent = 'Reading the market…'; };
    const box = $('mgp-luni'); if (!box) return;
    if (luniTab === 'sell') { renderLuniSell(box, pane, L); return; }
    if (luniTab === 'mine') { renderLuniMine(box, pane, L); return; }
    if (luniPick) { renderLuniTicket(box, pane, L); return; }
    /* the board */
    const rows = L.browse().filter((r) => !luniQuery || (r.name + ' ' + r.seller + ' ' + r.kind).toLowerCase().indexOf(luniQuery) >= 0);
    box.innerHTML =
      '<div class="mgp-cx-search"><input type="search" id="mgp-luni-q" placeholder="Search the market" value="' + esc(luniQuery) + '"></div>' +
      (rows.length
        ? '<div class="mgp-ldg">' + rows.slice(0, 120).map((r) => '<div class="mgp-ldr in" data-luni-pick="' + esc(r.id) + '"><span class="ic">' + esc(r.icon) + '</span>' +
            '<div class="mgp-ldb"><b>' + esc(r.name) + (r.kind === 'res' && r.lotSize ? ' <i class="mgp-n">×' + fmt(r.lotSize) + '</i>' : '') + '</b>' +
            '<small>' + esc(r.seller) + (r.kind === 'res' && r.lots > 1 ? ' · ' + r.lots + ' lots left' : '') + '</small></div>' +
            '<span class="d">' + fmt(r.price) + ' ' + (r.currency === 'aza' ? '👑' : '🔥') + '</span></div>').join('') + '</div>'
        : '<div class="mgp-empty">🛒<br>' + (luniLoading ? 'Reading the market…' : luniQuery ? 'Nothing matches.' : 'Nothing is listed right now.') + (luniLoading ? '' : '<br><small>Pull the Sell tab to put something up.</small>') + '</div>');
    const q = $('mgp-luni-q');
    if (q) {
      q.onkeydown = (e) => e.stopPropagation();
      q.oninput = () => { const at = q.selectionStart; luniQuery = q.value.trim().toLowerCase(); renderLuni(pane); const q2 = $('mgp-luni-q'); if (q2) { q2.focus(); try { q2.setSelectionRange(at, at); } catch (e) {} } };
    }
    box.querySelectorAll('[data-luni-pick]').forEach((el) => { el.onclick = () => { luniPick = el.dataset.luniPick; renderLuni(pane); }; });
    const note = $('mgp-luni-note'); if (note) note.textContent = rows.length + ' listing' + (rows.length === 1 ? '' : 's') + ' · cheapest first';
  }
  /* one listing, with the Buy */
  function renderLuniTicket(box, pane, L) {
    const r = L.browse().find((x) => x.id === luniPick);
    if (!r) { luniPick = null; renderLuni(pane); return; }
    const total = r.price;
    const aza = r.currency === 'aza';
    const purse = aza ? (L.walletAza ? L.walletAza() : 0) : L.wallet();
    const short = purse < total;
    box.innerHTML =
      '<div class="mgp-cx-tk">' +
        '<button type="button" class="mgp-cx-back" id="mgp-luni-back">‹ Market</button>' +
        '<div class="mgp-cx-head"><span class="ic">' + esc(r.icon) + '</span><div><b>' + esc(r.name) + '</b><small>' +
          (r.kind === 'res' ? ('resource · ' + fmt(r.lotSize) + ' per lot' + (r.lots > 1 ? ' · ' + r.lots + ' lots left' : '')) : (r.kind === 'item' ? 'held item' : 'card')) +
          ' · from ' + esc(r.seller) + '</small></div></div>' +
        '<div class="mgp-cx-px"><b>' + fmt(total) + ' ' + (r.currency === 'aza' ? '👑' : '🔥') + '</b>' + luniUsd(L, total) + '</div>' +
        '<div class="mgp-cx-pos">Wallet ' + (aza ? '👑 ' : '🔥 ') + fmt(purse) + (short ? ' — not enough for this' : '') + '</div>' +
        '<div class="mgp-mvb"><button type="button" id="mgp-luni-buy" class="mgp-btn go" ' + (short ? 'disabled' : '') + '>🛒 Buy' + (r.kind === 'res' ? ' one lot' : '') + '</button></div>' +
        '<p class="mgp-hint">' + (r.kind === 'res' ? 'Buys a single lot. The goods land in your stores and the seller is paid at once.' : 'The item goes straight into your inventory and the seller is paid at once.') + '</p>' +
        '<div class="mgp-note" id="mgp-luni-msg"></div>' +
      '</div>';
    $('mgp-luni-back').onclick = () => { luniPick = null; renderLuni(pane); };
    const btn = $('mgp-luni-buy'); if (!btn || short) return;
    btn.onclick = async () => {
      if (luniBusy) return; luniBusy = true; btn.disabled = true;
      const res = await L.buy(r.id);
      luniBusy = false;
      const msg = $('mgp-luni-msg');
      if (msg) { msg.textContent = res.msg || (res.ok ? 'Bought.' : 'Refused.'); msg.className = 'mgp-note ' + (res.ok ? 'ok' : 'bad'); }
      if (res.ok) { luniPick = null; await L.refresh(); if (app === 'luni') renderLuni(pane); }
      else btn.disabled = false;
    };
  }
  /* what I hold, and the form to put it up */
  function renderLuniSell(box, pane, L) {
    const S = L.sellable();
    const slots = L.slots();
    if (luniSell) {
      const s = luniSell;
      const isRes = s.kind === 'res';
      box.innerHTML =
        '<div class="mgp-cx-tk">' +
          '<button type="button" class="mgp-cx-back" id="mgp-luni-back">‹ Your stores</button>' +
          '<div class="mgp-cx-head"><span class="ic">' + esc(s.icon) + '</span><div><b>' + esc(s.name) + '</b><small>you hold ' + fmt(s.have) + '</small></div></div>' +
          '<div class="mgp-mv">' +
            (isRes
              ? '<label>Units per lot</label><div class="mgp-amt"><input type="number" id="mgp-luni-lotsize" min="1" step="1" inputmode="numeric" value="1"><span>per lot</span></div>' +
                '<label>How many lots</label><div class="mgp-amt"><input type="number" id="mgp-luni-lots" min="1" step="1" inputmode="numeric" value="1"><span>lots</span></div>'
              : '') +
            '<label>Price' + (isRes ? ' per lot' : '') + '</label><div class="mgp-amt"><input type="number" id="mgp-luni-price" min="1" step="1" inputmode="numeric" placeholder="0"><span>🔥</span></div>' +
            '<div class="usd" id="mgp-luni-usd"></div>' +
            '<div class="mgp-mvb"><button type="button" id="mgp-luni-list" class="mgp-btn go">🏷 List it</button></div>' +
            '<p class="mgp-hint">' + (isRes ? 'The units are held in escrow while the listing is up, and come back in full if you pull it down.' : 'The item is held while the listing is up, and comes back if you pull it down.') + '</p>' +
          '</div>' +
          '<div class="mgp-note" id="mgp-luni-msg"></div>' +
        '</div>';
      $('mgp-luni-back').onclick = () => { luniSell = null; renderLuni(pane); };
      const price = $('mgp-luni-price'), usd = $('mgp-luni-usd');
      const num = (id) => { const el = $(id); return Math.max(0, Math.floor(Number(el && el.value) || 0)); };
      const paint = () => { if (usd) { const u = L.usd(num('mgp-luni-price')); usd.textContent = u ? '≈ ' + u + ' USD' + (isRes ? ' a lot' : '') : ''; } };
      [price, $('mgp-luni-lotsize'), $('mgp-luni-lots')].forEach((el) => { if (el) { el.onkeydown = (e) => e.stopPropagation(); el.oninput = paint; } });
      paint();
      $('mgp-luni-list').onclick = async () => {
        if (luniBusy) return; luniBusy = true;
        const btn = $('mgp-luni-list'); btn.disabled = true;
        const res = await L.list({ kind: s.kind, id: s.id, price: num('mgp-luni-price'), lotSize: isRes ? num('mgp-luni-lotsize') : 0, lots: isRes ? num('mgp-luni-lots') : 1 });
        luniBusy = false;
        const msg = $('mgp-luni-msg');
        if (msg) { msg.textContent = res.msg || (res.ok ? 'Listed.' : 'Refused.'); msg.className = 'mgp-note ' + (res.ok ? 'ok' : 'bad'); }
        if (res.ok) { luniSell = null; luniTab = 'mine'; await L.refresh(); if (app === 'luni') renderLuni(pane); }
        else btn.disabled = false;
      };
      return;
    }
    const row = (x, kind) => '<div class="mgp-ldr in" data-luni-sell="' + esc(kind + ':' + x.id) + '"><span class="ic">' + esc(x.icon) + '</span>' +
      '<div class="mgp-ldb"><b>' + esc(x.name) + '</b><small>you hold ' + fmt(x.have) + '</small></div><span class="d">🏷</span></div>';
    box.innerHTML =
      (slots.used >= slots.max ? '<div class="mgp-note bad" style="padding:6px 12px">Your ' + slots.max + ' listing slots are full — pull one down first, or upgrade your Trader Membership.</div>' : '') +
      (S.resources.length ? '<div class="mgp-sub">Resources</div><div class="mgp-ldg short">' + S.resources.map((x) => row(x, 'res')).join('') + '</div>' : '') +
      (S.items.length ? '<div class="mgp-sub">Items</div><div class="mgp-ldg short">' + S.items.map((x) => row(x, 'item')).join('') + '</div>' : '') +
      (!S.resources.length && !S.items.length ? '<div class="mgp-empty">🏷<br>Nothing to sell yet.<br><small>Resources you gather and items you hold show up here.</small></div>' : '');
    box.querySelectorAll('[data-luni-sell]').forEach((el) => {
      el.onclick = () => {
        const [kind, id] = String(el.dataset.luniSell).split(':');
        const src = kind === 'res' ? S.resources : S.items;
        const x = src.find((y) => String(y.id) === id);
        if (x) { luniSell = { kind, id: x.id, name: x.name, icon: x.icon, have: x.have }; renderLuni(pane); }
      };
    });
  }
  /* my own listings, and the way back out of them */
  function renderLuniMine(box, pane, L) {
    const rows = L.mine();
    box.innerHTML = rows.length
      ? '<div class="mgp-ldg">' + rows.map((r) => '<div class="mgp-ldr out"><span class="ic">' + esc(r.icon) + '</span>' +
          '<div class="mgp-ldb"><b>' + esc(r.name) + (r.kind === 'res' && r.lotSize ? ' <i class="mgp-n">×' + fmt(r.lotSize) + '</i>' : '') + '</b>' +
          '<small>' + fmt(r.price) + ' 🔥' + (r.kind === 'res' && r.lots > 1 ? ' a lot · ' + r.lots + ' left' : '') + '</small></div>' +
          '<button type="button" class="mgp-btn" data-luni-cancel="' + esc(r.id) + '" style="padding:4px 9px;font-size:11px">Pull</button></div>').join('') + '</div>'
      : '<div class="mgp-empty">📄<br>You have nothing listed.<br><small>Put something up from the Sell tab.</small></div>';
    box.querySelectorAll('[data-luni-cancel]').forEach((b) => {
      b.onclick = async () => {
        if (luniBusy) return; luniBusy = true; b.disabled = true;
        const res = await L.cancel(b.dataset.luniCancel);
        luniBusy = false;
        await L.refresh();
        if (app === 'luni') renderLuni(pane);
        const note = $('mgp-luni-note'); if (note) note.textContent = res.msg || '';
      };
    });
  }
  function renderWall(pane) {
    const w = wallGet();
    pane.innerHTML = '<div class="mgp-wall">' +
      '<div class="mgp-wall-prev" style="' + (w ? 'background-image:url(' + w + ')' : '') + '">' + (w ? '' : '<span>No photo yet</span>') + '</div>' +
      '<div class="mgp-mvb"><button type="button" id="mgp-wall-pick" class="mgp-btn go">📷 Choose photo</button><button type="button" id="mgp-wall-clear" class="mgp-btn go" ' + (w ? '' : 'disabled') + '>Remove</button></div>' +
      '<input type="file" id="mgp-wall-file" accept="image/*" hidden>' +
      '<p class="mgp-hint">Your photo is resized to the phone and kept on this device for your account. It sits behind the home screen; apps keep their own look.</p>' +
      '<div class="mgp-note" id="mgp-wall-note"></div></div>';
    const fi = $('mgp-wall-file'), note = $('mgp-wall-note');
    $('mgp-wall-pick').onclick = () => fi.click();
    fi.onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      if (note) note.textContent = 'Preparing…';
      try { const data = await wallFromFile(f); if (!wallSet(data)) throw new Error('This device is out of storage for the photo.'); paintWall(); renderWall(pane); }
      catch (err) { if (note) note.textContent = (err && err.message) || 'Could not use that photo.'; }
    };
    $('mgp-wall-clear').onclick = () => { wallSet(''); paintWall(); renderWall(pane); };
  }

  /* ── open / close ── */
  function openPhone(which) {
    ensureDom();
    open = true;
    const w = $('mgphone'); w.classList.add('open'); w.setAttribute('aria-hidden', 'false');
    paintStatus(); paintHome(); paintWall();
    clearInterval(clockT); clockT = setInterval(() => { paintStatus(); if (!app) paintHome(); }, 15000);
    if (which) openApp(which); else home();
    return true;
  }
  function close() {
    if (!open) return false;
    if (app === 'chat') leaveChat();
    open = false; app = null;
    clearInterval(clockT); clockT = null;
    const w = $('mgphone'); if (w) { w.classList.remove('open'); w.setAttribute('aria-hidden', 'true'); }
    try { const n = notify(); if (n && n.close) n.close(); } catch (e) {}
    return true;
  }

  const CSS = [
    '#mgphone{display:none;position:fixed;inset:0;z-index:2147483380;background:rgba(4,3,10,.76);align-items:center;justify-content:center;padding:18px 14px 24px;}',
    '#mgphone.open{display:flex;}',
    '#mgp-shell{--ph:min(860px,calc(100vh - 44px));position:relative;flex:0 0 auto;height:var(--ph);width:min(94vw,calc(var(--ph) * 9 / 19.5));border-radius:56px;padding:11px;box-sizing:border-box;',
      'background:linear-gradient(148deg,#e9ecef 0%,#a7adb5 12%,#5c6169 34%,#3d4147 52%,#6f757d 74%,#c9ced4 92%,#8e949c 100%);',
      'box-shadow:0 40px 110px rgba(0,0,0,.82),inset 0 0 0 1.5px rgba(255,255,255,.22),inset 0 1px 2px rgba(255,255,255,.5),inset 0 -1px 2px rgba(0,0,0,.55);animation:mgprise .22s cubic-bezier(.2,.9,.3,1);}',
    '@keyframes mgprise{from{transform:translateY(14px) scale(.985);}to{transform:none;}}',
    '@media (prefers-reduced-motion: reduce){#mgp-shell{animation:none;}}',
    '#mgp-shell .mgp-vol,#mgp-shell .mgp-pwr{position:absolute;left:-2.5px;width:3.5px;border-radius:3px;background:linear-gradient(90deg,#8f959d,#4a4e55 55%,#2b2e33);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 1px 2px rgba(0,0,0,.5);}',
    '#mgp-shell .mgp-vol.up{top:150px;height:52px;}#mgp-shell .mgp-vol.dn{top:212px;height:52px;}#mgp-shell .mgp-pwr{left:auto;right:-2.5px;top:186px;height:86px;}',
    '#mgp-screen{height:100%;display:flex;flex-direction:column;overflow:hidden;border-radius:46px;position:relative;color:#e8e0d0;font-family:"Crimson Text",Georgia,serif;',
      'background:radial-gradient(120% 60% at 50% 0%,rgba(212,175,55,.16),transparent 60%),radial-gradient(80% 50% at 80% 100%,rgba(138,92,255,.16),transparent 60%),linear-gradient(180deg,#151210,#080706);box-shadow:inset 0 0 0 1px rgba(212,175,55,.18);}',
    '#mgp-screen .mgp-notch{position:absolute;left:50%;top:0;transform:translateX(-50%);width:52%;max-width:170px;height:26px;background:#000;z-index:6;pointer-events:none;border-radius:0 0 18px 18px;display:flex;align-items:center;justify-content:center;gap:9px;}',
    '#mgp-screen .mgp-notch .spk{width:34px;height:4px;border-radius:3px;background:linear-gradient(180deg,#1e1f22,#111);}#mgp-screen .mgp-notch .cam{width:7px;height:7px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#2b3a52,#0a0d14 70%);box-shadow:inset 0 0 0 1px rgba(90,120,170,.35);}',
    '#mgp-status{flex:none;height:44px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 5px;font-size:10.5px;color:#b8ac96;font-variant-numeric:tabular-nums;letter-spacing:.03em;}',
    '#mgp-status .mgp-clk{font-weight:700;color:#e8dcc0;}#mgp-status .mgp-sysr{display:flex;align-items:center;gap:5px;}#mgp-sig{font-size:9px;letter-spacing:-1px;}',
    '#mgp-status .mgp-batt{display:inline-block;width:20px;height:9px;border-radius:2px;border:1px solid rgba(255,255,255,.35);padding:1px;position:relative;}#mgp-status .mgp-batt::after{content:"";position:absolute;right:-3px;top:2.5px;width:2px;height:3px;background:rgba(255,255,255,.35);}',
    '#mgp-status .mgp-batt > i{display:block;height:100%;background:#7fd3a4;border-radius:1px;}#mgp-status .mgp-batt.low > i{background:#ff7a2f;}#mgp-status .mgp-bp{font-size:9.5px;color:#9d907a;}',
    '#mgp-home{flex:1;display:flex;flex-direction:column;padding:8px 18px 12px;min-height:0;}#mgp-home[hidden]{display:none;}',
    '#mgp-home.has-wall .mgp-date,#mgp-home.has-wall .mgp-lbl{text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 8px rgba(0,0,0,.6);}#mgp-home.has-wall .mgp-hint{color:#c9bfa8;text-shadow:0 1px 3px rgba(0,0,0,.9);}',
    '.mgp-wall{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;}.mgp-wall-prev{aspect-ratio:9/16;max-height:52%;border-radius:18px;border:1px solid rgba(212,175,55,.35);background:#0a0806 center/cover no-repeat;display:grid;place-items:center;color:#9d907a;font-size:12px;}',
    '#mgp-home .mgp-date{text-align:center;font-family:Cinzel,Georgia,serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#d9b45a;margin:6px 0 18px;}',
    '#mgp-home .mgp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 8px;align-content:start;}',
    '.mgp-appbtn{background:none;border:0;padding:0;cursor:pointer;color:#e8e0d0;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:6px;transition:transform .12s;}.mgp-appbtn:active{transform:scale(.92);}.mgp-appbtn:focus-visible{outline:2px solid #7fb8ff;outline-offset:3px;border-radius:14px;}',
    '.mgp-ico{position:relative;width:58px;height:58px;border-radius:16px;display:grid;place-items:center;font-size:28px;line-height:1;background:linear-gradient(160deg,color-mix(in srgb,var(--hue) 55%,#1a1712),color-mix(in srgb,var(--hue) 22%,#0c0a08));border:1px solid color-mix(in srgb,var(--hue) 60%,transparent);box-shadow:0 6px 16px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.14);}',
    '.mgp-badge{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#e0324b;color:#fff;font:800 10px/19px Georgia,serif;font-style:normal;text-align:center;border:1.5px solid #120c0c;}',
    '.mgp-lbl{font-size:11px;letter-spacing:.02em;color:#e8dcc0;}',
    '#mgp-home .mgp-hint{margin-top:auto;text-align:center;font-size:10px;color:#6f6656;padding-bottom:4px;}',
    '#mgp-app{flex:1;display:flex;flex-direction:column;min-height:0;}#mgp-app[hidden]{display:none;}',
    '#mgp-app .mgp-bar{flex:none;display:flex;align-items:center;gap:8px;padding:4px 12px 9px;border-bottom:1px solid rgba(212,175,55,.26);background:linear-gradient(180deg,rgba(212,175,55,.08),transparent);}',
    '#mgp-back,#mgp-x{flex:none;cursor:pointer;background:rgba(255,255,255,.05);border:1px solid rgba(212,175,55,.4);color:#e8dcc0;border-radius:6px;padding:4px 9px;font-size:13px;line-height:1;}#mgp-back{font-size:18px;padding:1px 10px 3px;}#mgp-back:hover,#mgp-x:hover{background:rgba(212,175,55,.16);color:#ffd166;}',
    '#mgp-app .mgp-ttl{flex:1;min-width:0;}#mgp-app .mgp-ttl b{display:block;font-family:Cinzel,Georgia,serif;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#f0d68f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}#mgp-app .mgp-ttl small{display:block;font-size:9.5px;color:#9d907a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#mgp-pane{flex:1;min-height:0;position:relative;display:flex;flex-direction:column;overflow:hidden;}',
    '.mgp-notif{flex:1;overflow-y:auto;padding:8px 10px;}.mgp-notif .notif-row{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);}.mgp-notif .notif-text{font-size:13px;line-height:1.4;}.mgp-notif .notif-when{font-size:10px;color:#9d907a;margin-top:2px;}.mgp-notif .notif-empty{padding:1.2rem;text-align:center;color:#9d907a;font-size:13px;line-height:1.5;}',
    '.mgp-foot{flex:none;padding:8px 12px;border-top:1px solid rgba(212,175,55,.2);display:flex;justify-content:flex-end;align-items:center;gap:8px;}.mgp-btn{cursor:pointer;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.45);color:#f0d68f;border-radius:6px;padding:5px 12px;font-family:inherit;font-size:12px;}.mgp-btn:hover{background:rgba(212,175,55,.22);}',
    '.mgp-note{font-size:10px;color:#9d907a;flex:1;}',
    '.mgp-chat-host{position:absolute;inset:0;}.mgp-chat-host #chat-overlay{font-size:13px;}',
    '.mgp-empty{padding:2rem 1.2rem;text-align:center;color:#c9bfa8;font-size:14px;line-height:1.6;}.mgp-empty small{display:block;margin-top:6px;color:#9d907a;font-size:11px;}',
    '.mgp-feed{flex:1;overflow-y:auto;padding:6px 8px;}.mgp-post{display:flex;gap:8px;padding:9px 6px;border-bottom:1px solid rgba(255,255,255,.06);}',
    '.mgp-av{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font:700 11px Cinzel,Georgia,serif;color:#1a1408;background:hsl(var(--h,210) 55% 62%);}.mgp-av.ico{background:rgba(255,255,255,.08);font-size:16px;}',
    '.mgp-pb{flex:1;min-width:0;}.mgp-ph{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;}.mgp-ph b{color:#f0d68f;font-size:13px;}.mgp-ph small{color:#9d907a;font-size:10px;}.mgp-ph .mgp-when{margin-left:auto;font-size:10px;color:#6f6656;}',
    '.mgp-body{font-size:12.5px;line-height:1.45;color:#e8e0d0;margin-top:2px;}.mgp-tag{color:#ff9a5c;}.mgp-post.good .mgp-tag{color:#7fd3a4;}',
    '.mgp-pf{display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:#9d907a;}.mgp-likes{color:#c9bfa8;}',
    '#mgp-homebar{flex:none;height:26px;background:none;border:0;cursor:pointer;display:grid;place-items:center;padding:0;}#mgp-homebar > i{display:block;width:36%;height:5px;border-radius:3px;background:rgba(232,220,192,.55);transition:background .15s,transform .15s;}#mgp-homebar:hover > i{background:#ffd166;transform:scaleX(1.1);}#mgp-homebar:focus-visible{outline:2px solid #7fb8ff;outline-offset:-4px;border-radius:12px;}',
    '#mgphone button:focus-visible{outline:2px solid #7fb8ff;outline-offset:2px;}',
    /* 📒 ledger + 🏦 bank */
    '.mgp-ldg-head,.mgp-bank-head{flex:none;padding:10px 14px 8px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid rgba(212,175,55,.2);background:linear-gradient(180deg,rgba(212,175,55,.06),transparent);}',
    '.mgp-bal small{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#9d907a;}.mgp-bal b{display:block;font-family:Cinzel,Georgia,serif;font-size:20px;color:#ffd166;line-height:1.15;}.mgp-bal.big b{font-size:26px;}.mgp-bal i{display:block;font-style:normal;font-size:11px;color:#c9bfa8;margin-top:2px;}',
    '.mgp-sums{display:flex;gap:10px;font-size:11px;}.mgp-sums .in{color:#7fd3a4;}.mgp-sums .out{color:#ff8c75;}',
    '.mgp-seg{flex:none;display:flex;margin:8px 12px 4px;border:1px solid rgba(212,175,55,.3);border-radius:8px;overflow:hidden;}.mgp-seg button{flex:1;background:none;border:0;border-right:1px solid rgba(212,175,55,.2);color:#9d907a;padding:6px 4px;font-family:inherit;font-size:11.5px;cursor:pointer;}.mgp-seg button:last-child{border-right:0;}.mgp-seg button.on{background:rgba(212,175,55,.16);color:#ffd166;}',
    '.mgp-ldg{flex:1;overflow-y:auto;padding:4px 10px 8px;}.mgp-ldg.short{flex:none;max-height:190px;}.mgp-ldr{display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.06);}.mgp-ldr .ic{flex:none;width:26px;text-align:center;font-size:15px;}',
    '.mgp-ldb{flex:1;min-width:0;}.mgp-ldb b{display:block;font-size:12.5px;color:#e8e0d0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.mgp-ldb small{display:block;font-size:10px;color:#9d907a;}',
    '.mgp-n{font-style:normal;font-weight:600;opacity:.65;font-size:11px;margin-left:4px;}.mgp-ldr .d{flex:none;font-family:Cinzel,Georgia,serif;font-size:13px;font-variant-numeric:tabular-nums;}.mgp-ldr.in .d{color:#7fd3a4;}.mgp-ldr.out .d{color:#ff8c75;}.mgp-ldr.sync .d{opacity:.75;}',
    '.mgp-bank{flex:1;overflow-y:auto;padding:6px 12px 10px;}.mgp-mv label{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#9d907a;margin:4px 0 4px;}',
    '.mgp-amt{display:flex;align-items:center;gap:6px;background:#0a0806;border:1px solid rgba(212,175,55,.4);border-radius:8px;padding:4px 10px;}.mgp-amt input{flex:1;min-width:0;background:none;border:0;color:#ffd166;font-family:Cinzel,Georgia,serif;font-size:20px;outline:none;}.mgp-amt input::-webkit-outer-spin-button,.mgp-amt input::-webkit-inner-spin-button{-webkit-appearance:none;}.mgp-amt span{font-size:18px;}',
    '.mgp-quick{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;}.mgp-quick button{cursor:pointer;background:rgba(255,255,255,.05);border:1px solid rgba(212,175,55,.3);color:#c9bfa8;border-radius:12px;padding:3px 9px;font-family:inherit;font-size:10.5px;}.mgp-quick button:hover{color:#ffd166;border-color:#d4af37;}',
    '.mgp-mv .usd{font-size:12px;color:#9be0c4;margin-top:4px;}.mgp-ldr button.mgp-btn{flex:none;}' +
    '.mgp-cx-body{flex:1;display:flex;flex-direction:column;min-height:0;}.mgp-cx-search{padding:6px 12px 2px;}.mgp-cx-search input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(47,184,166,.4);border-radius:8px;color:#e9e3f7;padding:7px 10px;font-size:13px;}' +
    '.mgp-cx-d{font-size:10.5px;font-weight:700;}.mgp-cx-d.up{color:#3fd08a}.mgp-cx-d.down{color:#ff6b6b}.mgp-ldr .d small{display:block;font-size:10px;opacity:.75}' +
    '.mgp-cx-tk{padding:8px 12px;overflow-y:auto;}.mgp-cx-back{background:none;border:0;color:#7fd6c9;font-size:12px;padding:0 0 6px;cursor:pointer;}.mgp-cx-head{display:flex;gap:10px;align-items:center;}.mgp-cx-head .ic{font-size:26px}.mgp-cx-head small{display:block;font-size:10.5px;opacity:.7}' +
    '.mgp-cx-px{display:flex;align-items:baseline;gap:10px;margin:8px 0 4px;font-family:Cinzel,Georgia,serif;font-size:18px;}.mgp-cx-spark{display:block;width:100%;height:56px;margin:2px 0 6px;background:rgba(0,0,0,.25);border-radius:6px;}.mgp-cx-pos{font-size:11.5px;opacity:.85;margin-bottom:6px;}.mgp-note.ok{color:#3fd08a}.mgp-note.bad{color:#ff8c75}' +
    '.mgp-mvb{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;}.mgp-btn.go{padding:9px 6px;font-size:13px;font-weight:700;}.mgp-btn:disabled{opacity:.5;cursor:default;}',
    '.mgp-hint{font-size:10.5px;line-height:1.5;color:#9d907a;margin:8px 0 4px;}.mgp-hint b{color:#ffb070;}.mgp-sub{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#d9b45a;margin:10px 0 2px;}',
    '.mgp-vault-sum{font-size:11.5px;color:#c9bfa8;line-height:1.5;padding:4px 0 8px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px;}.mgp-vault-sum b{color:#ffd166;}',
    '.mgp-vr{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);}.mgp-vr .ic{flex:none;width:24px;text-align:center;font-size:15px;}.mgp-vq{width:58px;flex:none;background:#0a0806;border:1px solid rgba(212,175,55,.35);border-radius:6px;color:#ffd166;padding:4px 6px;font-family:inherit;font-size:12px;}',
    '.mgp-vr button{flex:none;cursor:pointer;width:30px;height:28px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.45);color:#f0d68f;border-radius:6px;font-size:13px;}.mgp-vr button:disabled{opacity:.35;cursor:default;}',
  ].join('\n');

  window.MythicHandset = {
    open: (which) => openPhone(which), close, home,
    isOpen: () => open, app: () => app,
    apps: () => APPS.map((a) => ({ id: a.id, name: a.name, badge: badgeOf(a.id) })),
    wallpaper: { get: wallGet, set: (v) => { const ok = wallSet(v); paintWall(); return ok; } },
    feed: readFeed,
    refresh: () => { if (!open) return; paintStatus(); if (!app) paintHome(); else if (app === 'notif') { const n = notify(); try { n && n.render && n.render(); } catch (e) {} } else if (app === 'ledger' || app === 'bank') { const pane = $('mgp-pane'); if (pane && !bankBusy) (app === 'ledger' ? renderLedger : renderBank)(pane); } },
  };
})();
