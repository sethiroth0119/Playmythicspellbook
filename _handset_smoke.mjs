/* 📱 THE HANDSET — the bell is a phone.

   Asked for: "Change this button to Phone, with the phone modal from the
   city builder; add the chat in the phone; turn the tabs into apps and make
   the phone look and act like a real cell phone."

   What this file defends, headless:
     · the module loads in a sandbox with a fake DOM and registers
       window.MythicHandset with the three apps;
     · the Broadcast app reads the city's saved feed (newest save, posts
       newest first, unread against the saved read-mark) and survives junk;
     · the seams the module reads exist in index.html (MythicNotify.render /
       markRead / clear, MythicChatSeam, chatOpen / chatClose);
     · the bell is the phone button and notifOpen routes into the handset;
     · the script tag rides the build version.

   Run: node _handset_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const MOD = readFileSync('./public/src/phone/handset.js', 'utf8');

console.log('\n=== 1. the module, in a sandbox ===');
{
  /* a fake DOM: enough for ensureDom / paint to run */
  const els = {};
  const mkEl = (tag) => {
    const el = { tag, id: '', className: '', hidden: false, style: {}, children: [], attrs: {}, listeners: {}, _html: '',
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; }, getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentElement = this; if (c.id) els[c.id] = c; return c; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      querySelectorAll() { return []; }, querySelector() { return null; },
      animate() { return {}; }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; const re = /id="([^"]+)"/g; let m; while ((m = re.exec(v))) { if (!els[m[1]]) { const c = mkEl('div'); c.id = m[1]; c.parentElement = this; els[m[1]] = c; } } },
      get firstChild() { return this.children[0] || { style: {}, innerHTML: '' }; }, get textContent() { return this._html; }, set textContent(v) { this._html = String(v); },
    };
    return el;
  };
  const body = mkEl('body'), head = mkEl('head');
  const document = { body, head, getElementById: (id) => els[id] || null, createElement: (t) => mkEl(t), addEventListener() {} };
  const store = {};
  const localStorage = { get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i], getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const window = { MythicNotify: { state: () => ({ unread: 3 }), render() { this.rendered = true; }, markRead() { this.read = true; }, clear() { this.cleared = true; } }, MythicChatSeam: { unread: () => 2 } };
  const ctx = { window, document, localStorage, navigator: { onLine: true }, setInterval: () => 1, clearInterval() {}, Date, Number, Math, String, Array, Object, JSON, console, MutationObserver: class { observe() {} disconnect() {} } };
  ctx.window.document = document; ctx.window.localStorage = localStorage;
  vm.createContext(ctx);
  let err = null;
  try { vm.runInContext(MOD, ctx); } catch (e) { err = String(e && e.stack || e); }
  ok(!err, 'the module evaluates in a sandbox without throwing', err);
  const H = ctx.window.MythicHandset;
  ok(!!H && typeof H.open === 'function' && typeof H.close === 'function' && typeof H.home === 'function', 'window.MythicHandset registers open / close / home');
  const apps = H ? H.apps() : [];
  ok(apps.map((a) => a.id).join() === 'notif,chat,bcast,ledger,bank,cx,luni,merc,mayor,board,wall', 'eleven apps: Notifications, Chat, Broadcast, Ledger, Bank of Ethos, Crash Exchange, Luni, Mercenaries, Mayor, Leaderboards, Wallpaper', apps.map((a) => a.id).join());
  ok(apps[0].badge === 3 && apps[1].badge === 2, 'the home badges read the notification and chat seams (3 and 2)');
  ok(H.feed() === null, 'no city save → no feed, no throw');
  store['mythic_node_city_v2:old'] = JSON.stringify({ savedAt: 100, ext: { broadcast: { r: 0, p: [{ i: 'b1', q: 1, t: 1, n: 'Old Poster', b: 'old body' }] } } });
  store['mythic_node_city_v2:new'] = JSON.stringify({ savedAt: 200, ext: { broadcast: { r: 1, p: [{ i: 'b1', q: 1, t: 1, n: 'Tam Fallow', b: 'no #patrols' }, { i: 'b2', q: 2, t: 2, n: 'Water Department', k: 'dept', b: '#water demand exceeds capacity' }, { junk: true }] } } });
  const f = H.feed();
  ok(f && f.rows.length === 2 && f.rows[0].n === 'Water Department' && f.unread === 1, 'the newest save wins, posts come newest first, junk rows are dropped, unread counts past the read-mark', f && JSON.stringify({ n: f.rows.length, first: f.rows[0] && f.rows[0].n, unread: f.unread }));
  let opened = false;
  try { opened = H.open('notif'); } catch (e) { err = String(e && e.stack || e); }
  ok(opened === true && !err && H.isOpen() && H.app() === 'notif', 'open(\'notif\') builds the device and lands on the Notifications app', err);
  ok(ctx.window.MythicNotify.rendered === true && ctx.window.MythicNotify.read === true, 'the Notifications app paints through the seam and marks everything read');
  ok(!!els['notif-list'] && !!els['mgp-homebar'] && !!els['mgp-status'] && !!els['mgp-grid'], 'the screen has a status bar, a home grid, the notification list and a home bar');
  H.home();
  ok(H.app() === null && H.isOpen(), 'the home bar returns to the app grid without closing the phone');
  ok(H.close() === true && !H.isOpen(), 'close() puts the phone away');

  /* 📒🏦 the Ledger and Bank apps read window.MythicBank; with no seam they say so, with one they paint */
  H.open('ledger');
  ok(H.app() === 'ledger' && /not available on this build/.test(els['mgp-pane'].innerHTML), 'Ledger with no bank seam: a message, not a throw');
  H.close();
  const calls = [];
  ctx.window.MythicBank = {
    state: () => ({ signedIn: true, ready: true, err: '', extCols: true, balance: 5000, aza: 3, walletCinder: 1200, walletAza: 1, vaultUsed: 40, vaultCap: 15500, depositFee: 500, resources: [{ id: 'metal', name: 'Metal', icon: '⛓️', have: 12, banked: 40 }], bankLedger: [{ t: 1, kind: 'deposit', cinder: 500, aza: 0, note: 'Cinder deposit to bank' }], handle: 'seth' }),
    ledger: () => [{ t: 2, d: -300, r: 'Pack Shop', k: 'spend', b: 1200 }, { t: 1, d: 800, r: 'Battle won', k: 'gain', b: 1500 }],
    serverLedger: async () => ({ ok: true, rows: [] }),
    ensure: async () => true,
    deposit: async (n) => { calls.push(['deposit', n]); return true; }, withdraw: async (n) => { calls.push(['withdraw', n]); return true; },
    depositAza: async () => true, withdrawAza: async () => true, depositRes: async () => true, withdrawRes: async () => true, openFull: () => true,
  };
  H.open('ledger');
  const lh = els['mgp-pane'].innerHTML;
  ok(/🔥 1,200/.test(lh) && /\+800 received/.test(lh) && /−300 spent/.test(lh), 'Ledger: wallet balance, received and spent sums', lh.slice(0, 200));
  ok(/mgp-ldg/.test(lh) && /data-lm="server"/.test(lh), 'Ledger: a list and a Server audit switch');
  H.open('bank');
  const bh = els['mgp-pane'].innerHTML;
  ok(/🔥 5,000/.test(bh) && /@seth/.test(bh) && /👑 3 Aza/.test(bh) && /vault 40 \/ 15,500/.test(bh), 'Bank: account balance, handle, Aza and vault fill', bh.slice(0, 300));
  ok(/data-bt="cinder"/.test(bh) && /data-bt="aza"/.test(bh) && /data-bt="vault"/.test(bh), 'Bank: Cinder, Aza and Vault drawers');
  const bx = els['mgp-bank'] ? els['mgp-bank'].innerHTML : '';
  ok(/id="mgp-dep"/.test(bx) && /id="mgp-wd"/.test(bx) && /id="mgp-amt"/.test(bx), 'Bank: an amount field with Deposit and Withdraw', bx.slice(0, 120));
  H.close();
}

