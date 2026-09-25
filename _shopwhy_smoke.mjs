/* 🛒 TWO ZONE DEMAND DESCRIPTORS THAT NAMED A PROBLEM AND NOT ITS PARTS.

   bug-mtvdb20t: "Services falling short — residents cannot buy what they need
   here" never said WHICH services or how to fix them.
   bug-mtvdpfce: "Almost Nobody Is Shopping Yet" said the basket was tiny and
   not what a basket is made of, or what raises it.

   Now: the demographics tick hands the pipeline the economy's per-category
   satisfaction with the shop that sells each (servicesBreakdown); the cause
   line names the short ones worst-first with their shop and one fix sentence;
   the commercial descriptor prints residents / savings / jobs / wages and the
   one lever those numbers point at, and the commercial tab shows the four as
   stat cells.

   Run: node _shopwhy_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const PIPE = readFileSync('./public/src/demographics/pipeline.js', 'utf8').replace(/\r\n/g, '\n');
const IDX = readFileSync('./public/src/demographics/index.js', 'utf8').replace(/\r\n/g, '\n');
const DEM = readFileSync('./public/src/hud/demand.js', 'utf8').replace(/\r\n/g, '\n');
const P = await import('./public/src/demographics/pipeline.js');
const dm = { ui: { servicesGood: 0.75, servicesPoor: 0.4 } };

/* ── 1. services, by name ── */
ok(/let posts = null, seekers = 0, services = 1, servicesBy = null;/.test(IDX) && /servicesBy = servicesBreakdown\(E, snap\);/.test(IDX), 'the tick builds the breakdown from the same snapshot the mean is read from');
ok(/P\.step\(days, \{ survey: sv, budget, posts, seekers, services, servicesBy \}\)/.test(IDX), '…and hands it to the pipeline beside `services`');
ok(/function servicesBreakdown\(E, snap\) \{/.test(IDX) && /basket\.find\(\(x\) => x && x\.key === key\)/.test(IDX) && /inds\[b\.ind\]/.test(IDX), 'servicesBreakdown maps category → basket row → INDUSTRIES shop name');
ok(/const servicesBy = ctx && Array\.isArray\(ctx\.servicesBy\) \? ctx\.servicesBy : null;/.test(PIPE), 'the pipeline reads it as an array or nothing');
ok(/label: 'Services falling short', why: servicesShortText\(servicesBy, dm\) \}\);/.test(PIPE), 'the falling-short cause prints the named list');
ok(!/why: 'Residents cannot buy what they need here, and word gets around\.' \}\);/.test(PIPE), 'the bare sentence is gone from the cause');
{
  const L = [
    { key: 'food', name: 'Food', ico: '🍞', sat: 0.12, want: 400, shop: 'Grocery Store' },
    { key: 'healthcare', name: 'Healthcare', ico: '⚕️', sat: 0, want: 50, shop: 'Pharmacy' },
    { key: 'clothing', name: 'Clothing', ico: '👕', sat: 0.5, want: 80, shop: 'Clothing Store' },
    { key: 'cards', name: 'Ouroboros Cards', ico: '🃏', sat: 0.9, want: 10, shop: 'Card Shop' },
    { key: 'luxury', name: 'Luxury', ico: '💎', sat: 0.3, want: 5, shop: 'Luxury Boutique' },
    { key: 'restaurants', name: 'Restaurants', ico: '🍽️', sat: 0.6, want: 60, shop: 'Restaurant' },
  ];
  const t = P.servicesShortText(L, dm);
  ok(/^Residents cannot buy what they need here, and word gets around\. Short: /.test(t), 'keeps the verdict and adds the list');
  ok(/⚕️ Healthcare 0% \(Pharmacy\); 🍞 Food 12% \(Grocery Store\); 💎 Luxury 30% \(Luxury Boutique\); 👕 Clothing 50% \(Clothing Store\)\./.test(t), 'worst first, each with its shop, at most four', t);
  ok(!/Restaurants/.test(t) && !/Ouroboros/.test(t), 'the fifth-worst and the one above servicesGood are not listed');
  ok(/build the producer named, then staff both at the Job Fair/.test(t), 'and says how to fix each');
  ok(/has not reported which categories/.test(P.servicesShortText(null, dm)) && /has not reported which categories/.test(P.servicesShortText([], dm)), 'no breakdown → says so instead of inventing one');
  ok(P.servicesShortList([{ key: 'food', name: 'Food', sat: 0.9, want: 1 }], dm) === '', 'nothing short → empty list');
}
ok(/if \(S\.pull && S\.pull\.worst === 'services' && servicesBy\) \{/.test(PIPE) && /S\.pull\.worstText = 'Weakest right now: services — ' \+ short \+ ' ' \+ SERVICES_FIX;/.test(PIPE), 'the v98 weakest-draw sentence names the services too when services is weakest');

/* ── 2. the commercial descriptor, with its parts ── */
ok(!/Satisfaction reads ' \+ pc\(1 - rs\.share\) \+ ', but there is nothing there to satisfy/.test(DEM), 'the old self-contradicting sentence is gone');
ok(/label: 'Almost Nobody Is Shopping Yet',\n\s*why: 'The whole retail basket came to ' \+ qty\(rs\.want\) \+ ' 🔥 this shopping round — less than the price of one unit of anything in it, ' \+\n\s*'so the ' \+ pc\(1 - rs\.share\) \+ ' satisfaction figure is measuring a want too small to mean anything\. ' \+ sp\.why \+ ' ' \+ sp\.lever,/.test(DEM),
   'the descriptor explains the satisfaction figure, then prints the parts and the lever');
ok(/function residentsSpending\(snap\) \{/.test(DEM) && /snap\.flow && snap\.flow\.wages/.test(DEM) && /snap\.laborForce/.test(DEM) && /snap\.employed/.test(DEM) && /snap\.savings/.test(DEM), 'residentsSpending reads population, savings, laborForce, employed and flow.wages from the snapshot');
ok(/if \(pop < 1\) lever = 'Nobody lives here yet/.test(DEM) && /else if \(lf > 0 && empShare < 0\.5\) lever = 'The lever is jobs/.test(DEM) && /else if \(wages < Math\.max\(1, pop\)\) lever = 'The lever is wages/.test(DEM) && /else if \(pop < 20\) lever = 'The lever is residents/.test(DEM) && /else lever = 'The lever is rents/.test(DEM),
   'one lever, picked in order: nobody → jobs → wages → too few residents → rents');
ok(/return \{ causes: out, stat: sp\.stat, note: 'Commercial demand rises with residents/.test(DEM), 'commercial() returns the four stat cells');
ok(/\{ k: 'Residents', v: n0\(pop\) \}/.test(DEM) && /\{ k: 'Savings', v: qty\(savings\) \+ ' 🔥' \}/.test(DEM) && /\{ k: 'Wages \/ round', v: qty\(wages\) \+ ' 🔥' \}/.test(DEM) && /\{ k: 'Employed', v: n0\(emp\) \+ ' \/ ' \+ n0\(lf\) \}/.test(DEM), 'Residents, Savings, Wages / round, Employed');
ok(/return \{ value: clamp01\(v\), causes: causes\.slice\(\)\.sort\(\(a, b\) => Math\.abs\(b\.w\) - Math\.abs\(a\.w\)\), stat: res\.stat \|\| \[\], note: res\.note \};/.test(DEM) && /return \{ value: null, causes: \[\], stat: res\.stat \|\| \[\], note: res\.note \};/.test(DEM), 'fold() passes stat through on both branches (it used to drop it)');
{
  /* run residentsSpending for real, lifted out of the module */
  const src = DEM.slice(DEM.indexOf('function residentsSpending(snap) {'), DEM.indexOf('function commercial() {'));
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const n0 = (v) => Math.round(Number(v) || 0);
  const qty = (v) => String(Math.round((Number(v) || 0) * 10) / 10);
  const fn = new Function('clamp01', 'n0', 'qty', src + '; return residentsSpending;')(clamp01, n0, qty);
  let r = fn({ population: 40, savings: 12.5, laborForce: 20, employed: 3, flow: { wages: 0 } });
  ok(/40 residents hold 12\.5 🔥 of savings between them, 3 of 20 working-age residents have a job, and firms paid 0 🔥 in wages last round/.test(r.why), 'the parts, printed', r.why);
  ok(/^The lever is jobs/.test(r.lever), 'few employed → jobs');
  r = fn({ population: 40, savings: 5, laborForce: 20, employed: 18, flow: { wages: 2 } });
  ok(/^The lever is wages/.test(r.lever), 'employed but barely paid → wages (firms out of cash)');
  r = fn({ population: 8, savings: 300, laborForce: 5, employed: 5, flow: { wages: 90 } });
  ok(/^The lever is residents/.test(r.lever), 'paid, employed, but tiny city → residents');
  r = fn({ population: 60, savings: 300, laborForce: 30, employed: 28, flow: { wages: 400 } });
  ok(/^The lever is rents/.test(r.lever), 'paid, employed, big enough → rents');
  r = fn({ population: 0 });
  ok(/^Nobody lives here yet/.test(r.lever) && r.stat.length === 4 && r.stat[3].v === '0 / 0', 'empty city → housing first; four stat cells; nothing throws on a bare snapshot');
  ok(fn(null).stat.length === 4, 'null snapshot → zeros, not a throw');
}

/* the six knobs moved together */
const SRC = readFileSync('./public/index.html', 'utf8');
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 99, 'BUILD_VERSION is v121v99 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build (hud and demographics import at ?v=NC_BUILD)');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
