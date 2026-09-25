/* Regenerate WAREHOUSE_PASTE_index-module.js from the module actually live in
   public/index.html, keeping the paste file's own explanatory header.

   Needed because the 12th deploy knob — `warehouse/index.html?v=` — lives
   INSIDE the module, so bumping it desynced the extract. _wh_paste_check.mjs
   caught it, which is precisely what it exists for: the handoff records this
   file silently going 180 lines stale once, still parsing and still plausible,
   missing the whole retrieval half. */
import { readFileSync, writeFileSync } from 'node:fs';

const START = '// 🚚 STORAGE WAREHOUSE — player-owned';
const END = '} catch (e) {}';
const PASTE = 'WAREHOUSE_PASTE_index-module.js';

const raw = readFileSync('public/index.html', 'utf8');
const CRLF = raw.includes('\r\n');
const lines = raw.replace(/\r\n/g, '\n').split('\n');

const titleAt = lines.findIndex((l) => l.startsWith(START));
if (titleAt < 0) throw new Error('module start not found in index.html');
const endAt = lines.findIndex((l, i) => i > titleAt && l === END);
if (endAt < 0) throw new Error('module end not found in index.html');
const live = lines.slice(titleAt - 1, endAt + 1).join('\n').trimEnd();

const pasteRaw = readFileSync(PASTE, 'utf8').replace(/\r\n/g, '\n');
const pLines = pasteRaw.split('\n');
const pTitle = pLines.findIndex((l) => l.startsWith(START));
if (pTitle < 0) throw new Error('paste file has no module');
// Everything strictly above the box-rule line that precedes the title.
const header = pLines.slice(0, pTitle - 1).join('\n');

const out = header + '\n' + live + '\n';
writeFileSync(PASTE, CRLF ? out.replace(/\n/g, '\r\n') : out, 'utf8');
console.log('regenerated ' + PASTE + ' — module is ' + live.split('\n').length + ' lines');
