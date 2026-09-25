/* 🪙 AZA HISTORY + ARRIVAL NOTICES — bug-mu2s9wa7.

   Reported: "I seem to have 94 AZA in my wallet, however, I didn't buy all of
   them and I can't spend them in the game. I am not sure where these AZA came
   from." The balance was legitimate; the player just had no way to see it.

   Defends, headless:
     1. the module imports in Node with no window (pure half is testable);
     2. the reporter's REAL movements (read-only from production 2026-09-17,
        user id and Stripe session ids replaced) rebuild to a history whose
        summary nets to exactly the 94 they hold — including the three
        referral gifts the ledger only calls "Aza gift claim", the covert
        rewards by their rule names, and the pre-ledger purchases (20, 20)
        and gift (5) reconciled by one derived "spent before itemised" row;
     3. classify() words for every live wallet_ledger reason family;
     4. arrivalLines(): named, generic, quiet, and never on a spend;
     5. tick(): first sight of an account is silent, a spend is silent, a
        named rise toasts + rings the bell once, an unnamed rise waits one
        tick, another tab that already moved the baseline stays silent, an
        account switch seeds silently, a settling balance does nothing;
     6. index.html wiring: host, notes before adopts, quiet refund + bank
        withdrawal, entry points, the module tag, reasons on the AZA spends
        that used to land as bare "aza spend";
     7. NEGATIVE CONTROLS: the same assertions run against two mutants of the
        module and MUST fail — (a) the gift→from_label join removed, (b) quiet
        sources ignored. A suite that passes both mutants proves nothing.

   Run: node _azahistory_smoke.mjs */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

const MOD_PATH = './public/src/azahistory/index.js';
const MOD_SRC = readFileSync(MOD_PATH, 'utf8');
const SRC = readFileSync('./public/index.html', 'utf8');
const TMP = mkdtempSync(join(tmpdir(), 'azahist-'));
let seq = 0;
async function load(src, win) {
  const f = join(TMP, 'm' + (++seq) + '.mjs');
  writeFileSync(f, src);
  if (win) globalThis.window = win; else delete globalThis.window;
  const m = await import(pathToFileURL(f).href);
  delete globalThis.window;
  return m;
}

/* ── the reporter's real rows (production, read-only, 2026-09-17) ── */
const L = (t, d, b, r) => ({ created_at: t, delta: d, balance_after: b, reason: r });
const FIX = {
  ledgerComplete: true,
  ledger: [
    L('2026-08-23T13:53:35.419Z', 25, 25, 'Aza gift claim'),
    L('2026-08-23T13:53:37.065Z', 5, 30, 'Aza gift claim'),
    L('2026-08-23T13:53:45.138Z', 5, 35, 'Aza gift claim'),
    L('2026-08-26T13:55:32.697Z', -35, 0, 'trader membership: Professional Trader'),
    L('2026-09-05T21:21:31.523Z', 1, 1, 'Aza reward: cv_resource'),
    L('2026-09-05T21:21:31.525Z', 1, 2, 'Aza reward: cv_resource'),
    L('2026-09-05T21:21:31.536Z', 2, 4, 'Aza reward: cv_recruit'),
    L('2026-09-09T07:19:36.497Z', 150, 154, 'Aza pack purchase cs_live_S1'),
    L('2026-09-09T07:20:16.202Z', -60, 94, 'Secret Stash — Anomalous Fold'),
    L('2026-09-09T09:27:49.612Z', -30, 64, 'Warehouse: Forklift'),
    L('2026-09-09T09:28:09.655Z', -25, 39, 'Warehouse: upgrade to Sheet-Metal Warehouse'),
    L('2026-09-09T10:02:56.988Z', -10, 29, 'Warehouse: open storage unit space'),
    L('2026-09-09T10:02:59.475Z', -10, 19, 'Warehouse: open storage unit space'),
    L('2026-09-09T10:03:01.561Z', -10, 9, 'Warehouse: open storage unit space'),
    L('2026-09-17T09:41:57.300Z', 150, 159, 'Aza pack purchase cs_live_S2'),
    L('2026-09-17T09:50:05.570Z', -125, 34, 'trader membership: Market Tycoon'),
    L('2026-09-17T12:39:26.820Z', 150, 184, 'Aza pack purchase cs_live_S3'),
    L('2026-09-17T12:43:47.196Z', -120, 64, 'aza spend'),
    L('2026-09-17T13:19:13.770Z', 150, 214, 'Aza pack purchase cs_live_S4'),
    L('2026-09-17T13:20:01.906Z', -120, 94, 'aza spend'),
  ].reverse(),   // the client reads newest first
  purchases: [
    { session_id: 'cs_live_P1', aza: 20, created_at: '2026-08-03T15:39:15.401Z' },
    { session_id: 'cs_live_P2', aza: 20, created_at: '2026-08-06T16:08:50.214Z' },
    { session_id: 'cs_live_S1', aza: 150, created_at: '2026-09-09T07:19:36.497Z' },
    { session_id: 'cs_live_S2', aza: 150, created_at: '2026-09-17T09:41:57.300Z' },
    { session_id: 'cs_live_S3', aza: 150, created_at: '2026-09-17T12:39:26.820Z' },
    { session_id: 'cs_live_S4', aza: 150, created_at: '2026-09-17T13:19:13.770Z' },
  ],
  rewards: [
    { kind: 'cv_resource', aza: 1, ts: '2026-09-05T21:21:31.523Z' },
    { kind: 'cv_resource', aza: 1, ts: '2026-09-05T21:21:31.525Z' },
    { kind: 'cv_recruit', aza: 2, ts: '2026-09-05T21:21:31.536Z' },
  ],
  gifts: [
    { qty: 5, from_label: 'Referral', claimed_at: '2026-08-05T15:23:27.486Z' },
    { qty: 5, from_label: 'Referral', claimed_at: '2026-08-23T13:53:45.138Z' },
    { qty: 25, from_label: 'Shop', claimed_at: '2026-08-23T13:53:35.419Z' },
    { qty: 5, from_label: 'Referral', claimed_at: '2026-08-23T13:53:37.065Z' },
  ],
};

