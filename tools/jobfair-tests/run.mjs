/* ══════════════════════════════════════════════════════════════════════════
   📰 JOB FAIR — the bulletin, and the shortage diagnosis

   The load-bearing check is the CASCADE. Qualified workers spend downward:
   someone fit for `advanced` can also take a `skilled` job, and the engine
   fills advanced → unskilled. A shortage computed per band in isolation
   overstates the gap at the bottom and understates it at the top — it would
   tell the Governor to build the wrong school.

   Run:  node tools/jobfair-tests/run.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import J from '../../public/src/jobfair/jobfair.js';

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const mk = (id, band, openings, extra) => Object.assign({ id, name: id, ind: id, band, openings, wage: 500 }, extra || {});

console.log('\n\u{1F4F0} JOB FAIR\n');

/* ── 1. The education view is total and ordered ─────────────────────────── */
ok('every labour band maps to an education level', J.BANDS.every(b => !!J.EDU[b]));
ok('levels rise with the band', J.eduOf('advanced').level > J.eduOf('technical').level &&
   J.eduOf('technical').level > J.eduOf('skilled').level &&
   J.eduOf('skilled').level > J.eduOf('unskilled').level,
   J.BANDS.map(b => b + '=' + J.eduOf(b).level).join(' '));
ok('an unknown band falls back to the lowest rather than throwing',
   J.eduOf('nonsense').level === J.eduOf('unskilled').level);

/* ── 2. The bulletin ────────────────────────────────────────────────────── */
const market = {
  vacancies: { advanced: 14, technical: 15, skilled: 12, unskilled: 8 },
  employed:  { advanced: 3, technical: 10, skilled: 20, unskilled: 24 },
  qualified: { advanced: 1, technical: 6, skilled: 7, unskilled: 30 },
};
const firms = [
  mk('lab', 'advanced', 14, { name: 'Foundation Research Lab' }),
  mk('plant', 'technical', 15, { name: 'Prince Advanced Manufacturing' }),
  mk('steel', 'skilled', 12, { name: 'Steel Works' }),
  mk('market', 'unskilled', 8, { name: 'Ethos General Market' }),
  mk('quiet', 'skilled', 0, { name: 'Nobody Hiring Here' }),
];
const b1 = J.bulletin(market, firms, null);
ok('only businesses with openings are listed', b1.rows.length === 4,
   b1.rows.length + ' of ' + firms.length);
ok('the totals add up', b1.totals.openPositions === 49 && b1.totals.businessesHiring === 4,
   b1.totals.openPositions + ' positions across ' + b1.totals.businessesHiring + ' businesses');
ok('each row states the education it needs',
   b1.rows.every(r => r.edu && r.edu.name), b1.rows.map(r => r.name + '→L' + r.edu.level).join(' · '));

/* ── 3. 🔴 THE CASCADE ──────────────────────────────────────────────────── */
const sh = J.shortages(market, firms);
const byBand = {}; sh.forEach(s => { byBand[s.band] = s; });
console.log('\n   supply 1/6/7/30 (adv/tech/skill/unskill) against 14/15/12/8 openings:');
sh.forEach(s => console.log('     ' + s.band.padEnd(10) + ' short ' + s.short + ' of ' + s.openings +
  ' (available ' + s.available + ')'));
ok('advanced is short 13 of 14 (only one graduate exists)',
   byBand.advanced && byBand.advanced.short === 13, byBand.advanced ? byBand.advanced.short : 'none');
ok('technical is short 9 of 15 (6 qualified, nothing spare from above)',
   byBand.technical && byBand.technical.short === 9, byBand.technical ? byBand.technical.short : 'none');
ok('skilled is short 5 of 12', byBand.skilled && byBand.skilled.short === 5,
   byBand.skilled ? byBand.skilled.short : 'none');
ok('\u{1F3AF} unskilled is NOT short — 30 residents cover 8 jobs',
   !byBand.unskilled, byBand.unskilled ? ('claimed short ' + byBand.unskilled.short) : 'no shortage, correct');

/* The cascade in isolation: a surplus at the top must flow DOWN. */
const rich = { qualified: { advanced: 20, technical: 0, skilled: 0, unskilled: 0 } };
const needLow = [mk('a', 'skilled', 5)];
ok('\u{1F3AF} spare graduates fill the jobs BELOW them',
   J.shortages(rich, needLow).length === 0,
   '20 advanced grads cover 5 skilled jobs');
/* …and never upward. */
const poor = { qualified: { advanced: 0, technical: 0, skilled: 0, unskilled: 50 } };
const needHigh = [mk('b', 'advanced', 3)];
const upward = J.shortages(poor, needHigh);
ok('\u{1F3AF} …but labourers do NOT fill a doctor\'s post',
   upward.length === 1 && upward[0].short === 3,
   '50 unskilled vs 3 advanced openings → short ' + (upward[0] ? upward[0].short : '?'));
ok('the reason names the real cause', upward[0] && /schooling/.test(upward[0].reason),
   upward[0] ? upward[0].reason : '');

/* ── 4. Player priority ─────────────────────────────────────────────────── */
const sel = new Set(['market', 'steel']);
const b2 = J.bulletin(market, firms, sel);
ok('the player\'s picks are listed first', b2.rows[0].picked && b2.rows[1].picked,
   b2.rows.slice(0, 3).map(r => (r.picked ? '✓' : '·') + r.id).join(' '));
const order = J.priorityOrder(firms, sel);
ok('…and are served first when workers are scarce',
   order[0].id === 'steel' && order[1].id === 'market',
   order.map(f => f.id).join(' → '));

/* ── 5. Broadcast lines only describe real events ───────────────────────── */
ok('a hire line names the employer', /Foundation Medical/.test(J.broadcastLine('hired', 'Anna Flores', 'Foundation Medical')));
ok('a firing line names the reason', /downsizing/i.test(J.broadcastLine('fired', 'Marcus Reed', 'Ethos Steel', 'company downsizing')));

/* ── 6. Hostile input ───────────────────────────────────────────────────── */
let bad = null;
for (const v of [null, undefined, NaN, Infinity, -3, '7', {}]) {
  try {
    const r1 = J.bulletin({ vacancies: v, employed: v, qualified: v }, [mk('x', 'skilled', v)], null);
    const r2 = J.shortages({ qualified: v }, [mk('y', 'advanced', v)]);
    if (!Array.isArray(r1.rows) || !Array.isArray(r2) || !isFinite(r1.totals.openPositions)) { bad = String(v); break; }
  } catch (e) { bad = String(v) + ' THREW ' + e.message; break; }
}
ok('hostile market/firm input never throws or yields NaN', bad === null, bad || 'clean');

console.log('');
if (fails) { console.log('❌ ' + fails + ' CHECK(S) FAILED'); process.exit(1); }
console.log('✅ JOB FAIR: all checks green');
