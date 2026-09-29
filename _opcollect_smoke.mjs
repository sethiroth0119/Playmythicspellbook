/* 🔴 v121v127 — the Just Business collect exploit (bug-mtxzznni, high).
   A collect pays a pure function of (now − meta.lastCollect), capped at 36 h.
   The marker was written AFTER the payout, and for a CEO who is not the founder
   the write was refused by policy and returned 204 with NO error — so the
   client believed it had recorded the collection, re-read the stale row, and
   offered the same 36 hours again. Forever.
   Run: node _opcollect_smoke.mjs

   🔴 AND THAT FIX ZEROED EVERY COLLECT (bug-mu0bw80h), which this suite did not
      see. The claim moves lastCollect to now; the settle ran afterwards and
      measured (now − lastCollect) ≈ 0 hours. §5 below shows the claim leaves
      nothing for the NEXT click — true, and the intent — but it re-implements
      the formula inside the test and never runs the real functions in order,
      so it could not see that the SAME click was also paid that nothing.
      §6 onward runs _opComputed, _opClaimCollect and _opSettle for real, in the
      handler's order; §8 is the negative control that reproduces the zero.
      Four checks below were pinned to the TEXT of a call and are now matched to
      its rule; each says so where it changed. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
function fnText(name, src) {
  const s = src || SRC;
  let i = s.indexOf('async function ' + name + '(');
  if (i < 0) i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, started = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += d || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); i = e < 0 ? src.length : e; continue; }
    out += c; i++;
  }
  return out;
}
const constVal = (name) => { const m = new RegExp('const ' + name + ' = ([^;]+);').exec(SRC); return m ? m[1] : null; };


/* ── 1. claim first, pay second ── */
ok(/async function _opClaimCollect\(o\) \{/.test(SRC), 'the collection is CLAIMED by a function of its own');
/* ⚠ was /\.eq('id', o.id)\.select('id');/ — the chain now carries the compare-and-set
   filter between the two, so this asks the rule instead: the claim reads its row back. */
ok(/\.select\('id'\)/.test(stripComments(fnText('_opClaimCollect'))), '…which asks for the row back — a refused update answers 204 with no error, so without this a refusal looks exactly like success');
ok(/if \(!up \|\| !Array\.isArray\(up\.data\) \|\| up\.data\.length === 0\) return false;   \/\/ refused by policy — say so/.test(SRC), '…and no row means refused');
ok(/const _claimed = await _opClaimCollect\(o\);/.test(SRC), 'the handler claims BEFORE it settles');
{
  const i = SRC.indexOf('const _claimed = await _opClaimCollect(o);'), j = SRC.indexOf('const s = await _opSettle(o, c);');   // ⚠ was _opSettle(o) — it now pays what was measured BEFORE the claim
  ok(i > 0 && j > i, '…and the payout happens only after it, not before', 'claim@' + i + ' settle@' + j);
}
{
  /* ⚠ was a 400-character window after the brace; the already-collected branch now
     sits first. An ordered search asks the same thing: the refusal says nothing was
     paid, and says it before any payout call. */
  const h = SRC.slice(SRC.indexOf('if (!_claimed) {'));
  const iMsg = h.indexOf('nothing was paid'), iPay = h.indexOf('await _opSettle(');
  ok(iMsg > 0 && iMsg < iPay, 'a refused claim pays NOTHING and says so');
}

/* ── 2. the marker no longer trails the money ── */
{
  /* ⚠ was indexOf('async function _opSettle(o) {') — -1 once the signature gained `pre`,
     and slice(-1, 8999) is not the settle, so the negative check below would have
     passed on nothing at all. Found by name, and its presence asserted. */
  const settle = fnText('_opSettle');
  ok(settle.length > 200, 'the settle is found — a missing function must not make the next check vacuous');
  ok(!/lastCollect: Date\.now\(\) \}\);\n  try \{\n    const up = await Cloud\.client\.from\('corp_operations'\)\.update\(\{ meta: meta/.test(settle),
    'the settle no longer writes the marker after paying — that write is gone from it entirely');
}

/* ── 3. one at a time ── */
ok(/let _jbOpBusy = \{\};/.test(SRC) && /if \(_jbOpBusy\[a\.opId\]\) \{/.test(SRC), 'a second collect of the same operation is refused while the first is in flight');
ok(/_jbOpBusy\[a\.opId\] = true;\n\s*\/\* 🔴 CLAIM BEFORE PAYING/.test(SRC), '…and the lock is taken immediately before the claim, so a cheap refusal cannot strand it');
ok(/const _claimed = await _opClaimCollect\(o\);\n\s*try \{ delete _jbOpBusy\[a\.opId\]; \} catch \(e2\) \{\}/.test(SRC), '…and released once the marker has moved (the six-hour cooldown holds the door after that)');

/* ── 4. the door ── */
ok(/if \(e\.origin && e\.origin !== window\.location\.origin\) return;/.test(SRC), 'the Just Business message handler takes messages from our own origin only — it checked the message TYPE and nothing else');

/* ── 5. run the accrual rule for real ── */
{
  /* the shape the payout is computed from */
  const CAP_H = 36, CD_MS = 6 * 3600000;
  const computed = (lastCollect, now) => {
    const hrs = Math.min(CAP_H, Math.max(0, (now - lastCollect) / 3600000));
    return { hrs, gross: Math.floor(100 * hrs), cdLeft: Math.max(0, (lastCollect + CD_MS) - now) };
  };
  const now = Date.now(), day = 86400000;
  const first = computed(now - 2 * day, now);
  ok(first.hrs === 36 && first.cdLeft === 0, 'run for real: two days of accrual pays the 36-hour cap and the cooldown is clear');
  /* the old order: pay, then fail to record → the next call pays the same again */
  const brokenSecond = computed(now - 2 * day, now + 1000);
  ok(brokenSecond.gross === first.gross && brokenSecond.cdLeft === 0,
    'run for real: with the marker unmoved, the very next click pays the SAME 36 hours again — this is the exploit, exactly as reported');
  /* claimed first: lastCollect moves, so the same click now refuses */
  const afterClaim = computed(now, now + 1000);
  ok(afterClaim.gross === 0 && afterClaim.cdLeft > 5.9 * 3600000,
    'run for real: once the claim has moved the marker, the next click has nothing to pay and six hours to wait', JSON.stringify(afterClaim));
}

/* A sandbox holding the REAL _opComputed, _opClaimCollect and _opSettle, with
   the game around them stubbed and every payout recorded. */
function world(opts) {
  const o = opts || {};
  const paid = { cinder: 0, salvage: {}, rows: [] };
  const localOps = [];
  const calls = [];
  const env = {
    OP_ACCRUAL_CAP_H: Number(eval(constVal('OP_ACCRUAL_CAP_H'))),
    OP_COLLECT_CD_MS: Number(eval(constVal('OP_COLLECT_CD_MS'))),
    RESTAURANT_FOOD_MUL: 20,
    _opEcon: () => ({ ratePerWorkerHr: 100, salaryPerWorkerHr: 10, maxWorkers: 20, yields: { ore: 5 } }),
    _opStaffCount: () => 0,
    cxYieldMul: () => 1, _aiYieldTradeMul: () => 1, _opSiteEff: () => 1, _ownsRestaurant: () => false,
    getRes: () => 0,
    window: {},
    Profile: { cloud: null },
    _jbLocalOpsList: () => localOps,
    saveProfile: () => {},
    addCinders: (n) => { paid.cinder += n; },
    _wagePoolCredit: () => 0,
    spendResources: () => {},
    _nodeTierResBonus: () => ({}),
    addSalvage: (y) => { for (const k in y) paid.salvage[k] = (paid.salvage[k] | 0) + y[k]; },
    cxProduce: () => {},
    corpTreasuryFetch: async () => {},
    corpStaffPayroll: async () => {},
    _jbNum: (x) => Number(x) || 0,
    Corp: { treasury: 1e9 },
    _opTreasuryRow: async (amt, kind) => { paid.rows.push([kind, amt]); },
    Cloud: { client: o.client || null },
  };
  const body = [fnText('_opComputed'), fnText('_opClaimCollect'), fnText('_opSettle')].join('\n');
  const api = new Function(...Object.keys(env), body + '\nreturn { _opComputed, _opClaimCollect, _opSettle };')(...Object.values(env));
  return { api, paid, localOps, calls };
}
const H = 3600000;

console.log('\n=== 6. the collect handler measures, claims, then pays what it measured ===');
{
  const i = SRC.indexOf("} else if (a.kind === 'opCollect') {");
  ok(i > 0, 'the opCollect handler is findable');
  const h = stripComments(SRC.slice(i, i + 6000));
  const iMeasure = h.indexOf('const c = _opComputed(o);');
  const iClaim = h.indexOf('await _opClaimCollect(o)');
  const iSettle = h.indexOf('await _opSettle(o, c)');
  ok(iMeasure > 0 && iClaim > iMeasure, 'it measures the accrual BEFORE it claims');
  ok(iSettle > iClaim, 'it pays AFTER the claim — the v121v127 order, kept');
  ok(iSettle > 0, 'and pays from THAT measurement — _opSettle(o, c), not a fresh one taken after the claim moved the clock');
  ok(!/await _opSettle\(o\)\s*;/.test(h.slice(0, h.indexOf('corpTreasuryFetch'))),
    'no bare _opSettle(o) remains on the collect path');
  const settle = stripComments(fnText('_opSettle'));
  ok(/async function _opSettle\(o, pre\)/.test(settle) && /const c = pre \|\| _opComputed\(o\);/.test(settle),
    '_opSettle uses the measurement it is given, and computes only when given none (the staffing path)');
}

console.log('\n=== 7. run for real: claim, then settle, pays the accrual ===');
{
  const W = world();
  const o = { id: 'op1', op_type: 'mine', workers: 10, meta: { localOnly: true, lastCollect: Date.now() - 13 * H } };
  W.localOps.push(o);
  const c = W.api._opComputed(o);
  ok(c.cdLeft === 0 && c.gross > 0, 'a business 13h since its last collect is off cooldown with production to pay', 'gross ' + c.gross);
  const claimed = await W.api._opClaimCollect(o);
  ok(claimed === true, 'the claim lands');
  ok(Date.now() - o.meta.lastCollect < 1000, '…and has moved the clock to now — the thing that zeroed every payout');
  const s = await W.api._opSettle(o, c);
  const want = Math.max(0, c.gross - c.salary);
  ok(s.net === want && want > 0, 'the settle pays the accrual measured before the claim', 'net ' + s.net + ' want ' + want);
  ok(W.paid.cinder === want, 'the player receives that Cinder', String(W.paid.cinder));
  ok((W.paid.salvage.ore | 0) === (c.yields.ore | 0) && c.yields.ore > 0, 'and the resources it produced', JSON.stringify(W.paid.salvage));
}

console.log('\n=== 8. NEGATIVE CONTROL — the shipped order pays nothing ===');
{
  const W = world();
  const o = { id: 'op1', op_type: 'mine', workers: 10, meta: { localOnly: true, lastCollect: Date.now() - 13 * H } };
  W.localOps.push(o);
  const c = W.api._opComputed(o);
  await W.api._opClaimCollect(o);
  const s = await W.api._opSettle(o);          // v121v127–v173: no measurement passed
  ok(c.gross > 0 && s.net === 0 && W.paid.cinder === 0,
    'claim then a FRESH settle pays 0 of an accrual worth ' + Math.max(0, c.gross - c.salary) + ' — bug-mu0bw80h reproduced', 'net ' + s.net);
}

console.log('\n=== 9. the cloud claim is compare-and-set ===');
{
  /* A PostgREST builder that records its filters and answers like the server:
     the update lands only if every filter matches the row. */
  const mkClient = (row) => {
    const rec = [];
    const client = {
      from: () => {
        const f = { filters: [] };
        const b = {
          update: (patch) => { f.patch = patch; return b; },
          eq: (col, val) => { f.filters.push(['eq', col, val]); return b; },
          is: (col, val) => { f.filters.push(['is', col, val]); return b; },
          select: async () => {
            rec.push(f);
            const get = (col) => col === 'id' ? row.id : col === 'meta->>lastCollect' ? (row.meta.lastCollect == null ? null : String(row.meta.lastCollect)) : undefined;
            const hit = f.filters.every(([op, col, val]) => op === 'eq' ? get(col) === val : get(col) === val);
            if (!hit) return { data: [], error: null };
            row.meta = f.patch.meta;
            return { data: [{ id: row.id }], error: null };
          },
        };
        return b;
      },
    };
    return { client, rec };
  };

  const t0 = Date.now() - 13 * H;
  const dbRow = { id: 'op9', meta: { lastCollect: t0 } };
  const { client, rec } = mkClient(dbRow);
  const W = world({ client });
  const tabA = { id: 'op9', op_type: 'mine', workers: 10, meta: { lastCollect: t0 } };
  const tabB = { id: 'op9', op_type: 'mine', workers: 10, meta: { lastCollect: t0 } };   // same stale read

  ok(await W.api._opClaimCollect(tabA) === true, 'tab A claims');
  const fA = rec[0].filters;
  ok(fA.some(([op, col, v]) => op === 'eq' && col === 'meta->>lastCollect' && v === String(t0)),
    'the claim is filtered on the lastCollect it measured from, as plain integer text', JSON.stringify(fA));
  ok(await W.api._opClaimCollect(tabB) === false,
    'tab B, holding the same stale read, is REFUSED — before this it was paid a second time');

  const fresh = { id: 'op10', meta: {} };
  const m2 = mkClient(fresh);
  const W2 = world({ client: m2.client });
  ok(await W2.api._opClaimCollect({ id: 'op10', op_type: 'mine', workers: 1, meta: {} }) === true,
    'a business never collected before claims against a null stamp');
  ok(m2.rec[0].filters.some(([op, col, v]) => op === 'is' && col === 'meta->>lastCollect' && v === null), '…using IS NULL');

  const odd = { id: 'op11', meta: { lastCollect: 1.5 } };
  const m3 = mkClient(odd);
  const W3 = world({ client: m3.client });
  await W3.api._opClaimCollect({ id: 'op11', op_type: 'mine', workers: 1, meta: { lastCollect: 1.5 } });
  ok(!m3.rec[0].filters.some(([, col]) => col === 'meta->>lastCollect'),
    'a non-integer stamp falls back to the id-only claim rather than locking the business out');

  const h = SRC.slice(SRC.indexOf("} else if (a.kind === 'opCollect') {"));
  ok(/Already collected — from another tab or device/.test(h.slice(0, 8000)),
    'a refused claim that turns out to be someone else\'s collect says so, instead of blaming permissions');
}

console.log('\n=== 10. personally-funded businesses: the clock only moves forward across devices ===');
{
  const i = SRC.indexOf('if (Array.isArray(f.__jbLocalOps__)) {');
  ok(i > 0, 'the local-ops restore is findable');
  let d = 0, j = SRC.indexOf('{', i), end = -1;
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (d === 0) { end = k; break; } } }
  const block = SRC.slice(i, end + 1);
  const run = new Function('Profile', 'f', block);
  const P = { jbLocalOps: [{ id: 'L1', op_type: 'farm', meta: { localOnly: true, lastCollect: 1000 } }] };
  run(P, { __jbLocalOps__: [{ id: 'L1', op_type: 'farm', meta: { localOnly: true, lastCollect: 5000 } }, { id: 'L2', op_type: 'mine', meta: { lastCollect: 7 } }] });
  ok(P.jbLocalOps.find(x => x.id === 'L1').meta.lastCollect === 5000,
    'a later collect recorded elsewhere replaces this device\'s older clock — no second payout for the same hours');
  ok(P.jbLocalOps.find(x => x.id === 'L2'), 'a business founded on the other device still arrives (the union is unchanged)');
  const P2 = { jbLocalOps: [{ id: 'L1', op_type: 'farm', workers: 9, meta: { localOnly: true, lastCollect: 9000 } }] };
  run(P2, { __jbLocalOps__: [{ id: 'L1', op_type: 'farm', workers: 1, meta: { localOnly: true, lastCollect: 5000 } }] });
  const l1 = P2.jbLocalOps.find(x => x.id === 'L1');
  ok(l1.meta.lastCollect === 9000, 'an OLDER cloud stamp never winds this device\'s clock back');
  ok(l1.workers === 9, 'and the rest of the local row is untouched — only the stamp is merged');
}


/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 127, 'BUILD_VERSION is v121v127 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
