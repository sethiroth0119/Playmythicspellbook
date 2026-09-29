/* 🪙 AZA GRANTS GO THROUGH THE SERVER — sql/159.

   Owner: "AZA from the season pass, coupons, Territory Wars loot and
   resource-exchange sales is only added on the player's device, so it likely
   vanishes on the next load. Fix this."
   Measured 2026-09-17 (read-only): 7 Luni AZA sales (132 AZA) claimed by their
   sellers with no wallet_ledger credit and no buyer charge; 9 accounts
   redeemed the 500-AZA WELCOME2026 code and none has the credit.

   OWNER DECISION 2026-09-18 on the season pass, Territory Wars loot and Oil
   Sim: "give cinder instead max 15,000". Those three NO LONGER GRANT AZA:
   sql/159's cinder_claim_season / cinder_claim_capped pay CINDER (the AZA
   amount the reward names × aza_config.cinder_per_aza, 5,000) with a
   server-side ceiling of 15,000 per player per UTC day per reward. Coupons,
   Luni trades and broker deals are still AZA. Sections 8-10 below defend
   the Cinder half; the AZA checks above them now use only the AZA kinds.

   Defends, headless (~1 s, no browser):
     1. every former local-only grant site is gone from index.html — season
        pass, coupon, Territory Wars loot, the trade bridge's addAza/spendAza,
        the broker's _bdApply AZA line, the Oil Sim contract/emergency, and the
        optimistic addSovereigns() bumps in front of sovReward();
     2. each of those sites now calls its server function;
     3. the client helper (_azaGrant / _azaPendFlush), extracted from
        index.html and RUN: an ok reply adopts the server balance and names
        the source first; a MISSING function queues the claim, says "reward
        saved — it will be added when the server is ready" and does NOT touch
        the balance; a refusal is not queued; a flush pays the queue once and
        empties it; a flush while still missing keeps it;
     4. _resSettleEntry, extracted and RUN: an AZA sale pays the seller via
        aza_trade_collect and never through the local wallet; the buyer is
        charged via aza_trade_pay and the AZA legs are stripped before
        settle(); a missing function leaves the row unclaimed;
     5. the AZA history labels the new ledger reasons;
     6. sql/159 is a DRAFT with RLS for all four tables and no player write
        policy on the claims table;
     7. NEGATIVE CONTROLS: a mutant helper whose fallback bumps the balance
        locally, and a mutant index.html with the old season line restored,
        MUST fail the same assertions.

   Run: node _azagrants_smoke.mjs */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import vm from 'vm';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/159_aza_server_grants.sql', 'utf8').replace(/\r\n/g, '\n');
const AH = readFileSync('./public/src/azahistory/index.js', 'utf8');

function between(src, a, b) {
  const i = src.indexOf(a); if (i < 0) return '';
  const j = src.indexOf(b, i + a.length); return j < 0 ? '' : src.slice(i, j + b.length);
}
function fnText(src, head) {
  // A top-level function: from its header to the first "\n}\n" after it.
  const i = src.indexOf(head); if (i < 0) return '';
  const j = src.indexOf('\n}\n', i); return j < 0 ? '' : src.slice(i, j + 3);
}