/* ── assertions shared by the real module and the mutants ── */
function historyChecks(M, tag) {
  const r = [];
  const t = (c, m, x) => r.push([c, tag + m, x]);
  const H = M.buildHistory(JSON.parse(JSON.stringify(FIX)));
  const line = M.summaryLine(H.totals);
  t(line === 'Bought 640 · Gifts 25 · Rewards 19 · Spent 590', 'summary line is "Bought 640 · Gifts 25 · Rewards 19 · Spent 590"', line);
  t(Math.round(H.totals.net) === 94, 'the rows net to the 94 AZA the player holds', H.totals.net);
  const labels = H.rows.map((x) => x.label);
  t(labels.filter((l) => l === 'Referral reward (gift claim)').length === 3, 'three referral gifts are called referral rewards (2 ledger + 1 pre-ledger receipt)', labels.join(' | '));
  t(labels.includes('Gift claim — from Shop'), 'the 25 AZA Shop gift is named', labels.join(' | '));
  t(labels.filter((l) => l === 'Reward — Covert mission: Resource Run').length === 2 && labels.includes('Reward — Covert mission: Recruitment Drive'), 'covert rewards carry the aza_reward_rules names');
  t(labels.filter((l) => l === 'Purchase — 150 AZA pack').length === 4 && labels.filter((l) => l === 'Purchase — 20 AZA pack').length === 2, 'four ledger 150-packs + two pre-ledger 20-pack receipts, none twice');
  t(labels.includes('Warehouse upgrade — Sheet-Metal Warehouse') && labels.includes('Secret Stash — Anomalous Fold') && labels.includes('Trader membership — Market Tycoon') && labels.filter((l) => l === 'Warehouse storage space').length === 3, 'spends carry their reasons');
  t(labels.filter((l) => l === 'Spent (item not recorded)').length === 2, 'the two bare "aza spend" rows are shown honestly, not hidden');
  const der = H.rows.filter((x) => x.src === 'derived');
  t(der.length === 1 && der[0].delta === -45 && der[0].kind === 'spend', 'pre-ledger 20+20+5 reconciled by ONE derived −45 row', JSON.stringify(der));
  let sorted = true; for (let i = 1; i < H.rows.length; i++) if (H.rows[i].at > H.rows[i - 1].at) sorted = false;
  t(sorted && H.rows[0].label === 'Spent (item not recorded)' && H.rows[0].delta === -120, 'newest first');
  return r;
}

