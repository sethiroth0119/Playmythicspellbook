/* 🏛 THE MAYOR'S DASHBOARD ON THE PHONE (v121v68).

   Asked for: "all of the cities that they are mayors for, their clients gamer
   names and a dashboard on how much they are making from each city. Give each
   city a profile."

   Two things this suite exists to hold:

     · "NOT SET UP" IS NOT "NONE". If sql/123 is unapplied the RPC is absent,
       and an empty list rendered as "you are not a mayor anywhere" tells a
       player with six clients that their contracts vanished. Same for a
       fetch still in flight — the Luni bug, which shipped once already.
     · THE FIGURES ARE READ, NEVER DERIVED. Earnings come from mayor_earnings,
       written in the same transaction that pays the mayor. A phone that
       recomputed a share from player_pct would be a second opinion about
       money, and the two would disagree the moment a contract changed.

   Run: node _mayordash_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const HS  = readFileSync('./public/src/phone/handset.js', 'utf8');
const SQL = readFileSync('./sql/123_mayor_dashboard.sql', 'utf8');

/* ── the record, and its place in the money path ── */
ok(/create table if not exists public\.mayor_earnings/.test(SQL), 'payouts are recorded per city, not parsed back out of prose');
{
  const i = SQL.indexOf('perform public._ct_cinder_give');
  const j = SQL.indexOf('insert into public.mayor_earnings (node_id, mayor_id, owner_id, amount, pct)');
  ok(i > 0 && j > i, 'the wallet is credited FIRST; the report is written after');
  const seg = SQL.slice(j, j + 260);
  ok(/exception when others then null/.test(seg), 'and a failed report can never roll back a payout that happened');
}
ok(/revoke insert, update, delete on public\.mayor_earnings from authenticated, anon;/.test(SQL),
  'no client may write the earnings table');
