/* ⏳ HELD CINDER RELEASE — sql/156 + sql/157 + the client call.

   Reported by the owner (2026-09-17): "ClareyV has 315,908 Cinder stuck behind
   the daily earnings cap and never released."

   Root cause (live, read-only): sql/093's wallet_holds_release() paid holds one
   row at a time — five writes per hold, one of them a user_profiles update whose
   up_guard trigger is heavy. ClareyV had 35,688 tiny holds (~9 Cinder each), so
   every call hit the 8 s statement_timeout, rolled back, and the client
   swallowed the error. sql/156 does the same rule as one set-based UPDATE and
   one _ct_cinder_give credit (rehearsed on live in a rolled-back block: 622 ms,
   315,908 released, second call 0).

   This suite pins:
     1. sql/156 — set-based, locked, exactly-once, not client-nameable, same cap.
     2. NEGATIVE CONTROL — the set-based detector run over 093's release body
        must say NO. If it said yes, check 1 would prove nothing.
     3. The allocation rule, run for real on a JS mirror of the SQL CTE: oldest
        first, never more than the room, idempotent, nothing minted.
     4. sql/157 — draft, lists the stuck players, reuses the worker, re-runnable.
     5. The client: runs walletHoldsCheck against fakes (release, missing RPC,
        timeout) and the Cinder pill's held tag; sign-in calls the release.
     6. HELD FIRST (owner, 2026-09-18: "yes" to "Should held Cinder be paid out
        first?"). sql/156's wallet_credit locks the wallet, runs the SAME worker
        before it looks at the room, then credits the new income into what is
        left and appends the rest to the newest open hold. Pinned in the SQL,
        then run for real on a JS model: a player at the cap every day drains
        their oldest holds; no new income is paid while an older hold waits;
        wallet + held == before + income, to the Cinder, every step; merging
        into one open row releases every event in exactly the order separate
        rows would. NEGATIVE CONTROL: the 093 order (new income first) fails
        the held-first check and never drains an at-cap player.
        (Rehearsed on live 2026-09-18 in a rolled-back DO block as ClareyV —
        see the report; nothing persisted.)

   Run: node _holdrelease_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SRC = rd('./public/index.html');
const S156 = rd('./sql/156_hold_release.sql');
const S157 = rd('./sql/157_hold_release_backlog.sql');
const S093 = rd('./sql/093_wallet_daily_cap_4500000_and_holds.sql');

const fnBody = (sql, name) => {
  const i = sql.indexOf('create or replace function public.' + name + '(');
  if (i < 0) return '';
  const j = sql.indexOf('end$function$;', i);
  return j < 0 ? '' : sql.slice(i, j + 14);
};
/* "Set-based": no per-row loop, holds updated in ONE statement from an
   allocation CTE, the wallet credited ONCE through _ct_cinder_give. */
