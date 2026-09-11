/* 🚪 THE BUNKER: rooms are for show, two big doors on the left.

   Asked for: "Remove all of these modals from the bunker pictures when they are
   clicked on. I just want them to be for show. Remove the buttons down here but
   Assign change that to Camp and Ethos Heights. Make them big buttons next to
   the bunker images on the left side so players can see the buttons and know
   to click them and give a tool tip above them to tell players what they do."

   Pins the page text (the JSX is compiled in the browser; tmp/_drive_bunker.mjs
   is the headless drive that measured it: 9 rooms, no panel on click, cursor
   default, no action row, two 235×99 doors at x=12 beside a bunker at x=319,
   posts nav:campOps and ethos, tooltip opacity 1 above the button).

   Run: node _bunkerdoors_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const APP = readFileSync('./public/base/app.jsx', 'utf8').replace(/\r\n/g, '\n');
const HUD = readFileSync('./public/base/hud.jsx', 'utf8').replace(/\r\n/g, '\n');
const CSS = readFileSync('./public/base/styles.css', 'utf8').replace(/\r\n/g, '\n');
const HTML = readFileSync('./public/base/index.html', 'utf8');
const SRC = readFileSync('./public/index.html', 'utf8');

/* rooms are for show */
ok(/<Room\s+key=\{r\.id\}\s+room=\{r\}\s+active=\{false\}\s+onClick=\{undefined\}\s*\/>/.test(APP), 'a room is rendered with no click and never active');
ok(!/onClick=\{\(\) => setActiveId\(r\.id\)\}/.test(APP), 'the old room click is gone');
ok(/<Panel room=\{null\}/.test(APP), 'the room panel is handed nothing');
ok(!/onClick=\{\(\) => onSelect\(window\.ROOMS\[i\]\.id\)\}/.test(HUD), 'the minimap cells no longer open rooms');
ok(!/"\\nClick to open this room"/.test(HUD), '…and no longer say "Click to open this room"');
ok(/\.room \{\s*position: relative;\s*background: var\(--hull\);\s*border: 1px solid var\(--line\);\s*overflow: hidden;\s*cursor: default;/.test(CSS), 'a room does not invite a click (cursor default)');

/* the action row is gone */
ok(!/<div className="actions">/.test(HUD), 'the bottom action row is gone');
for (const lbl of ['Build', 'Hire', 'Bunks', 'Assign']) ok(!new RegExp('<span className="act-lbl">' + lbl + '</span>').test(HUD), 'no "' + lbl + '" button remains');
ok(/<div className="tick">/.test(HUD) && /className="minimap"/.test(HUD), 'the clock controls and the minimap stay');

/* two big doors on the left, tooltip above */
const D = HUD.slice(HUD.indexOf('<div className="doors">'), HUD.indexOf('{BAG && BAG.has && ('));
ok(D.length > 200 && HUD.indexOf('<div className="doors">') < HUD.indexOf('className="left-section bag"'), 'the doors sit at the top of the left column, before the bag and the alerts');
ok(/<span className="door-lbl">Camp<\/span>/.test(D) && /onClick=\{door\("nav:campOps"\)\}/.test(D), 'Camp opens Camp Ops (the old Assign seam)');
ok(/<span className="door-lbl">Ethos Heights<\/span>/.test(D) && /onClick=\{door\("ethos"\)\}/.test(D), 'Ethos Heights opens the district map (the old seam)');
ok((D.match(/data-tip="/g) || []).length === 2 && /data-tip="Camp Ops — station units/.test(D) && /data-tip="Ethos Heights — the district map/.test(D), 'each door carries a tooltip that says what it does');
ok(/\.door::after \{\s*content: attr\(data-tip\);\s*position: absolute; left: 50%; bottom: calc\(100% \+ 8px\);/.test(CSS), 'the tooltip is positioned ABOVE the button');
ok(/\.door:hover::after, \.door:focus-visible::after[^\n]*\{ opacity: 1;/.test(CSS), '…and shows on hover and keyboard focus');
ok(/\.doors \{[\s\S]*?padding: 78px 12px 6px;/.test(CSS), 'the column reserves headroom so the first door\'s tip fits above it');
ok(/\.door \{[\s\S]*?width: 100%;\s*padding: 16px 12px 14px;/.test(CSS) && /\.door-ico \{ font-size: 30px;/.test(CSS), 'the doors are big — full column width, 30px icon');
ok(!/\.doors \.door:first-child::after \{ bottom: auto;/.test(CSS), 'no door drops its tip below');
ok(/e\.key === "a" \|\| e\.key === "A"/.test(APP) && /action: "nav:campOps"/.test(APP), 'hotkey A still reaches Camp Ops');

/* the page busts its own cache and the six knobs moved */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
const bv = (HTML.match(/hud\.jsx\?v=(v121v\d+)/) || [])[1];
ok(!!bv && HTML.includes('styles.css?v=' + bv) && HTML.includes('app.jsx?v=' + bv) && parseInt(bv.replace('v121v', ''), 10) >= 95, 'base/index.html loads the three changed files at one build string, v121v95 or later (the page busts its own cache when IT changes)', bv);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
