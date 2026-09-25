/* 🏛 THE MAYOR HALL REVENUE SPLIT ACTUALLY PAYS (v121v65).

   Asked for: the revenue split set in Mayor Hall must be connected to the city
   builder, so a node owner who hired a mayor splits the city's Cinder by the
   accepted contract.

   What was true before: node_mayors.player_pct was written by Mayor Hall,
   read by the game to PRINT on a button, and applied to nothing.
   city_owner_ledger_apply credited the owner with 100% of every payout. A
   mayor could work a 30/70 contract for a month and be paid nothing by it.

   The two things this suite refuses to let regress:

     · THE SPLIT IS SERVER SIDE. The client running the city is the mayor's
       client and Cinder withdraws to real money through the Cashout Vault, so
       a percentage the payee can edit is a faucet, not a contract. No arith-
       metic that decides money may appear in index.html.
     · CUT + OWNER = DELTA, EXACTLY. Floored cut, exact remainder to the owner.
       Two independent floors would leak a Cinder per payout to nobody, and a
       ceil would mint one.

   Run: node _mayorsplit_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/121_mayor_revenue_split.sql', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── the split arithmetic, as the SQL states it ── */
{
  /* Mirrors the two lines in sql/121 exactly:
       if delta > 0 and pct > 0 then cut := floor(delta * pct / 100.0)
       owner := delta - cut                                              */
  const split = (delta, pct) => {
    const p = Math.min(100, Math.max(0, Number(pct) || 0));
    const cut = (delta > 0 && p > 0) ? Math.floor(delta * p / 100) : 0;
    return { cut, owner: delta - cut };
  };
  ok(/v_cut := floor\(v_delta \* v_pct \/ 100\.0\);/.test(SQL), 'the cut is FLOORED, never rounded up — no minting');
  ok(/v_owner_delta := v_delta - v_cut;/.test(SQL), 'and the owner takes the exact remainder, not a second floor');
  let leak = 0, minted = 0;
  for (let d = 0; d <= 400; d++) {
    for (const p of [0, 1, 7, 25, 30, 33, 50, 70, 99, 100]) {
      const s = split(d, p);
      if (s.cut + s.owner !== d) { leak++; }
      if (s.cut > d) minted++;
    }
  }
  ok(leak === 0, 'across 4000 payouts, cut + owner is always exactly the delta', leak + ' mismatches');
  ok(minted === 0, 'and the mayor is never paid more than the city earned');
  ok(split(100, 30).cut === 30 && split(100, 30).owner === 70, 'the screenshot contract pays 30 / 70', JSON.stringify(split(100, 30)));
  ok(split(7, 30).cut === 2 && split(7, 30).owner === 5, 'the rounding crumb goes to the owner, who carries the city', JSON.stringify(split(7, 30)));
  ok(split(100, 0).cut === 0, 'a 0% contract pays the mayor nothing');
  ok(split(100, 100).cut === 100 && split(100, 100).owner === 0, 'a 100% contract pays it all through');
  /* THE RULE THAT MATTERS MOST: a spend is not a rebate. */
  ok(split(-250, 30).cut === 0 && split(-250, 30).owner === -250, 'a SPEND is never split — it comes wholly out of the owner', JSON.stringify(split(-250, 30)));
}
ok(/if v_delta > 0 and coalesce\(v_pct, 0\) > 0 then/.test(SQL), 'only a positive delta is shared, in the SQL itself');
ok(/least\(100, greatest\(0, coalesce\(m\.player_pct, 0\)\)\)/.test(SQL), 'a stored percentage outside 0-100 is clamped, not trusted');

/* ── authority ── */
ok(/and m\.mayor_id = auth\.uid\(\)/.test(SQL) && /and coalesce\(m\.active, true\)/.test(SQL),
  'terms are only readable by the ACTIVE mayor of that node');
ok(/security definer set search_path = public/.test(SQL), 'the function pins its search_path');
ok(/revoke all on function public\._node_mayor_terms\(text\) from public, anon;/.test(SQL),
  'BOTH acl entries come off the new function — public and anon');
