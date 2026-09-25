/* ══════════════════════════════════════════════════════════════════════════
   🎯 TARGET CLICK — a pending choice owns the click, and the pick is the pick

   Owner: "Targeting is not working when clicking the target it do not do the
   effect it just click the details of the unit/hero".

   TWO BUGS, found one inside the other, both measured by
   .gauntlet/targetclick-probe.mjs against the real reducers (19/19 now; 10 FAIL
   on the code before this change):
   1. The 3D board sends every click with the unit under the cursor, the host
      routes any such click to onUnitClick, and onUnitClick knew none of the five
      choice modes that live at the top of onTileClick. So a click on the unit
      you were asked to choose opened its details and the effect waited forever.
   2. With the click fixed, the probe clicked the FAR enemy and the NEAR one
      died. The picker honours 🌐 Global (`global` / radius>=99); the reducer's
      inRadius clamped every radius to 4 — and six effects read the pin as
      `(eff._targetId && list.find(...)) || list[0]`, so a pick outside the
      effect's own list silently became a different unit.

   Run: node _targetclick_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
let fails = 0, passes = 0;
const has = (t) => SRC.indexOf(t) >= 0;
function ok(label, cond, why) {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (why ? '\n         ' + why : '')); }
}
function fnBody(head) {
  const i = SRC.indexOf(head);
  if (i < 0) return '';
  const j = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, j > 0 ? j : i + 6000);
}

console.log('\n── 1. the click ──');
{
  const unitClick = fnBody('function onUnitClick(unitId) {');
  const tileClick = fnBody('function onTileClick(x, y) {');
  ok('onUnitClick is locatable', unitClick.length > 300);
  ok('onTileClick is locatable', tileClick.length > 300);
  /* every mode onTileClick resolves ahead of its card/unit handling must be
     forwarded — derived from onTileClick itself, so a SIXTH mode added there
     without being added here goes red instead of silently unclickable */
  const modes = [...new Set((tileClick.match(/if \(App\.ui && App\.ui\.([A-Za-z]+)\)/g) || [])
    .map(m => m.replace(/.*App\.ui\.([A-Za-z]+)\).*/, '$1')))];
  ok('onTileClick still has its choice modes (the derivation has something to check)', modes.length >= 5, modes.join(','));
  for (const m of modes) {
    ok('onUnitClick forwards ' + m, unitClick.indexOf('App.ui.' + m) > 0,
       'a unit standing on a legal tile for this mode cannot be clicked');
  }
  const fwd = unitClick.indexOf('if (_t && _t.pos) { onTileClick(_t.pos.x, _t.pos.y); return; }');
  ok('…to the tile the unit stands on', fwd > 0);
  ok('…BEFORE the selected-card branch and the details panel', fwd > 0
     && fwd < unitClick.indexOf('if (App.ui.selectedCardId) {')
     && fwd < unitClick.indexOf('App.ui.modalUnitId = unitId;'));
  ok('the board still routes unit clicks through onUnitClick', has("if (d.unitId && typeof onUnitClick === 'function') onUnitClick(d.unitId);"));
}

console.log('\n── 2. the pick ──');
ok('_pinOr exists and returns NOTHING for a missing pin', has("if (eff && eff._targetId) return (list || []).find(u => u && u.id === eff._targetId) || null;"));
ok('_resolveTargetUnit no longer falls back past a pin', has("if (eff && eff._targetId) { const t = candidates.find(u => u && u.id === eff._targetId); return t || null; }"));
ok('no redirecting fallback survives anywhere', !/\(eff\._targetId && [A-Za-z_]+\.find\([^)]*\)\) \|\| [A-Za-z_]+\[0\]/.test(SRC),
   'a pin outside the list becomes list[0] — a unit the player never chose');
ok('six effects read the pin through _pinOr', (SRC.match(/= _pinOr\(eff, /g) || []).length === 6,
   'found ' + (SRC.match(/= _pinOr\(eff, /g) || []).length);
ok('…and each one fizzles out loud', (SRC.match(/the chosen target is no longer in reach/g) || []).length === 6);
ok('the reducer range honours Global exactly as the picker does',
   has("if (eff.global === true || (eff.radius | 0) >= 99) return true;")
   && has("const isGlobal = (eff.global === true) || ((eff.radius | 0) >= 99);"));

console.log('\n── negative control ──');
ok('fnBody really can come back empty', fnBody('function noSuchThing_(') === '');

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all ' + passes + ' passed') + ' (' + passes + '/' + (passes + fails) + ')');
process.exit(fails ? 1 : 0);
