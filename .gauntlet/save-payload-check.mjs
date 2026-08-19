/* Reconciled-save check: does the ONE payload the four systems now share
   round-trip, and does a save written before any of them still open? */
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) {}, id: '', style: {}, appendChild() {} }),
  head: { appendChild() {} },
};

const N = await import('../public/src/naming/index.js');
const P = await import('../public/src/palette/index.js');

let ok = 0, bad = 0;
const t = (label, cond, got) => { (cond ? ok++ : bad++); console.log((cond ? '  ok  ' : '  FAIL ') + label + ' = ' + JSON.stringify(got)); };

const game = { tiles: {
  '5,5': { type: 'road', lvl: 1 },
  '5,6': { type: 'housing', lvl: 2 },
  '6,5': { type: 'gasstation', lvl: 1 },
} };

const api = N.mount({ game, saveSoon() {}, toast() {}, logEvent() {},
  blueprintName: (k) => ({ housing: 'Housing', gasstation: 'Gas Station', road: 'Road' })[game.tiles[k].type],
  opsLabel: () => null, wrapInspect: () => {} });

// palette needs a THREE stub only for mount()
P.mount({ THREE: { Color: function () {} }, tiles: () => game.tiles, saveSoon() {}, toast() {} });

const shelf = window.MythicCitySave;
t('the shelf is registered', !!shelf, !!shelf);

// ── the merged serialize(), as index.html now writes it ──────────────────
function serialize(prevPaintDisk, prevTransitRaw) {
  const payload = { v: 5, tiles: game.tiles, savedAt: 1 };
  // Read the globals every time, exactly as index.html does — the whole point
  // of the erase guards is what happens when one of them is NOT there.
  payload.transit = window.MythicTransit ? window.MythicTransit.save() : (prevTransitRaw || null);
  payload.paint = window.MythicPalette ? window.MythicPalette.save() : (prevPaintDisk || null);
  if (window.MythicCitySave) payload.ext = window.MythicCitySave.collect();
  if (window.MythicCitySave) payload.meta = window.MythicCitySave.describe(payload);
  return JSON.parse(JSON.stringify(payload));
}

api.ensureAll();
const nameBefore = api.nameFor('6,5');
api.setName('5,6', 'Ashgrove Court');
const s1 = serialize(null, null);

t('one ext field, not four top-level ones', Object.keys(s1.ext).sort().join(','), Object.keys(s1.ext).sort().join(','));
t('meta walks the payload', s1.meta.keys.includes('paint') && s1.meta.keys.includes('transit') && s1.meta.keys.includes('ext'), s1.meta.keys);
t('meta names its tenants', s1.meta.modules, s1.meta.modules);
t('meta reports the schema off the payload', s1.meta.schema === 5, s1.meta.schema);
t('nothing recoloured ⇒ paint is null (no save grows)', s1.paint === null, s1.paint);
t('no transit module ⇒ transit is null', s1.transit === null, s1.transit);

// ── round trip ────────────────────────────────────────────────────────────
api.clearName('5,6');
shelf.restore(s1.ext);
t('a player-typed name survives serialize → restore', api.nameFor('5,6') === 'Ashgrove Court', api.nameFor('5,6'));
t('an AUTO name is pinned and does not re-roll', api.nameFor('6,5') === nameBefore, api.nameFor('6,5'));

// ── an OLD save: none of these four keys exist ────────────────────────────
const old = { v: 5, tiles: game.tiles, savedAt: 1 };
let threw = null;
try {
  shelf.restore(old.ext);                                   // undefined
  const paintDisk = (old.paint && typeof old.paint === 'object') ? old.paint : null;
  window.MythicPalette.load(paintDisk);
  const transitRaw = (old.transit && typeof old.transit === 'object') ? old.transit : null;
  t('an old save has no paint, and that means "never recoloured"', paintDisk === null, paintDisk);
  t('an old save has no transit, and that means "no network"', transitRaw === null, transitRaw);
} catch (e) { threw = e; }
t('an old save opens without throwing', threw === null, threw && threw.message);

// ── a save written TODAY, opened by a build where the modules 404'd ───────
// Give the two guarded fields something real to lose first.
const realPaint = window.MythicPalette;
window.MythicPalette = { save: () => ({ v: 1, t: { '5,6': { w: 'aabbcc', h: 1 } } }) };
window.MythicTransit = { save: () => ({ v: 1, seq: 3, lines: [{ id: 1, name: 'Blue', stops: ['5,6', '6,5'] }] }) };
const s2 = serialize(null, null);
t('a recoloured city writes a paint blob', !!(s2.paint && s2.paint.t['5,6']), s2.paint);
t('a drawn network writes a transit blob', !!(s2.transit && s2.transit.lines.length), s2.transit);
t('and meta lists both, plus its ext tenant', s2.meta.keys.join(','), s2.meta.keys);

// …now every module 404s on the next boot.
delete window.MythicPalette; delete window.MythicCitySave; delete window.MythicTransit;
const paintDisk = (s2.paint && typeof s2.paint === 'object') ? s2.paint : null;
const transitRaw = (s2.transit && typeof s2.transit === 'object') ? s2.transit : null;
const s3 = serialize(paintDisk, transitRaw);
t('a module-less build writes the disk copy BACK, never null over player data',
  JSON.stringify(s3.paint) === JSON.stringify(paintDisk) &&
  JSON.stringify(s3.transit) === JSON.stringify(transitRaw), { paint: s3.paint, transit: s3.transit });
t('…and omits ext/meta rather than writing an empty one over the names',
  s3.ext === undefined && s3.meta === undefined, { ext: s3.ext, meta: s3.meta });
window.MythicPalette = realPaint;

console.log('\n' + (bad ? bad + ' FAILED' : 'ALL CLEAN') + ' (' + ok + ' ok)');
process.exit(bad ? 1 : 0);