ok(/grant execute on function public\._node_mayor_terms\(text\) to authenticated;/.test(SQL), 'and signed-in players may call it');
{
  const iRefuse = SQL.indexOf("'insufficient_cinder'");
  const iPay = SQL.indexOf('_ct_cinder_give');
  ok(iRefuse > 0 && iPay > iRefuse, 'the mayor is paid AFTER the owner side commits, never before a refusal can fire');
}
ok(/perform public\._ct_cinder_give\(v_mayor, v_cut::bigint/.test(SQL),
  'the share goes through the canonical faucet, so the wallet and its ledger agree');
ok(/Mayor revenue share \(/.test(SQL), 'and lands in the phone ledger as a named line, not an unexplained credit');
{
  /* The contract words its resource terms as a policy ("Node owner keeps
     them"), not a percentage. Reading them as one would pay people terms they
     never agreed to, so the salvage loop must not know the split exists. */
  const body = SQL.replace(/--[^\n]*/g, '');
  const i = body.indexOf('for k in select jsonb_object_keys');
  const loop = body.slice(i, body.indexOf('end loop;', i));
  ok(i > 0 && !/v_pct|v_cut/.test(loop), 'the salvage loop never touches the split — resources are not a percentage', loop.slice(0, 90));
  ok(/resource_policy/.test(SQL), 'and the file says why');
}

/* ── no money maths on the client ── */
{
  const c = fnText('_cityCutReport');
  ok(!/\/\s*100|\*\s*pct|player_pct/.test(c), 'the client computes no share of its own — it reports the server\'s', c.slice(0, 120));
  ok(/Number\(cut\)/.test(c), 'it only reads the number the server sent');
}
ok(/if \(Number\(j\.mayor_cut\) > 0\)/.test(SRC), 'a taken delta reports the cut the server actually moved');
{
  const i = SRC.indexOf('if (Number(j.mayor_cut) > 0)');
  const j = SRC.indexOf('CityMgr.cinder = Math.max(0, Math.round(Number(j.cinder) || 0));');
  ok(i > 0 && j > 0 && i > j, 'after adopting the owner balance, which already has the cut taken off');
}

/* ── the client report, run for real ── */
{
  const world = () => {
    const toasts = [];
    const ctx = { console, window: {}, CityMgr: {}, document: { getElementById: () => null },
      showToast: (t) => toasts.push(String(t)), Date, Profile: {}, App: {} };
    vm.createContext(ctx);
    vm.runInContext([fnText('_cityCutNote'), fnText('_twMayorCutBadge'), fnText('_cityCutReport')].join('\n'), ctx);
    return { ctx, toasts, run: (c, p) => vm.runInContext('_cityCutReport(' + c + ',' + p + ')', ctx) };
  };
  {
    const w = world();
    ok(w.run(30, 30) === true, 'the first share is announced');
    ok(/30% you · 70% owner/.test(w.toasts[0]), 'and states the contract in the player\'s own terms', w.toasts[0]);
    ok(w.ctx.CityMgr.myCut === 30, 'the session tally starts');
    ok(w.run(30, 30) === false, 'the next payout does not toast again — a city pays every few seconds');
    ok(w.ctx.CityMgr.myCut === 60, 'but it still counts', String(w.ctx.CityMgr.myCut));
  }
  {
    const w = world();
    ok(w.run(0, 30) === false && !w.ctx.CityMgr.myCut, 'a zero share says nothing and counts nothing');
    ok(w.run(-5, 30) === false, 'and a negative one is refused outright');
  }
  {
    const say = (p) => {
      const ctx = { console };
      vm.createContext(ctx);
      vm.runInContext(fnText('_cityCutNote'), ctx);
      return vm.runInContext('_cityCutNote(' + p + ')', ctx);
    };
    ok(say(30) === '30% you · 70% owner' && say(0) === '0% you · 100% owner' && say(100) === '100% you · 0% owner',
      'the wording always totals 100', say(30) + ' / ' + say(0));
  }
}

/* ── the badge ── */
ok(/id = 'node-city-cut'/.test(SRC), 'a hired mayor sees the contract on the city host bar');
{
  const i = SRC.indexOf("if (App._cityOwnerId && typeof _twNodeMayor === 'function')");
  ok(i > 0, 'the badge is gated on being in someone ELSE\'s city');
  ok(/_mrow\.mayor_id === \(\(Profile\.cloud && Profile\.cloud\.userId\) \|\| null\)/.test(SRC),
    'and on being that city\'s actual mayor');
}
ok(/CityMgr\.myCut = 0; CityMgr\._cutToldAt = 0;/.test(SRC), 'a different client city starts a fresh tally');
ok(/window\.MythicMayorPay = \{/.test(SRC), 'the seam is on window, not a top-level const');
ok(/window\.BUILD_VERSION = 'v121v(6[5-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v65 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
