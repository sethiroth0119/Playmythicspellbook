/* 🪙 AZA IN THE WALLET LEDGERS — the phone 📒 Ledger and the Bank of Ethos Ledger.

   Asked for: "Add AZA coin to the phone ledger and bank ledger, show when AZA
   coin is added or spent."

   What this file defends, headless:
     1. /src/azahistory walletRows(): a player's wallet_ledger 'sovereigns' rows
        become display rows labelled by the SAME classify() the AZA history uses
        (Grimalkin Lord's real reasons, read-only 2026-09-18, Stripe session ids
        replaced), with the balance-after kept, newest first; Cinder rows that
        slip in are dropped; walletTotals() counts AZA only.
     2. walletLedger(): the direct own-row select (resource = 'sovereigns'),
        the get_my_ledger() fallback marked incomplete, and 'signin' offline.
     3. the phone, in a vm sandbox: the header carries 🪙 AZA beside 🔥 Cinder,
        the AZA sums are their own line, AZA rows carry 🪙 + "after 🪙 N" +
        "AZA", and the All / Cinder / AZA filter shows exactly one currency.
     4. the Bank of Ethos PageLedger, compiled with esbuild and called with a
        stub React: wallet AZA rows appear with the AZA glyph, sign and
        balance-after, and the filter works.
     5. the wiring in index.html / Bank of Ethos.html.
   NEGATIVE CONTROLS: the pre-change phone read (get_my_ledger filtered to
   resource === 'cinder') loses every AZA row, and folding AZA into the Cinder
   sums would change them — the new code must do neither.

   Run: node _azaledger_smoke.mjs */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import vm from 'vm';
import { transformSync } from 'esbuild';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

const AZA_SRC = readFileSync('./public/src/azahistory/index.js', 'utf8');
const PHONE = readFileSync(process.env.AZALEDGER_PHONE || './public/src/phone/handset.js', 'utf8');   // env: mutation runs
const SRC = readFileSync('./public/index.html', 'utf8');
const JSX = readFileSync(process.env.AZALEDGER_JSX || './public/ethos/app.jsx', 'utf8');
const BOE = readFileSync('./public/ethos/Bank of Ethos.html', 'utf8');
const TMP = mkdtempSync(join(tmpdir(), 'azaledger-'));
let seq = 0;
async function load(win) {
  const f = join(TMP, 'm' + (++seq) + '.mjs');
  writeFileSync(f, AZA_SRC);
  if (win) globalThis.window = win; else delete globalThis.window;
  const m = await import(pathToFileURL(f).href);
  delete globalThis.window;
  return m;
}

/* Grimalkin Lord's real AZA rows (production, read-only), newest first as the
   select returns them; session ids replaced. */
const L = (t, d, b, r, res) => ({ created_at: t, delta: d, balance_after: b, reason: r, resource: res || 'sovereigns' });
const GRIM = [
  L('2026-09-17T13:20:01.906Z', -120, 94, 'aza spend'),
  L('2026-09-17T13:19:13.770Z', 150, 214, 'Aza pack purchase cs_test_REPLACED_4'),
  L('2026-09-17T12:43:47.196Z', -120, 64, 'aza spend'),
  L('2026-09-17T12:39:26.820Z', 150, 184, 'Aza pack purchase cs_test_REPLACED_3'),
  L('2026-09-17T09:50:05.570Z', -125, 34, 'trader membership: Market Tycoon'),
  L('2026-09-17T09:41:57.300Z', 150, 159, 'Aza pack purchase cs_test_REPLACED_2'),
  L('2026-09-09T10:03:01.561Z', -10, 9, 'Warehouse: open storage unit space'),
  L('2026-09-09T09:28:09.655Z', -25, 39, 'Warehouse: upgrade to Sheet-Metal Warehouse'),
  L('2026-09-09T09:27:49.612Z', -30, 64, 'Warehouse: Forklift'),
  L('2026-09-09T07:20:16.202Z', -60, 94, 'Secret Stash — Anomalous Fold'),
  L('2026-09-09T07:19:36.497Z', 150, 154, 'Aza pack purchase cs_test_REPLACED_1'),
  L('2026-09-05T21:21:31.536Z', 2, 4, 'Aza reward: cv_recruit'),
  L('2026-09-05T21:21:31.525Z', 1, 2, 'Aza reward: cv_resource'),
  L('2026-08-26T13:55:32.697Z', -35, 0, 'trader membership: Professional Trader'),
  L('2026-08-23T13:53:45.138Z', 5, 35, 'Aza gift claim'),
];
/* what get_my_ledger() hands back: every resource, Cinder dominating */
const MIXED = [
  L('2026-09-17T13:25:00.000Z', -5000, 65499, 'Resource Market: Buy livestock', 'cinder'),
  ...GRIM.slice(0, 3),
  L('2026-09-17T12:00:00.000Z', 12000, 70499, 'Battle won', 'cinder'),
  L('2026-09-17T11:00:00.000Z', 3, null, 'metal', 'user_resources'),
];

