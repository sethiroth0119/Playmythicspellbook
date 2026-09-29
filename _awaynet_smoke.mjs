/* ⏳ THE AWAY REPORT PRINTED THE SAME RESOURCE TWICE (v121v75).

   Reported, with the panel showing Water +305 produced and −305 consumed, Food
   +520 and −521: "it seems like it produce and then it consume the same — have
   it where the city produce the live and real data."

   BOTH FIGURES WERE REAL. Every one is a ledger write: the city banks water
   into the player's stash and spends it straight back out for its own needs,
   and food differs by 1 because the two are computed independently — they were
   never mirrored. What was wrong is that a city consuming everything it makes
   is the exact case where two separate lists are the least useful way to say
   so; it reads as a bug in the numbers rather than as a city running to stand
   still.

   So a resource on BOTH sides is now one line showing what actually landed,
   with the gross underneath. Nothing is hidden, and a resource on only one
   side is untouched.

   Run: node _awaynet_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');

/* Lift the real renderer. */
function fnText(name) {
  let i = NC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = NC.indexOf('{', i);
  for (let k = j; k < NC.length; k++) { if (NC[k] === '{') d++; else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); } }
}
function render(rep) {
  const ctx = {
    console,
    resIco: (r) => '[' + r + ']',
    resName: (r) => r,
    fmtAway: (ms) => Math.round(ms / 60000) + 'm',
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fnText('awayReportHtml'), ctx);
  ctx.__rep = Object.assign({
    cinder: 0, gained: {}, spent: {}, stockDelta: {}, awayMs: 3600000, simSec: 3600,
    slices: 100, capped: false, lostMs: 0, popBefore: 40, popAfter: 40, stashChoke: null,
    vitalsBefore: {}, vitalsAfter: {},
  }, rep);
  return vm.runInContext('awayReportHtml(__rep)', ctx);
}

/* ── the reported case ── */
{
  const h = render({ gained: { water: 305, food: 520 }, spent: { water: 305, food: 521 } });
  ok(!/\+305/.test(h), 'water no longer prints +305 as a bare production line', h.match(/.{0,40}305.{0,40}/) || '');
  ok(/±0/.test(h), 'it prints a net of ±0 — the city ran to stand still', /±0/.test(h) ? '' : h.slice(0, 200));
  ok(/made 305 · used 305/.test(h), 'with the gross still on the row, so nothing is hidden');
  ok(/made 520 · used 521/.test(h), 'and the same for food');
  ok(/−1/.test(h), 'food shows a net of −1 — it ate one unit out of the stash', /−1/.test(h) ? '' : 'missing');
  ok(!/Consumed/.test(h), 'and the Consumed heading is gone entirely, because nothing was consumed that was not also made');
  ok(/net of what the city used/.test(h), 'the heading says what the list is');
}

/* ── one-sided resources are untouched ── */
{
  const h = render({ gained: { corn: 109, fruit: 65 }, spent: { medicine: 46 } });
  ok(/\+109/.test(h) && /\+65/.test(h), 'a resource only produced still reads as a plain gain');
  ok(/Consumed/.test(h) && /−46/.test(h), 'and one only consumed still gets the Consumed list');
  ok(!/made /.test(h), 'no net row appears when nothing is on both sides');
  ok(!/net of what the city used/.test(h), 'and the heading stays plain');
}
{
  /* Mixed: some both-sided, some not. */
  const h = render({ gained: { water: 300, corn: 50 }, spent: { water: 100, medicine: 20 } });
  ok(/\+200/.test(h), 'a city that banked more than it used shows the surplus', /\+200/.test(h) ? '' : 'missing');
  ok(/made 300 · used 100/.test(h), 'with the gross');
  ok(/\+50/.test(h), 'the produce-only resource is still its own line');
  ok(/−20/.test(h), 'and the consume-only one is still listed under Consumed');
}
{
  const h = render({ cinder: 1488, gained: { water: 10 }, spent: { water: 10 } });
  ok(/\+1488/.test(h), 'Cinder is never netted — it is not a two-sided city resource');
}
{
  const h = render({ gained: {}, spent: {} });
  ok(/Nothing was produced/.test(h), 'an idle city still says nothing was produced');
}

/* ── the numbers themselves are still the real ledger writes ── */
ok(/gained\[id\] = \(gained\[id\] \|\| 0\) \+ n;/.test(NC), 'production is still counted from the actual addRes');
ok(/if \(ok && c\) for \(const k in c\) if \(c\[k\] > 0\) \{ spent\[k\] = /.test(NC),
  'and consumption still only counts a spend the LEDGER ACCEPTED — the panel reports, it does not model');
ok(/BOTH SIDES WAS PRINTED TWICE|BOTH MAKES AND EATS WAS PRINTED TWICE/.test(NC), 'the reason is written where the next reader will look');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