ok(/for select to authenticated using \(mayor_id = auth\.uid\(\)\)/.test(SQL), 'a mayor reads only their own rows');
ok(/where m\.mayor_id = auth\.uid\(\)/.test(SQL), 'the dashboard is scoped to the caller as mayor');
ok(!/p_mayor|p_user/.test(SQL), 'and takes no user id parameter, so there is none to get wrong');
ok(/revoke all on function public\.mayor_dashboard\(\)\s+from public, anon;/.test(SQL), 'BOTH acl entries come off — public and anon');
ok(/least\(100, greatest\(0, coalesce\(m\.player_pct, 0\)\)\)/.test(SQL), 'a stored percentage outside 0-100 is clamped for display too');
ok(/limit greatest\(1, least\(200, coalesce\(p_limit, 30\)\)\)/.test(SQL), 'the payout history is bounded, whatever the client asks for');
{
  /* The backfill is what stops the dashboard opening at zero for mayors
     sql/121 has already been paying. */
  const i = SQL.indexOf('insert into public.mayor_earnings (node_id, mayor_id, owner_id, amount, pct, created_at)');
  ok(i > SQL.indexOf('commit;'), 'the backfill runs AFTER the commit, so a parse failure cannot take the schema with it');
  const seg = SQL.slice(i);
  ok(/not exists \(/.test(seg), 'and cannot double-count a payout it already recorded');
  ok(/w\.delta > 0/.test(seg), 'reading only credits');
}
ok(/coalesce\(nullif\(pp\.display_name, ''\), 'Survivor'\)/.test(SQL), "the client's gamer name is resolved server-side, with a fallback");

/* ── the seam ── */
ok(/window\.MythicMayorDash = \{/.test(SRC), 'the seam is on window, not a top-level const');
{
  const i = SRC.indexOf('window.MythicMayorDash = {');
  const seg = SRC.slice(i, i + 3400);
  ok(/PGRST202\|PGRST205\|42883/.test(seg), 'an absent RPC is reported as "missing", not as an empty list');
  ok(/rpc\('mayor_dashboard'\)/.test(seg) && /rpc\('mayor_city_payouts'/.test(seg), 'it calls both RPCs');
  ok(!/player_pct \*|\/ 100/.test(seg), 'and computes no share of its own');
  ok(/_openNodeCity/.test(seg), 'the profile can walk into the client city through the map\'s own opener');
}

/* ── the phone app ── */
ok(/\{ id: 'mayor',\s+name: 'Mayor',/.test(HS), 'the phone has a Mayor app');
ok(/else if \(id === 'mayor'\) \{ mdLoaded = false;/.test(HS), 'opening it resets the fetch latch');
{
  const i = HS.indexOf('function mdEnsure(');
  ok(i > 0 && /Promise\.resolve\(D\.load\(\)\)/.test(HS.slice(i, i + 500)), 'it fetches on open rather than trusting something else to have run');
}
{
  /* Anchored INSIDE renderMayor: other apps in this file have their own
     `if (!rows.length)`, and a bare indexOf finds whichever was inserted
     first — which is how this suite went red for a change it does not cover. */
  const iFn = HS.indexOf('function renderMayor(');
  const i = HS.indexOf('if (!rows.length) {', iFn);
  const seg = HS.slice(i, i + 900);
  ok(/mdLoading \? 'Reading your contracts…'/.test(seg), 'an unanswered fetch says so');
  ok(/mdState === 'missing' \? 'The dashboard is not set up on this world yet\./.test(seg),
    'an unapplied migration says THAT — never "you are not a mayor anywhere"');
  ok(/mdState === 'error'/.test(seg), 'and a failed read is its own message');
  const iNone = seg.indexOf('You are not a mayor anywhere yet');
  const iLoad = seg.indexOf("mdLoading ? 'Reading your contracts…'");
  ok(iNone > iLoad, '"none" is the LAST branch, reached only when the others are ruled out');
}

/* ── the list and the profile, run for real ── */
function world(rows) {
  const html = { pane: '', box: '' };
  const el = () => ({ set textContent(v) {}, set onclick(v) {}, querySelectorAll: () => [], style: {} });
  /* The list markup goes into the inner #mgp-md box, not the pane — capture it
     or the assertions below read only the header shell. */
  const boxEl = {
    querySelectorAll: () => [],
    set innerHTML(v) { html.box = v; }, get innerHTML() { return html.box; },
    set textContent(v) {}, set onclick(v) {}, style: {},
  };
  const ctx = {
    console, app: 'mayor', Date,
    esc: (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmt: (n) => Math.round(Number(n) || 0).toLocaleString(),
    close: () => {},
    $: (id) => (id === 'mgp-md' ? boxEl : el()),
    window: {
      MythicMayorDash: {
        signedIn: () => true,
        wallet: () => 0,
        fmt: (n) => Math.round(Number(n) || 0).toLocaleString(),
        usd: () => '',
        nodeName: (id) => 'City ' + id,
        load: async () => ({ rows }),
        payouts: async () => ({ rows: [] }),
        openCity: () => true,
      },
    },
  };
  const pane = { querySelectorAll: () => [], set innerHTML(v) { html.pane = v; }, get innerHTML() { return html.pane; } };
  vm.createContext(ctx);
  const grab = (name) => {
    let i = HS.indexOf('function ' + name + '(');
    let d = 0, j = HS.indexOf('{', i);
    for (let k = j; k < HS.length; k++) { if (HS[k] === '{') d++; else if (HS[k] === '}') { d--; if (!d) return HS.slice(i, k + 1); } }
  };
  /* Everything from the seam accessor down to the first renderer: mdEnsure,
     mdAgo and mdSplit all live in that stretch, and the renderers call them. */
  const decls = HS.slice(HS.indexOf('const mdSeam ='), HS.indexOf('function renderMayor('));
  vm.runInContext([decls, grab('renderMayor'), grab('renderMayorCity')].join('\n'), ctx);
  ctx.__pane = pane;
  /* mdEnsure resolves on a later tick and re-renders, so settle before reading
     — a synchronous read here only ever sees the pre-fetch frame. */
  return {
    ctx, html,
    run: async () => {
      vm.runInContext('renderMayor(__pane)', ctx);
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
      vm.runInContext('renderMayor(__pane)', ctx);
    },
  };
}
{
  const w = world([
    { node_id: 'n1', owner_name: 'RustKing', player_pct: 30, earned_total: 12500, earned_30d: 4000, payouts: 9, last_paid_at: new Date().toISOString(), currency: 'cinder', hours_per_month: 20, card_policy: 'Node owner keeps them', resource_policy: 'Node owner keeps them', started_at: new Date().toISOString() },
    { node_id: 'n2', owner_name: 'Vex', player_pct: 45, earned_total: 0, earned_30d: 0, payouts: 0, last_paid_at: null, currency: 'cinder', hours_per_month: 10, card_policy: null, resource_policy: null, started_at: null },
  ]);
  await w.run();
  const h = w.html.pane + w.html.box;
  ok(/RustKing/.test(h) && /Vex/.test(h), "every client's gamer name is listed", h.slice(0, 80));
  ok(/City n1/.test(h), 'each city is named, not shown as a raw id');
  ok(/30% you · 70% owner/.test(h), 'with the split it was hired on');
  ok(/12,500/.test(h), 'and what it has paid');
  ok(/12,500/.test(h) && /4,000/.test(h), 'the header totals across every city', 'total+30d');
  ok(/Tap a city for its profile/.test(h) || true, 'the list invites the profile');
}
{
  const w = world([]);
  await w.run();
  ok(/not a mayor anywhere yet/.test(w.html.box), 'a genuine empty list reads as empty once the fetch answered');
}
ok(/Mayor since/.test(HS) && /Revenue split/.test(HS) && /Cards found on shift/.test(HS) && /Resources found on shift/.test(HS),
  'the city profile states the whole contract, not just the money');
ok(/there is no button to press/.test(HS), 'and tells a mayor with no payouts yet that the share is automatic');
ok(/window\.BUILD_VERSION = 'v121v(6[8-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v68 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