console.log('\n=== 1. walletRows / walletTotals (pure) ===');
const M = await load(null);
{
  ok(typeof M.walletRows === 'function' && typeof M.walletTotals === 'function' && typeof M.walletLedger === 'function' && typeof M.cachedWalletRows === 'function', 'azahistory exports walletRows, walletTotals, walletLedger, cachedWalletRows');
  const rows = M.walletRows(GRIM.slice().reverse());
  ok(rows.length === GRIM.length && rows.every((r) => r.cur === 'aza'), 'every AZA row kept, every one tagged cur: aza', rows.length);
  ok(rows[0].t > rows[1].t && rows[0].d === -120 && rows[0].b === 94, 'newest first, with the balance after (🪙 94 after the last spend)', JSON.stringify(rows[0]));
  const lab = (i) => rows[i].r;
  ok(lab(1) === 'Purchase — 150 AZA pack' && !/cs_test/.test(lab(1)), 'pack purchase is labelled by classify(), without the Stripe session id', lab(1));
  ok(lab(0) === 'Spent (item not recorded)', '"aza spend" reads as a spend with no item recorded', lab(0));
  ok(lab(4) === 'Trader membership — Market Tycoon' && lab(7) === 'Warehouse upgrade — Sheet-Metal Warehouse' && lab(6) === 'Warehouse storage space' && lab(9) === 'Secret Stash — Anomalous Fold', 'membership, warehouse and stash spends read in plain words');
  ok(lab(11) === 'Reward — Covert mission: Recruitment Drive' && lab(12) === 'Reward — Covert mission: Resource Run' && lab(14) === 'Gift claim', 'rewards and gift claims read in plain words');
  ok(rows.every((r) => r.r === M.classify(GRIM.find((g) => Date.parse(g.created_at) === r.t).reason, r.d, null).label), 'every label IS classify()\'s — one mapping, not a copy');
  const mixed = M.walletRows(MIXED);
  ok(mixed.length === 3 && mixed.every((r) => r.cur === 'aza'), 'Cinder and resource rows handed to walletRows are dropped', mixed.length);
  const t = M.walletTotals(rows);
  ok(t.in === 608 && t.out === 525, 'AZA totals: +608 received, −525 spent', JSON.stringify(t));
  ok(M.walletTotals([{ d: 5000, cur: undefined }, { d: -300 }]).in === 0, 'walletTotals ignores Cinder rows');
  const tn = M.walletTotals(rows.concat([{ t: 1, d: 99999, r: 'Cinder', cur: 'cinder' }]));
  ok(tn.in === 608, 'NEGATIVE CONTROL: a Cinder row in the list does not reach the AZA totals', JSON.stringify(tn));
}

