/* 🧾 THREE NAMED PROOFS OVER THE FORGE SAVE PATH (v121v76).

   _forgeids_smoke.mjs proves the general contract — "a save with zero user
   input changes nothing" — across 153 real cards. It cannot prove the three
   SPECIFIC defects it found are gone, because each one needs a card that
   CARRIES the value the bug eats, and no card in the shipped pools does.

   So this file authors those three cards and runs the real cycle on each:

       renderCardEditor() → bindCardEditor() → captureEditorIntoCard()
       renderCardEditor() → bindCardEditor() → captureEditorIntoCard()

   i.e. save → REOPEN → save. Both saves are "the user touched nothing"; the
   reopen is the half that matters, because the reopen is where a value the
   editor cannot show becomes a default and the second save writes that default
   back over the card. saveCardFromInputs() then cloud-pushes it
   (index.html:152231-152245), so the rewritten definition reaches every owner.

   Each check FAILS on the build these defects were found in and PASSES after
   the fix. Run one at a time:

     node _forgesave_proof.mjs                        ← all three
     node _forgesave_proof.mjs --check=two-element-spell
     node _forgesave_proof.mjs --check=vanish-mincost
     node _forgesave_proof.mjs --check=unrenderable

   🔴 AND THE OTHER HALF OF THE PROOF: a check that cannot go red proves
   nothing. FORGE_PROOF_INDEX=<a file> serves that file as /index.html instead
   of public/index.html, so the same command can be pointed at the build the
   defects were found in and watched to fail — without swapping anything in a
   tree other agents are writing to:

     git show <before>:public/index.html > /tmp/before.html
     FORGE_PROOF_INDEX=/tmp/before.html node _forgesave_proof.mjs

   🔴 Same rule as the smoke suite: the page is served from a local http server
   and EVERY off-origin request is aborted. This never touches Supabase.
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, 'public');
const ARGV = process.argv.slice(2);
const ONLY = (ARGV.find(a => a.startsWith('--check=')) || '').split('=')[1] || '';
/* Serve a DIFFERENT index.html as /index.html — see the header. Everything else
   (assets, cardsets, /src modules) still comes from public/, which is what makes
   pointing this at a pre-change index.html a one-liner. */
const ALT_INDEX = process.env.FORGE_PROOF_INDEX || '';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; return !!c; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.glb': 'model/gltf-binary' };
async function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = (ALT_INDEX && (p === '/index.html')) ? path.resolve(ALT_INDEX) : path.join(ROOT, p);
    if (ALT_INDEX && p === '/index.html') {
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return fs.createReadStream(f).pipe(res);
    }
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  /* Other agents run harnesses in this tree at the same time — take the first
     free port instead of dying on EADDRINUSE. */
  for (let port = 8860; port < 8900; port++) {
    const got = await new Promise((r) => { server.once('error', () => r(0)); server.listen(port, '127.0.0.1', () => r(port)); });
    if (got) return { server, port: got };
  }
  throw new Error('no free port in 8860-8899');
}

/* ── the cards, each carrying exactly the value its defect eats ───────────── */

/* DEFECT A — a spell authored with TWO elements. index.html:150734 read
   ed-element2 through a presence probe and wrote card.elements = [primary]
   when the spell editor did not render the control. */
const CARD_TWO_ELEMENT_SPELL = {
  id: 'proof_two_element_spell', name: 'Two-Element Spell', type: 'spell', icon: '✨',
  cost: 3, rarity: 'rare', desc: 'authored with fire AND water',
  elements: ['fire', 'water'], factions: [],
  effect: { type: 'damage', amount: 6, target: 'enemy' },
};

/* DEFECT B — a vanishUnit gate with a real minimum cost. index.html:151705
   read ed-playreq-mincost, an id the editor never rendered, with the literal
   fallback 0. */
