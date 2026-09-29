/* 🌟 v121v124 — "Summon From Zone" can pick hand / deck / graveyard / Void in
   EVERY effect block, not only On Play. Run: node _summonzone_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the field reaches every editor ── */
ok(/🌟 COMPLETE EVERY SUMMON ZONE\./.test(SRC), 'a completion pass finishes the editors that never had the picker');
ok(/if \(document\.getElementById\(pre \+ '-summonzone'\)\) return;      \/\/ already has one/.test(SRC), '…without touching the six that already ship one');
{
  const m = /const PRE = \['ed-onplay', 'ed-ongrave', 'ed-ig', 'ed-grave', 'ed-field', 'ed-hand',\n\s*'ed-onatk', 'ed-onkill', 'ed-milled', 'ed-aura', 'ed-kalon-onx',\n\s*'ed-onplayx-0', 'ed-onplayx-1', 'ed-onplayx-2', 'ed-onplayx-3', 'ed-onplayx-4', 'ed-onplayx-5'\];/.test(SRC);
  ok(m, 'every block that can hold the effect is in the list — On-Grave and Hand Ability, which the owner hit, and all six extra On-Play slots');
}
ok(/const typeSel = document\.getElementById\(pre \+ '-type'\) \|\| document\.getElementById\(pre \+ '-effect'\);/.test(SRC), 'a block that is not on screen is skipped (both id shapes are asked for)');
ok(/wrap\.innerHTML = _summonZoneFieldHtml\(pre, \{ summonZone: saved \|\| 'deck' \}\);/.test(SRC), 'it is the SAME picker the other editors use, not a second copy');
ok(/saved = \(eff && typeof eff\.summonZone === 'string'\) \? eff\.summonZone : null;/.test(SRC), '…and it opens on the zone the card already had saved');

/* ── 2. it is gated and ordered like the rest ── */
{
  const i = SRC.indexOf('🌟 COMPLETE EVERY SUMMON ZONE'), j = SRC.indexOf('_fxApplyEffectGate();', i);
  ok(i > 0 && j > i, 'the injection runs BEFORE the effect gate, so the new field hides and shows with the others');
}
ok(/'summonzone': \['summonZone'\]/.test(SRC), 'the gate table already knew the suffix — no second mapping was invented');

/* ── 3. the save side ── */
ok(/function _fxZonePathFor\(prefix, card\) \{/.test(SRC) && /Array\.isArray\(card\.onPlayExtra\) \? card\.onPlayExtra\[\+m\[1\]\] : null/.test(SRC) && /card\.kalonForm && card\.kalonForm\.onTransform/.test(SRC),
  'each editor knows which effect object its zone belongs to, including the extra slots and the Kalon transform');
ok(/function _fxCaptureAllSummonZones\(card\) \{/.test(SRC) && /const TAKES_ZONE = \{ summonFromZone: 1, sacrificeToSummon: 1 \};/.test(SRC), 'a save-side sweep writes every picker back, only for effects that take a zone');
ok(/try \{ _fxCaptureAllSummonZones\(card\); \} catch \(e\) \{ console\.warn\('\[zone-sweep\]', e\); \}/.test(SRC), '…and it runs on save, beside the filter sweep');

/* ── 4. the effects and the runtime are untouched ── */
/* ⚠ THIS PIN CARRIED THE LABEL PROSE VERBATIM, and that is not what it is for:
   its own message says "declares that it needs a ZONE", and the needs list is
   the whole of that claim. v121v133 widened the label to say the effect also
   carries enchantments now, and the pin failed over a sentence it was never
   testing. The needs list — which IS the contract the zone picker reads — is
   asserted exactly as before, and the label is still required to be the Summon
   From Zone one, so a rename that changed the EFFECT is still caught. */
ok(/\{ id: 'summonFromZone', label: '🌟 Summon From Zone \([^']*\)', needs: \['summonZone','amount','summonCardIds','filter'\] \}/.test(SRC), 'the effect still declares that it needs a zone');
ok(/const SUMMON_ZONES = \[\n\s*\{ id: 'deck',  key: 'deck',      label: 'deck' \},\n\s*\{ id: 'hand',  key: 'hand',      label: 'hand' \},\n\s*\{ id: 'grave', key: 'graveyard', label: 'graveyard' \},\n\s*\{ id: 'void',  key: 'void',      label: 'Void' \},\n\s*\];/.test(SRC), 'the four zones are unchanged');
ok(/function _summonZone\(id\) \{ return SUMMON_ZONES\.find\(z => z\.id === id\) \|\| SUMMON_ZONES\[0\]; \}/.test(SRC), 'a card saved before today, with no zone, still reads as the deck — nothing already built changes behaviour');

/* ── 5. run the mapping for real ── */
{
  const block = SRC.slice(SRC.indexOf('function _fxZonePathFor(prefix, card) {'), SRC.indexOf('function _fxCaptureAllFilters(card) {'));
  const g = { _fxFilterPathFor: (p, c) => ({ 'ed-ongrave': c.onGrave, 'ed-hand': c.handActive && c.handActive.effect }[p] || null) };
  const api = new Function('g', 'with (g) { ' + block + ' return { _fxZonePathFor, _fxCaptureAllSummonZones }; }')(g);
  const card = {
    onGrave: { type: 'summonFromZone' },
    handActive: { effect: { type: 'sacrificeToSummon' } },
    onPlayExtra: [{ type: 'damage' }, { type: 'summonFromZone' }],
    kalonForm: { onTransform: { type: 'summonFromZone' } },
  };
  ok(api._fxZonePathFor('ed-ongrave', card) === card.onGrave, 'run for real: the On-Grave picker belongs to card.onGrave');
  ok(api._fxZonePathFor('ed-onplayx-1', card) === card.onPlayExtra[1], 'run for real: the second extra slot belongs to onPlayExtra[1]');
  ok(api._fxZonePathFor('ed-kalon-onx', card) === card.kalonForm.onTransform, 'run for real: the Kalon picker belongs to its transform effect');
  ok(api._fxZonePathFor('ed-onplayx-9', card) === null && api._fxZonePathFor('ed-nope', card) === null, 'run for real: an unknown editor writes nowhere');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 124, 'BUILD_VERSION is v121v124 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