console.log('\n=== 2. walletLedger() — own-row select, fallback, offline ===');
{
  const calls = [];
  const mkClient = (selErr, rpcData) => ({
    from(tbl) {
      const q = { _: [['from', tbl]] };
      const chain = ['select', 'eq', 'order', 'limit'];
      chain.forEach((k) => { q[k] = (...a) => { q._.push([k, ...a]); return q; }; });
      q.then = (res, rej) => { calls.push(q._); return Promise.resolve(selErr ? { data: null, error: { message: 'permission denied' } } : { data: GRIM, error: null }).then(res, rej); };
      return q;
    },
    rpc(name, args) { calls.push([['rpc', name, args]]); return Promise.resolve(rpcData ? { data: rpcData, error: null } : { data: null, error: { message: 'function get_my_ledger does not exist' } }); },
  });
  let client = mkClient(false), uid = 'u-grim';
  const win = { MythicAzaHost: { client: () => client, uid: () => uid } };
  const W = await load(win);
  globalThis.window = win;
  const r = await W.walletLedger();
  const q = calls[0] || [];
  ok(r.ok && r.rows.length === GRIM.length && r.complete === true, 'direct select: every AZA row, complete (< 200)', JSON.stringify({ ok: r.ok, n: r.rows.length }));
  ok(q.some((x) => x[0] === 'from' && x[1] === 'wallet_ledger') && q.some((x) => x[0] === 'eq' && x[1] === 'resource' && x[2] === 'sovereigns') && q.some((x) => x[0] === 'eq' && x[1] === 'user_id' && x[2] === 'u-grim'), 'reads wallet_ledger, resource = sovereigns, own user id', JSON.stringify(q));
  ok(q.some((x) => x[0] === 'limit' && x[1] === 200), 'limit 200');
  ok(W.cachedWalletRows().length === GRIM.length, 'the result is cached for the synchronous bank seed');
  uid = 'someone-else';
  ok(W.cachedWalletRows().length === 0, 'the cache is per account — a switched account sees none of it');
  uid = 'u-grim';
  client = mkClient(true, MIXED); calls.length = 0;
  const f = await W.walletLedger();
  ok(f.ok && f.rows.length === 3 && f.complete === false && calls.some((c) => c[0][0] === 'rpc' && c[0][1] === 'get_my_ledger'), 'select refused ⇒ get_my_ledger() fallback, AZA subset only, marked incomplete', JSON.stringify({ n: f.rows.length, c: f.complete }));
  client = mkClient(true, null);
  const g = await W.walletLedger();
  ok(!g.ok && g.reason === 'missing', 'both refused ⇒ ok:false, reason missing', JSON.stringify(g));
  client = null;
  const h = await W.walletLedger();
  ok(!h.ok && h.reason === 'signin', 'no client ⇒ reason signin, no throw');
  delete globalThis.window;
}

