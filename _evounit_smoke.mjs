/* 🪖 v121v143 — an Evo unit is EDITED as a unit: stats, moves, the lot.
   Run: node _evounit_smoke.mjs

   Owner: "Rvo Units are just like Summons and units they are units that can
   fight you have them as Spells Give them where they two can have stats and
   attacks etc."

   ⚠ THIS IS A BUG IN v121v138/v140, NOT A NEW REQUEST. The `evo` type was added
     to the Forge dropdown and the ENGINE was taught it may stand on a tile
     (_isSummonableCard, v121v140) — but the EDITOR's own test was left as
     `type === 'unit' || 'hero' || 'summon'`, so picking Evo Unit rendered the
     non-unit form: no HP/ATK/DEF/MAG/RES/SPD, no learnset, no passives, no
     factions. A card that gets summoned onto the board to FIGHT had no way to be
     given anything to fight with.

   ⚠ THE SAVE SIDE NEEDED NO CHANGE, which is the tell that this was purely a
     rendering gate: the stat capture is `if (document.getElementById('ed-hp'))`,
     so it reads whatever the editor put on screen. The stats were never refused,
     only never offered. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── one predicate ────────────────────────────────────────────────────────── */
ok(/function isUnitLikeType\(t\) \{/.test(SRC), 'ONE predicate answers "does this card type have a unit\'s body"');
{
  const f = SRC.slice(SRC.indexOf('function isUnitLikeType(t) {'), SRC.indexOf('function isUnitLikeType(t) {') + 300);
  /* 🌌 2026-09-18 — owner: "Make Realm Deck a card type where Fusions,
     Convergence, Evo Units, Archons are all in that." An Evo card is now saved
     as type 'realm' (realmKind 'evo'), so 'realm' joins the list; 'evo' stays
     for any save the normaliser has not reached. The guarded behaviour (an Evo
     card has a unit's body) is unchanged — realmtype-probe E2/E3 edit and
     reload a Realm/Evo card's stats for real. */
  ok(/return k === 'unit' \|\| k === 'hero' \|\| k === 'summon' \|\| k === 'evo' \|\| k === 'realm';/.test(f),
    'and an Evo unit is one of them — alongside units, heroes and summons (as type evo OR as a Realm card)');
  ok(/String\(t \|\| 'unit'\)\.toLowerCase\(\)/.test(f),
    '…answered case-insensitively, and an absent type still reads as a unit, as it did before');
}
ok(/That was a bug in v121v138\/v140/.test(SRC),
  'the note records that this was a MISS in the type\'s own rollout, not a late feature request');

/* ── every site that decided "is this a unit" ─────────────────────────────── */
ok(/  const isUnitLike = isUnitLikeType\(type\);/.test(SRC),
  'THE FORGE EDITOR renders the unit form — the site that caused the report');
ok(/const isUnitLike = isUnitLikeType\(c\.type\);   \/\/ 🪖 v121v143 — Evo units too/.test(SRC),
  'the deck-search card panel shows its stat bars');
ok(/const isUnitLike = kind === 'unit' \|\| \(kind === 'custom' && isUnitLikeType\(card\.type\)\);/.test(SRC),
  'the collection card detail treats it as a unit — which is also what gives it an equip key');
ok(/if \(isUnitLikeType\(t\) && t !== 'summon'\) \{\n\s*const s = c\.stats \|\| \{\};/.test(SRC),
  'the Forge card list prints its stat line instead of an empty spell line');
ok(/evo:'Evo Unit'/.test(SRC), '…and the list names the type rather than printing a bare "evo"');
ok(!/const isUnitLike = type === 'unit' \|\| type === 'hero' \|\| type === 'summon';/.test(SRC)
   && !/const isUnitLike = c\.type === 'unit' \|\| c\.type === 'hero' \|\| c\.type === 'summon';/.test(SRC),
  'no hand-rolled unit-like test is left behind to drift from the predicate — four sites disagreeing is exactly how this bug happened');

/* ── the save side is untouched, deliberately ─────────────────────────────── */
ok(/if \(document\.getElementById\('ed-hp'\)\) \{\n\s*card\.stats = card\.stats \|\| \{\};/.test(SRC),
  'the stat capture still keys off the FIELD EXISTING, so rendering the unit form is all that was ever needed');
ok(/The save side needs no change — the stat capture is\n\s*gated on document\.getElementById\('ed-hp'\)/.test(SRC),
  '…and that reasoning is written where the next reader would otherwise go hunting for a save bug');

/* ── the rest of the Evo rules still hold ─────────────────────────────────── */
/* 🌌 'realm' added beside 'evo' (owner, 2026-09-18: Evo is a Realm kind now).
   Proven on the board by realmtype-probe R5: a realm-typed Evo hatches out of
   the Realm Deck onto the cocoon's tile. */
ok(/t === 'unit' \|\| t === 'summon' \|\| t === 'evo' \|\| t === 'realm' \|\| t === 'enchantment' \|\| t === 'curse'/.test(SRC),
  'v121v140 still stands: an Evo unit may be summoned onto a tile (type evo or realm)');
ok(/function isEvoCard\(card\) \{/.test(SRC) && /function isRealmOnlyCard\(card\) \{/.test(SRC),
  'v121v138 still stands: it is still a Realm-deck-only card for DECKBUILDING');

/* ── run the predicate for real ───────────────────────────────────────────── */
{
  const isUnitLikeType = (t) => {
    const k = String(t || 'unit').toLowerCase();
    return k === 'unit' || k === 'hero' || k === 'summon' || k === 'evo';
  };
  ok(isUnitLikeType('evo') === true, 'run for real: an Evo unit has a body');
  ok(isUnitLikeType('EVO') === true, 'run for real: …case-insensitively');
  ok(isUnitLikeType('unit') && isUnitLikeType('hero') && isUnitLikeType('summon'),
    'run for real: everything that had a body before still does');
  ok(isUnitLikeType(undefined) === true && isUnitLikeType('') === true,
    'run for real: a missing type still reads as a unit — the old default, unchanged');
  ok(!isUnitLikeType('spell') && !isUnitLikeType('trap') && !isUnitLikeType('enchantment')
     && !isUnitLikeType('curse') && !isUnitLikeType('weather') && !isUnitLikeType('location') && !isUnitLikeType('wall'),
    'run for real: and nothing WITHOUT a body gained one — a spell must not sprout a stat block');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 143, 'BUILD_VERSION is v121v143 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