const setBased = (body) => !!body
  && !/\bfor\s+\w+\s+in\b/i.test(body)
  && !/\bloop\b/i.test(body)
  && /update public\.wallet_holds h\s+set released = h\.released \+ take\.t/.test(body)
  && (body.match(/_ct_cinder_give\(/g) || []).length === 1
  && !/update public\.user_profiles/.test(body);

/* ── 1. sql/156 ── */
console.log('sql/156');
const W = fnBody(S156, '_wallet_holds_release_for');
const P = fnBody(S156, 'wallet_holds_release');
ok(/^-- DRAFT — NOT APPLIED\./m.test(S156), 'header says DRAFT — NOT APPLIED');
ok(!!W && /returns jsonb language plpgsql security definer set search_path to 'public'/.test(W), 'the worker exists and is SECURITY DEFINER with a pinned search_path');
ok(setBased(W), 'the worker is set-based: no loop, one UPDATE of the holds, one _ct_cinder_give credit');
ok(/select coalesce\(cinder, 0\) into v_bal from public\.user_progress where user_id = p_uid for update;/.test(W)
   && W.indexOf('for update;') < W.indexOf('with open_h as'), 'the player\'s wallet row is locked FOR UPDATE before any hold is read (two tabs cannot pay the same hold)');
ok(/perform 1 from public\.wallet_holds\s+where user_id = p_uid and released < amount\s+order by created_at, id\s+for update;/.test(W), 'the open hold rows are locked too, oldest first');
ok(/sum\(amount - released\) over \(order by created_at, id\s+rows between unbounded preceding and 1 preceding\)/.test(W)
   && /least\(rem, v_room - before\)/.test(W) && /where before < v_room/.test(W), 'allocation: running sum oldest first, each hold takes at most the room left');
ok(/select coalesce\(sum\(t\), 0\), count\(\*\) into v_rel, v_n from upd;/.test(W)
   && /public\._ct_cinder_give\(p_uid, v_rel,/.test(W), 'the credit is exactly what `released` grew by (v_rel from the UPDATE … RETURNING)');
ok(/v_room := greatest\(0, c_max_day - v_day\);/.test(W) && /if v_room > 0 then/.test(W), 'bounded by the same room rule as 093 (no room → no writes)');
{
  const cap156 = (W.match(/c_max_day constant bigint := (\d+);/) || [])[1];
  const credit093 = fnBody(S093, 'wallet_credit');
  const cap093 = (credit093.match(/c_max_day\s+constant bigint := (\d+);/) || [])[1];
  ok(cap156 && cap156 === cap093, 'the release uses the SAME daily cap as wallet_credit', cap156 + ' vs ' + cap093);
}
ok(!/wallet_credit\(/.test(W), 'the release does not go through wallet_credit, so the cap cannot re-hold it');
ok(/revoke all on function public\._wallet_holds_release_for\(uuid\) from public, anon, authenticated;/.test(S156), 'a client cannot call the worker with someone else\'s uid');
ok(/return public\._wallet_holds_release_for\(auth\.uid\(\)\);/.test(P) && /grant execute on function public\.wallet_holds_release\(\) to authenticated;/.test(S156)
   && /revoke all on function public\.wallet_holds_release\(\) from public, anon;/.test(S156), 'the player call is the worker for auth.uid() only; anon cannot call it');
ok(/'released', v_rel, 'holds', v_n, 'held', v_left,\s+'cinder', coalesce\(v_bal, 0\), 'cap', c_max_day, 'frees_at', v_frees/.test(W), 'the answer keeps 093\'s shape (the live client works the moment 156 is applied)');
ok(!/create table/i.test(S156), 'no new table (so no new RLS owed)');
ok(/\n-- VERIFY \(read-only\)\n[\s\S]*\nselect\n[\s\S]*cinder_still_held;\s*$/.test(S156), 'ends with a verify SELECT');

/* ── 2. NEGATIVE CONTROL ── */
console.log('negative control');
const R093 = fnBody(S093, 'wallet_holds_release');
ok(!!R093 && /for r in/.test(R093), 'control: 093\'s release is found and is the per-row loop');
ok(!setBased(R093), 'control: the set-based detector says NO to 093 (the detector can fail)');
ok(!setBased(W.replace('with open_h as', 'for r in select 1 loop end loop; with open_h as')), 'control: sneaking a loop back into 156 turns check 1 red');

/* ── 3. the allocation rule, run for real ── */
console.log('allocation (JS mirror of the CTE)');
function release(holds, room) {         // mirrors open_h → take → upd
  const open = holds.filter(h => h.released < h.amount).sort((a, b) => a.t - b.t || a.id - b.id);
  let before = 0, rel = 0, n = 0;
  for (const h of open) {
    const rem = h.amount - h.released;
    if (before < room) { const t = Math.min(rem, room - before); if (t > 0) { h.released += t; rel += t; n++; } }
    before += rem;
  }
  return { rel, n };
}
{
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const holds = []; let total = 0;
  for (let i = 0; i < 35688; i++) { const a = 1 + Math.floor(rnd() * 17); total += a; holds.push({ id: i, t: i, amount: a, released: 0 }); }
  const r1 = release(holds, 4452112);
  ok(r1.rel === total && r1.n === 35688, 'ClareyV-shaped backlog (35,688 small holds) with 4,452,112 room: everything releases in one call', r1.rel + '/' + total);
  const r2 = release(holds, 4452112);
  ok(r2.rel === 0 && r2.n === 0, 'second call releases 0 (exactly once)');
  ok(holds.every(h => h.released === h.amount), 'every hold is marked fully released — paid == released growth, nothing minted');
}
{
  const holds = [{ id: 1, t: 3, amount: 500, released: 0 }, { id: 2, t: 1, amount: 300, released: 100 }, { id: 3, t: 2, amount: 400, released: 0 }];
  const r = release(holds, 450);
  ok(r.rel === 450 && holds[1].released === 300 && holds[2].released === 250 && holds[0].released === 0, 'partial room: oldest first (200 from the oldest, 250 from the next), never more than the room');
  ok(release(holds, 0).rel === 0, 'no room → nothing moves');
}

/* ── 4. sql/157 ── */
console.log('sql/157');
ok(/^-- DRAFT — NOT APPLIED\./m.test(S157), 'header says DRAFT — NOT APPLIED');
ok(/ClareyV\s+6b721987\s+35,688\s+315,908/.test(S157), 'the header lists ClareyV, uid prefix, rows and 315,908');
{
  const code157 = S157.replace(/^\s*--.*$/gm, '');
  ok(/j := public\._wallet_holds_release_for\(r\.user_id\);/.test(code157) && !/update public\.(wallet_holds|user_progress|user_profiles)/i.test(code157) && !/_ct_cinder_give|wallet_credit|insert into/i.test(code157), 'it calls the SAME worker and writes nothing itself');
}
ok(/to_regprocedure\('public\._wallet_holds_release_for\(uuid\)'\) is null then\s+raise exception/.test(S157), 'refuses to run before sql/156');
ok(/where h\.released < h\.amount/.test(S157), 'only open holds are visited (re-running pays nothing twice)');
ok(/\n-- VERIFY[\s\S]*\nselect [\s\S]*order by still_held desc;\s*$/.test(S157), 'ends with a verify SELECT');

/* ── 5. the client ── */
console.log('client');
{
  const a = SRC.indexOf('let _walletHoldsT = 0');
  const b = SRC.indexOf('function walletHoldsSoon()');
  ok(a > 0 && b > a, 'walletHoldsCheck is found');
  const body = SRC.slice(a, b);
  const unavail = SRC.slice(SRC.indexOf('function _walletRpcUnavailable(err) {'), SRC.indexOf('// Pull the canonical progress row'));
  const run = async (rpcResult) => {
    const g = {
      toasts: [], warns: [], renders: 0, saved: 0,
      App: {}, Profile: { gems: 100, cloud: { signedIn: true } }, Wallet: { rpcMissing: false },
      Cloud: { client: { rpc: async (n) => { g.called = n; return rpcResult; } } },
      showToast: (m) => g.toasts.push(m), notify: () => {}, saveProfile: () => { g.saved++; }, render: () => { g.renders++; },
      _gemsTaxExempt: (f) => f(), console: { warn: (...x) => g.warns.push(x.join(' ')) },
      Date, Math, Number, String, setTimeout: () => 0, clearTimeout: () => {},
    };
    const fn = new Function('g', 'with (g) { ' + unavail + body + ' return walletHoldsCheck; }')(g);
    await fn();
    return g;
  };
  let g = await run({ data: { ok: true, released: 315908, held: 0, holds: 35688, cinder: 14089854, cap: 4500000, frees_at: null } });
  ok(g.called === 'wallet_holds_release', 'it calls wallet_holds_release');
  ok(g.toasts.includes('🔥 315,908 Cinder released from yesterday\'s cap'), 'release → toast "315,908 Cinder released from yesterday\'s cap"', JSON.stringify(g.toasts));
  ok(g.Profile.gems === 14089854 && g.saved === 1 && g.App._walletHeld === 0, 'adopts the server balance, saves, clears the held figure');

  g = await run({ data: { ok: true, released: 0, held: 12345, holds: 0, cinder: 100, cap: 4500000, frees_at: '2026-09-18T13:42:16Z' } });
  ok(g.App._walletHeld === 12345 && g.App._walletHeldFreesAt === '2026-09-18T13:42:16Z' && g.renders === 1, 'still held → the pill figure and release time are set and the rail re-renders');
  ok(g.toasts.some(t => /12,345 Cinder is over your 4,500,000 daily limit/.test(t)), 'still held → the player is told the number');

  g = await run({ error: { code: 'PGRST202', message: 'Could not find the function public.wallet_holds_release' } });
  ok(g.warns.length === 0 && g.toasts.length === 0, 'legacy: function missing (PGRST202) → silent');
  g = await run({ error: { code: '42883', message: 'function public.wallet_holds_release() does not exist' } });
  ok(g.warns.length === 0 && g.toasts.length === 0, 'legacy: function missing (42883) → silent');
  g = await run({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  ok(g.warns.length === 1 && /57014/.test(g.warns[0]), 'the ClareyV failure (57014 timeout) is no longer swallowed — it is logged');
  ok(g.Profile.gems === 100 && g.toasts.length === 0, '…and a failed release changes nothing locally');
}
{
  const f = SRC.slice(SRC.indexOf('async function walletFetchProgress() {'));
  const tail = f.slice(0, f.indexOf('\n}\n'));
  ok(/Wallet\.lastFetchAt = Date\.now\(\);\n\s+try \{ saveProfile\(\); \} catch \(e\) \{\}\n[\s\S]{0,300}try \{ walletHoldsSoon\(\); \} catch \(e\) \{\}\n\s+return \{ ok: true, row: r\.data \};/.test(tail), 'a returning player\'s sign-in asks for the release (not only the first-seed branch)');
}
{
  const i = SRC.indexOf('let heldTag = \'\', heldTip = \'\';');
  const blk = SRC.slice(i, SRC.indexOf('return `', i));
  ok(i > 0 && /\$\{cin\}\$\{heldTag\}<\/div>/.test(SRC) && /'Cinders \(earned in-game\)' \+ heldTip/.test(SRC), 'the Cinder pill carries the held tag and a tooltip with the release time');
  const g = { App: { _walletHeld: 315908, _walletHeldFreesAt: '' }, settling: false, Math, Number, Date };
  const out = new Function('g', 'with (g) { ' + blk + ' return [heldTag, heldTip]; }')(g);
  ok(/⏳ \+315,908/.test(out[0]) && /315,908 Cinder held over the daily cap, releases within 24 hours/.test(out[1]), 'run for real: 315,908 held → "⏳ +315,908" and its tooltip');
  g.App._walletHeld = 0;
  const none = new Function('g', 'with (g) { ' + blk + ' return [heldTag, heldTip]; }')(g);
  ok(none[0] === '' && none[1] === '', 'nothing held → no tag');
}

/* ── 6. HELD FIRST ── */
console.log('held-first (sql/156 wallet_credit)');
const C = fnBody(S156, 'wallet_credit');
/* "Held-first" in the SQL: the worker is CALLED (not copied) after the
   refusals and BEFORE the room for the new income is computed, under a wallet
   lock taken before the ref check. */
const heldFirstSql = (body) => {
  if (!body) return false;
  const lock = body.search(/select coalesce\(cinder,\s*0\) into v_bal from public\.user_progress where user_id = v_uid for update;/);
  const refc = body.indexOf('ref = p_ref');
  const hour = body.indexOf('c_max_hour then');
  const rel = body.indexOf('public._wallet_holds_release_for(v_uid)');
  const room = body.indexOf('v_room := greatest(0, c_max_day - v_day);');
  const pay = body.indexOf('set cinder = coalesce(cinder, 0) + p_amount');
  return lock > 0 && lock < refc && refc < hour && hour < rel && rel < room && room < pay;
};
ok(!!C && /create or replace function public\.wallet_credit\(p_amount bigint, p_reason text default 'reward', p_ref text default null\)\nreturns bigint language plpgsql security definer set search_path to 'public'/.test(C), 'wallet_credit keeps its signature and bigint answer (every server caller and the client keep working)');
ok(heldFirstSql(C), 'order: wallet lock → ref check → refusals → RELEASE HOLDS → room for new income → credit');
ok(!/with open_h as|sum\(amount - released\) over/.test(C), 'the release is the worker, called — not a copy of its allocation that could drift');
ok(/v_rel := public\._wallet_holds_release_for\(v_uid\);[\s\S]{0,200}v_bal := coalesce\(\(v_rel ->> 'cinder'\)::bigint, v_bal\);/.test(C), 'the returned balance includes what the call released');
ok(/update public\.wallet_holds h\s+set amount = h\.amount \+ v_hold, updated_at = now\(\)\s+where h\.id = \(select id from public\.wallet_holds\s+where user_id = v_uid and released < amount\s+order by created_at desc, id desc\s+limit 1\)/.test(C)
   && /if v_hid is null then\s+insert into public\.wallet_holds \(user_id, amount, reason\) values \(v_uid, v_hold, p_reason\);/.test(C), 'excess is appended to the NEWEST open hold (the queue tail); a new row only when nothing is open');
ok(/'HELD daily>'[\s\S]*' held=' \|\| v_hold/.test(C), 'every held credit still writes its own \'held\' ledger row (the per-event audit)');
ok(/grant execute on function public\.wallet_credit\(bigint, text, text\) to authenticated, service_role;/.test(S156) && /revoke all on function public\.wallet_credit\(bigint, text, text\) from public, anon;/.test(S156), 'grants match live (authenticated + service_role, never anon)');
{
  const capC = (C.match(/c_max_day\s+constant bigint := (\d+);/) || [])[1];
  const capW = (W.match(/c_max_day constant bigint := (\d+);/) || [])[1];
  ok(capC && capC === capW, 'wallet_credit and the worker share one daily cap', capC + ' vs ' + capW);
}
ok(/credit_is_held_first/.test(S156), 'the VERIFY checks the live body is held-first');
ok(!heldFirstSql(fnBody(S093, 'wallet_credit')), 'control: the 093 wallet_credit fails the held-first SQL check');

/* The model. Holds are rows of SEGMENTS {ev, amt} so a merged row still knows
   which event each Cinder came from; release eats from the front of the
   oldest row. Both orders use the same release (the worker). */
function Wallet(order, merge, cap) {
  const s = { wallet: 0, rows: [], window: [], order, merge, cap, paidEv: {}, violations: 0, ev: 0 };
  const used = () => s.window.reduce((a, x) => a + x, 0);
  const held = () => s.rows.reduce((a, r) => a + r.segs.reduce((b, g) => b + g.amt, 0), 0);
  const release = () => {
    let room = Math.max(0, s.cap - used()), rel = 0;
    while (room > 0 && s.rows.length) {
      const r = s.rows[0], g = r.segs[0], t = Math.min(g.amt, room);
      g.amt -= t; room -= t; rel += t; s.paidEv[g.ev] = (s.paidEv[g.ev] || 0) + t;
      if (!g.amt) r.segs.shift(); if (!r.segs.length) s.rows.shift();
    }
    if (rel) { s.wallet += rel; s.window.push(rel); }
    return rel;
  };
  s.held = held; s.release = release;
  s.credit = (amt) => {
    const ev = ++s.ev;
    if (s.order === 'held-first') release();
    const room = Math.max(0, s.cap - used()), fit = Math.min(amt, room), hold = amt - fit;
    if (fit > 0 && held() > 0) s.violations++;          // new income paid while an older hold waits
    if (fit) { s.wallet += fit; s.window.push(fit); }
    if (hold) {
      if (s.merge && s.rows.length) s.rows[s.rows.length - 1].segs.push({ ev, amt: hold });
      else s.rows.push({ segs: [{ ev, amt: hold }] });
    }
    return ev;
  };
  s.day = () => { s.window = []; };                    // the 24h window rolls over
  return s;
}
function simulate(order, merge) {
  const s = Wallet(order, merge, 4500000);
  let income = 0, conserved = true, firstDrainDay = -1;
  const backlogEv = [];
  s.window = [4500000];                                  // the day is already full…
  for (let i = 0; i < 40; i++) { income += 9000; backlogEv.push(s.credit(9000)); }   // …so all of this is held
  const heldAtStart = s.held();
  for (let d = 1; d <= 5; d++) {
    s.day();
    for (let k = 0; k < 50; k++) {                       // 50 × 100,000 = 5,000,000/day: at the cap every day
      income += 100000; s.credit(100000);
      if (s.wallet + s.held() !== income) conserved = false;
    }
    s.release(); s.release();                            // the client's calls: nothing left to pay
    if (s.wallet + s.held() !== income) conserved = false;
    if (firstDrainDay < 0 && backlogEv.every(e => (s.paidEv[e] || 0) === 9000)) firstDrainDay = d;
  }
  return { s, conserved, firstDrainDay, heldAtStart };
}
{
  const hf = simulate('held-first', true);
  const old = simulate('income-first', true);
  ok(hf.heldAtStart === 360000, 'model: 360,000 held behind a full day to start with', hf.heldAtStart);
  ok(hf.firstDrainDay === 1, 'held-first: a player at the cap every day gets the old backlog back on the first new day', hf.firstDrainDay);
  ok(hf.s.violations === 0, 'held-first: no new income is ever paid while an older hold is open', hf.s.violations);
  ok(hf.conserved, 'held-first: wallet + held == before + income after every credit and release (nothing minted, nothing lost)');
  ok(old.conserved, 'the 093 order conserves too (the change is the ORDER, not the amounts)');
  ok(old.firstDrainDay === -1 && old.s.violations > 0, 'NEGATIVE CONTROL: the 093 order pays new income first and the at-cap player never gets the backlog back', old.firstDrainDay + ' / ' + old.s.violations);
  const hfOne = simulate('held-first', false);
  ok(JSON.stringify(hf.s.paidEv) === JSON.stringify(hfOne.s.paidEv) && hf.s.wallet === hfOne.s.wallet && hf.s.held() === hfOne.s.held(),
     'merging into one open row releases every event exactly as separate rows would (FIFO kept)');
  ok(hf.s.rows.length <= 1, 'merged: at most ONE open hold row per player (no more 35,688-row backlogs)', hf.s.rows.length);
  ok(hfOne.s.rows.length > 1, 'control: unmerged, the same history leaves many rows', hfOne.s.rows.length);
}
{
  // the rehearsal's shape: at cap, +1,000 held; 200,000 room appears, +5,000 → the holds get it all.
  const s = Wallet('held-first', true, 4500000);
  s.window = [4500000]; s.rows = [{ segs: [{ ev: 0, amt: 315908 }] }];
  const before = s.wallet + s.held();
  s.credit(1000);
  ok(s.wallet === 0 && s.held() === 316908 && s.rows.length === 1, 'at cap: +1,000 is held behind the backlog, no new row');
  s.window = [4300000];
  s.credit(5000);
  ok(s.wallet === 200000 && s.held() === 121908 && s.paidEv[0] === 200000 && !s.paidEv[1] && !s.paidEv[2], '200,000 of room: all of it to the OLDEST hold, the 5,000 is held behind (the live rehearsal\'s numbers)');
  ok(s.wallet + s.held() === before + 6000, 'conservation to the Cinder: ' + (s.wallet + s.held()) + ' = ' + (before + 6000));
  const o = Wallet('income-first', true, 4500000);
  o.window = [4300000]; o.rows = [{ segs: [{ ev: 0, amt: 316908 }] }];
  o.credit(5000);
  ok(o.violations === 1, 'NEGATIVE CONTROL: the 093 order pays the 5,000 while 316,908 older Cinder waits');
}

console.log(fails ? '\n' + fails + ' FAILED (' + passes + ' passed)' : '\nALL PASS (' + passes + ')');
process.exit(fails ? 1 : 0);
