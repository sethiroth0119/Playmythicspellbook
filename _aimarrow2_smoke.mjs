/* ============================================================================
 * _aimarrow2_smoke.mjs — 🏹 TARGETING ARROW + RANDOM REVEAL gate.
 *                                              node _aimarrow2_smoke.mjs
 * ----------------------------------------------------------------------------
 * The purple/red arrow that says who a spell is pointing at, and the arrow that
 * reveals which unit a random roll chose.
 *
 * 🔴 EVERY FAILURE HERE IS SILENT. An arrow anchored through a DOM rect still
 * draws — in the wrong place, or at 0,0, because during a stage match the DOM
 * board is visibility:hidden. An arrow whose colour is decided by a second
 * opinion still draws — in the wrong colour, telling the player a click will be
 * accepted when it will be refused. And a reveal that never removes itself
 * leaves a marker pointing at a unit forever. None of those throw.
 * ==========================================================================*/
import fs from 'fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ── the renderer ── */
ok('the aim arrow exists', /function _bbAimShow\(fromU, toU, legal\)/.test(SRC));
ok('…and can be hidden', /function _bbAimHide\(\)/.test(SRC));
ok('the reveal arrow exists', /function _bbRevealArrow\(unit, colour\)/.test(SRC));

/* ── anchoring: the trap that has already bitten twice ── */
const pt = /function _bbAimPointOf\(unitOrPos\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_bbAimPointOf found', !!pt);
if (pt) {
  ok('it anchors through the stage mapping, not a DOM rect',
     /_bbTilePoint/.test(pt[0]) && !/querySelector/.test(pt[0]),
     'during a stage match the DOM board is hidden — a .tile lookup answers about a board nobody can see');
  ok('…and it accepts a unit OR a bare position',
     /unitOrPos && unitOrPos\.pos/.test(pt[0]));
  ok('…and tolerates y or z for the row',
     /p\.y != null \? p\.y : p\.z/.test(pt[0]),
     'units carry pos.y, board tiles carry z — mixing them silently points at the wrong row');
}

/* ── the colour must come from the rule, not a second opinion ── */
const hov = /function _bbAimFromHover\(d\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_bbAimFromHover found', !!hov);
if (hov) {
  ok('legality is decided by _targetCandidates — the same function the click uses',
     /_targetCandidates\(s, caster, step\.effect\)/.test(hov[0]),
     'an arrow that says legal while the click refuses is worse than no arrow');
  ok('…and honours a redirected step',
     /_redirectCandidates/.test(hov[0]));
  ok('bare ground hides the arrow rather than flashing it red',
     /if \(!over\) \{ _bbAimHide\(\); return; \}/.test(hov[0]),
     'a red arrow on every empty hex the cursor crosses makes the board flash angrily');
  ok('no targeting in progress means no arrow',
     /if \(!t \|\| !d \|\| d\.x < 0\) \{ _bbAimHide\(\); return; \}/.test(hov[0]));
}

/* ── colours are the ones asked for ── */
ok('legal is PURPLE', /_AIM_LEGAL = '#a06cff'/.test(SRC));
ok('illegal is RED',  /_AIM_DENY  = '#ff5a4a'/.test(SRC));

/* ── lifetime ── */
ok('the hover drives it', /_bbAimFromHover\(d\)/.test(SRC));
ok('a click clears it — a click that ENDS targeting produces no next hover',
   /_bbAimHide\(\); \} catch \(e\) \{\}\n  const t = App\.ui && App\.ui\.targeting;/.test(SRC));
const rev = /function _bbRevealArrow\(unit, colour\) \{[\s\S]*?\n\}/.exec(SRC);
if (rev) {
  ok('the reveal removes itself on a TIMER, not animationend',
     /setTimeout\(\(\) => \{ try \{ el\.remove\(\)/.test(rev[0]) && !/animationend/.test(rev[0]),
     'animationend does not fire in a backgrounded tab, and the marker would persist');
  ok('…and it is pointer-events:none', /pointer-events:none/.test(rev[0]));
}
ok('the aim overlay cannot eat the click it describes',
   /id = 'bb-aim';[\s\S]{0,300}?pointer-events:none/.test(SRC));

/* ── the random reveal is actually wired to a random pick ── */
ok('a random sacrifice reveals which unit the roll chose',
   /_sacMode === 'random' && typeof _bbRevealArrow === 'function'/.test(SRC));
ok('…and it fires BEFORE the unit is marked dead',
   /_bbRevealArrow\(_v, '#ff5a4a'\); \} catch \(e\) \{\}\n        state\.units = state\.units\.map/.test(SRC),
   'afterwards there is nothing on the board to point at and the arrow floats over bare ground');

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