/* ── 1+2. static: the old local grants are gone, the server calls are there ── */
// Comments explain WHY and quote the old code, so the "is it gone" checks read
// code only. Rough on purpose: block comments, then // to end of line (not
// after ':' or a quote, so URLs and strings survive).
const noComments = (s) => String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
function staticChecks(S0, tag) {
  const S = noComments(S0);
  const r = [];
  const t = (c, m, x) => r.push([c, tag + m, x]);
  const season = between(S, "case 'cinder_server': {", 'break;');
  t(season && !/Profile\.(sovereigns|gems)\s*[+-]?=/.test(season) && /_cinderRewardGrant\('cinder_claim_season'/.test(season) && !/_azaGrant\(/.test(season),
    'season pass: no local AZA or Cinder write; pays CINDER through cinder_claim_season', season.slice(0, 160));
  t(!/case 'aza': \{/.test(between(S, 'function claimSeasonReward(tier, track) {', 'claimedMap[String(tier)] = true;')), 'season pass: the AZA reward branch is gone');
  const coupon = between(S, 'if ((r.aza | 0) > 0) {', 'lines.push(');
  t(coupon && !/Profile\.sovereigns\s*=/.test(coupon) && /_azaGrant\('aza_redeem_coupon'/.test(coupon), 'coupon: no local write; calls aza_redeem_coupon');
  const tw = between(S, 'function _twDispenseLoot(key, amount, nodeId) {', "if (lower === 'cinder' || lower === 'gems') {");
  t(tw && !/Profile\.(sovereigns|gems)\s*[+-]?=/.test(tw) && /_cinderRewardGrant\('cinder_claim_capped', \{ p_kind: 'tw_loot'/.test(tw) && !/_azaGrant\(/.test(tw) && /Cinder \(server\)', amount: \(amount \| 0\) \* AZA_TO_CINDER/.test(tw),
    'Territory Wars loot: no local write; pays CINDER through cinder_claim_capped tw_loot and reports it as Cinder');
  t(/_twDispenseLoot\(k, amt, nodeId\)/.test(S), 'the collect loop passes the node id for the claim key');
  const bridge = between(S, 'window.MythicTradeBridge = {', 'takeOwned:');
  t(/spendAza: \(\) => false,/.test(bridge) && /addAza: \(\) => false,/.test(bridge) && !/Profile\.sovereigns/.test(bridge.slice(bridge.indexOf('spendAza'))), 'trade bridge: spendAza / addAza refuse instead of moving AZA locally');
  const bd = fnText(S, 'function _bdApply(s, dir) {');
  t(bd && !/Profile\.sovereigns/.test(bd), 'broker _bdApply no longer moves AZA locally');
  t(/_azaGrantRpc\('aza_broker_accept'/.test(S) && /p_step: 'escrow'/.test(S) && /p_step: 'collect'/.test(S) && /p_step: 'refund'/.test(S), 'broker deals: accept / escrow / collect / refund go to the server');
  const osim = fnText(S, 'function _osimAzaReward(kind, n) {');
  t(!/_osimState\.aza \+= /.test(S) && /_osimAzaReward\('oilsim_contract'/.test(S) && /_osimAzaReward\('oilsim_emergency'/.test(S)
    && /_cinderRewardGrant\('cinder_claim_capped'/.test(osim) && !/_azaGrant\(/.test(osim), 'Oil Sim contract + emergency rewards pay CINDER through cinder_claim_capped');
  t(!/◈' \+ (c|em|_osimState\.emergency)\.rewardAza/.test(S) && !/for ◈' \+ \(6 \+/.test(S) && (S.match(/_osimRewardTxt\(/g) || []).length >= 5,
    'Oil Sim: every place that SHOWS the contract reward shows Cinder (_osimRewardTxt), never ◈ AZA');
  t(!/_azaGrant\('aza_claim_(season|capped)'|_azaGrantRpc\('aza_claim_(season|capped)'|_cinderRewardGrant\('aza_claim/.test(S), 'no call site names the retired aza_claim_season / aza_claim_capped');
  t(!/addSovereigns\(a\);\s*\n\s*sovReward\('cv_/.test(S) && !/addSovereigns\(25\);/.test(S) && !/addSovereigns\(5\);/.test(S), 'no optimistic local bump in front of sovReward (covert, Chosen trophy, Dark Event)');
  const auct = fnText(S, 'function _auctWalletAdd(cur, amount) {');
  t(auct && !/addSovereigns\(/.test(auct.replace(/\/\/.*$/gm, '')), 'NPC auction sale: no local bump before the clamped sov_reward');
  const settle = fnText(S, 'async function _resSettleEntry(e) {');
  t(/aza_trade_pay/.test(settle) && /aza_trade_collect/.test(settle), 'Luni AZA sales: buyer charged by aza_trade_pay, seller paid by aza_trade_collect');
  const legacy = fnText(S, 'async function _resLegacySweep(me, opts) {');
  t(/e\.currency === 'aza'\) \{ ResMarket\.waiting\.push\(e\); continue; \}/.test(legacy), 'legacy sweep: an AZA sale waits instead of flipping paid_out');
  return r;
}
for (const [c, m, x] of staticChecks(SRC, '')) ok(c, m, x);

/* ── 3. the helper, extracted and run ── */
const HELPER = between(SRC, "const _AZA_PEND_PREFIX = 'mythic_aza_pending:';", 'try { setTimeout(_azaPendFlush, 25000); setInterval(_azaPendFlush, 300000); } catch (e) {}');
ok(HELPER.length > 2000, 'helper block extracted from index.html (' + HELPER.length + ' chars)');

function makeWorld(helperSrc) {
  const store = {};
  const w = {
    toasts: [], notes: [], adopts: [], order: [], calls: [], cledger: [], exempt: 0,
    mode: 'ok',   // ok | missing | refused
    reply: (fn, args) => ({ ok: true, credited: 7, aza: 130 }),
  };
  const ctx = {
    console, JSON, Math, Date, Number, String, Array, Object, Promise, setTimeout: () => 0, setInterval: () => 0,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    Profile: { sovereigns: 100, gems: 100000, walletSeqProgress: 2, cloud: { signedIn: true, userId: 'u1' } },
    saveProfile: () => {}, _cinderLedgerAdd: (d, r) => w.cledger.push(r + ':' + d),
    _gemsTaxExempt: (fn) => { w.exempt++; return fn(); },
    Cloud: { client: { rpc: async (fn, args) => {
      w.calls.push(fn);
      if (w.mode === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.' + fn } };
      if (w.mode === 'refused') return { data: { ok: false, error: 'unknown_coupon' } };
      if (w.mode === 'daily_cap') return { data: { ok: false, error: 'daily_cap', cap: 15000, used_today: 15000 } };
      return { data: w.reply(fn, args) };
    } } },
    initCloud: () => true,
    showToast: (m) => w.toasts.push(m),
    _azaNoteSource: (label, n) => { w.notes.push(label + ':' + n); w.order.push('note'); },
    _sovAdopt: (j) => { if (j && typeof j.aza === 'number') { ctx.Profile.sovereigns = j.aza; w.adopts.push(j.aza); w.order.push('adopt'); } },
  };
  vm.createContext(ctx);
  vm.runInContext(helperSrc + '\n;this.__h = { _azaGrant, _azaPendFlush, _azaPendRead, _azaPendKey, _azaPendWrite, _cinderRewardGrant: (typeof _cinderRewardGrant === "function" ? _cinderRewardGrant : null) };', ctx);
  return { ctx, w, store, h: ctx.__h };
}

async function helperChecks(helperSrc, tag) {
  const r = [];
  const t = (c, m, x) => r.push([c, tag + m, x]);
  try {
    // a. ok → adopt, noted first
    let W = makeWorld(helperSrc);
    let g = await W.h._azaGrant('aza_redeem_coupon', { p_code: 'X' }, { label: 'coupon X', key: 'coupon:X' });
    t(g.ok && g.credited === 7 && W.ctx.Profile.sovereigns === 130, 'ok reply: the SERVER balance is adopted (100 → 130), credited 7', JSON.stringify(g) + ' bal=' + W.ctx.Profile.sovereigns);
    t(W.w.order.join(',') === 'note,adopt' && W.w.notes[0] === 'coupon X:7', 'the source is named BEFORE the balance moves (AZA history notice)', W.w.order.join(','));
    // b. missing → queued, honest toast, balance untouched
    W = makeWorld(helperSrc); W.w.mode = 'missing';
    g = await W.h._azaGrant('aza_redeem_coupon', { p_code: 'SPRING' }, { label: 'coupon SPRING', key: 'coupon:SPRING' });
    t(g.pending && W.ctx.Profile.sovereigns === 100, 'missing function: the balance is NOT touched (no AZA that would vanish)', 'bal=' + W.ctx.Profile.sovereigns);
    t(W.w.toasts.some((m) => /Reward saved — it will be added when the server is ready/.test(m)), 'missing function: "Reward saved — it will be added when the server is ready"', W.w.toasts.join('|'));
    t(W.h._azaPendRead().length === 1 && W.h._azaPendRead()[0].key === 'coupon:SPRING', 'missing function: the claim key is queued locally');
    await W.h._azaGrant('aza_redeem_coupon', { p_code: 'SPRING' }, { label: 'coupon SPRING', key: 'coupon:SPRING', silent: true });
    t(W.h._azaPendRead().length === 1, 'the same claim queued twice is ONE entry');
    // f. flush while still missing keeps it
    await W.h._azaPendFlush();
    t(W.h._azaPendRead().length === 1 && W.ctx.Profile.sovereigns === 100, 'flush while the function is still missing keeps the queue and moves nothing');
    // d. flush once available → paid once, emptied
    W.w.mode = 'ok'; W.w.reply = () => ({ ok: true, credited: 1, aza: 101 });
    await W.h._azaPendFlush();
    t(W.h._azaPendRead().length === 0 && W.ctx.Profile.sovereigns === 101 && W.w.notes.includes('coupon SPRING:1'), 'flush when the server is ready pays the saved claim ONCE, names it, empties the queue', 'bal=' + W.ctx.Profile.sovereigns + ' q=' + W.h._azaPendRead().length);
    const before = W.w.calls.length; await W.h._azaPendFlush();
    t(W.w.calls.length === before, 'a second flush sends nothing');
    // c. refused → not queued, no change
    W = makeWorld(helperSrc); W.w.mode = 'refused';
    g = await W.h._azaGrant('aza_redeem_coupon', { p_code: 'NOPE' }, { label: 'coupon NOPE', key: 'coupon:NOPE' });
    t(g.refused && /no AZA on the server/.test(g.why) && W.h._azaPendRead().length === 0 && W.ctx.Profile.sovereigns === 100, 'a refusal (unknown coupon) is reported, not queued, and moves nothing', JSON.stringify(g));
    // signed out → queued under guest, folded into the account on sign-in
    W = makeWorld(helperSrc); W.ctx.Profile.cloud = { signedIn: false };
    await W.h._azaGrant('aza_redeem_coupon', { p_code: 'GUEST' }, { label: 'coupon GUEST', key: 'coupon:GUEST' });
    t(W.ctx.Profile.sovereigns === 100 && W.h._azaPendRead('mythic_aza_pending:guest').length === 1, 'signed out: queued under guest, balance untouched');
    W.ctx.Profile.cloud = { signedIn: true, userId: 'u9' }; W.w.reply = () => ({ ok: true, credited: 5, aza: 105 });
    await W.h._azaPendFlush();
    t(W.ctx.Profile.sovereigns === 105 && W.h._azaPendRead('mythic_aza_pending:guest').length === 0, 'signing in folds the guest queue into the account and pays it');
  } catch (e) { t(false, 'helper checks threw', e && e.message); }
  return r;
}
for (const [c, m, x] of await helperChecks(HELPER, '')) ok(c, m, x);

/* ── 4. _resSettleEntry, extracted and run ── */
async function settleChecks() {
  const LEGS = fnText(SRC, 'function _resEntryLegs(e) {');
  const SETTLE = fnText(SRC, 'async function _resSettleEntry(e) {');
  ok(LEGS && SETTLE, '_resEntryLegs + _resSettleEntry extracted');
  const run = async (e, mode) => {
    const w = { rpc: [], claimed: [], settled: null, adopts: [], notes: [], local: 0 };
    const ctx = {
      console, Math, Number, String, Object, Array, Promise,
      Profile: { get sovereigns() { return 50; }, set sovereigns(v) { w.local++; }, gems: 0 },
      ResMarket: { caps: {}, stuck: [] },
      frApplyTax: (g) => ({ net: g, tax: 0 }),
      getRes: () => 0, showToast: () => {},
      _MT: () => ({ preflight: () => ({ ok: true }), settleLegs: (legs) => { w.settled = legs; return { ok: true }; } }),
      _resClaimIds: async (ids) => { w.claimed.push(...ids); return ids; },
      _azaGrantRpc: async (fn, args) => {
        w.rpc.push(fn);
        if (mode === 'missing') return { state: 'missing' };
        if (fn === 'aza_trade_collect') return { state: 'ok', data: { ok: true, claimed: true, credited: e.price_total, aza: 50 + e.price_total } };
        return { state: 'ok', data: { ok: true, paid: e.price_total, aza: 50 - e.price_total } };
      },
      _azaRefusalWhy: () => 'x', _azaNoteSource: (l, n) => w.notes.push(l + ':' + n), _sovAdopt: (j) => w.adopts.push(j.aza),
      _cinderLedgerAdd: () => {}, Cloud: { client: { rpc: async () => ({ data: { ok: true, fallback: true } }) } },
    };
    vm.createContext(ctx);
    vm.runInContext(LEGS + '\n' + SETTLE + '\n;this.__s = _resSettleEntry;', ctx);
    const res = await ctx.__s(e);
    return { res, w };
  };
  const base = { kind: 'sale', currency: 'aza', resource: 'water', units: 10, lots: 1, price_total: 8, ledger_id: 1854 };
  let o = await run(Object.assign({ party: 'seller' }, base), 'ok');
  ok(o.res.ok && o.res.serverPaid && o.w.rpc.join() === 'aza_trade_collect' && o.w.adopts[0] === 58, 'seller of an AZA sale is paid by aza_trade_collect and adopts the server balance', JSON.stringify(o.res));
  ok(o.w.local === 0 && o.w.settled === null && o.w.claimed.length === 0, 'seller: no local AZA write, no client settle, no separate rl_claim (the server claimed it)');
  ok(o.w.notes[0] === 'Luni sale:8', 'seller: the arrival notice names "Luni sale"');
  o = await run(Object.assign({ party: 'buyer' }, base), 'ok');
  ok(o.w.rpc.join() === 'aza_trade_pay' && o.w.adopts[0] === 42, 'buyer is charged by aza_trade_pay (server balance adopted)');
  ok(o.w.settled && o.w.settled.every((l) => l.kind !== 'aza') && o.w.settled.some((l) => l.kind === 'res' && l.dir === 'give'), 'buyer: the AZA leg is stripped; only the goods settle locally', JSON.stringify(o.w.settled));
  o = await run(Object.assign({ party: 'seller' }, base), 'missing');
  ok(!o.res.ok && o.res.deferred && o.w.claimed.length === 0 && o.w.local === 0, 'server not ready: the sale stays UNCLAIMED and waiting — nothing paid locally', JSON.stringify(o.res));
  o = await run(Object.assign({ party: 'buyer' }, base), 'missing');
  ok(!o.res.ok && o.res.deferred && o.w.settled === null && o.w.claimed.length === 0, 'server not ready: the buyer is not handed the goods and nothing is claimed');
  o = await run(Object.assign({ party: 'seller' }, base, { currency: 'cinders' }), 'ok');
  ok(!o.w.rpc.length, 'a Cinder sale never touches the AZA functions');
}
await settleChecks();

/* ── 5. AZA history labels ── */
{
  const f = join(mkdtempSync(join(tmpdir(), 'azag-')), 'ah.mjs');
  writeFileSync(f, AH);
  delete globalThis.window;
  const M = await import(pathToFileURL(f).href);
  const C = (r, d) => M.classify(r, d);
  ok(C('Aza reward: coupon WELCOME2026', 500).label === 'Coupon code — WELCOME2026' && C('Aza reward: coupon WELCOME2026', 500).kind === 'reward', 'history: a coupon credit reads "Coupon code — WELCOME2026"');
  // 2026-09-18: these three pay Cinder now — the AZA history must not carry
  // names for them (it would be describing money that is not AZA).
  ok(['season_pass', 'tw_loot', 'oilsim_contract', 'oilsim_emergency'].every((k) => !(k in M.REWARD_LABELS)) && M.REWARD_LABELS.cv_resource,
    'history: season pass, TW loot and Oil Sim are NOT named as AZA rewards any more (they pay Cinder); covert rewards still are');
  ok(C('Resource exchange sale #1854', 8).label === 'Luni sale #1854' && C('Resource exchange purchase #1854', -8).kind === 'spend', 'history: Luni sale / purchase rows are named, the purchase is a spend');
  ok(C('Broker deal escrow returned #ab12cd34', 2).kind === 'refund' && C('Broker deal purchase #ab12cd34', -1).kind === 'spend' && C('Broker deal sale #ab12cd34', 1).kind === 'other', 'history: broker escrow / purchase / sale rows are classified');
  const reasons = (SQL.match(/'Aza reward: coupon '|'Season Pass reward — tier '|'Territory Wars loot'|'Oil field emergency'|'Oil field contract'/g) || []);
  ok(reasons.length >= 5 && !/grant/i.test(reasons.join(' ')), 'ledger reasons avoid the word "grant" (a history would call them admin grants)', reasons.join(' | '));
  // "At least ah3": a later change (the ledger AZA rows, ah4) must move it on.
  ok(+((SRC.match(/src\/azahistory\/index\.js\?v=ah(\d+)/) || [])[1] || 0) >= 3, 'the history module version was bumped (ah3 or later)');
}

/* ── 6. sql/159 ── */
ok(/DRAFT — NOT APPLIED/.test(SQL.slice(0, 400)), 'sql/159 header says DRAFT — NOT APPLIED');
ok(['aza_grant_kinds', 'aza_coupons', 'aza_season_tiers', 'aza_grant_claims'].every((t) => new RegExp('alter table public\\.' + t + '\\s+enable row level security').test(SQL)), 'RLS enabled on all four new tables in the same file');
ok(/create policy agc_sel on public\.aza_grant_claims for select to authenticated using \(user_id = auth\.uid\(\)\)/.test(SQL) && !/create policy \w+ on public\.aza_grant_claims for (insert|update|delete|all)/.test(SQL), 'claims: own-rows SELECT only, no player write policy');
ok((SQL.match(/create policy acp_admin_\w+ on public\.aza_coupons[^;]*is_admin\(\)/g) || []).length === 4, 'coupons: every verb admin-only (players cannot list codes)');
ok(/\('WELCOME2026', 15, 0, false,/.test(SQL), 'WELCOME2026 is seeded DISABLED, at 15 AZA (owner, 2026-09-18)');
ok(!/grant execute on function public\.(_aza_bal|_aza_cap_check|_sov_apply)/.test(SQL) && /revoke all on function public\._aza_cap_check\(uuid, text, bigint\) from public, anon, authenticated/.test(SQL), 'private helpers are not executable by players');
ok(/if k\.kind is null or k\.mode <> 'capped' or k\.pays <> 'cinder'/.test(SQL), 'cinder_claim_capped accepts only capped Cinder kinds (cannot be pointed at a coupon, trade or season kind)');
ok(/v_amt := least\(greatest\(coalesce\(p_requested, 0\), 0\), k\.max_per_claim\)/.test(SQL), 'a capped claim is clamped to max_per_claim');
ok(/select -aza into v_paid from public\.aza_grant_claims where kind = 'trade_pay'/.test(SQL), 'the seller is paid what the buyer was charged — never the ledger price on its own');
ok(/-- VERIFY/.test(SQL) && /welcome_enabled;\s*\n/.test(SQL), 'ends with a verify SELECT');

/* ── 7. negative controls ── */
const MUT_HELPER = HELPER.replace("_azaPendAdd({ fn: fn, args: args,", "try { Profile.sovereigns = (Profile.sovereigns | 0) + 7; } catch (e) {} _azaPendAdd({ fn: fn, args: args,");
ok(MUT_HELPER !== HELPER, 'NEGATIVE CONTROL: the local-fallback mutation applies to the current helper');
const hf = (await helperChecks(MUT_HELPER, '[mutant helper] ')).filter(([c]) => !c).length;
ok(hf >= 2, 'NEGATIVE CONTROL: a helper that bumps AZA locally when the server is missing FAILS (' + hf + ' failed)');
const MUT_SRC = SRC.replace("const _spKey = 's' + (sp.seasonStartedAt || 0) + ':t' + tier;", "Profile.sovereigns = (Profile.sovereigns | 0) + (reward.amount | 0); const _spKey = 's' + (sp.seasonStartedAt || 0) + ':t' + tier;");
ok(MUT_SRC !== SRC, 'NEGATIVE CONTROL: the old season line can be restored into a mutant');
const sf = staticChecks(MUT_SRC, '[mutant src] ').filter(([c]) => !c).length;
ok(sf >= 1, 'NEGATIVE CONTROL: the restored local season grant FAILS the static checks (' + sf + ' failed)');

/* ══ 8. THE CINDER REWARDS — owner 2026-09-18: "give cinder instead max 15,000" ══
   The season pass, TW loot and Oil Sim no longer grant AZA. The ceiling is
   enforced by the SERVER, so what can be checked headless is (a) the SQL
   that enforces it, read structurally, with mutants that must fail, and
   (b) the client helper, run, including that it never touches AZA. The
   live proof (a DO block ending in RAISE EXCEPTION) is in the 2026-09-18
   report: tier 8 paid 5,000 once, a repeat paid 0, loot stopped at 15,000
   with a partial 5,000, and each reward had its own 15,000. */
const RATE_CLIENT = Number((SRC.match(/const AZA_TO_CINDER = (\d+);/) || [])[1]);
function cinderSqlChecks(Q, tag) {
  const r = [];
  const t = (c, m, x) => r.push([c, tag + m, x]);
  const caps = {}; for (const m of Q.matchAll(/\('(season_pass|tw_loot|oilsim)',\s+(\d+),/g)) caps[m[1]] = Number(m[2]);
  t(caps.season_pass === 15000 && caps.tw_loot === 15000 && caps.oilsim === 15000, 'cinder_reward_caps seeds 15,000 for each of season_pass / tw_loot / oilsim (the owner\'s "max 15,000")', JSON.stringify(caps));
  t(/update public\.cinder_reward_caps set daily_cinder = <n> where bucket = 'tw_loot';/.test(Q), 'the ceiling is documented as a one-row UPDATE');
  t(/update public\.aza_grant_kinds set pays = 'cinder', cinder_bucket = 'season_pass'/.test(Q) && /cinder_bucket = 'tw_loot'/.test(Q) && /cinder_bucket = 'oilsim',\s+daily_cap = 0 where kind in \('oilsim_contract', 'oilsim_emergency'\)/.test(Q),
    'season_pass, tw_loot and both Oil Sim kinds are asserted pays = cinder on every run (the two Oil Sim kinds share one bucket)');
  const core = between(Q, 'create or replace function public._cinder_reward_pay(', 'end $$;');
  t(core.length > 1500, '_cinder_reward_pay extracted (' + core.length + ' chars)');
  t(/v_rate := public\._cinder_per_aza\(\);/.test(core) && /v_want := p_aza_named \* v_rate;/.test(core) && /select cinder_per_aza::bigint from public\.aza_config where id = 1/.test(Q),
    'the Cinder is the AZA-named amount × aza_config.cinder_per_aza, read at claim time (no rate written down)');
  const iLock = core.indexOf('for update'), iAlready = core.indexOf("claim_key = p_key) then"), iSum = core.indexOf('sum(c.cinder)'), iIns = core.indexOf('insert into public.aza_grant_claims');
  t(iLock > 0 && /from public\.cinder_reward_days\s+where user_id = p_uid and bucket = k\.cinder_bucket and day = v_day for update/.test(core) && iLock < iAlready && iAlready < iSum && iSum < iIns,
    'ROW LOCK on (user, reward, UTC day) is taken BEFORE the once-check, the room is measured and the claim inserted (two tabs cannot share the room)', [iLock, iAlready, iSum, iIns].join(','));
  t(/join public\.aza_grant_kinds gk on gk\.kind = c\.kind\s+where c\.user_id = p_uid and gk\.cinder_bucket = k\.cinder_bucket/.test(core) && /c\.created_at >= v_from and c\.created_at < v_from \+ interval '1 day'/.test(core),
    'the day\'s room is summed per REWARD (bucket) over the UTC day, from the append-only claims');
  t(/v_room := greatest\(0, v_cap - v_used\);/.test(core) && /v_pay := least\(v_want, v_room\);/.test(core),
    'a claim pays least(wanted, room left) — a partial last claim, never past 15,000');
  t(/if v_room <= 0 then\s+return jsonb_build_object\('ok', false, 'error', 'daily_cap'/.test(core) && core.indexOf("'daily_cap'") < iIns,
    'no room left → refused BEFORE anything is recorded (not consumed)');
  t(/v_give := public\._ct_cinder_give\(p_uid, v_pay, p_reason\);/.test(core) && !/wallet_credit\(/.test(core) && !/_sov_apply\(/.test(core),
    'credited through _ct_cinder_give (the definer wallet credit) — never _sov_apply (AZA), never the capped/held wallet_credit');
  t(/'credited', v_pay/.test(core) && /'cinder', coalesce\(v_bal, 0\)/.test(core) && /'wallet_seq', coalesce\(v_seq, 0\)/.test(core),
    'returns the credited Cinder, the new balance and wallet_seq');
  t(/if k\.mode = 'season' then/.test(core) && /make_interval\(days => coalesce\(k\.cooldown_days, 80\)\)/.test(core), 'a season tier pays once per cooldown_days (80) — once per season');
  const fnSeason = between(Q, 'create or replace function public.cinder_claim_season(', 'end $$;');
  t(/select aza into v_amt from public\.aza_season_tiers where tier = p_tier;/.test(fnSeason) && !/p_amount|p_requested/.test(fnSeason), 'the season amount comes from aza_season_tiers — the client cannot name it');
  t(/revoke all on function public\._cinder_reward_pay\(uuid, text, text, bigint, jsonb, text\) from public, anon, authenticated;/.test(Q)
    && /revoke all on function public\._cinder_per_aza\(\) from public, anon, authenticated;/.test(Q)
    && /grant execute on function public\.cinder_claim_season\(int, text\) to authenticated;/.test(Q)
    && /grant execute on function public\.cinder_claim_capped\(text, text, bigint\) to authenticated;/.test(Q)
    && !/grant execute on function public\._cinder/.test(Q), 'the core + rate helpers are private; only the two claim functions are callable, by signed-in players');
  t(['cinder_reward_caps', 'cinder_reward_days'].every((x) => new RegExp('alter table public\\.' + x + ' enable row level security').test(Q))
    && /create policy crd_sel on public\.cinder_reward_days for select to authenticated using \(user_id = auth\.uid\(\)\)/.test(Q)
    && !/create policy \w+ on public\.cinder_reward_(caps|days) for (insert|update|delete|all)/.test(Q), 'RLS on both new Cinder tables in the same file; own-rows read, no player write policy');
  t(/drop function if exists public\.aza_claim_season\(int, text\);/.test(Q) && /drop function if exists public\.aza_claim_capped\(text, text, bigint\);/.test(Q) && !/create or replace function public\.aza_claim_(season|capped)/.test(Q),
    'the AZA versions of the three rewards are gone from sql/159');
  t(/EDITED IN PLACE 2026-09-18, STILL NOT APPLIED/.test(Q.slice(0, 1500)), 'sql/159 says it was edited in place and is still not applied');
  return r;
}
for (const [c, m, x] of cinderSqlChecks(SQL, '')) ok(c, m, x);
{
  // The season tier catalogue shows what the server pays: tier AZA × rate, capped at one day's 15,000.
  const tiers = {}; for (const m of SQL.matchAll(/\((\d+), (\d+)\)/g)) { const t = +m[1]; if ([8, 15, 21, 28].includes(t)) tiers[t] = +m[2]; }
  const cat = between(SRC, 'const SEASON_PREMIUM_REWARDS = [', '];');
  const shown = {}; for (const m of cat.matchAll(/kind:'cinder_server', amount: (\d+),[^}]*\}, \/\/\s+(\d+)/g)) shown[+m[2]] = +m[1];
  const want = {}; for (const t of [8, 15, 21, 28]) want[t] = Math.min(tiers[t] * RATE_CLIENT, 15000);
  ok(RATE_CLIENT === 5000 && JSON.stringify(shown) === JSON.stringify(want) && !/kind:'aza'/.test(cat),
    'Season Pass tiers 8/15/21/28 show Cinder = aza_season_tiers × AZA_TO_CINDER (5,000), capped at 15,000 — no AZA tier left', JSON.stringify({ shown, want }));
}

/* ── 9. the Cinder helper, run ── */
async function cinderHelperChecks(helperSrc, tag) {
  const r = [];
  const t = (c, m, x) => r.push([c, tag + m, x]);
  try {
    let W = makeWorld(helperSrc);
    t(typeof W.h._cinderRewardGrant === 'function', '_cinderRewardGrant exists in the helper block');
    // a. server ahead-or-level → the server's balance + seq are adopted; AZA untouched, no AZA note
    W.w.reply = () => ({ ok: true, credited: 5000, cinder: 105000, wallet_seq: 7, cap: 15000, clamped: false });
    let g = await W.h._cinderRewardGrant('cinder_claim_season', { p_tier: 8, p_claim_key: 's1:t8' }, { label: 'Season Pass tier 8', key: 'season:s1:t8', retryOnCap: true });
    t(g.ok && g.credited === 5000 && W.ctx.Profile.gems === 105000 && W.ctx.Profile.walletSeqProgress === 7, 'ok: the server Cinder balance (105,000) and wallet_seq are adopted', JSON.stringify(g) + ' gems=' + W.ctx.Profile.gems + ' seq=' + W.ctx.Profile.walletSeqProgress);
    t(W.ctx.Profile.sovereigns === 100 && W.w.notes.length === 0 && W.w.adopts.length === 0, 'a Cinder reward NEVER moves AZA and is never announced as AZA (no _azaNoteSource, no _sovAdopt)');
    t(W.w.exempt >= 1 && W.w.toasts.some((m) => /\+5,000 Cinder — Season Pass tier 8/.test(m)) && W.w.cledger[0] === 'Season Pass tier 8:5000', 'the write is tax-exempt, toasted as "+5,000 Cinder" and booked in the Cinder ledger');
    // b. local ahead of the server → the credit is added, the seq is NOT adopted
    W = makeWorld(helperSrc); W.ctx.Profile.gems = 200000;
    W.w.reply = () => ({ ok: true, credited: 5000, cinder: 105000, wallet_seq: 9 });
    await W.h._cinderRewardGrant('cinder_claim_capped', { p_kind: 'tw_loot', p_claim_key: 'tw:N1:1', p_requested: 1 }, { label: 'Territory Wars loot', key: 'tw:N1:1' });
    t(W.ctx.Profile.gems === 205000 && W.ctx.Profile.walletSeqProgress === 2, 'local ahead of the server: the credit is ADDED (205,000), a lower server figure never erases local Cinder, seq untouched', 'gems=' + W.ctx.Profile.gems + ' seq=' + W.ctx.Profile.walletSeqProgress);
    // c. partial last claim → toast names the limit
    W = makeWorld(helperSrc);
    W.w.reply = () => ({ ok: true, credited: 5000, wanted: 10000, clamped: true, cap: 15000, cinder: 105000, wallet_seq: 2 });
    await W.h._cinderRewardGrant('cinder_claim_capped', { p_kind: 'tw_loot', p_claim_key: 'tw:N1:2', p_requested: 2 }, { label: 'Territory Wars loot', key: 'tw:N1:2' });
    t(W.w.toasts.some((m) => /\+5,000 Cinder — Territory Wars loot \(today's 15,000 limit reached\)/.test(m)), 'a partial last claim says the day\'s 15,000 limit was reached', W.w.toasts.join('|'));
    // d. missing → queued as Cinder, balances untouched, honest toast; flush pays Cinder once
    W = makeWorld(helperSrc); W.w.mode = 'missing';
    g = await W.h._cinderRewardGrant('cinder_claim_capped', { p_kind: 'oilsim_contract', p_claim_key: 'osim:1', p_requested: 3 }, { label: 'Oil field contract', key: 'osim:1' });
    t(g.pending && W.ctx.Profile.gems === 100000 && W.ctx.Profile.sovereigns === 100 && W.h._azaPendRead()[0].cur === 'cinder', 'missing function: queued as a CINDER claim, neither balance touched');
    t(W.w.toasts.some((m) => /Reward saved — it will be added when the server is ready/.test(m)), 'missing function: "Reward saved — it will be added when the server is ready"');
    await W.h._azaPendFlush();
    t(W.h._azaPendRead().length === 1 && W.ctx.Profile.gems === 100000, 'flush while still missing keeps it and moves nothing');
    W.w.mode = 'ok'; W.w.reply = () => ({ ok: true, credited: 15000, cinder: 115000, wallet_seq: 2 });
    await W.h._azaPendFlush();
    t(W.h._azaPendRead().length === 0 && W.ctx.Profile.gems === 115000 && W.ctx.Profile.sovereigns === 100 && W.w.notes.length === 0, 'flush when ready pays the saved claim in CINDER once (never AZA) and empties the queue', 'gems=' + W.ctx.Profile.gems + ' aza=' + W.ctx.Profile.sovereigns);
    // e. daily_cap on a season tier → kept for another day; on loot → refused, not queued
    W = makeWorld(helperSrc); W.w.mode = 'daily_cap';
    g = await W.h._cinderRewardGrant('cinder_claim_season', { p_tier: 21, p_claim_key: 's1:t21' }, { label: 'Season Pass tier 21', key: 'season:s1:t21', retryOnCap: true });
    t(g.pending && W.h._azaPendRead().length === 1 && W.w.toasts.some((m) => /limit is reached; it will be added on a later day/.test(m)), 'season tier on a full day: saved for a later day (the server did not consume it)');
    await W.h._azaPendFlush();
    t(W.h._azaPendRead().length === 1 && W.ctx.Profile.gems === 100000, 'flush on a still-full day keeps the tier queued, moves nothing');
    W.w.mode = 'ok'; W.w.reply = () => ({ ok: true, credited: 15000, cinder: 115000, wallet_seq: 2 });
    await W.h._azaPendFlush();
    t(W.h._azaPendRead().length === 0 && W.ctx.Profile.gems === 115000, 'the next day the saved tier is paid once');
    W = makeWorld(helperSrc); W.w.mode = 'daily_cap';
    g = await W.h._cinderRewardGrant('cinder_claim_capped', { p_kind: 'tw_loot', p_claim_key: 'tw:N1:3', p_requested: 1 }, { label: 'Territory Wars loot', key: 'tw:N1:3' });
    t(g.refused && /today's Cinder limit/.test(g.why) && W.h._azaPendRead().length === 0 && W.ctx.Profile.gems === 100000, 'loot on a full day: refused in Cinder words, not queued, nothing moves', JSON.stringify(g));
    // f. a queue entry from the pre-decision draft (aza_claim_season) is paid as CINDER
    W = makeWorld(helperSrc);
    W.h._azaPendWrite([{ fn: 'aza_claim_season', args: { p_tier: 8, p_claim_key: 's0:t8' }, label: 'Season Pass tier 8', key: 'season:s0:t8', at: 1 }]);
    W.w.reply = () => ({ ok: true, credited: 5000, cinder: 105000, wallet_seq: 2 });
    await W.h._azaPendFlush();
    t(W.w.calls[0] === 'cinder_claim_season' && W.ctx.Profile.gems === 105000 && W.ctx.Profile.sovereigns === 100, 'an old queued aza_claim_season is sent as cinder_claim_season and paid in Cinder', W.w.calls.join());
  } catch (e) { t(false, 'cinder helper checks threw', e && e.stack); }
  return r;
}
for (const [c, m, x] of await cinderHelperChecks(HELPER, '')) ok(c, m, x);

/* ── 10. NEGATIVE CONTROLS for the Cinder half ── */
{
  const muts = [
    ['no ceiling (pays what was asked)', SQL.replace('v_pay := least(v_want, v_room);', 'v_pay := v_want;')],
    ['no row lock', SQL.replace('and day = v_day for update;', 'and day = v_day;')],
    ['ceiling raised to 150,000', SQL.replace("('tw_loot',     15000,", "('tw_loot',     150000,")],
    ['full day consumes the claim', SQL.replace("  if v_room <= 0 then\n    return jsonb_build_object('ok', false, 'error', 'daily_cap'", "  if v_room < 0 then\n    return jsonb_build_object('ok', false, 'error', 'daily_cap'")],
    ['credited as AZA', SQL.replace('v_give := public._ct_cinder_give(p_uid, v_pay, p_reason);', "v_give := to_jsonb(public._sov_apply(p_uid, v_pay, p_reason));")],
  ];
  for (const [name, Q] of muts) {
    ok(Q !== SQL, 'NEGATIVE CONTROL (' + name + '): the mutation applies to sql/159');
    const nf = cinderSqlChecks(Q, '[mut] ').filter(([c]) => !c).length;
    ok(nf >= 1, 'NEGATIVE CONTROL (' + name + '): the mutant FAILS the Cinder SQL checks (' + nf + ' failed)');
  }
  const M1 = HELPER.replace("  _azaPendAdd(item);\n  if (!meta.silent) { try { showToast('🔥 Reward saved", "  try { Profile.gems = (Profile.gems | 0) + 5000; } catch (e) {}\n  _azaPendAdd(item);\n  if (!meta.silent) { try { showToast('🔥 Reward saved");
  ok(M1 !== HELPER, 'NEGATIVE CONTROL: the local-Cinder-fallback mutation applies to the helper');
  const f1 = (await cinderHelperChecks(M1, '[mutant cinder fallback] ')).filter(([c]) => !c).length;
  ok(f1 >= 1, 'NEGATIVE CONTROL: a helper that bumps Cinder locally when the server is missing FAILS (' + f1 + ' failed)');
  const M2 = HELPER.replace('    const n = _cinderRewardAdopt(r.data, meta.label);\n', '    const n = _cinderRewardAdopt(r.data, meta.label); try { _azaNoteSource(meta.label, n, false); _sovAdopt({ aza: 100 + n }); } catch (e) {}\n');
  ok(M2 !== HELPER, 'NEGATIVE CONTROL: the announce-as-AZA mutation applies to the helper');
  const f2 = (await cinderHelperChecks(M2, '[mutant as-AZA] ')).filter(([c]) => !c).length;
  ok(f2 >= 1, 'NEGATIVE CONTROL: a helper that announces / pays a Cinder reward as AZA FAILS (' + f2 + ' failed)');
  const M3 = SRC.replace("{ kind:'cinder_server', amount: 15000, label:'15,000 Cinder', icon:'🔥' }, // 28", "{ kind:'aza',   amount:   5,  label:'5 Aza Coin',           icon:'🪙' }, // 28");
  ok(M3 !== SRC, 'NEGATIVE CONTROL: the old AZA tier 28 can be restored into a mutant');
  const cat3 = between(M3, 'const SEASON_PREMIUM_REWARDS = [', '];');
  ok(/kind:'aza'/.test(cat3), 'NEGATIVE CONTROL: the restored AZA tier is visible to the catalogue check');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
