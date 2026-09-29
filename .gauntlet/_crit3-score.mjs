// CRITIC-3 scoring: engine-required keys (my own scan) vs what the gate SHOWS
// (my own driver dump). Maps an engine key -> the field suffixes that write it,
// read out of the real capture function, NOT out of FX_GATE_FIELDS.
import fs from 'fs';
const ROOT = 'D:/game-deploy';
const eng = JSON.parse(fs.readFileSync(ROOT + '/.gauntlet/_crit3-engine.json', 'utf8'));
const drv = JSON.parse(fs.readFileSync(ROOT + '/.gauntlet/_crit3-fxgate.json', 'utf8'));
const SRC = fs.readFileSync(ROOT + '/public/index.html', 'utf8');

// --- build key -> suffix map from the on-play capture object itself ---------
const capStart = SRC.indexOf('function captureEditorIntoCard(card) {');
const capEnd = SRC.indexOf('function saveCardFromInputs(', capStart);
const cap = SRC.slice(capStart, capEnd);
// every "someKey: ... 'ed-onplay-<suf>' ..." within one logical line-run
const key2suf = {};
const lines = cap.split('\n');
let curKey = null, depthHint = 0;
for (const ln of lines) {
  const km = ln.match(/^\s{6,}([A-Za-z_][A-Za-z0-9_]*)\s*:/);
  if (km) { curKey = km[1]; depthHint = 0; }
  const sufs = [...ln.matchAll(/'ed-onplay-([a-z0-9-]+)'/g)].map(m => m[1]);
  if (curKey && sufs.length) {
    key2suf[curKey] = key2suf[curKey] || new Set();
    sufs.forEach(s => key2suf[curKey].add(s));
  }
  depthHint++;
  if (depthHint > 12) curKey = null;
}
// engine keys the on-play object supplies under a different name
const ALIAS = { summonCard: 'summonCardId', filterCardIds: 'filterCardIds' };

const IDS = Object.keys(eng.perEffect);
const rows = [];
let missTotal = 0, missEff = 0;
const UNIVERSAL_IGNORE = new Set(['_autoPick', '_targetId', '_vfxCenter', 'vfx', 'side', 'polarity',
  'protectFlags', 'condition', 'turns', 'boostDuration']);
for (const id of IDS) {
  const need = eng.perEffect[id].filter(k => !UNIVERSAL_IGNORE.has(k));
  const vis = new Set((drv.rows[id] && drv.rows[id].blocks['ed-onplay'].visIds) || []);
  const miss = [];
  for (const k of need) {
    const kk = ALIAS[k] || k;
    const set = key2suf[kk] || key2suf[k];
    if (!set) continue;                       // no editor field writes it at all
    const sufs = [...set];
    // visible if ANY field that writes this key is visible
    const anyVis = sufs.some(s => vis.has(s));
    if (!anyVis) miss.push(k + ' [' + sufs.join(',') + ']');
  }
  if (miss.length) { missEff++; missTotal += miss.length; }
  rows.push({ id, needN: need.length, visN: vis.size, miss });
}
console.log('=== CRITIC-3: engine-required-but-HIDDEN in #fx-onplay ===');
console.log('effects with a hidden engine-read field:', missEff, '/', IDS.length,
  '| total hidden fields:', missTotal);
rows.filter(r => r.miss.length).forEach(r => console.log('  MISS', r.id, '->', r.miss.join(' ; ')));
const visNs = rows.map(r => r.visN);
console.log('visible on-play controls: mean', (visNs.reduce((a, b) => a + b, 0) / visNs.length).toFixed(1),
  'min', Math.min(...visNs), 'max', Math.max(...visNs), 'of DOM', drv.rows[IDS[0]].blocks['ed-onplay'].dom);
// sweep coherence
let badSec = 0, badChip = 0;
for (const id of IDS) {
  if (drv.rows[id].emptySec.length) { badSec++; if (badSec < 6) console.log('  EMPTY-SEC', id, drv.rows[id].emptySec.join(',')); }
  if (drv.rows[id].badChips.length) { badChip++; if (badChip < 6) console.log('  BAD-CHIP', id, drv.rows[id].badChips.join(',')); }
}
console.log('empty visible sections:', badSec, '/', IDS.length, '| chips -> hidden section:', badChip, '/', IDS.length);
// DOM drift
const domSet = new Set(IDS.map(id => drv.rows[id].domTotal));
console.log('distinct total-control counts across all 118 picks (1 == no re-render/removal):', [...domSet].join(','));
// sibling blocks + extra slots
for (const b of drv.present) {
  const ns = IDS.map(id => drv.rows[id].blocks[b].visIds.length);
  console.log('  ' + b.padEnd(14), 'vis mean', (ns.reduce((a, x) => a + x, 0) / ns.length).toFixed(1),
    'min', Math.min(...ns), 'max', Math.max(...ns), 'of DOM', drv.rows[IDS[0]].blocks[b].dom);
}
fs.writeFileSync(ROOT + '/.gauntlet/_crit3-score.json', JSON.stringify({ rows, key2suf: Object.fromEntries(Object.entries(key2suf).map(([k, v]) => [k, [...v]])) }, null, 1));