const CARD_VANISH_MINCOST = {
  id: 'proof_vanish_mincost', name: 'Vanish Gate', type: 'spell', icon: '🌌',
  cost: 4, rarity: 'epic', desc: 'vanish a unit costing 5 or more',
  elements: ['void'], factions: [],
  effect: { type: 'damage', amount: 4, target: 'enemy' },
  playRequirement: {
    type: 'vanishUnit', allowNormalPlay: false, discountedCost: -1,
    nameIncludes: '', element: 'any', faction: 'any', minCost: 5,
  },
};

/* DEFECT C, family 1 of 2 — a VOID-ONLY in-pile ability whose Card Filter is
   set. renderCardEditor built that filter block from card.inGrave only, so a
   void-only card showed a blank filter and the next save wrote 'any' over it.
   Six of the 74 unrenderable paths, on 153/153 cards. */
const CARD_INVOID_FILTER = {
  id: 'proof_invoid_filter', name: 'Void Haunt', type: 'spell', icon: '🌌',
  cost: 2, rarity: 'rare', desc: 'while vanished, hits fire cards',
  elements: ['shadow'], factions: [],
  effect: { type: 'damage', amount: 3, target: 'enemy' },
  inVoid: {
    trigger: 'turnStart', effect: 'damageEnemy', chance: 100, cooldown: 0, amount: 2,
    summonCard: null, summonZone: 'deck', searchDeckType: 'any',
    filter: { element: 'fire', cardType: 'unit', faction: 'any', costMode: 'exact' },
  },
};

/* DEFECT C, family 2 of 2 — a HAND-AUTHORED onResurrect that is deliberately
   NOT a copy of onPlay. The Auto-copy checkbox rendered CHECKED whenever
   onResurrect merely existed, so the next save replaced the authored block
   with a copy of onPlay. 68 of the 74 unrenderable paths. */
const CARD_ONRESURRECT = {
  id: 'proof_onresurrect', name: 'Risen Healer', type: 'unit', icon: '🧟',
  cost: 5, rarity: 'epic', desc: 'hurts on play, heals when it rises',
  elements: ['shadow'], factions: [], stats: { hp: 20, atk: 10, def: 8, mag: 8, res: 8, spd: 1 },
  onPlay: { type: 'aoeDamage', amount: 7, radius: 1, chance: 100 },
  onResurrect: { type: 'heal', amount: 9, radius: 2, chance: 100 },
  inGrave: {
    trigger: 'turnStart', effect: 'selfDeploy', chance: 100, cooldown: 0, amount: 0,
    summonCard: null, summonZone: 'deck', searchDeckType: 'any',
  },
};

/* ── the cycle, in the page: save → REOPEN → save, touching nothing ──────── */
const CYCLE = (card) => {
  const host = document.createElement('div'); host.id = '__forge_proof'; document.body.appendChild(host);
  const out = [];
  let cur = JSON.parse(JSON.stringify(card));
  for (let i = 0; i < 2; i++) {
    Forge.customCards = [cur]; App.editingCardId = cur.id; App._traitPoolModal = false;
    host.innerHTML = renderCardEditor();
    bindCardEditor();
    captureEditorIntoCard(cur);
    delete cur._editedAt;                       // a deliberate stamp, not card content
    out.push(JSON.parse(JSON.stringify(cur)));
    cur = JSON.parse(JSON.stringify(cur));
  }
  host.remove();
  return { afterSave: out[0], afterReopenSave: out[1] };
};

