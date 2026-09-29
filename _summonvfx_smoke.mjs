/* ============================================================================
 * _summonvfx_smoke.mjs — ✨ STANDARD SUMMON VFX gate.   node _summonvfx_smoke.mjs
 * ----------------------------------------------------------------------------
 * Hologram (normal) and Crimson Rupture (mythic/ACE) are the ordinary arrival
 * effect for a unit being PLAYED. They are not cinematics and must never drift
 * back into _UNIT_SUMMON_VFX, which is the ACE iframe lane behind the
 * _summonCineBusy lock.
 *
 * 🔴 THE TWO THAT EARN THEIR KEEP are the anchor order and the hold. Both are
 * silent when wrong: a VFX anchored off the tile still plays (in the middle of
 * the board), and a unit that arrives during its own hologram still arrives. No
 * error, no failing syntax gate — it just looks wrong.
 * ==========================================================================*/
import fs from 'fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const BB  = fs.readFileSync(new URL('./public/battle-board/index.html', import.meta.url), 'utf8');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ── the lane ── */
ok('hologram/crimson are OUT of the cinematic table',
   !/_UNIT_SUMMON_VFX[\s\S]{0,4000}?hologram:/.test(SRC) && SRC.indexOf('vfx-hologram.html') < 0,
   'still registered as a cinematic');
ok('the standard table names both renderers',
   /_STANDARD_SUMMON_VFX = \{[\s\S]*?HologramSummon[\s\S]*?RuptureSummon[\s\S]*?\}/.test(SRC));
ok('they are the canvas classes, not the iframe pages',
   SRC.indexOf('assets/vfx/hologram-summon.js') > 0 && SRC.indexOf('assets/vfx/rupture-summon.js') > 0);
ok('the standard path never takes the cinematic lock',
   !/_playStandardSummonVfx[\s\S]{0,4000}?_summonCineBusy/.test(SRC),
   'a normal summon must not block on the ACE lane');
ok('mythic/ACE is split by the existing tier helper',
   /_playStandardSummonVfx[\s\S]{0,800}?_vfxSummonTier/.test(SRC));
ok('an ordinary play dispatches it instead of falling through to the meteor',
   /_playStandardSummonVfx\(u,/.test(SRC));
ok('cards already saved with the old ids still resolve',
   /vfxId === 'hologram' \|\| vfxId === 'crimson'/.test(SRC));

/* ── the anchor, and its order ── */
const fn = /function _playStandardSummonVfx\(unit, anchor\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_playStandardSummonVfx found', !!fn);
if (fn) {
  const body = fn[0];
  const iTile = body.indexOf('_bbTilePoint');
  const iDom  = body.indexOf('anchor && anchor.x');
  ok('the stage tile mapping is asked BEFORE the DOM anchor',
     iTile > 0 && iDom > 0 && iTile < iDom,
     '_vfxAnchorFor never returns null, so asking it first makes _bbTilePoint unreachable and the VFX plays at board centre');
  ok('…and there is still a last-resort centre', /innerWidth \/ 2/.test(body));
  ok('the canvas is placed against the renderer floor line, not its centre',
     /H \* 0\.82/.test(body), 'or the unit materialises above its own hex');
  ok('a backstop removes the canvas if onComplete never fires',
     /setTimeout\(kill/.test(body), 'a backgrounded tab stops rAF and it would sit there forever');
}

/* ── the hold ── */
ok('the host asks the board to hold the arrival', /_bbStagePost\('summonHold'/.test(SRC));
ok('the board implements summonHold', /function summonHold\(unitId, hold\)/.test(BB));
ok('the board wires the message', /t === 'summonHold'/.test(BB));
ok('the hold is CLAMPED on the board side',
   /Math\.min\(8, \+hold \|\| 0\)/.test(BB),
   'a bad value from the host must not be able to hide a unit indefinitely');
ok('the hold is a countdown the board owns, not a reveal message',
   /u\.riseHold -= dt/.test(BB),
   'a two-message reveal is how a unit ends up on the board and permanently invisible — see _bbStagePushUnits');
ok('it takes over an already-started rise (the two messages race)',
   /u\.rise = 0; u\.riseT = undefined;\n  u\.riseHold = h;/.test(BB));
ok('the ordinary ceremony still runs when the hold expires',
   /_riseGo[\s\S]{0,200}?summonFx\(unitId\)/.test(BB));

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
