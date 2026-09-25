/* ══════════════════════════════════════════════════════════════════════════
   💼 DRIVE-CORP-NM-DESK — the game side of sql/142 (corporations employ
   Node Managers): the desk a founder hires from, the offer a player answers,
   the fee rows the treasury log shows, and the contract chip in the city.

   WHAT IT RUNS. The REAL code, lifted out of public/index.html by its two
   anchors (from `function _cityCutNote(pct) {` to the openNodeManagerDesk
   export) plus the REAL corpTreasuryFetch, in a blank Chromium page with a
   stubbed Cloud.client. The stub is a tiny in-page server: it answers the four
   sql/142 RPCs per CALLER (manager or founder, as the RLS/RPC would) and the
   corp_treasury read. index.html itself is not booted — it opens on an auth
   gate and 11 MB of boot proves nothing about this screen.

   ROLES: tables-missing (the live DB today), founder, member (non-founder),
   offered player, then the same contract seen from both sides after Accept,
   then account isolation on a shared device.

   MONEY: spendGems / addGems are trapped and Profile.gems is a setter trap.
   The flow must never call or write any of them — the server moves the
   Cinder inside the payout, and nowhere else.

   NEGATIVE CONTROLS (each must turn a check red):
     N1  founder gate removed from the render → a member sees Offer.
     N2  missing-function detection removed → tables-missing shows the
         generic error instead of the explanation.
     N3  a mutant that credits the fee with addGems → the money trap fires.

   Run:  node .gauntlet/drive-corp-nm-desk.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + String(x).slice(0, 300))); c ? passes++ : fails++; };

const HTML = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function lift(startMark, endMark, inclusiveEnd) {
  const a = HTML.indexOf(startMark);
  const b = HTML.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error('anchor missing: ' + startMark.slice(0, 40));
  if (HTML.indexOf(startMark, a + 1) >= 0) throw new Error('anchor not unique: ' + startMark.slice(0, 40));
  return HTML.slice(a, inclusiveEnd ? b + endMark.length : b);
}
const DESK = lift('function _cityCutNote(pct) {', 'try { window.openNodeManagerDesk = openNodeManagerDesk; } catch (e) {}', true);
const CTF = lift('async function corpTreasuryFetch() {', '/* 🏦 WALLET → CORP TREASURY', false);

// ── static: the new code never touches the wallet ─────────────────────────
ok(!/\b(addGems|spendGems)\s*\(/.test(DESK), 'desk code never calls addGems/spendGems');
ok(!/Profile\.gems\s*(=|\+=|-=|\+\+|--)/.test(DESK), 'desk code never writes Profile.gems');
ok(/rpc\('corp_offer_node_manager'/.test(DESK) && /rpc\('corp_accept_node_manager'/.test(DESK) && /rpc\('corp_end_node_manager'/.test(DESK) && /rpc\('corp_node_manager_list'/.test(DESK), 'desk calls the four sql/142 RPCs by name');
ok(/_cityCutReport\(j\.mayor_cut, j\.mayor_pct, j\)/.test(HTML), 'ledger reply hands the whole reply to the chip');
ok(/getElementById\('cnm-pill'\)/.test(HTML), 'JB overlay mounts the desk pill');

const CORP = 'c0000000-0000-4000-8000-000000000001';
const FOUNDER = 'f0000000-0000-4000-8000-00000000000f';
const MEMBER = 'a0000000-0000-4000-8000-00000000000a';
const PLAYER = 'b0000000-0000-4000-8000-00000000000b';

const STUBS = `
window.__log = { toasts: [], confirms: [], rpc: [], money: 0, errors: [] };
function showToast(m) { __log.toasts.push(String(m)); }
async function gcConfirm(m) { __log.confirms.push(String(m)); return true; }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function spendGems() { __log.money++; return true; }
function addGems() { __log.money++; }
function initCloud() { return true; }
async function searchPlayers(q) { return /bo/i.test(q) ? [{ userId: '${PLAYER}', name: 'Bo Stranger' }] : []; }
const _gemStore = { v: 500 };
const Profile = { cloud: { signedIn: true, userId: null, displayName: 'Me' } };
Object.defineProperty(Profile, 'gems', { get() { return _gemStore.v; }, set(v) { __log.money++; _gemStore.v = v; } });
const App = { screen: 'city' };
const Corp = { mine: null, owned: null, roster: [], treasury: 0, treasuryLog: [], treasury24h: 0, treasuryKnown: false };
let _twMayors = { 'N-25': { node_id: 'N-25', mayor_id: '${PLAYER}' }, 'N-31': { node_id: 'N-31', mayor_id: '${PLAYER}' }, 'N-40': { node_id: 'N-40', mayor_id: 'someone-else' } };
async function tw_fetchNodeMayors() { return _twMayors; }
const DB = window.__db || { missing: false, contracts: [], treasury: [], founders: { '${CORP}': '${FOUNDER}' } };
window.__db = DB;
function _mine(me) {
  return DB.contracts.filter(k => k.manager_id === me || DB.founders[k.corp_id] === me).map(k => Object.assign({}, k, {
    role: k.manager_id === me ? 'manager' : 'employer', corp_name: 'Ash Guild', corp_tag: 'ASH',
    manager_name: k.manager_id === '${PLAYER}' ? 'Bo Stranger' : 'Mia Member',
    corp_fees_total: DB.treasury.filter(t => t.kind === 'node_manager_fee' && t.user_id === k.manager_id && t.corp_id === k.corp_id).reduce((s, t) => s + t.amount, 0) }));
}
const MISSING = { code: 'PGRST202', message: 'Could not find the function public.corp_node_manager_list without parameters in the schema cache' };
const Cloud = { client: {
  async rpc(name, args) {
    __log.rpc.push(name);
    const me = Profile.cloud.userId;
    if (DB.missing) return { data: null, error: Object.assign({}, MISSING, { message: MISSING.message.replace('corp_node_manager_list', name) }) };
    if (name === 'corp_node_manager_list') return { data: _mine(me), error: null };
    if (name === 'corp_offer_node_manager') {
      if (DB.founders[args.p_corp_id] !== me) return { data: null, error: { code: '42501', message: 'only the corporation founder can hire a Node Manager' } };
      const id = 'k' + (DB.contracts.length + 1);
      DB.contracts.push({ id, corp_id: args.p_corp_id, manager_id: args.p_manager_id, manager_pct: args.p_pct, status: 'offered', started_at: null, ended_at: null });
      return { data: id, error: null };
    }
    const k = DB.contracts.find(x => x.id === args.p_id);
    if (name === 'corp_accept_node_manager') {
      if (!k || k.manager_id !== me) return { data: null, error: { code: '42501', message: 'no such offer for you' } };
      k.status = 'active'; k.started_at = new Date().toISOString();
      return { data: { ok: true, id: k.id, corp_id: k.corp_id, manager_pct: k.manager_pct }, error: null };
    }
    if (name === 'corp_end_node_manager') {
      if (!k) return { data: null, error: { code: '42501', message: 'no such contract for you' } };
      k.status = 'ended'; return { data: { ok: true, id: k.id }, error: null };
    }
    return { data: null, error: { message: 'unknown rpc ' + name } };
  },
  from(table) {
    const q = { _eq: {} };
    q.select = () => q; q.order = () => q; q.limit = () => q;
    q.eq = (c, v) => { q._eq[c] = v; return q; };
    q.then = (res, rej) => {
      if (table !== 'corp_treasury') return Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(res, rej);
      const rows = DB.treasury.filter(t => t.corp_id === q._eq.corp_id).slice().reverse();
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    };
    return q;
  },
} };
const CityMgr = { myCut: 0, myPct: 0 };
`;

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 900, height: 900 } });

// One shared DB object survives page loads by being serialised into each page.
let DBSTATE = null;
async function boot(desk, who, setup) {
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="bar"></div>'
    + '<script>window.__db = ' + JSON.stringify(DBSTATE) + ';</script>'
    + '<script>' + STUBS + '\n' + CTF + '\n' + desk + '\n</script>'
    + '</body></html>';
  await pg.route('http://nm.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await pg.goto('http://nm.test/');
  await pg.evaluate(({ who, setup }) => {
    Profile.cloud.userId = who;
    new Function(setup)();
  }, { who, setup: setup || '' });
  return { pg, errs };
}
async function tryClick(pg, sel) { try { await pg.click(sel, { timeout: 2500 }); return true; } catch (e) { return false; } }
async function openDesk(pg) {
  await pg.evaluate(() => openNodeManagerDesk());
  await pg.waitForFunction(() => Corp.nm && Corp.nm.state !== 'unknown', null, { timeout: 5000 });
  await pg.waitForTimeout(150);
  return pg.evaluate(() => {
    const el = document.getElementById('cnm-desk');
    return {
      text: el ? el.innerText : '',
      offer: el ? el.querySelectorAll('[data-cnm="offer"]').length : -1,
      accept: el ? el.querySelectorAll('[data-cnm="accept"]').length : -1,
      end: el ? el.querySelectorAll('[data-cnm="end"]').length : -1,
      money: __log.money, gems: _gemStore.v, rpc: __log.rpc.slice(),
    };
  });
}
async function save(pg) { DBSTATE = await pg.evaluate(() => window.__db); }
const FOUNDER_SETUP = `Corp.mine = { id: '${CORP}', name: 'Ash Guild', tag: 'ASH' }; Corp.owned = { id: '${CORP}', name: 'Ash Guild', tag: 'ASH' };
  Corp.roster = [{ userId: '${FOUNDER}', name: 'Fay Founder', role: 'founder' }, { userId: '${MEMBER}', name: 'Mia Member', role: 'member' }];`;
const MEMBER_SETUP = `Corp.mine = { id: '${CORP}', name: 'Ash Guild', tag: 'ASH' }; Corp.owned = null;
  Corp.roster = [{ userId: '${FOUNDER}', name: 'Fay Founder', role: 'founder' }, { userId: '${MEMBER}', name: 'Mia Member', role: 'member' }];`;

async function runScenarios(desk, label) {
  const out = {};
  // 1. tables missing, founder (the most controls anyone could see)
  DBSTATE = { missing: true, contracts: [], treasury: [], founders: { [CORP]: FOUNDER } };
  { const { pg, errs } = await boot(desk, FOUNDER, FOUNDER_SETUP);
    const r = await openDesk(pg);
    out.missing = { r, errs: errs.slice() };
    // the chip must also be quiet with no contract data
    out.missingChip = await pg.evaluate(() => { const d = document.createElement('div'); d.id = 'node-city-cut'; document.body.appendChild(d); CityMgr.myPct = 30; _twMayorCutBadge(); return d.textContent; });
    await pg.close(); }
  // 2. founder, live tables
  DBSTATE = { missing: false, contracts: [], treasury: [], founders: { [CORP]: FOUNDER } };
  { const { pg, errs } = await boot(desk, FOUNDER, FOUNDER_SETUP);
    const r = await openDesk(pg);
    out.founder = { r, errs };
    // search reaches a stranger; offer them 70%
    await pg.fill('#cnm-q', 'bo');
    await tryClick(pg, '[data-cnm="search"]');
    await pg.waitForFunction(() => /Bo Stranger/.test(document.getElementById('cnm-desk').innerText), null, { timeout: 4000 }).catch(() => {});
    out.searchSees = await pg.evaluate(() => document.getElementById('cnm-desk').innerText);
    await pg.fill('#cnm-pct', '150');
    await tryClick(pg, '[data-cnm="offer"][data-id="' + PLAYER + '"]');
    await pg.waitForTimeout(150);
    out.badPct = await pg.evaluate(() => ({ toasts: __log.toasts.slice(), offers: __db.contracts.length }));
    await pg.fill('#cnm-pct', '70');
    await tryClick(pg, '[data-cnm="offer"][data-id="' + PLAYER + '"]');
    await pg.waitForFunction(() => __db.contracts.length === 1, null, { timeout: 4000 }).catch(() => {});
    await pg.waitForTimeout(250);
    out.afterOffer = await pg.evaluate(() => ({ text: document.getElementById('cnm-desk').innerText, confirms: __log.confirms.slice(), n: __db.contracts.length, pct: __db.contracts[0] && __db.contracts[0].manager_pct }));
    await save(pg); await pg.close(); }
  // 3. member (non-founder)
  { const { pg, errs } = await boot(desk, MEMBER, MEMBER_SETUP);
    out.member = { r: await openDesk(pg), errs };
    await pg.close(); }
  // 4. offered player
  { const { pg, errs } = await boot(desk, PLAYER, '');
    const r = await openDesk(pg);
    out.player = { r, errs };
    await tryClick(pg, '[data-cnm="accept"]');
    await pg.waitForFunction(() => __db.contracts[0].status === 'active', null, { timeout: 4000 }).catch(() => {});
    await pg.waitForTimeout(250);
    out.playerAfter = await pg.evaluate(() => ({ text: document.getElementById('cnm-desk').innerText, status: __db.contracts[0].status }));
    // the city chip: a payout reply from the sql/142 server
    out.chip = await pg.evaluate(() => {
      const d = document.createElement('div'); d.id = 'node-city-cut'; document.body.appendChild(d);
      CityMgr.myPct = 30;
      const told = _cityCutReport(210, 30, { mayor_cut: 210, mayor_pct: 30, corp_id: __db.contracts[0].corp_id, manager_pct: 70, corp_share: 90 });
      return { told, text: d.textContent, toast: __log.toasts[__log.toasts.length - 1] };
    });
    // a 0% contract still reports the corp's part
    out.zeroCut = await pg.evaluate(() => { CityMgr._cutToldAt = 0; CityMgr.myCut = 0; CityMgr.corpCut = 0; return _cityCutReport(0, 30, { corp_id: 'x', manager_pct: 0, corp_share: 5 }); });
    // an older (sql/121) reply leaves the employer alone; a sql/142 reply with corp_id null clears it
    out.oldReply = await pg.evaluate(() => { CityMgr.emp = { corpId: 'x', pct: 70 }; _cityCutReport(5, 30, { mayor_cut: 5 }); const kept = !!CityMgr.emp; _cityCutReport(5, 30, { mayor_cut: 5, corp_id: null }); return { kept, cleared: CityMgr.emp === null }; });
    // account isolation on a shared device: B signs in on this tab
    out.iso = await pg.evaluate(() => {
      CityMgr.emp = null;
      const before = _corpNmRows().length;
      Profile.cloud.userId = 'e0000000-0000-4000-8000-0000000000ee';
      const after = _corpNmRows().length;
      const d = document.getElementById('node-city-cut'); _twMayorCutBadge();
      return { before, after, chip: d.textContent };
    });
    out.playerMoney = await pg.evaluate(() => ({ money: __log.money, gems: _gemStore.v }));
    await save(pg); await pg.close(); }
  // 5. the server paid a fee: founder and manager see the same pct and nodes
  DBSTATE.treasury.push({ id: 't1', corp_id: CORP, user_id: PLAYER, amount: 90, kind: 'node_manager_fee', note: 'Node Manager fee (30% of a 30% share) — city on node N-25', created_at: new Date().toISOString() });
  DBSTATE.treasury.push({ id: 't0', corp_id: CORP, user_id: FOUNDER, amount: 1000, kind: 'deposit', note: 'member deposit', created_at: new Date().toISOString() });
  { const { pg, errs } = await boot(desk, FOUNDER, FOUNDER_SETUP);
    out.founderAfter = { r: await openDesk(pg), errs, treasury: await pg.evaluate(() => Corp.treasury) };
    await pg.close(); }
  { const { pg, errs } = await boot(desk, PLAYER, '');
    out.playerView = { r: await openDesk(pg), errs };
    await pg.close(); }
  return out;
}

// ═══ REAL CODE ═══════════════════════════════════════════════════════════════
console.log('— real code');
const R = await runScenarios(DESK, 'real');
ok(/not switched on/i.test(R.missing.r.text), 'tables missing: desk explains the feature is not on yet', R.missing.r.text);
ok(R.missing.r.offer === 0 && R.missing.r.accept === 0 && R.missing.r.end === 0, 'tables missing: no offer/accept/end controls even for a founder', JSON.stringify(R.missing.r));
ok(R.missing.errs.length === 0, 'tables missing: no console errors', R.missing.errs.join(' | '));
ok(/30% you · 70% owner/.test(R.missingChip), 'tables missing: city chip keeps the plain split', R.missingChip);
ok(R.founder.errs.length === 0, 'founder: no console errors', R.founder.errs.join(' | '));
ok(R.founder.r.offer === 1 && /Mia Member/.test(R.founder.r.text), 'founder: Offer control for the roster member (not for themself)', JSON.stringify(R.founder.r));
ok(/Hire a Node Manager/.test(R.founder.r.text) && /Nobody works for Ash Guild/.test(R.founder.r.text), 'founder: hire section + empty managers list');
ok(/Bo Stranger/.test(R.searchSees), 'founder: a searched player can be offered a post');
ok(R.badPct.offers === 0 && R.badPct.toasts.some(t => /whole percent/.test(t)), 'founder: 150% refused client-side as feedback, nothing sent', JSON.stringify(R.badPct));
ok(R.afterOffer.n === 1 && R.afterOffer.pct === 70, 'founder: offer reached the RPC with 70', JSON.stringify(R.afterOffer));
ok(R.afterOffer.confirms.some(c => /keep 70%/.test(c) && /other 30%/.test(c)), 'founder: gcConfirm states both halves before sending');
ok(/offer pending/.test(R.afterOffer.text) && /Withdraw/.test(R.afterOffer.text), 'founder: pending offer listed with Withdraw', R.afterOffer.text);
ok(R.member.errs.length === 0, 'member: no console errors', R.member.errs.join(' | '));
ok(R.member.r.offer === 0 && !/Hire a Node Manager/.test(R.member.r.text), 'member: no Offer controls, no hire section', R.member.r.text);
ok(/No offers or contracts/.test(R.member.r.text), 'member: own empty state shown');
ok(!R.member.r.rpc.includes('corp_offer_node_manager'), 'member: never calls the offer RPC');
ok(R.player.errs.length === 0, 'offered player: no console errors', R.player.errs.join(' | '));
ok(R.player.r.accept === 1 && /Decline/.test(R.player.r.text) && /Ash Guild/.test(R.player.r.text), 'offered player: Accept + Decline shown', R.player.r.text);
ok(R.player.r.offer === 0, 'offered player (founds nothing): no Offer control');
ok(R.playerAfter.status === 'active' && /End contract/.test(R.playerAfter.text), 'offered player: accept goes through the RPC and the desk shows the contract', R.playerAfter.text);
ok(R.chip.told && /30% share · you 70% of it · \[ASH\] 30% · 70% owner · \+210/.test(R.chip.text), 'chip: employed split drawn from the server reply', R.chip.text);
ok(/\+90 to your corporation/.test(R.chip.toast || ''), 'chip: toast names the corporation part', R.chip.toast);
ok(R.zeroCut === true, 'chip: a 0% contract with a corp share still reports');
ok(R.oldReply.kept && R.oldReply.cleared, 'chip: pre-142 reply keeps employer, 142 reply with no employer clears it', JSON.stringify(R.oldReply));
ok(R.iso.before === 1 && R.iso.after === 0 && /30% you · 70% owner/.test(R.iso.chip), 'shared device: next account sees none of the previous contracts', JSON.stringify(R.iso));
ok(R.playerMoney.money === 0 && R.playerMoney.gems === 500, 'no wallet call or Profile.gems write through offer/accept/payout', JSON.stringify(R.playerMoney));
const fa = R.founderAfter.r, pv = R.playerView.r;
ok(/Keeps 70%/.test(fa.text) && /you keep 70%/.test(pv.text), 'both sides show the same 70%', fa.text + ' || ' + pv.text);
ok(/Runs 2 nodes: N-25, N-31/.test(fa.text) && /Runs 2 nodes: N-25, N-31/.test(pv.text), 'both sides show the same node list', fa.text + ' || ' + pv.text);
ok(/fees earned 90/.test(fa.text), 'founder: fees earned is the server total');
ok(/Node Manager fee · Bo Stranger/.test(fa.text) && /\+90 🔥/.test(fa.text) && !/\+1,000/.test(fa.text), 'founder: treasury log shows the Node Manager fee row (and only fee rows)', fa.text);
ok(R.founderAfter.treasury === 1090, 'treasury balance is sum(amount) from the ledger read', R.founderAfter.treasury);
ok(R.founderAfter.errs.length === 0 && R.playerView.errs.length === 0, 'after payout: no console errors');
ok(fa.money === 0 && pv.money === 0, 'after payout: no wallet writes on either side');

// ═══ NEGATIVE CONTROLS ═══════════════════════════════════════════════════════
console.log('— negative controls');
{
  const M1 = DESK.replace('    if (Corp.owned) {\n      const emp', '    if (true) {\n      const emp');
  ok(M1 !== DESK, 'N1 mutant applied');
  const r = await runScenarios(M1.replace(/Corp\.owned\.(id|name)/g, "(Corp.owned||Corp.mine).$1"), 'N1');
  ok(r.member.r.offer > 0, 'N1 caught: without the founder gate a member sees Offer', r.member.r.offer);
}
{
  const M2 = DESK.replace("return /PGRST202|PGRST205|42883|42P01|could not find the function|does not exist|schema cache/i.test(m);", 'return false;');
  ok(M2 !== DESK, 'N2 mutant applied');
  const r = await runScenarios(M2, 'N2');
  ok(!/not switched on/i.test(r.missing.r.text), 'N2 caught: without detection the missing table is not explained', r.missing.r.text);
}
{
  const M3 = DESK.replace("showToast('💼 You now manage nodes for '", "addGems(1); showToast('💼 You now manage nodes for '");
  ok(M3 !== DESK, 'N3 mutant applied');
  ok(/\baddGems\s*\(/.test(M3), 'N3 caught by the static wallet check');
  const r = await runScenarios(M3, 'N3');
  ok(r.playerMoney.money > 0, 'N3 caught by the runtime money trap', JSON.stringify(r.playerMoney));
}

await b.close();
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