console.log('\n=== 3. the phone Ledger, in a sandbox ===');
{
  const els = {};
  const clickables = [];
  const mkEl = (tag) => {
    const el = { tag, id: '', className: '', hidden: false, style: {}, children: [], attrs: {}, listeners: {}, _html: '',
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; }, getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentElement = this; if (c.id) els[c.id] = c; return c; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      querySelectorAll(sel) {
        const m = /^\[data-(l[fm])\]$/.exec(sel); if (!m) return [];
        const out = []; const re = new RegExp('data-' + m[1] + '="([^"]+)"', 'g'); let x;
        while ((x = re.exec(this._html))) { const b = { dataset: { [m[1] === 'lf' ? 'lf' : 'lm']: x[1] }, onclick: null }; out.push(b); clickables.push(b); }
        return out;
      },
      querySelector() { return null; },
      animate() { return {}; }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; const re = /id="([^"]+)"/g; let m; while ((m = re.exec(v))) { const c = mkEl('div'); c.id = m[1]; c.parentElement = this; els[m[1]] = c; } },
      get firstChild() { return this.children[0] || { style: {}, innerHTML: '' }; }, get textContent() { return this._html; }, set textContent(v) { this._html = String(v); },
    };
    return el;
  };
  const body = mkEl('body'), head = mkEl('head');
  const document = { body, head, getElementById: (id) => els[id] || null, createElement: (t) => mkEl(t), addEventListener() {} };
  const store = {};
  const localStorage = { get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i], getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const aRows = M.walletRows(GRIM);
  /* Cinder server rows exactly as MythicBank.serverLedger() shapes them */
  const cRows = [{ t: Date.parse('2026-09-17T13:25:00Z'), d: -5000, r: 'Resource Market: Buy livestock', b: 65499, k: 'server' }, { t: Date.parse('2026-09-17T12:00:00Z'), d: 12000, r: 'Battle won', b: 70499, k: 'server' }];
  let azaCalls = 0;
  const window = {
    MythicNotify: { state: () => ({ unread: 0 }), render() {}, markRead() {}, clear() {} }, MythicChatSeam: { unread: () => 0 },
    MythicBank: {
      state: () => ({ signedIn: true, ready: true, err: '', extCols: true, balance: 0, aza: 0, walletCinder: 65499, walletAza: 94, vaultUsed: 0, vaultCap: 0, depositFee: 0, resources: [], bankLedger: [], handle: 'grim' }),
      ledger: () => [{ t: 2, d: -300, r: 'Pack Shop', k: 'spend', b: 1200 }, { t: 1, d: 800, r: 'Battle won', k: 'gain', b: 1500 }],
      serverLedger: async () => ({ ok: true, rows: cRows }),
      ensure: async () => true, openFull: () => true,
    },
    MythicAzaHistory: { walletLedger: async () => { azaCalls++; return { ok: true, rows: aRows, complete: true }; } },
  };
  const ctx = { window, document, localStorage, navigator: { onLine: true }, setInterval: () => 1, clearInterval() {}, setTimeout: (f) => { f(); return 1; }, Date, Number, Math, String, Array, Object, JSON, Promise, RegExp, console, MutationObserver: class { observe() {} disconnect() {} } };
  window.document = document; window.localStorage = localStorage;
  vm.createContext(ctx);
  vm.runInContext(PHONE, ctx);
  const H = window.MythicHandset;
  const flush = () => new Promise((r) => setImmediate(r));
  ok(H && typeof H.ledgerMerge === 'function', 'MythicHandset publishes ledgerMerge');
  H.open('ledger');
  await flush(); await flush();
  const pane = () => els['mgp-pane'].innerHTML, list = () => (els['mgp-ldg'] || {}).innerHTML || '', note = () => (els['mgp-ldg-note'] || {}).innerHTML || '', sums = () => (els['mgp-aza-sums'] || {}).innerHTML || '';
  ok(/🔥 65,499/.test(pane()) && /🪙 94 AZA/.test(pane()), 'header: 🔥 65,499 wallet and 🪙 94 AZA beside it', pane().slice(0, 300));
  ok(/\+800 received/.test(pane()) && /−300 spent/.test(pane()), 'the Cinder sums are the Cinder diary\'s alone (+800 / −300)');
  ok(/\+608 AZA received/.test(sums()) && /−525 AZA spent/.test(sums()), 'the AZA sums are their own line (+608 / −525 AZA)', sums());
  ok(!/\+1,408|\+608 received|−825 spent/.test(pane()), 'NEGATIVE CONTROL: AZA is not added into the Cinder totals');
  ok(/data-lf="all"/.test(pane()) && /data-lf="cinder"/.test(pane()) && /data-lf="aza"/.test(pane()), 'an All / Cinder / AZA filter');
  const L0 = list();
  const azaN = (L0.match(/data-cur="aza"/g) || []).length, cinN = (L0.match(/data-cur="cinder"/g) || []).length;
  ok(azaN === GRIM.length && cinN === 2, 'All: every AZA row and every Cinder row in one list', azaN + ' aza / ' + cinN + ' cinder');
  ok(/class="mgp-ldr aza out" data-cur="aza"><span class="ic">🪙<\/span>/.test(L0) && /after 🪙 94/.test(L0) && /−?-120 AZA<\/span>|>-120 AZA</.test(L0), 'an AZA spend: 🪙 icon, red (out), "after 🪙 94", amount in AZA', L0.slice(0, 400));
  ok(/class="mgp-ldr aza in"[^]*?Purchase — 150 AZA pack[^]*?after 🪙 214[^]*?\+150 AZA/.test(L0), 'an AZA purchase: green (in), plain label, after 🪙 214, +150 AZA');
  ok(L0.indexOf('Resource Market: Buy livestock') < L0.indexOf('Spent (item not recorded)') && L0.indexOf('Spent (item not recorded)') < L0.indexOf('Battle won'), 'merged newest first across both currencies');
  ok(/2 Cinder \+ 15 AZA server rows · tamper-proof/.test(note()), 'the footer counts both', note());
  const click = (attr, v) => { const b = clickables.filter((x) => x.dataset[attr] === v).pop(); b && b.onclick && b.onclick(); };
  click('lf', 'aza'); await flush(); await flush();
  const L1 = list();
  ok((L1.match(/data-cur="aza"/g) || []).length === 15 && !/data-cur="cinder"/.test(L1), 'filter AZA: only AZA rows', L1.slice(0, 120));
  ok(/15 AZA server rows/.test(note()), 'filter AZA: footer', note());
  click('lf', 'cinder'); await flush(); await flush();
  const L2 = list();
  ok(!/data-cur="aza"/.test(L2) && (L2.match(/data-cur="cinder"/g) || []).length === 2, 'filter Cinder: only Cinder rows');
  click('lf', 'aza'); click('lm', 'wallet'); await flush();
  ok(/AZA is not kept on this device/.test(list()), '"This device" + AZA says there is no local AZA diary', list());
  click('lf', 'all'); await flush();
  ok((list().match(/data-cur="cinder"/g) || []).length === 2 && /AZA: Account record/.test(note()), '"This device" + All: the Cinder diary, pointing AZA to the account record', note());
  ok(azaCalls === 1, 'the AZA read is reused across repaints (15 s cache)', azaCalls);
  /* ledgerMerge, and the negative control against the pre-change read */
  const oldRead = MIXED.filter((x) => x && x.resource === 'cinder');
  ok(oldRead.every((x) => x.resource === 'cinder') && oldRead.length === 2 && MIXED.filter((x) => x.resource === 'sovereigns').length === 3, 'NEGATIVE CONTROL: the old list (get_my_ledger filtered to cinder) drops all 3 AZA rows');
  const merged = H.ledgerMerge(cRows, aRows, 'all');
  ok(merged.length === 17 && merged.filter((e) => e.cur === 'aza').length === 15, 'ledgerMerge(all): 2 Cinder + 15 AZA');
  ok(H.ledgerMerge(cRows, aRows, 'cinder').every((e) => e.cur !== 'aza') && H.ledgerMerge(cRows, aRows, 'aza').every((e) => e.cur === 'aza'), 'ledgerMerge filters are exclusive');
  ok(H.ledgerMerge(cRows.concat(aRows), [], 'cinder').every((e) => e.cur !== 'aza'), 'an AZA row in the Cinder list never shows under Cinder');
  H.close();
}

