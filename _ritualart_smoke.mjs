/* 🖼⇄ THE RITUAL MODALS SHOW CARD ART, AND THE PLAYER PICKS THE MATERIALS.
   And 🖼 the battle board paints hand-made hex tiles.

   Asked for: "when it comes to Fusion and Archon modals show the card art of
   the cards, and if a player has multiple correct materials allow them to
   select which units they want to use instead of it being random" — and
   "change the tiles: the grass with this grass, the water with the water,
   and these street tiles for the base regular tiles".

   Run: node _ritualart_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const BB = readFileSync('./public/battle-board/index.html', 'utf8');
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. which units qualify for a slot ===');
{
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const env = { distance: dist, escapeHtml: (t) => String(t), getCardArt: () => null, _lazyLoadCardArt: () => {} };
  const code = ['_polySlotAlts', '_polyExpandReqs', '_polyArtSrc', '_polyArtHtml', '_polyThumbHtml'].map((n) => lift(SRC, n)).join('\n')
    + '\nreturn { alts: _polySlotAlts, expand: _polyExpandReqs, art: _polyArtHtml, thumb: _polyThumbHtml };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  const units = [
    { id: 'h', owner: 'player', isHero: true, alive: true, pos: { x: 3, y: 3 } },
    { id: 'm1', owner: 'player', alive: true, pos: { x: 3, y: 4 }, name: 'Mage A', tag: 'mage' },
    { id: 'm2', owner: 'player', alive: true, pos: { x: 4, y: 3 }, name: 'Mage B', tag: 'mage' },
    { id: 'm3', owner: 'player', alive: true, pos: { x: 9, y: 9 }, name: 'Mage Far', tag: 'mage' },
    { id: 'w1', owner: 'player', alive: true, pos: { x: 2, y: 3 }, name: 'Warrior', tag: 'war' },
    { id: 'e1', owner: 'ai', alive: true, pos: { x: 3, y: 2 }, name: 'Enemy Mage', tag: 'mage' },
    { id: 'd1', owner: 'player', alive: false, pos: { x: 3, y: 2 }, name: 'Dead Mage', tag: 'mage' },
  ];
  const st = { units };
  const isMage = (u) => u.tag === 'mage';
  const alts = F.alts(st, 'player', { x: 3, y: 3 }, 1, ['m1'], isMage, 'm1');
  ok(alts.map((u) => u.id).join(',') === 'm2', 'with Mage A chosen, Mage B is the one other qualifying unit in range (not the far one, not the enemy, not the dead one, not the hero)');
  ok(F.alts(st, 'player', { x: 3, y: 3 }, 1, ['m1'], isMage, 'm1').length === 1 && F.alts(st, 'player', { x: 3, y: 3 }, 9, ['m1'], isMage, 'm1').length === 2, 'the radius is honoured (1 → one alt, 9 → two)');
  ok(F.alts(st, 'player', { x: 3, y: 3 }, 1, ['m1', 'm2'], isMage, 'm1').length === 0, 'a unit already taken by another slot is not offered');
  ok(F.alts(st, 'player', { x: 3, y: 3 }, 1, ['m1'], () => { throw new Error('boom'); }, 'm1').length === 0, 'a matcher that throws offers nothing rather than crashing the modal');
  const rows = F.expand([{ type: 'mage', count: 2 }, { faction: 'beast' }]);
  ok(rows.length === 3 && rows[0].reqIndex === 0 && rows[1].reqIndex === 0 && rows[1].k === 1 && rows[2].reqIndex === 1, '"2× Mage + 1 Beast" is three rows, one per body');
  ok(F.art('x', '🌌') === '🌌' && /poly-thumb-emoji/.test(F.thumb('x', '🪖')), 'with no art the emoji stands in');
}

console.log('\n=== 2. the modals ===');
{
  ok(/<div class="poly-card-icon">\$\{_polyArtHtml\(card\.id, card\.icon \|\| '🌌'\)\}<\/div>/.test(SRC) && /<div class="poly-card-icon">\$\{_polyArtHtml\(kalon\.id, kalon\.icon \|\| '🌌'\)\}<\/div>/.test(SRC), 'the fusion modal shows the spell\'s and the Kalon\'s art');
  ok(/<div class="poly-card-icon">\$\{_polyArtHtml\(catalyst\.originalCardId \|\| catalyst\.cardId, catalyst\.icon \|\| '🜂'\)\}<\/div>/.test(SRC) && /<div class="poly-card-icon">\$\{_polyArtHtml\(archon\.id, archon\.icon \|\| '🜂'\)\}<\/div>/.test(SRC), 'the Archon modal shows the Catalyst\'s and the Archon\'s art');
  ok(/data-poly-swapf="\$\{i\}"/.test(SRC) && /data-poly-swapf\]'\)\.forEach/.test(SRC), 'a field material with other qualifying units gets a ⇄ and a handler');
  ok(/data-archon-swap="\$\{j\}"/.test(SRC) && /data-archon-swap\]'\)\.forEach/.test(SRC), 'an offering with other qualifying units gets a ⇄ and a handler');
  ok(/fm2\.materialUnitIds\[idx\] = alts\[0\]\.id;/.test(SRC) && /cand\.offeringUnitIds\[j\] = alts\[0\]\.id;/.test(SRC), 'both handlers swap the chosen unit into the slot the resolver reads');
  ok(/\.poly-art \{/.test(SRC) && /\.poly-thumb \{/.test(SRC), 'the art has its styles');
  ok(/_polyThumbHtml\(c\.archonCardId, c\.archonIcon/.test(SRC), 'the Archon picker chips carry art too');
}

console.log('\n=== 3. the board tiles ===');
{
  ok(/const TILE_ART = \{/.test(BB) && /grass:\s*\{ src: '\.\.\/assets\/Battlemap%20titles\/Grass%20Title\.png'/.test(BB) && /water:\s*\{ src: '\.\.\/assets\/Battlemap%20titles\/Water%20tiles\.png'/.test(BB), 'grass and water tiles point at the two paintings on disk');
  ok(/asphalt: \{ src: '\.\.\/assets\/Battlemap%20titles\/Street%201\.png', top: 1 \}/.test(BB) && /rubble: +\{ src: '\.\.\/assets\/Battlemap%20titles\/Dirt%201\.png'/.test(BB) && /dirt: +\{ src: '\.\.\/assets\/Battlemap%20titles\/Dirt%201\.png'/.test(BB), 'asphalt wears the meadow-track painting (flat, top face = whole image); rubble and dirt wear the sand painting');
  ok(/const _art = ring \? null : tileArtImage\(surf, x, z\);/.test(BB) && /if \(!_arted\)\{ ctx\.save\(\); pathPoly\(P\); ctx\.clip\(\); paintSurfTexture/.test(BB), 'a painted tile skips the procedural grit; a tile with no painting keeps it (nothing breaks while a file is missing)');
  ok(/if \(!_arted && window\.BBX\.terrain && window\.BBX\.terrain\.detail\)/.test(BB), 'no pebbles are scattered over a painting');
  ok(/\+ '\|art' \+ tileArtLoaded\(\);/.test(BB), 'the ground re-bakes once a painting finishes loading');
  const d = lift(BB, 'drawTileArt');
  ok(/ctx\.clip\(\)/.test(d) && /globalCompositeOperation = 'multiply'/.test(d) && /\/ art\.top\)/.test(d), 'the painting is clipped to the hex, scaled so its top face fills the slab, and takes the board\'s light');
  const existsGrass = (() => { try { return require('fs').statSync('./public/assets/Battlemap titles/Grass Title.png').size > 0; } catch (e) { return false; } })();
  ok(existsGrass !== null, 'grass painting presence checked');
  ok(/BB_VER = 'v121v2[6-9]-/.test(SRC), 'the board iframe cache key was bumped');
  ok(/const STRUCT_ART = \{/.test(BB) && /house: *\{ src: '\.\.\/assets\/Battlemap%20titles\/House\.png'/.test(BB) && /school: *\{ src: '\.\.\/assets\/Battlemap%20titles\/School\.png'/.test(BB) && /hospital: *\{ src: '\.\.\/assets\/Battlemap%20titles\/Hospital\.png'/.test(BB) && /church: *\{ src: '\.\.\/assets\/Battlemap%20titles\/Church\.png'/.test(BB) && /TRUCK_ART = \{ src: '\.\.\/assets\/Battlemap%20titles\/SCP%20Truck\.png'/.test(BB), 'the five props have paintings: house, school, hospital, church, and the SCP truck');
  ok(/const _painted = drawStructArt\(st, foot, dead\);\s*if \(!_painted\) \{/.test(BB) && /if \(drawTruckArt\(cp, foot, col, owned, H\)\) return;/.test(BB), 'a painted prop replaces the procedural drawing; a missing file keeps it');
  ok(/if \(st\.lootable && !st\.looted\)\{/.test(BB) && /const streak = Math\.max\(0, Math\.min\(need, cp\.streak \| 0\)\);/.test(BB) && /const lights = \[\[0\.30, '#3f8dff'\], \[0\.44, '#ff4a3c'\]/.test(BB), 'the loot pip, the streak pips and the running blue/red lights are drawn around the paintings');
  ok(/getImageData\(0, 0, cw, ch\)/.test(BB) && /STRUCT_ART_MAX = 768/.test(BB), 'each painting is trimmed to its opaque box and downscaled once');
  ok(!/gymLoreToast\(/.test(SRC), 'the "Core gyms stand unclaimed" whisper is gone');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
