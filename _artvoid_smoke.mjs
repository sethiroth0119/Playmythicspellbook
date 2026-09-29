/* ══════════════════════════════════════════════════════════════════════════
   🎴🌌⏱ ACTIVATION ART · BANISH COSTS → VOID · 4-SECOND COUNTER FLASH

   Owner, in one message:
     "when I kalon transformed I got this [frame + ⭐] it should always be the
      card art" · "No Hero ability should show this it should always be their
      card art" [frame + 🦄]
     "I vanished a card from my graveyard for a cost and it still did not appear
      in the vanish zone"
     "when I used spell counters a quick notification flash acrossed the screen
      make it last 4 seconds"

   Behaviour is measured by two probes against the real reducers:
     .gauntlet/afxart-probe.mjs    6/6 now; the Kalon and hero cases FAIL before
     .gauntlet/voidflash-probe.mjs 15/15 now; 9 FAIL before (nothing reached the
                                   Void, and a banished unit card still showed in
                                   the graveyard through its corpse)
   This file pins the source facts those results depend on.

   Run: node _artvoid_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
let fails = 0, passes = 0;
const has = (t) => SRC.indexOf(t) >= 0;
const count = (t) => SRC.split(t).length - 1;
function ok(label, cond, why) {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (why ? '\n         ' + why : '')); }
}
function fnBody(head) {
  const i = SRC.indexOf(head);
  if (i < 0) return '';
  const j = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, j > 0 ? j : i + 8000);
}

console.log('\n── 🎴 activation art ──');
{
  const best = fnBody('function _abilityArtBest(cardId, big) {');
  ok('_abilityArtBest is locatable', best.length > 300);
  ok('…asks getCardArt (the catalogue artUrl a Kalon form lives in)', best.indexOf("getCardArt(i)") > 0);
  ok('…and _polyArtSrc (fusion Kalons)', best.indexOf('_polyArtSrc(i)') > 0);
  ok('…as the LAST tier in both orders, behind the caches', best.indexOf('[stable, resident, thumb, mp, catalog]') > 0
     && best.indexOf('[stable, thumb, resident, mp, catalog]') > 0);
  const ann = fnBody('function _afxAnnounce(before, after, unit, card, opts) {');
  ok('_afxAnnounce is locatable', ann.length > 500);
  ok('…tries EVERY candidate id, not just the first', ann.indexOf('for (const _i of _ids) {') > 0 && ann.indexOf('if (art) break;') > 0,
     'a hero ability\'s card.id is the ABILITY\'s id; stopping there never reached the hero\'s portrait');
  ok('…including the hero\'s own id', ann.indexOf('unit && unit.isHero ? unit.heroId : null') > 0);
  ok('…with the live Kalon form before the base card', ann.indexOf('unit && unit.cardId, unit && unit.isHero') > 0
     && ann.indexOf('unit && unit.cardId') < ann.indexOf('unit && unit.originalCardId'));
}

console.log('\n── 🌌 banish costs → the Void ──');
ok('_fileBanishedToVoid exists', has('function _fileBanishedToVoid(state, side, cards, fromGrave) {'));
ok('…retires the corpse a grave card stood for', /function _fileBanishedToVoid[\s\S]{0,700}_graveCardLeft\(s, side, c\)/.test(SRC),
   'without it the graveyard view folds the unit back in and the card shows in both piles');
{
  const pay = fnBody('function _applyCostPayment(state, side, sourceUnit, cost, picks) {');
  ok('the cost picker files what it banishes', pay.indexOf('s = _fileBanishedToVoid(s, side, gone, true);') > 0);
  const alt = fnBody('function _applyAltPlayCost(state, side, card) {');
  ok('banishGraveCost collects graveyard cards instead of dropping them', alt.indexOf('if (g) graveGone.push(g);') > 0);
  ok('…collects hand cards', alt.indexOf('if (h) toVoid.push(h);') > 0);
  ok('…files a given-up field unit\'s card', alt.indexOf("if (c) toVoid.push({ ...c, instanceId: c.instanceId || ('void_' + u.id) });") > 0);
  ok('…and writes the Void onto the side the caller spreads', alt.indexOf('if (state[meKey]) state[meKey].void = _v[meKey].void;') > 0);
  ok('no graveyard splice in it discards its result any more', alt.indexOf('grave.splice(i, 1); } catch') < 0);
}

console.log('\n── ⏱ the counter flash ──');
ok('COUNTER_FLASH_MS is 4000', has('const COUNTER_FLASH_MS = 4000;'));
ok('all four flash timers use it', count('Date.now() - App.ui.counterFlash.at > COUNTER_FLASH_MS - 100') === 4
   && count('} } }, COUNTER_FLASH_MS);') === 4, 'found ' + count('} } }, COUNTER_FLASH_MS);'));
ok('no 800 ms timer is left', count('Date.now() - App.ui.counterFlash.at > 700') === 0);
ok('the overlay animates for that long', has('<div class="counter-flash" style="animation-duration:${COUNTER_FLASH_MS}ms;animation-delay:-${_cfT}ms">'));
ok('…and resumes on re-render instead of restarting', has('const _cfT = Math.max(0, Date.now() - ((cf && cf.at) || Date.now()));'));
ok('the keyframes HOLD the flash (85 %) before fading', has('85% { opacity: 1; transform: scale(1); }'));

console.log('\n── negative control ──');
ok('fnBody really can come back empty', fnBody('function noSuch_(') === '');

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all ' + passes + ' passed') + ' (' + passes + '/' + (passes + fails) + ')');
process.exit(fails ? 1 : 0);