console.log('\n=== 4. the Bank of Ethos PageLedger (esbuild + stub React) ===');
{
  const a = JSX.indexOf('function PageLedger(');
  const b = JSX.indexOf('/* ============================================================\n   PAGE: CHARTS');
  ok(a > 0 && b > a, 'PageLedger found in app.jsx');
  const code = transformSync(JSX.slice(a, b), { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  const h = (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) });
  let stateVal = 'all';
  const useState = (init) => [stateVal, (v) => { stateVal = v; }];
  const glyph = (name) => function G() { return name; };
  const make = new Function('h', 'Frag', 'useState', 'fmt', 'Icon', 'CinderGlyph', 'AzaGlyph', code + '\nreturn PageLedger;');
  const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
  const PageLedger = make(h, 'frag', useState, fmt, glyph('icon'), glyph('CDR'), glyph('AZA'));
  const text = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : (typeof n.type === 'function' ? '[' + n.type() + ']' : '') + text(n.kids);
  const find = (n, pred, out = []) => { if (n && typeof n === 'object' && !Array.isArray(n)) { if (pred(n)) out.push(n); (n.kids || []).forEach((k) => find(k, pred, out)); } else if (Array.isArray(n)) n.forEach((k) => find(k, pred, out)); return out; };
  const account = {
    ledger: [{ ts: Date.parse('2026-09-17T14:00:00Z'), kind: 'deposit', cinder: 5000, aza: 0, note: 'Cinder deposit to bank' }, { ts: Date.parse('2026-09-16T10:00:00Z'), kind: 'aza-deposit', cinder: 0, aza: 3, note: 'Aza deposit' }],
    azaWallet: M.walletRows(GRIM),
  };
  const render = (f) => { stateVal = f; return PageLedger({ account }); };
  const t0 = render('all');
  const rows0 = find(t0, (n) => n.type === 'tr' && n.props['data-src']);
  const wal = rows0.filter((r) => r.props['data-src'] === 'wallet');
  ok(rows0.length === 17 && wal.length === 15, 'All: 2 bank rows + 15 wallet AZA rows', rows0.length + ' / ' + wal.length);
  const first = text(rows0.find((r) => r.props['data-src'] === 'wallet'));
  ok(/AZA spent/.test(first) && /Spent \(item not recorded\)/.test(first) && /\[AZA\]-120 AZA/.test(first) && /\[AZA\]94/.test(first), 'a wallet AZA spend: AZA glyph, −120 AZA, balance after 94', first);
  const buy = text(wal.find((r) => /Purchase — 150 AZA pack/.test(text(r))));
  ok(/AZA added/.test(buy) && /\+150 AZA/.test(buy) && /\[AZA\]214/.test(buy), 'a wallet AZA purchase: AZA added, +150 AZA, after 214', buy);
  const flow = text(find(t0, (n) => n.props && n.props['data-aza-flow'] !== undefined));
  ok(/AZA \+611 added · −525 spent/.test(flow), 'the AZA chip: +611 added (608 wallet + 3 bank) · −525 spent', flow);
  ok(/CDR flow \+5,000/.test(text(t0)) && !/Live · 2026-05-19|\+94,200|\+21,500/.test(text(t0)), 'the CDR chip is real and AZA-free; the placeholder chips are gone');
  const tA = render('aza'); const rA = find(tA, (n) => n.type === 'tr' && n.props['data-src']);
  ok(rA.length === 16 && rA.every((r) => r.props['data-cur'] === 'aza'), 'filter AZA: the 15 wallet rows + the bank Aza deposit', rA.length);
  const tC = render('cinder'); const rC = find(tC, (n) => n.type === 'tr' && n.props['data-src']);
  ok(rC.length === 1 && rC[0].props['data-src'] === 'bank', 'filter Cinder: only the Cinder deposit — no wallet AZA row', rC.length);
  const fb = find(render('all'), (n) => n.type === 'button' && n.props['data-ledger-filter']);
  ok(fb.map((x) => x.props['data-ledger-filter']).join() === 'all,cinder,aza' && fb.every((x) => typeof x.props.onClick === 'function'), 'three live filter buttons');
  const none = PageLedger({ account: { ledger: [] } });
  ok(/no transactions yet/.test(text(none)), 'an account seeded by an older parent (no azaWallet) still renders');
}

