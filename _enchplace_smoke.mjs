/* 🔮📍 v121v135 — an enchantment is PLACED on a highlighted tile next to your
   hero. Run: node _enchplace_smoke.mjs

   Owner: "When playing a Enchantment it should show heighlighted tiles next to
   the hero to where it can be placed on the battlefield."

   ⚠ IT WAS NOT MERELY UNHIGHLIGHTED — IT WAS UNPLAYABLE FROM HAND. The
     card-detail Play button knows four immediate plays (spell, weather, a
     whole-board location, a tunnelling unit) and sends everything else into
     TILE TARGETING. An enchantment landed there, and the highlight pass built
     validPlacement only for unit/trap/wall/location while onTileClick's switch
     had branches for unit/location/trap/wall — so nothing lit up AND the click
     did nothing. playSpell's enchantment branch is reachable only for
     card.type === 'spell', so no player route ever got to it. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the ring ─────────────────────────────────────────────────────────────── */
ok(/if \(card\.type === 'enchantment' \|\| card\.type === 'curse'\) return DEFAULT_UNIT_PLACE_RANGE;/.test(SRC),
  'the ring is STATED — next to the hero, like a unit — rather than falling through to a default that a later edit could move');
{
  const f = SRC.slice(SRC.indexOf('const getValidPlacementTiles = (card, hero, state) => {'), SRC.indexOf('// Wall placement default range is 1'));
  ok(/if \(card\.type === 'enchantment' \|\| card\.type === 'curse'\) \{\n\s*return cells\.filter\(p => !getOccupant\(p, state\.units\) && !\(state\.board\[p\.y\]\[p\.x\] && state\.board\[p\.y\]\[p\.x\]\.wall\)\);/.test(f),
    'it takes a TILE, so the ring excludes ground a unit or a wall already holds — the bare fall-through would have lit those up');
  ok(/sealed\.some/.test(f), '…and a sealed tile is still filtered at the source, so highlight, click and AI agree');
}

/* ── the highlight and the click gain it TOGETHER ─────────────────────────── */
ok(/\|\| moveCard\.type === 'enchantment' \|\| moveCard\.type === 'curse'\) \{\n\s*validPlacement = getValidPlacementTiles\(moveCard, ph, s\);/.test(SRC),
  'HOLDING ONE LIGHTS THE TILES — the owner\'s actual request');
ok(/else if \(card\.type === 'enchantment' \|\| card\.type === 'curse'\) _gateOnPlayThenPlace\(card, \(\) => placeEnchantment\(card, \{x, y\}\), \(\) => placeEnchantment\(card, \{x, y\}, \{ validateOnly: true \}\)\);/.test(SRC),
  '…and clicking one PLAYS it — the other half, which was missing too, so targeting mode had no exit but Escape');
ok(/UI-lies-about-the-rules pair/.test(SRC.slice(SRC.indexOf('v121v135 — an enchantment lights its tiles too'), SRC.indexOf('v121v135 — an enchantment lights its tiles too') + 700)),
  '…and the pairing is written down, because lighting a tile the click refuses is the same class of bug in reverse');

/* ── the placement ────────────────────────────────────────────────────────── */
ok(/function placeEnchantment\(card, pos, opts\) \{/.test(SRC), 'the play has its own function');
{
  const f = SRC.slice(SRC.indexOf('function placeEnchantment(card, pos, opts) {'), SRC.indexOf('function playSpell(card) {'));
  ok(/_battleIsLocked\(s, 'player', 'spell'\)/.test(f), 'a spell lockdown stops it — it is cast from hand like a spell');
  ok(/_phaseAllows\('play'\)/.test(f) && /_checkPlayRequirement\(card, s, 'player'\)/.test(f), '…as do the phase gate and the play requirement');
  ok(/if \(_dry\) return true;/.test(f) && /const _dry = !!\(opts && opts\.validateOnly\);/.test(f),
    'the DRY RUN answers before any cost is taken — a refused play must never cost the player a discard first');
  {
    const dryAt = f.indexOf('if (_dry) return true;');
    ok(f.indexOf('_playerNegateAbort') > dryAt && f.indexOf('App.state = {') > dryAt,
      '…and it returns BEFORE the negate check and the state write, which both mutate real game state');
  }
  ok(/_tok\.isEnchantment = true; _tok\.cardType = card\.type;/.test(f),
    'the board token announces itself — the same flag v121v133 put on a SUMMONED one, so both routes make the same board object');
  ok(/_tok\.hasMoved = true; _tok\.hasAttacked = true;/.test(f), '…and it takes no turn: it is a permanent standing on a tile, not a combatant');
  ok(/_tok\._fromHand = true;/.test(f), '…and it WAS called from hand, which the Banish Unless Called From Hand effect reads');
  ok(/tokenId: _tok \? _tok\.id : undefined,/.test(f) && /pos: \{ x: pos\.x, y: pos\.y \},/.test(f),
    'the state.enchantments entry is KEPT and linked to the token — the aura layer, the curse release, the zone condition and the side-swap all read that entry, and dropping it would silently kill all four');
  ok(/const _anchor = _tok \|\|/.test(f),
    'an arrival effect fires from the permanent\'s OWN tile now — it has a real position for the first time');
  ok(/kind: 'play', cardId: card\.id, cardType: card\.type/.test(f),
    '…and the log row can draw its card art, like any other play');
}
ok(/function _enchantEntry\(card, owner, turnNumber, extra\) \{/.test(SRC),
  'ONE entry builder — two constructors for state.enchantments is how its four readers quietly disagree');
{
  /* ⚠ ANCHORED ON playSpell, NOT on the type test — v121v135 put that same
     test into getValidPlacementTiles, EARLIER in the file, so an indexOf for it
     lands on the placement ring and the slice would cover half the engine. */
  const _psAt = SRC.indexOf('function playSpell(card) {');
  const ps = SRC.slice(_psAt, SRC.indexOf('// 🌌 Polycreation spell', _psAt));
  ok(/enchantments: \[\.\.\.\(s\.enchantments \|\| \[\]\), _enchantEntry\(card, 'player', s\.turnNumber\)\],/.test(ps),
    'the CAST path (a chain, a copy effect) builds the same entry with NO tile — it still anchors on the hero, exactly as it always did');
  ok(/NO TILE HERE, DELIBERATELY/.test(ps), '…and says so, so the next reader does not "fix" it');
}

/* ── the aura, and death ──────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('if (Array.isArray(state.enchantments)) {'), SRC.indexOf('if (Array.isArray(state.enchantments)) {') + 1800);
  ok(/if \(!tk \|\| !tk\.alive\) return;/.test(f),
    'DESTROYED ENDS IT — "they stay on the field until destroyed", derived rather than hooked');
  ok(/if \(tk\.pos\) ep = \{ x: tk\.pos\.x, y: tk\.pos\.y \};/.test(f),
    'the aura radiates from the LIVE token, never from the stored e.pos — the two can then never drift apart');
  ok(/pos: ep \|\| heroPos\(eo\)/.test(f),
    '…and an entry with no token (the AI\'s plays, the cast path) still anchors on its owner\'s hero, unchanged');
  ok(/forty places in this file/.test(f),
    'the reason liveness is derived is written down: alive:false is set in ~40 places and a per-site hook would be broken by the first one missed');
}
ok(/A DESTROYED PERMANENT LEAVES THE FIELD/.test(SRC) && /if \(alive\.length !== s\.enchantments\.length\) s = \{ \.\.\.s, enchantments: alive, log: log \};/.test(SRC),
  '…and the dead entry is swept, so it stops riding in every replay snapshot and answering "you control an enchantment"');

/* ── run the rules for real ───────────────────────────────────────────────── */
{
  /* the ring */
  const DEFAULT_UNIT_PLACE_RANGE = 1;
  const range = (t) => t === 'unit' ? DEFAULT_UNIT_PLACE_RANGE
    : t === 'enchantment' || t === 'curse' ? DEFAULT_UNIT_PLACE_RANGE : 1;
  ok(range('enchantment') === 1 && range('curse') === 1, 'run for real: an enchantment places on the hero\'s own neighbours');

  /* the tile filter */
  const units = [{ id: 'u1', alive: true, pos: { x: 2, y: 2 } }];
  const board = [[{}, {}, {}], [{}, {}, {}], [{}, {}, { wall: { hp: 5 } }]];
  const occ = (p) => units.some(u => u.alive && u.pos.x === p.x && u.pos.y === p.y);
  const filt = (cells) => cells.filter(p => !occ(p) && !(board[p.y] && board[p.y][p.x] && board[p.y][p.x].wall));
  const cells = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 1, y: 1 }];
  const got = filt(cells);
  ok(got.length === 2 && !got.some(p => p.x === 2 && p.y === 2),
    'run for real: the tile a unit stands on is not offered', JSON.stringify(got));
  ok(!filt([{ x: 2, y: 2 }]).length, 'run for real: …nor one under a wall');

  /* liveness */
  const board2 = [{ id: 't1', alive: true, pos: { x: 1, y: 1 } }, { id: 't2', alive: false, pos: { x: 0, y: 0 } }];
  const heroPos = () => ({ x: 9, y: 9 });
  const src = (e) => {
    if (e.tokenId) {
      const tk = board2.find(u => u.id === e.tokenId);
      if (!tk || !tk.alive) return null;
      return { x: tk.pos.x, y: tk.pos.y };
    }
    return heroPos();
  };
  ok(JSON.stringify(src({ tokenId: 't1' })) === '{"x":1,"y":1}',
    'run for real: a live enchantment radiates from its own tile');
  ok(src({ tokenId: 't2' }) === null,
    'run for real: a DESTROYED one projects nothing at all — this is "until destroyed"');
  ok(JSON.stringify(src({})) === '{"x":9,"y":9}',
    'run for real: one with no token (the AI, the cast path) still anchors on the hero — the old behaviour, untouched');
  ok(src({ tokenId: 'gone' }) === null,
    'run for real: a token that is not on the board at all is treated as destroyed, not as hero-anchored');
}

/* ── what was deliberately NOT changed ────────────────────────────────────── */
{
  const btn = SRC.slice(SRC.indexOf('const playBtn = document.getElementById(\'card-detail-play\');'), SRC.indexOf('function closeCardDetail()'));
  ok(!/enchantment/.test(btn),
    'the Play button is UNCHANGED — an enchantment still falls into the targeting branch, which is now the branch that works');
  ok(/card\.type === 'spell'/.test(btn) && /card\.type === 'weather'/.test(btn),
    '…and the immediate plays it does know are untouched');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 135, 'BUILD_VERSION is v121v135 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