console.log('\n=== 1a. the wallpaper ===');
{
  ok(/wallKey = \(\) => \{[^\n]*'mythic_phone_wall:' \+ u/.test(MOD), 'the wallpaper is kept per account on the device');
  ok(/const MW = 540, MH = 1170;/.test(MOD) && /toDataURL\('image\/jpeg', q\)/.test(MOD) && /out\.length > 380000 && q > 0\.4/.test(MOD), 'a photo is shrunk to the screen and re-encoded until it fits');
  ok(/function paintWall\(\)/.test(MOD) && /home\.classList\.toggle\('has-wall', !!w\)/.test(MOD) && /paintStatus\(\); paintHome\(\); paintWall\(\);/.test(MOD), 'the home screen paints the wallpaper when the phone opens');
  ok(/id="mgp-wall-pick"/.test(MOD) && /id="mgp-wall-clear"/.test(MOD) && /accept="image\/\*"/.test(MOD), 'Wallpaper app: choose a photo, remove it');
}

console.log('\n=== 1b. the bank seam and the wallet ledger in index.html ===');
{
  ok(/window\.MythicBank = \{/.test(SRC) && /deposit:\s+async \(n\) => \{ try \{ return !!\(await boeDeposit\(n\)\); \}/.test(SRC) && /withdrawRes: async \(id, n\) => \{ try \{ return !!\(await boeWithdrawRes\(id, n\)\); \}/.test(SRC), 'MythicBank forwards to the Bank of Ethos functions (no rule of its own)');
  ok(/function spendGems\(amount, reason\) \{[\s\S]{0,400}_cinderLedgerAdd\(-amount, reason \|\| \('Spent in ' \+ _ledgerScreenLabel\(\)\), 'spend'\)/.test(SRC), 'spendGems writes a ledger row with the reason (or the screen)');
  ok(/function addGems\(amount, reason\) \{[\s\S]{0,300}_cinderLedgerAdd\(amount, reason && reason !== 'addGems' \? reason : \('Received in ' \+ _ledgerScreenLabel\(\)\)/.test(SRC), 'addGems writes a ledger row');
  ok(/_ledgerWhy\(dir === 'deposit' \? 'Bank of Ethos deposit' : 'Bank of Ethos withdrawal'/.test(SRC), 'bank deposit / withdrawal are booked in the wallet ledger by the write itself');
  ok(/function _cinderLedgerTick\(\)/.test(SRC) && /setInterval\(_cinderLedgerTick, 4000\)/.test(SRC), 'a tick books direct Profile.gems writes as sync rows');
  ok(/'mythic_cinder_ledger:' \+ \(\(Profile\.cloud && Profile\.cloud\.userId\) \|\| 'guest'\)/.test(SRC) && /if \(_cl\.rows\.length > 400\) _cl\.rows\.length = 400;/.test(SRC), 'the ledger is per account on the device, capped at 400 rows');
  ok(/rpc\('get_my_ledger', \{ p_limit: 200 \}\)/.test(SRC) && /x\.resource === 'cinder'/.test(SRC), 'the server audit reads wallet_ledger cinder rows');
}

console.log('\n=== 2. the wiring in index.html ===');
{
  ok(/b\.setAttribute\('aria-label', 'Phone'\);\s*b\.title = 'Phone — notifications, chat, broadcast';\s*b\.innerHTML = '<span class="notif-bell-ico">📱<\/span>/.test(SRC), 'the bell button is the phone button');
  ok(/if \(window\.MythicHandset && typeof window\.MythicHandset\.open === 'function'\) \{\s*_notif\.unread = 0; _notifPaint\(\);\s*if \(window\.MythicHandset\.open\('notif'\)\) return;/.test(SRC), 'notifOpen routes into the handset, with the old modal as the fallback');
  ok(/render: \(\) => \{ try \{ _notifRender\(\); \} catch \(e\) \{\} \},\s*markRead: \(\) => \{ _notif\.unread = 0; _notifPaint\(\); \},\s*clear: \(\) => \{ _notif\.list\.length = 0;/.test(SRC), 'MythicNotify exposes render / markRead / clear for the phone');
  ok(/window\.MythicChatSeam = \{ unread: \(\) => \(Chat\.unread \| 0\), open: \(\) => !!Chat\.open, view: \(\) => Chat\.view \};/.test(SRC), 'the chat seam exposes the unread count');
  ok(/^function chatOpen\(\)/m.test(SRC) && /^function chatClose\(\)/m.test(SRC), 'chatOpen / chatClose are function declarations (reachable from the module)');
  ok(/const el = old \|\| document\.createElement\('div'\);\s*el\.id = 'chat-overlay';\s*if \(!old\) el\.style\.cssText/.test(SRC), 'the chat overlay reuses its element and only styles it on first build — so the phone\'s geometry sticks across re-renders');
  ok(/<script src="src\/phone\/handset\.js\?v=v12\dv\d+" defer><\/script>/.test(SRC), 'the module rides a build-versioned script tag');
  const tag = (SRC.match(/handset\.js\?v=(v12\dv\d+)/) || [])[1], ver = (SRC.match(/window\.BUILD_VERSION = '(v12\dv\d+)'/) || [])[1];
  ok(tag && tag === ver, 'and that version is the build version (' + ver + ')', tag);
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