console.log('\n=== 5. the wiring ===');
{
  ok(/azaWallet: \(function \(\) \{ try \{ const A = window\.MythicAzaHistory; return \(A && typeof A\.cachedWalletRows === 'function'\) \? A\.cachedWalletRows\(\)\.slice\(0, 120\) : \[\]; \} catch \(e\) \{ return \[\]; \} \}\)\(\),/.test(SRC), 'postSeed hands the iframe the cached AZA wallet rows');
  ok(/window\.MythicAzaHistory\.walletLedger\(\)\.then\(\(\) => \{ try \{ postSeed\(\); \} catch \(e\) \{\} \}, \(\) => \{\}\);/.test(SRC), 'opening the bank reads the AZA rows, then re-seeds');
  ok(/azaWallet: Array\.isArray\(d\.azaWallet\) \? d\.azaWallet : \(\(prev && prev\.azaWallet\) \|\| \[\]\),/.test(JSX), 'the iframe keeps azaWallet from the seed');
  ok(/<script type="text\/babel" src="app\.jsx\?v=v121q52"><\/script>/.test(BOE), 'app.jsx cache-buster bumped (q52)');
  ok(/src\/azahistory\/index\.js\?v=ah4"/.test(SRC), 'azahistory cache-buster bumped (ah4)');
  ok(/x\.resource === 'cinder'/.test(SRC) && /rpc\('get_my_ledger', \{ p_limit: 200 \}\)/.test(SRC), 'serverLedger() stays Cinder-only, so AZA is never listed twice');
  ok(/walletLedger, walletRows, walletTotals, cachedWalletRows/.test(AZA_SRC), 'window.MythicAzaHistory publishes the wallet-ledger API');
  ok(/sub: 'Every Cinder and AZA in and out of your wallet'/.test(PHONE), 'the Ledger app says it holds both currencies');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