async function tickChecks(src, tag) {
  const r = [];
  const t = (c, m, x) => r.push([c, tag + m, x]);
  const store = {};
  const toasts = [], bells = [];
  const st = { uid: 'u1', aza: 94, settling: false, src: [] };
  const hostObj = {
    uid: () => st.uid, aza: () => st.aza, settling: () => st.settling,
    sources: () => st.src.slice(), clearSources: () => { st.src.length = 0; },
    toast: (m) => toasts.push(m), notify: (m) => bells.push(m),
  };
  const win = { MythicAzaHost: hostObj, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  const M = await load(src, win);
  globalThis.window = win;
  try {
    st.settling = true; M.tick();
    t(!('mythic_aza_seen:u1' in store) && !toasts.length, 'nothing happens while the balance is settling');
    st.settling = false; M.tick();
    t(store['mythic_aza_seen:u1'] === '94' && !toasts.length, 'first sight of an account seeds the baseline silently (no "+94 arrived" on a new device)');
    st.aza = 34; M.tick();
    t(store['mythic_aza_seen:u1'] === '34' && !toasts.length && !bells.length, 'a spend moves the baseline and says nothing');
    st.src.push({ label: 'referral reward', amount: 5, quiet: false }); st.aza = 39; M.tick();
    t(toasts.length === 1 && toasts[0] === '🪙 +5 AZA — referral reward', 'a named rise toasts "🪙 +5 AZA — referral reward"', toasts[0]);
    t(bells.length === 1 && bells[0] === '🪙 +5 AZA — referral reward', 'and rings the notification bell once', bells.join('|'));
    t(st.src.length === 0, 'the note is consumed');
    st.src.push({ label: '', amount: 1, quiet: false, rewardKind: 'cv_resource' }); st.aza = 40; M.tick();
    t(toasts[1] === '🪙 +1 AZA — Covert mission: Resource Run', 'a reward note is worded from the rules', toasts[1]);
    st.aza = 50; M.tick();
    t(toasts.length === 2, 'an UNNAMED rise waits one tick (the crediting tab may still name it)');
    M.tick();
    t(toasts.length === 3 && toasts[2] === '🪙 +10 AZA arrived — see AZA history', 'then says "AZA arrived — see AZA history" rather than guessing', toasts[2]);
    st.src.push({ label: 'refund', amount: 10, quiet: true }); st.aza = 40; M.tick(); st.aza = 50; M.tick();
    t(toasts.length === 3, 'the refund of the player\'s own failed spend is quiet', toasts.slice(3).join('|'));
    st.src.length = 0;
    st.aza = 70; M.tick(); store['mythic_aza_seen:u1'] = '70'; M.tick();
    t(toasts.length === 3, 'another tab that already moved the shared baseline keeps this tab silent');
    st.uid = 'u2'; st.aza = 500; M.tick();
    t(store['mythic_aza_seen:u2'] === '500' && toasts.length === 3, 'an account switch seeds the new account silently');
  } finally { delete globalThis.window; }
  return r;
}

/* ── 1. import with no window ── */
const M0 = await load(MOD_SRC, null);
ok(typeof M0.buildHistory === 'function' && typeof M0.tick === 'function' && typeof M0.arrivalLines === 'function', 'module imports in Node with no window');
ok(M0.tick() === null, 'tick() with no host is a no-op, not a throw');

/* ── 2. the reporter's history ── */
for (const [c, m, x] of historyChecks(M0, '')) ok(c, m, x);

/* ── 3. classify ── */
const C = (r, d, g) => M0.classify(r, d, g);
ok(C('Aza -> Cinder exchange', -20).label === 'Exchanged for Cinder' && C('Aza -> Cinder exchange', -20).kind === 'spend', 'Cinder exchange is a spend');
ok(C('Bank of Ethos deposit (aza)', -5).kind === 'bank' && C('Bank of Ethos withdrawal (aza)', 5).kind === 'bank', 'bank moves are moves, not spends or income');
ok(C('Aza refund of 1234', 10).kind === 'refund', 'sov_refund rows are refunds');
ok(C('Aza gift claim', 5, { from_label: 'Admin' }).label === 'Admin grant (gift claim)', 'an Admin gift says Admin grant');
ok(C('Aza gift claim', 5, null).label === 'Gift claim', 'an unmatched gift claim still says Gift claim');
ok(C('Weapon Smith blueprint: Greatsword', -22).label === 'Weapon Smith blueprint — Greatsword', 'Weapon Smith blueprint');
ok(C('affiliate: Iron Wolves', 3).kind === 'reward' && C('community: Iron Wolves', -9).kind === 'spend', 'community earnings are rewards, memberships are spends');
ok(C('Aza reward: brand_new_kind', 2).label === 'Reward — Brand new kind', 'an unknown reward kind is prettified, never dropped');
ok(M0.SINKS.length >= 8 && M0.SINKS.some((s) => /Warehouse/.test(s)) && M0.SINKS.some((s) => /Secret Stash/.test(s)) && M0.SINKS.some((s) => /Trader membership/.test(s)), '"Where can I spend AZA?" lists the real sinks');

/* ── 4. arrivalLines ── */
ok(M0.arrivalLines(-10, []).length === 0 && M0.arrivalLines(0, []).length === 0, 'never a notice on a spend or no change');
ok(M0.arrivalLines(5, [{ label: 'bank withdrawal', amount: 5, quiet: true }]).length === 0, 'a quiet rise says nothing');
ok(M0.arrivalLines(7, [{ label: 'referral reward', amount: 5 }]).join('|') === '🪙 +5 AZA — referral reward|🪙 +2 AZA arrived — see AZA history', 'a rise bigger than its note names the part it knows and flags the rest');

/* ── 5. tick ── */
for (const [c, m, x] of await tickChecks(MOD_SRC, '')) ok(c, m, x);

/* ── 6. index.html wiring ── */
const sov = SRC.slice(SRC.indexOf('function sovReward(kind, requested) {'), SRC.indexOf('function sovReward(kind, requested) {') + 700);
ok(sov.indexOf('_azaNoteSource(') > 0 && sov.indexOf('_azaNoteSource(') < sov.indexOf('_sovAdopt(j)'), 'sovReward names the reward BEFORE adopting the balance');
ok(/window\.MythicAzaHost\s*=\s*\{/.test(SRC) && /function _azaNoteSource\(label, amount, quiet, rewardKind\)/.test(SRC), 'host + note function exist');
const refund = SRC.slice(SRC.indexOf('function refundSovereigns(amount) {'), SRC.indexOf('function refundSovereigns(amount) {') + 400);
ok(/_azaNoteSource\('refund', amount, true\)/.test(refund), 'refundSovereigns notes a QUIET source');
ok(/_azaNoteSource\('bank withdrawal', amt, true\)/.test(SRC), 'Bank of Ethos withdrawal is quiet');
const gc = SRC.slice(SRC.indexOf("rpc('gift_claim'"), SRC.indexOf("rpc('gift_claim'") + 4000);
ok(/from_label/.test(gc) && gc.indexOf('_azaNoteSource(') < gc.indexOf('_sovAdopt({ aza: j.aza })'), 'gift claim names Referral / Admin from from_label before adopting');
ok(/_azaNoteSource\('purchase \('/.test(SRC), 'a pack purchase names its pack size');
ok(/class="hub-cur-pill hub-cur-pill-sov" data-aza-history="hub"/.test(SRC) && /data-aza-history="profile"/.test(SRC) && /data-aza-history="market"/.test(SRC), 'entry points: hub AZA pill, profile, market wallet');
ok(/<script type="module" src="src\/azahistory\/index\.js\?v=[^"]+"><\/script>/.test(SRC), 'the module is loaded');
ok(/spendSovereigns\(price, 'Base Vault expansion'\)/.test(SRC) && /spendSovereigns\(sovCost, 'Pack: '/.test(SRC) && /spendSovereigns\(sovCost, 'Structure Deck: '/.test(SRC) && /spendSovereigns\(amount, 'Auction purchase'\)/.test(SRC), 'the AZA spends that landed as bare "aza spend" now carry a reason');

/* ── 7. negative controls ── */
const MUT_A = MOD_SRC.replace('if (i >= 0) { usedG.add(i); gift = gifts[i]; }', 'if (i >= 0) { usedG.add(i); }');
const MUT_B = MOD_SRC.replace('if (src.length && src.every((s) => s.quiet)) return [];', '').replace("const named = src.filter((s) => !s.quiet);", 'const named = src;');
ok(MUT_A !== MOD_SRC && MUT_B !== MOD_SRC, 'NEGATIVE CONTROL: both mutations apply to the current source');
const ma = await load(MUT_A, null);
const aFails = historyChecks(ma, '[mutant A] ').filter(([c]) => !c).length;
ok(aFails >= 2, 'NEGATIVE CONTROL: without the gift→from_label join the history checks FAIL (' + aFails + ' failed)');
const bFails = (await tickChecks(MUT_B, '[mutant B] ')).filter(([c]) => !c).length;
ok(bFails >= 1, 'NEGATIVE CONTROL: ignoring quiet sources makes the tick checks FAIL (' + bFails + ' failed)');

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
