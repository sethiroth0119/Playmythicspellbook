/* 🎴🧬 v121v140 — the FOURTH ability surface gets the card art, and an Evo unit
   is a unit. Run: node _evoart_smoke.mjs

   Owner, with a screenshot of a frame PNG wearing a unicorn emoji: "When a hero
   or unit use their ability Show the card art not this emoji stuff."
   Owner: "Evo Units are units It should be under summon."

   ⚠ v121v134 REPLACED THE ART LOOKUP ON THREE SURFACES AND MISSED A FOURTH.
     The ⚡ panel, the activation cinematic and the battle log were fixed;
     _afxAnnounce — which builds the spec ActivateFX draws as a FULL-SCREEN card
     face — still ran the pre-v134 lookup: refuse every blob:, then fall to the
     thumbnail tier. That is exactly the code v134 identified as the bug, because
     _lazyLoadCardArt stores EVERY streamed card art as a blob:. With artUrl null
     activate.js falls to frameUrl + an .afx-glyph of s.icon, which is the
     screenshot, precisely. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const AFX = readFileSync('./public/src/battle/activate.js', 'utf8').replace(/\r\n/g, '\n');

/* ── the fourth surface ───────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _afxAnnounce(before, after, unit, card, opts) {'), SRC.indexOf('window.ActivateFX.announce(_spec);'));
  /* 4d33c03a49: the beat now walks every candidate id (the hero's own, the live
     Kalon form, the base card) and asks the resolver for each — `_i`, not the
     single `cardId` it used to stop at. Still the shared resolver, still full art. */
  ok(/_abilityArtBest\((?:cardId|_i), true\)/.test(f),
    'THE ACTIVATION BEAT ASKS THE SHARED RESOLVER — the surface v121v134 missed');
  ok(/true asks for FULL art/.test(f),
    '…for FULL art, because this one fills the screen: a 160px thumb is the last thing it should settle for');
  ok(!/String\(a\)\.slice\(0, 5\) !== 'blob:'/.test(f),
    'the blob: refusal is GONE from here too — it was throwing away the art the board is already drawing');
  ok(!/_abilityCardArt\(cardId\)/.test(f), '…and so is the old thumbnail-only fallback');
  ok(/v121v134 fixed the ⚡ panel, the cinematic and the battle log and MISSED\n\s*this one/.test(f),
    'the note records that this was a MISS in an earlier fix, not a new surface — so the next reader knows to check for a fifth');
  /* the spec still carries everything else it did */
  ok(/artUrl: art,/.test(f) && /frameUrl: frame,/.test(f), 'the spec still carries both art and frame');
  ok(/hidden: !!\(o\.hidden \|\| \(owner === 'ai' && unit && unit\.isFaceDown\)\)/.test(f),
    '…and still never reveals a face-down enemy card — the Subterfuge leak this project already closed once');
}
{
  /* the frame fallback is deliberate HERE, unlike in the log */
  const f = SRC.slice(SRC.indexOf("// No illustration ⇒ the card's own FRAME png"), SRC.indexOf("// No illustration ⇒ the card's own FRAME png") + 1200);
  ok(/THIS FALLBACK STAYS, unlike the battle log's/.test(f),
    'the frame fallback is KEPT here on purpose — a full-screen card face is not a 34px log row, and activate.js says a bare dark rectangle is the worst outcome');
}
/* the consumer side, so the pin is anchored on what actually draws the emoji */
ok(/else if \(s\.frameUrl && !s\.hidden\) \{/.test(AFX) && /glyph = '<span class="afx-glyph">' \+ esc\(s\.icon \|\| '⚡'\) \+ '<\/span>';/.test(AFX),
  'activate.js still draws frame + glyph when there is NO art — which is why the fix had to be on the producing side, not here');
ok(/if \(s\.artUrl && !s\.hidden\) \{/.test(AFX), '…and draws the art when there is some, unchanged');

/* ── an Evo unit is a unit ────────────────────────────────────────────────── */
/* 🌌 2026-09-18 — an Evo card is saved as type 'realm' now (owner: Evo is a
   Realm kind), so 'realm' must be on this list too or the hatch would be
   refused again. realmtype-probe R5 hatches a realm-typed Evo onto a tile. */
ok(/return t === 'unit' \|\| t === 'summon' \|\| t === 'evo' \|\| t === 'realm' \|\| t === 'enchantment' \|\| t === 'curse';/.test(SRC),
  'AN EVO UNIT MAY BE PUT ON A TILE — without this the Evo unit is refused by the very summon that exists to bring it out');
{
  const f = SRC.slice(SRC.indexOf('🧬 v121v140 — AN EVO UNIT IS A UNIT'), SRC.indexOf('🧬 v121v140 — AN EVO UNIT IS A UNIT') + 700);
  ok(/BY THE VERY SUMMON THAT EXISTS TO\n\s*BRING IT OUT/.test(f),
    'the note records the failure this prevents — the Cocoon feature would have broken the moment it was built');
  ok(/It stays Realm-deck-only for DECKBUILDING/.test(f),
    '…and that "is a unit on the board" and "is Realm-deck-only in the builder" are separate questions');
}
ok(/isRealmOnlyCard/.test(SRC) && /isEvoCard/.test(SRC), 'the v121v138 Realm-deck-only rule is still in force');

/* ── the dropdown entry sits under Summon ─────────────────────────────────── */
/* 🌌 2026-09-18 — owner: "Make Realm Deck a card type where Fusions, Convergence,
   Evo Units, Archons are all in that." The 'evo' dropdown entry was REPLACED by
   one '🌌 Realm' entry (Evo is picked as its kind), in the same slot under
   Summon. So the pins move to that entry: still exactly one, still directly
   under Summon, still above Counter and away from Bred Unit — and no separate
   Evo type entry is left behind to be picked by mistake. */
ok((SRC.match(/\{ id: 'realm',    label: '🌌 Realm \(Realm Deck/g) || []).length === 1   // (the Inventory's Realm TAB shares the shorter prefix)
   && (SRC.match(/\{ id: 'evo',      label: '🧬 Evo Unit/g) || []).length === 0,
  'there is exactly ONE Realm entry (which holds Evo) and no separate Evo entry');
{
  const summonAt = SRC.indexOf("{ id: 'summon',   label: '🌀 Summon");
  const evoAt = SRC.indexOf("{ id: 'realm',    label: '🌌 Realm (Realm Deck");
  const counterAt = SRC.indexOf("{ id: 'counter',  label: '⏱ Counter");
  const bredAt = SRC.indexOf("{ id: 'bred',     label: '🧬 Bred Unit");
  ok(summonAt > 0 && evoAt > summonAt, 'the Realm entry (Evo\'s home) comes AFTER Summon — the owner asked for Evo "under summon"', 'summon@' + summonAt + ' realm@' + evoAt);
  ok(counterAt > evoAt, '…and before Counter, so it sits directly beneath Summon rather than merely later in the list');
  ok(bredAt > evoAt, '…and it is no longer down beside Bred Unit, where it was');
}

/* ── run the type rule for real ───────────────────────────────────────────── */
{
  // 🌌 + 'realm' — the type an Evo card is saved as since 2026-09-18 (see above)
  const summonable = (t) => t === 'unit' || t === 'summon' || t === 'evo' || t === 'realm' || t === 'enchantment' || t === 'curse';
  ok(summonable('evo') === true && summonable('realm') === true, 'run for real: an Evo unit can be summoned onto the board (type evo or realm)');
  ok(summonable('unit') && summonable('summon') && summonable('enchantment') && summonable('curse'),
    'run for real: every type that could be summoned before still can');
  ok(!summonable('spell') && !summonable('trap') && !summonable('location') && !summonable('weather') && !summonable('hero'),
    'run for real: and nothing new became summonable — a hero especially, which would make "your hero died" ambiguous');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 140, 'BUILD_VERSION is v121v140 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