/* ── the three checks ─────────────────────────────────────────────────────── */
const CHECKS = [
  {
    name: 'two-element-spell',
    what: 'a spell authored with elements ["fire","water"] survives save → reopen → save with BOTH elements',
    run: async (page) => {
      const r = await page.evaluate(CYCLE, CARD_TWO_ELEMENT_SPELL);
      const a = (r.afterSave.elements || []).join('/'), b = (r.afterReopenSave.elements || []).join('/');
      ok(a === 'fire/water', 'after the first save the spell still has both elements — got ' + JSON.stringify(r.afterSave.elements), a);
      ok(b === 'fire/water', 'after reopen + save it still has both elements — got ' + JSON.stringify(r.afterReopenSave.elements), b);
    },
  },
  {
    name: 'vanish-mincost',
    what: 'playRequirement.type="vanishUnit" with minCost 5 survives save → reopen → save as 5',
    run: async (page) => {
      const r = await page.evaluate(CYCLE, CARD_VANISH_MINCOST);
      const a = (r.afterSave.playRequirement || {}).minCost, b = (r.afterReopenSave.playRequirement || {}).minCost;
      ok((r.afterSave.playRequirement || {}).type === 'vanishUnit', 'the requirement is still a vanishUnit gate after saving', String((r.afterSave.playRequirement || {}).type));
      ok(a === 5, 'after the first save minCost is still 5 — got ' + JSON.stringify(a), String(a));
      ok(b === 5, 'after reopen + save minCost is still 5 — got ' + JSON.stringify(b), String(b));
    },
  },
  {
    name: 'unrenderable',
    what: 'two cards carrying unrenderable-but-written paths (.inVoid.filter.element, .onResurrect.*) survive save → reopen → save',
    run: async (page) => {
      const v = await page.evaluate(CYCLE, CARD_INVOID_FILTER);
      const f1 = ((v.afterSave.inVoid || {}).filter || {}), f2 = ((v.afterReopenSave.inVoid || {}).filter || {});
      ok(f1.element === 'fire' && f1.cardType === 'unit',
        'after the first save the void ability still filters element=fire cardType=unit — got ' + JSON.stringify(f1), JSON.stringify(f1));
      ok(f2.element === 'fire' && f2.cardType === 'unit',
        'after reopen + save it still filters element=fire cardType=unit — got ' + JSON.stringify(f2), JSON.stringify(f2));

      const g = await page.evaluate(CYCLE, CARD_ONRESURRECT);
      const r1 = g.afterSave.onResurrect || {}, r2 = g.afterReopenSave.onResurrect || {};
      ok(r1.type === 'heal' && r1.amount === 9,
        'after the first save the hand-authored onResurrect is still heal/9 — got ' + JSON.stringify(r1), JSON.stringify(r1));
      ok(r2.type === 'heal' && r2.amount === 9,
        'after reopen + save it is still heal/9 — got ' + JSON.stringify(r2), JSON.stringify(r2));
      ok((g.afterReopenSave.onPlay || {}).type === 'aoeDamage' && (g.afterReopenSave.onPlay || {}).amount === 7,
        'and the onPlay block it must not have been overwritten by is still aoeDamage/7', JSON.stringify(g.afterReopenSave.onPlay));
    },
  },
];

/* ── runner ───────────────────────────────────────────────────────────────── */
const chosen = ONLY ? CHECKS.filter(c => c.name === ONLY) : CHECKS;
if (!chosen.length) { console.log('\n  no such check: ' + ONLY + '   (' + CHECKS.map(c => c.name).join(' · ') + ')'); process.exit(2); }

const { server, port } = await serve();
let browser;
try { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
catch (e) {
  console.log('\n  cannot launch chromium: ' + (e && e.message ? e.message.split('\n')[0] : e));
  console.log('  this suite drives the REAL editor in a real DOM. Install the browser with:  npx playwright install chromium');
  server.close(); process.exit(1);
}
const page = await browser.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e).slice(0, 200)));
await page.route('**', r => (r.request().url().startsWith('http://127.0.0.1:' + port) ? r.continue() : r.abort()));
await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
if (ALT_INDEX) console.log('  ⚠ FORGE_PROOF_INDEX — serving ' + path.resolve(ALT_INDEX) + ' as /index.html');

for (const c of chosen) {
  console.log('\n=== ' + c.name + ' — ' + c.what + ' ===');
  try { await c.run(page); } catch (e) { ok(false, c.name + ' threw', String(e && e.message || e)); }
}
ok(pageErrs.length === 0, 'the page threw nothing while the editor was driven', pageErrs.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
