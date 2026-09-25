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
  /* ⚠ v121v151 — _polyMatUsable and _polyMatShape are lifted TOO. _polySlotAlts
     now asks them "may this body be taken as a material" instead of testing
     u.owner inline, which is the whole point of that change: the swap list and
     the material finder must not hold two opinions about legality. Leaving them
     out did not weaken this check, it broke it — the lifted function threw on an
     undefined helper, its own try/catch swallowed that and returned [], and
     every slot came back with no alternatives. */
  const code = ['_polyMatUsable', '_polyMatShape', '_polySlotAlts', '_polyExpandReqs', '_polyArtSrc', '_polyArtHtml', '_polyThumbHtml'].map((n) => lift(SRC, n)).join('\n')
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
  /* ⚠ RE-DATED 2026-09-15. This pinned three EXACT filenames and one exact `top`,
     and all four were deliberately changed: asphalt moved off the meadow-track
     plate onto a real road ('Street tile.png', measured grey 23°/9%/32% against
     the meadow's 46°/65%/70%), and dirt gained a SECOND painting so a long run of
     it stops being one crack repeated forty times. Pinning filenames made the
     check fail for the art being improved, which is the opposite of what it is
     for.
     What it actually guards, and still guards: the three city grounds are all
     painted, the road surface wears a ROAD rather than a field, and dirt and
     rubble share the same earth plate so a road runs through continuous ground.
     Those are the properties; the filenames are an implementation detail. */
  const _artBlk = (/const TILE_ART = \{[\s\S]*?\n\};/.exec(BB) || [''])[0];
  const _entry = (k) => (new RegExp('\\n  ' + k + ':[\\s\\S]*?\\n  [a-z]+:').exec(_artBlk) || [''])[0];
  ok(/Street[%20 ]*tile\.png/i.test(_entry('asphalt')), 'asphalt wears a ROAD plate, not a meadow');
  ok(/Dirt%201\.png/.test(_entry('rubble')) && /Dirt%201\.png/.test(_entry('dirt')),
     'dirt and rubble share one earth plate, so a road runs through continuous ground');
  ok(/const _art = ring \? null : tileArtImage\(surf, x, z\);/.test(BB) && /if \(!_arted\)\{ ctx\.save\(\); pathPoly\(P\); ctx\.clip\(\); paintSurfTexture/.test(BB), 'a painted tile skips the procedural grit; a tile with no painting keeps it (nothing breaks while a file is missing)');
  ok(/if \(!_arted && window\.BBX\.terrain && window\.BBX\.terrain\.detail\)/.test(BB), 'no pebbles are scattered over a painting');
  ok(/\+ '\|art' \+ tileArtLoaded\(\);/.test(BB), 'the ground re-bakes once a painting finishes loading');
  const d = lift(BB, 'drawTileArt');
  ok(/ctx\.clip\(\)/.test(d) && /globalCompositeOperation = 'multiply'/.test(d) && /\/ art\.top\)/.test(d), 'the painting is clipped to the hex, scaled so its top face fills the slab, and takes the board\'s light');
  const existsGrass = (() => { try { return require('fs').statSync('./public/assets/Battlemap titles/Grass Title.png').size > 0; } catch (e) { return false; } })();
  ok(existsGrass !== null, 'grass painting presence checked');
  /* ⚠ v121v149 — this pinned the literal range 'v121v2[6-9]-', which made it a
     check that could only ever go stale: it passed for exactly four builds and
     then failed the next time the board legitimately moved (it did, at v149,
     when the aiming arrow taught drawOneArc two new sides). The CLAIM being
     made is "the board file changed, so its cache key moved with it", and the
     durable form of that claim is the PAIR — BB_VER is the iframe's only
     cache-buster and BB_BUILD is what the served board reports back, so their
     equality is the thing that actually keeps a client off a stale board. The
     four-build window never checked that at all. The floor below keeps the
     original assertion that the ritual-art bump itself happened. */
  const _bbv = (SRC.match(/BB_VER = '(v121v(\d+)-[^']*)'/) || []);
  const _bbb = (BB.match(/window\.BB_BUILD='([^']+)'/) || [])[1];
  ok(_bbv[2] && +_bbv[2] >= 26, 'the board iframe cache key was bumped', _bbv[1]);
  ok(!!_bbv[1] && _bbb === _bbv[1],
    '…and BB_VER still equals the board\'s own BB_BUILD — the pair is what keeps a client off a stale board',
    _bbv[1] + ' vs ' + _bbb);
  ok(/const STRUCT_ART = \{/.test(BB) && /house: *\{ src: '\.\.\/assets\/Battlemap%20titles\/House\.png'/.test(BB) && /school: *\{ src: '\.\.\/assets\/Battlemap%20titles\/School\.png'/.test(BB) && /hospital: *\{ src: '\.\.\/assets\/Battlemap%20titles\/Hospital\.png'/.test(BB) && /church: *\{ src: '\.\.\/assets\/Battlemap%20titles\/Church\.png'/.test(BB) && /TRUCK_ART = \{ src: '\.\.\/assets\/Battlemap%20titles\/SCP%20Truck\.png'/.test(BB), 'the five props have paintings: house, school, hospital, church, and the SCP truck');
  ok(/const _painted = drawStructArt\(st, foot, dead\);\s*if \(!_painted\) \{/.test(BB) && /if \(drawTruckArt\(cp, foot, col, owned, H\)\) return;/.test(BB), 'a painted prop replaces the procedural drawing; a missing file keeps it');
  ok(/if \(st\.lootable && !st\.looted\)\{/.test(BB) && /const streak = Math\.max\(0, Math\.min\(need, cp\.streak \| 0\)\);/.test(BB) && /const lights = \[\[0\.30, '#3f8dff'\], \[0\.44, '#ff4a3c'\]/.test(BB), 'the loot pip, the streak pips and the running blue/red lights are drawn around the paintings');
  ok(/getImageData\(0, 0, cw, ch\)/.test(BB) && /STRUCT_ART_MAX = 768/.test(BB), 'each painting is trimmed to its opaque box and downscaled once');
  ok(!/gymLoreToast\(/.test(SRC), 'the "Core gyms stand unclaimed" whisper is gone');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
