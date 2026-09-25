/* 🧩 v121v124 — Bruce Prints (the game's own code, drawn) are a folder in the
   engine's Content Browser, always there; and the Player Closet is locked to
   players until it is stocked, while the Closet Studio stays admin-only.
   Run: node _bruceprints_smoke.mjs */
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const ASSETS = readFileSync('./public/src/mapforge/mapforge.assets.js', 'utf8').replace(/\r\n/g, '\n');
const ED = readFileSync('./public/src/mapforge/mapforge.editor.js', 'utf8').replace(/\r\n/g, '\n');
const GEN = readFileSync('./tools/bruceprints/build.mjs', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the prints exist, and they are generated from the real source ── */
ok(existsSync('./Content/BrucePrints/manifest.json') && existsSync('./public/bruce-prints/manifest.json'), 'the prints are written twice: the repo folder to read, and public/ for the game to serve');
{
  const man = JSON.parse(readFileSync('./public/bruce-prints/manifest.json', 'utf8'));
  ok(man.functions > 5000 && man.sources > 100 && man.systems.length >= 10,
    'the manifest was built by parsing the shipped source', man.functions + ' functions from ' + man.sources + ' sources, ' + man.systems.length + ' systems');
  const one = man.systems.find((s) => s.id === 'Economy') || man.systems[0];
  const g = JSON.parse(readFileSync('./public/bruce-prints/' + one.id + '/' + one.prints[0].name + '.bp.json', 'utf8'));
  ok(g.nodes.length > 0 && g.nodes.every((nd) => nd.file && typeof nd.line === 'number'),
    'every node carries the real file and line it was read from — a print can always be checked against the code', g.nodes.length + ' nodes in ' + one.id);
  ok(g.nodes.some((nd) => nd.kind === 'data') && g.nodes.some((nd) => nd.kind === 'event'),
    '…and is coloured by what the function does (an entry point, a writer of saved state)');
  ok(readdirSync('./public/bruce-prints').filter((f) => statSync('./public/bruce-prints/' + f).isDirectory()).length >= 10, 'one folder per system, the way a Content Browser holds them');
}
ok(/const OUT_WEB = join\(ROOT, 'public', 'bruce-prints'\);/.test(GEN) && /copyTree\(OUT, OUT_WEB\);/.test(GEN), 'the generator keeps the served copy in step — one build, both places');

/* ── 2. the Content Browser shows them ── */
ok(/print:   \{ label: 'Bruce Print', icon: '🧩', source: 'code' \},/.test(ASSETS), 'the asset index knows what a print is');
ok(/\(src\.prints \|\| \[\]\)\.forEach\(p => push\('print', p\.system \+ '\/' \+ p\.print/.test(ASSETS) && /'Bruce Prints',/.test(ASSETS), '…and files them under Bruce Prints');
ok(/'Bruce Prints': \['print'\]/.test(ED), 'the folder is one of the browser\'s categories, beside Models and Prefabs');
ok(/fetch\('\/bruce-prints\/manifest\.json\?v=' \+ \(window\.BUILD_VERSION \|\| 'dev'\)\)/.test(ED), 'the editor reads the manifest from the deployed copy');
ok(/\.catch\(\(\) => \{ printList = \[\]; printsLoading = false; \}\);/.test(ED), '…and a miss simply leaves the folder out — the engine never depends on it');
ok(/else if \(e\.kind === 'print'\) \{ try \{ window\.open\(e\.url, '_blank', 'noopener'\); \} catch \(x\) \{\} \}/.test(ED), 'picking a print opens the graph instead of trying to place it in the map');
ok(/prints: printList \|\| \[\],/.test(ED), 'the index is rebuilt with the prints once they land');
ok(/if \(h\.indexOf\('\/'\) > 0\) \{ const \[sy, pr\] = h\.split\('\/'\);/.test(readFileSync('./Content/BrucePrints/index.html', 'utf8')), 'the link opens straight onto the graph it names');

/* ── 3. the closet doors ── */
ok(/const adminTiles = !_isAdmin \? \[\] : \[/.test(SRC), 'the Closet Studio tile sits in the admin-only list — a player has never been shown it');
ok(/\{ id: 'btn-closet-studio', icon: '🧵', name: 'Closet Studio'/.test(SRC), '…and that is where it still is');
ok(/\? \(_isAdmin\n\s*\? \{ id: 'btn-closet', icon: '<span style="font-size:3rem/.test(SRC), 'the Player Closet tile is the working one only for an admin');
ok(/: \{ id: 'btn-closet', icon: '🔒', name: 'Player Closet', sub: 'Opens when the wardrobe is stocked'/.test(SRC) && /badge: 'Coming soon', locked: true,/.test(SRC),
  '…and a player gets the game\'s own LOCKED tile, greyed with a padlock');
ok(/showToast\('🔒 The Player Closet is not open yet — the wardrobe is still being built\.', 3200\);/.test(SRC), '…which says why when pressed, rather than opening an empty room');

/* ── 4. the publish regression that took auto-publish down ── */
ok(!/\n      cardSets: \(Forge\.cardSets/.test(SRC), 'card_catalog is not asked for a column it does not have (this failed EVERY publish: "Could not find the \'cardSets\' column")');
ok(/__card_sets__:         \(Forge\.cardSets \|\| \[\]\)/.test(SRC) && /if \(Array\.isArray\(rawMoves\.__card_sets__\)\) Catalog\.cardSets = rawMoves\.__card_sets__;/.test(SRC),
  'the sets ride inside the moves blob, where obtainability and the structure decks already travel');
ok(/delete cleanMoves\.__card_sets__;/.test(SRC), '…and are stripped back out of the moves the game actually plays with');

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 124, 'BUILD_VERSION is v121v124 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
