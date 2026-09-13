#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   HANDBOOK SYNC — regenerates the two GENERATED files under public/handbook/.

     gamedata.json   the element matchup wheel, factions, rarities, statuses
     art.json        the artwork index the editor's image picker browses

   WHY THIS EXISTS: the handbook quotes 21 elements, 42 factions and 60 status
   effects. Hand-copying those into prose guarantees they drift the first time
   somebody adds an element — and a rules book that is quietly wrong is worse
   than no rules book. So the tables are read straight out of index.html's own
   constants and the book only holds the prose around them.

   ⚠ It reads index.html by locating the `const X = ` declarations and
   evaluating just those chunks in isolation (rewritten to `var` so the values
   escape the Function scope). If one of those declarations is renamed or
   reformatted, this throws loudly rather than emitting a half-empty file —
   that is deliberate. A silent partial write is how the book would go stale
   without anyone noticing.

   Run:  node tools/handbook-sync.mjs
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX  = path.join(ROOT, 'public', 'index.html');
const OUTDIR = path.join(ROOT, 'public', 'handbook');
const ASSETS = path.join(ROOT, 'public', 'assets');

/* ── 1. gamedata.json ─────────────────────────────────────────────────── */

const src = fs.readFileSync(INDEX, 'utf8');

function grab(startRe, endMarker, label) {
  const i = src.search(startRe);
  if (i < 0) throw new Error(`handbook-sync: could not find ${label} in public/index.html — was it renamed?`);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error(`handbook-sync: found ${label} but not its closing "${endMarker}"`);
  return src.slice(i, j + endMarker.length);
}

const code = [
  grab(/^const ELEMENTS = \[/m,       '];',   'ELEMENTS'),
  grab(/^const ELEMENT_DATA = \{/m,   '\n};', 'ELEMENT_DATA'),
  grab(/^const STRONG_VS = \{/m,      '\n};', 'STRONG_VS'),
  grab(/^const RARITIES = \[/m,       '\n];', 'RARITIES'),
  grab(/^const FACTIONS = \[/m,       '\n];', 'FACTIONS'),
  grab(/^const STATUS_EFFECTS = \{/m, '\n};', 'STATUS_EFFECTS'),
].join('\n').replace(/^const /gm, 'var ');   // `const` in a Function body does not escape it

const { ELEMENTS, ELEMENT_DATA, STRONG_VS, RARITIES, FACTIONS, STATUS_EFFECTS } =
  new Function(code + '\nreturn {ELEMENTS,ELEMENT_DATA,STRONG_VS,RARITIES,FACTIONS,STATUS_EFFECTS};')();

/* Derive each element's defensive side from STRONG_VS, exactly the way the
   game's own MATCHUPS block does — including the sworn-opposite case, where
   both directions are 2x and NEITHER resists. Listing a sworn opposite under
   "weak to" would tell the reader to avoid a matchup that is actually even. */
const elements = {};
for (const e of ELEMENTS) {
  const d = ELEMENT_DATA[e];
  const mutual = ELEMENTS.filter(o => STRONG_VS[o].includes(e) && STRONG_VS[e].includes(o));
  elements[e] = {
    name: d.name,
    color: d.color,
    icon: d.icon,
    img: d.img ? `assets/artwork/gameicons/Elements/${d.img}` : null,
    strongVs: STRONG_VS[e].slice(),
    weakTo: ELEMENTS.filter(o => STRONG_VS[o].includes(e) && !STRONG_VS[e].includes(o)),
    mutual,
  };
}

const gamedata = {
  generated: new Date().toISOString().slice(0, 10),
  order: ELEMENTS,
  elements,
  rarities: RARITIES.map(r => ({ id: r.id, name: r.name, color: r.color })),
  factions: FACTIONS.map(f => ({
    id: f.id, name: f.name, icon: f.icon, color: f.color, desc: f.desc,
    img: f.img ? `assets/artwork/gameicons/factions/${f.img}` : null,
  })),
  // Statuses without a `desc` are internal bookkeeping entries (the Ambush
  // Guard radii, source-tracking flags) — nothing to tell a player about.
  statuses: Object.keys(STATUS_EFFECTS)
    .map(k => ({ id: k, name: STATUS_EFFECTS[k].name, icon: STATUS_EFFECTS[k].icon, desc: STATUS_EFFECTS[k].desc }))
    .filter(s => s.name && s.desc),
};

fs.writeFileSync(path.join(OUTDIR, 'gamedata.json'), JSON.stringify(gamedata));

/* ── 2. art.json ──────────────────────────────────────────────────────── */

// Only the folders that hold card/board/character art a handbook would use.
// The whole of public/assets is far larger (audio, 3d models, sprite sheets)
// and would make the picker useless.
const ART_DIRS = [
  'artwork', 'Locations', 'Heros', 'Characters', 'Frames', 'Gameboard',
  'Spells', 'Trap', 'Units', 'Items', 'Weather', 'Boosterandpacks',
];
const OK = /\.(png|webp|jpe?g)$/i;

function walk(dir, depth, out) {
  if (depth > 2 || !fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, depth + 1, out);
    else if (OK.test(ent.name)) out.push(full);
  }
  return out;
}

const images = ART_DIRS
  .flatMap(d => walk(path.join(ASSETS, d), 0, []))
  .map(full => {
    const rel = 'assets/' + path.relative(ASSETS, full).split(path.sep).join('/');
    return { p: rel, n: path.basename(rel).replace(OK, ''), g: rel.split('/')[1] };
  })
  .sort((a, b) => a.p.localeCompare(b.p));

fs.writeFileSync(path.join(OUTDIR, 'art.json'),
  JSON.stringify({ generated: gamedata.generated, count: images.length, images }));

/* ── 3. Report ────────────────────────────────────────────────────────── */

console.log('✓ handbook sync');
console.log(`  gamedata.json  ${ELEMENTS.length} elements · ${gamedata.factions.length} factions · ${gamedata.rarities.length} rarities · ${gamedata.statuses.length} statuses`);
console.log(`  art.json       ${images.length} images across ${new Set(images.map(i => i.g)).size} folders`);

// A missing art file in the book is a broken image on a published page, so
// check every path the book actually references and say so rather than
// shipping a silent 404.
const bookPath = path.join(OUTDIR, 'handbook.json');
if (fs.existsSync(bookPath)) {
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  const refs = [book.cover?.image, book.cover?.fallback];
  for (const c of book.chapters || []) {
    refs.push(c.art);
    for (const s of c.sections || []) refs.push(s.img);
  }
  const missing = refs.filter(Boolean).filter(r => !/^https?:/.test(r) && !fs.existsSync(path.join(ROOT, 'public', r)));
  if (missing.length) {
    console.log(`  ⚠ ${missing.length} referenced image(s) not on disk:`);
    for (const m of missing) console.log(`      ${m}`);
  } else {
    console.log('  ✓ every image the book references exists on disk');
  }
}
