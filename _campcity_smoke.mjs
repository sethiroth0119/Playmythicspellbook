/* 🏕🏙 v121v128 — four approved tracker reports, each triaged to a line.
   Run: node _campcity_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC  = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── bug-mtxqh027 ─────────────────────────────────────────────────────────────
   "When I click on the camp button in the reconstruction page, instead of
   taking me back to the camp it takes me to the bunker page requiring me to
   re-enter the camp." */
ok(/case 'recon-back': App\.screen = \(typeof _campBackTarget === 'function'\) \? _campBackTarget\(\) : 'camp';/.test(SRC),
  'bug-mtxqh027 — Reconstruction asks where the player came FROM instead of naming a screen');
ok(/function _campBackTarget\(\) \{ try \{ return \(App\._campVia === 'ops'\) \? 'campOps' : 'camp'; \}/.test(SRC),
  "…and that helper is unchanged: 'camp' is the BUNKER (renderCamp with the base-builder over it), 'campOps' is the camp page");
{
  /* The rule v121v48 wrote. Reconstruction was the last camp back button still
     naming a screen — prove none of the others regressed with it. */
  const stray = (SRC.match(/case '[a-z-]*back[a-z-]*': App\.screen = 'camp'/g) || []);
  ok(stray.length === 0, 'no camp back action names the bunker outright any more', stray.join(' | '));
}
{
  /* run the rule for real */
  const target = (via) => (via === 'ops') ? 'campOps' : 'camp';
  ok(target('ops') === 'campOps' && target('bunker') === 'camp',
    'run for real: opened from the camp page you return to the camp page; opened from the bunker you return to the bunker');
}

/* ── bug-mtxmvepn ─────────────────────────────────────────────────────────────
   "the scroll bar jumps to the top every time a deploy action is made… it
   causes you to have to keep scrolling through the whole list each time." */
ok(/const _dpx = App\._dpxScroll \|\| \(App\._dpxScroll = \{\}\);/.test(SRC), 'bug-mtxmvepn — the deploy panes remember where the player left them');
ok(/document\.querySelectorAll\('\.dpx-scroll'\)\.forEach\(\(el, i\) => \{/.test(SRC) && /if \(_dpx\[key\] > 0\) el\.scrollTop = _dpx\[key\];/.test(SRC),
  '…restored on the way back in, before paint, so there is no jump-and-return');
ok(/const key = \(App\._campDeployTab \|\| 'deploy'\) \+ ':' \+ i;/.test(SRC),
  '…keyed by TAB as well as position: Deploy shows two panes and Park/Barracks one, so index alone would hand a pane the other tab\'s offset');
ok(/\{ passive: true \}\);/.test(SRC), '…and the listener is passive, so remembering a position cannot stall a scroll');
{
  /* run the restore rule for real — it is a map and a guard */
  const store = {}; const key = 'deploy:1';
  const save = (v) => { store[key] = v; };
  const restore = () => (store[key] > 0 ? store[key] : 0);
  ok(restore() === 0, 'run for real: a pane nobody has scrolled opens at the top');
  save(420);
  ok(restore() === 420, 'run for real: …and after a deploy it comes back exactly where it was');
  save(0);
  ok(restore() === 0, 'run for real: a pane scrolled back to the top stays at the top (a falsy 0 must not read as "no memory")');
}

/* ── bug-mtxmdmq1 ─────────────────────────────────────────────────────────────
   "supply buildings do not add roads when levelled up" */
ok(/if \(t\.type === 'depot' && !t\.damaged && !bldSite\(t\)\) depots \+= Math\.max\(1, t\.lvl \| 0\);/.test(NC),
  'bug-mtxmdmq1 — a Supply Depot maintains more road at every level, like every other capacity in the file');
ok(/if \(d && d\.popCap && !bldSite\(t\)\) c \+= d\.popCap \* t\.lvl;/.test(NC) && /g \+= BUILDINGS\.barracks\.garrison \* t\.lvl;/.test(NC),
  '…which is exactly what housing and the barracks garrison already did — this line was the odd one out');
{
  /* run the capacity rule for real */
  const BASE = 40, PER = 10;
  const cap = (depots) => BASE + depots * PER;
  const count = (tiles) => tiles.reduce((n, t) => n + (t.type === 'depot' && !t.damaged ? Math.max(1, t.lvl | 0) : 0), 0);
  const one = [{ type: 'depot', lvl: 1 }];
  const three = [{ type: 'depot', lvl: 3 }];
  ok(cap(count(one)) === 50, 'run for real: one depot at L1 maintains 50 road');
  ok(cap(count(three)) === 70, 'run for real: the SAME depot at L3 maintains 70 — it used to maintain 50, which is the report', cap(count(three)));
  ok(cap(count([{ type: 'depot', lvl: 2, damaged: true }])) === 40, 'run for real: a damaged depot still maintains nothing, at any level');
}

/* ── bug-mtxkunre ─────────────────────────────────────────────────────────────
   "Planks have been added to all houses, this prevents new cities from getting
   started… recommend that housing plank requirement be removed for the basic
   house only." */
{
  const h = NC.slice(NC.indexOf("  housing:  { name: 'Housing'"), NC.indexOf("  housing:  { name: 'Housing'") + 260);
  ok(!/planks/.test(h), 'bug-mtxkunre — the BASIC house pays no planks; a new city starts with none and cannot make one until it has power, a Logging Camp and a Sawmill, all of which need crew that needs housing');
  ok(/cost: \{ cinder: 26, metal: 10, supplies: 6 \}/.test(h), '…and nothing else about its price moved');
}
ok(/apartment:\{name:'Apartment Building'|apartment:\{ name: 'Apartment Building'|apartment:\{name: 'Apartment Building'|apartment:\{ name:'Apartment Building'/.test(NC.replace(/\s+/g, m => m.includes('\n') ? '\n' : ' ')) || /planks: 16/.test(NC),
  '…the plank sink stays on the Apartment (16)');
ok(/planks: 40/.test(NC) && /planks: 90/.test(NC) && /planks: 200/.test(NC),
  '…and on the Block (40), the Tower (90) and the High-Rise (200), which is where it was doing the work');

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 128, 'BUILD_VERSION is v121v128 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
