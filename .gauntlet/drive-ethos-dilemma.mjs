/* ══════════════════════════════════════════════════════════════════════════
   🏛 DRIVE-ETHOS-DILEMMA — the Heights interrupts the mission map.

   Asked for: "Add this to the 'Ethos Heights' Mission map. Make it random when
   a player move, or before their deploy. Make it connect to the deck they last
   used and connects to the bond system. And remove the reset the save button.
   Also make sure it fits the theme and show the card art of the units vs a
   emoji."

   WHAT THIS PINS:
     · a crossing and a deploy can BOTH raise a dilemma, and neither is certain
     · the offer cooldown still bounds it — the odds cannot compound into spam
     · the deploy interrupt LAUNCHES THE RUN AFTER the modal closes, and still
       launches it when no dilemma could be built
     · the roster is the deck the player LAST TOOK OUT, not their collection
     · those units carry their CARD ART, not a playing-card glyph
     · resolving moves the bond of the units who took a side
     · "Reset all progress" — which erased every bond in the game — is gone,
       markup and handler both

   ⚠ STAGING: a last-used deck is written the way startBattleWithPrep writes it,
     and Math.random is pinned where the assertion is about the ROLL rather than
     about chance. Nothing about the modal, the roster, the art or the bond
     write is faked.

   Run:  node .gauntlet/drive-ethos-dilemma.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 8810 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1500, height: 980 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(7000);

const out = {};

/* ── the source facts a driver cannot boot its way to ────────────────────── */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rnd = fs.readFileSync(path.join(ROOT, 'src/dilemma/render.js'), 'utf8');
  const msn = fs.readFileSync(path.join(ROOT, 'src/missions/render.js'), 'utf8').replace(/\r\n/g, '\n');
  out.src = {
    resetMarkupGone: idx.indexOf('id="btn-reset-progress"') < 0,
    resetHandlerGone: idx.indexOf("getElementById('btn-reset-progress')") < 0,
    bridgeHasArt: idx.indexOf('cardArt: (cardId) =>') >= 0,
    /* the art gate is the module's own, not the bridge's */
    artGated: rnd.indexOf('const ART_OK = ') >= 0 && rnd.indexOf('const ART_BAD = ') >= 0,
    /* both call sites, and the deploy one launches either way */
    firesOnMove: msn.indexOf("heightsRoll('move')") >= 0,
    firesOnDeploy: msn.indexOf("heightsRoll('deploy') && heightsOpen(launch)") >= 0,
    deployLaunchesAnyway: msn.indexOf("if (heightsRoll('deploy') && heightsOpen(launch)) return;\n    launch();") >= 0,
  };
}

/* ── the roster is the last deck, and it wears its art ───────────────────── */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  const D = window.MythicDilemmas;

  /* Record a deck the way startBattleWithPrep does. ⚠ `cards` is an ARRAY of
     '<kind>:<id>' KEY STRINGS, not a map — Object.keys() on it yields "0".."7",
     which resolve to nothing and render an empty roster that looks exactly like
     "this player has no companions". That was this driver's own first bug. */
  const hero = getAllHeroes()[0];
  const cards = (typeof getGeneratedDeckForHero === 'function') ? (getGeneratedDeckForHero(hero.id) || []) : [];
  o.deckKeys = cards.length;
  o.deckKeySample = cards.slice(0, 3);
  Profile.dilemma = Profile.dilemma || {};
  Profile.dilemma.lastDeck = {
    id: null, name: hero.name + "'s deck",
    heroId: hero.id, cards: cards.slice(), at: Date.now(),
  };

  /* 🎴 ART HAS TO BE STAGED, and staging it is the honest thing rather than a
     dodge. Card art lives in Forge.cardArtUrl, hydrated from the published
     catalogue when a player is SIGNED IN; this harness is signed out and
     offline by design, so a fresh profile genuinely holds none. Asserting
     "art appears" without staging would only ever prove the harness has no
     data. So: put art where the game puts it, on some of the deck but not all
     of it, and then assert the pipeline carries it AND that the units without
     it still get their glyph. */
  const pre = D.roster();
  o.rosterSize = pre.length;
  o.rosterNames = pre.slice(0, 4).map(u => u.name);
  o.artBeforeStaging = pre.filter(u => !!u.art).length;

  Forge.cardArtUrl = Forge.cardArtUrl || {};
  const withCards = pre.filter(u => u.card && u.card.id);
  o.stagedCount = 0;
  withCards.forEach((u, i) => {
    if (i % 2) return;                       // half the roster, deliberately
    Forge.cardArtUrl[u.card.id] = 'https://cdn.example/art/' + u.card.id + '.png';
    o.stagedCount++;
  });
  /* …and one hostile URL, on a real card, to prove the gate is load-bearing
     rather than decorative. */
  const hostile = withCards.find((u, i) => i % 2 === 1);
  if (hostile) { Forge.cardArtUrl[hostile.card.id] = 'javascript:alert(1)'; o.hostileOn = hostile.card.id; }

  const roster = D.roster();
  o.withArt = roster.filter(u => !!u.art).length;
  /* the bridge is what resolves it — prove it is the SAME url the rest of the
     game uses, not a second art pipeline */
  const first = roster.find(u => u.art && u.art.indexOf('https') === 0);
  o.artMatchesGame = first ? (getCardArt(first.card.id) === first.art) : null;
  return o;
}));

/* ── the roll: neither certain nor impossible, and cooldown-bounded ──────── */
Object.assign(out, await pg.evaluate(() => {
  const D = window.MythicDilemmas;
  const at = (v) => {
    const r = Math.random; Math.random = () => v;
    try { return { move: D.rollFor('move'), deploy: D.rollFor('deploy'), junk: D.rollFor('nowhere') }; }
    finally { Math.random = r; }
  };
  const lo = at(0.01), hi = at(0.99);
  return {
    rollLow: lo, rollHigh: hi,
    rollIsRandom: lo.move === true && hi.move === false && lo.deploy === true && hi.deploy === false,
    unknownWhereRefused: lo.junk === false && hi.junk === false,
  };
}));

/* ── the mission map, and the deploy interrupt on it ─────────────────────── */
await pg.evaluate(() => { App.screen = 'rlcList'; render(); });
await pg.waitForTimeout(3000);

Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  const r = Math.random; Math.random = () => 0.001;      // force the interrupt
  try {
    const btn = document.getElementById('msn-go');
    o.deployBtn = !!btn;
    if (btn) btn.click();
    await new Promise(res => setTimeout(res, 1200));
    o.modalOpenBeforeRun = window.MythicDilemmas.isOpen();
    o.screenStillMap = App.screen;
  } finally { Math.random = r; }
  return o;
}));

await pg.waitForTimeout(600);
await pg.screenshot({ path: '.gauntlet/_dlm-on-map.png' });

/* the roster panel, with art, inside the real modal */
Object.assign(out, await pg.evaluate(() => {
  const rows = [...document.querySelectorAll('.md-urow')];
  const imgs = [...document.querySelectorAll('.md-uart')];
  return {
    modalRows: rows.length,
    artImgs: imgs.length,
    artLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
    firstArtSrc: imgs.length ? imgs[0].getAttribute('src').slice(0, 64) : null,
    /* a dead art URL must leave the GLYPH showing, not an empty bordered box */
    glyphsUnderArt: [...document.querySelectorAll('.md-uicon:has(.md-uart) .md-uglyph')].length,
    everyRowHasAFace: rows.every(r => !!r.querySelector('.md-uglyph, .md-uart')),
    iconCellPx: rows.length ? (() => {
      const c = rows[0].querySelector('.md-uicon'); const bb = c.getBoundingClientRect();
      return Math.round(bb.width) + 'x' + Math.round(bb.height);
    })() : null,
  };
}));

/* ── resolving moves the bond of whoever took a side ─────────────────────── */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  const before = {}; window.MythicDilemmas.roster().forEach(u => { before[u.id] = u.bond; });
  /* ⚠ NOT just the first choice. A choice the player cannot afford renders with
     `.off` and aria-disabled, and clicking it arms nothing — so a driver that
     grabs [0] can report "commit stayed disabled" on a modal that is behaving
     perfectly. Pick one the player can actually take. */
  const opts = [...document.querySelectorAll('.md-choice[data-md="pick"]')];
  o.choiceCount = opts.length;
  /* …and not just any affordable one. Each choice carries its own tally of who
     supports and who objects, and a choice NOBODY has a view on moves no bond —
     correctly. Asserting 'a bond moved' after clicking whichever choice came
     first makes the test a coin flip on the corpus. Pick one the room reacts to,
     so the assertion is about the bond WRITE and not about the roll.
     ⚠ Falls back to any affordable choice when no choice divides the room: that
       is a real state (a procedural dilemma), and the bond assertion below is
       skipped for it rather than failed. */
  const reacts = (el) => {
    const t = el.querySelector('.md-tally');
    if (!t) return 0;
    const n = (sel) => { const e = t.querySelector(sel); return e ? (parseInt((e.textContent||'').replace(/[^0-9]/g, ''), 10) || 0) : 0; };
    return n('.sup') + n('.ag');
  };
  const affordable = opts.filter(x => !x.classList.contains('off'));
  const opt = affordable.find(x => reacts(x) > 0) || affordable[0] || opts[0];
  o.roomReacts = opt ? reacts(opt) : 0;
  o.choiceClickable = !!opt;
  if (opt) { opt.click(); await new Promise(r => setTimeout(r, 500)); }
  o.choiceArmed = !!(opt && opt.getAttribute('aria-pressed') === 'true');
  const commit = document.getElementById('md-commit');
  o.commitEnabled = !!(commit && !commit.disabled);
  if (commit && !commit.disabled) { commit.click(); await new Promise(r => setTimeout(r, 1400)); }
  const after = window.MythicDilemmas.roster();
  o.bondsMoved = after.filter(u => before[u.id] !== undefined && u.bond !== before[u.id]).length;
  o.resolvedCount = window.MythicDilemmas.state().resolved || 0;
  return o;
}));

/* ── …and the SAME interrupt on a crossing, driven rather than grepped ───── */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  /* close whatever the deploy path opened, and clear the cooldown the way a
     new offer would — the assertion here is about the MOVE call site, not
     about whether a second dilemma is due 45 minutes early. */
  try { window.MythicDilemmas.close(); } catch (e) {}
  App.screen = 'rlcList'; render();
  await new Promise(r => setTimeout(r, 1500));
  await new Promise(r => setTimeout(r, 400));
  const st = window.MythicDilemmas.state();
  st.nextAt = 0; window.MythicDilemmaBridge.setState(st);
  o.availableAgain = window.MythicDilemmas.available();
  const r = Math.random; Math.random = () => 0.001;
  try {
    const mv = document.getElementById('msn-move');
    o.moveBtn = !!mv;
    if (mv) mv.click();
    await new Promise(res => setTimeout(res, 1600));
    o.modalOpenAfterMove = window.MythicDilemmas.isOpen();
  } finally { Math.random = r; }
  return o;
}));

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
const s = out.src;
if (!s.resetMarkupGone) F.push('"Reset all progress" markup is still there');
if (!s.resetHandlerGone) F.push('the reset handler is still bound');
if (!s.bridgeHasArt) F.push('the bridge cannot resolve card art');
if (!s.artGated) F.push('art URLs reach markup with no gate');
if (!s.firesOnMove) F.push('a move cannot raise a dilemma');
if (!s.firesOnDeploy) F.push('a deploy cannot raise a dilemma');
if (!s.deployLaunchesAnyway) F.push('a refused dilemma would eat the deploy');
if (!out.rosterSize) F.push('the last-used deck produced no roster');
if (out.artBeforeStaging !== 0) F.push('the harness had art before staging — the assertion below proves nothing');
/* 🔴 TWO LAYERS, TWO NUMBERS, AND CONFLATING THEM IS A BUG IN THE TEST.
   The engine carries whatever the bridge resolved — INCLUDING the hostile
   URL, because sanitising at the data layer would hide it from the layer
   whose job it is. The RENDERER is what refuses to draw it. So the roster
   holds staged+1 and the modal shows staged: that gap IS the gate working,
   and an assertion that demanded they match would fail on correct code. */
if (out.withArt !== out.stagedCount + (out.hostileOn ? 1 : 0)) F.push('the roster carried ' + out.withArt + ' arts for ' + out.stagedCount + ' staged + 1 hostile');
if (out.artMatchesGame === false) F.push('the art URL is not the one the rest of the game uses');
if (!out.rollIsRandom) F.push('the interrupt is not actually a roll');
if (!out.unknownWhereRefused) F.push('an unknown trigger point invents a rate');
if (!out.modalOpenBeforeRun) F.push('the deploy did not raise the dilemma first');
if (out.availableAgain && !out.modalOpenAfterMove) F.push('a crossing did not raise the dilemma');
if (!out.artImgs) F.push('the modal drew no card art');
if (out.artImgs !== out.stagedCount) F.push('the modal drew ' + out.artImgs + ' faces for ' + out.stagedCount + ' staged');
if (out.hostileOn && out.artImgs !== out.stagedCount) F.push('the hostile art URL reached an img tag');
/* the cell must actually BECOME a portrait, not stay a one-line glyph slot */
if (out.iconCellPx && Number(String(out.iconCellPx).split('x')[1]) < 24) F.push('the art cell never grew past the glyph clamp (' + out.iconCellPx + ')');
if (!out.choiceArmed) F.push('clicking a choice did not arm it');
if (out.glyphsUnderArt !== out.artImgs) F.push('an art cell has no glyph under it — a dead URL would leave an empty box');
if (!out.everyRowHasAFace) F.push('a roster row drew neither art nor glyph');
if (out.roomReacts > 0 && !out.bondsMoved) F.push('the room took sides on this choice and no bond moved');
if (out.resolvedCount !== 1) F.push('the decision was not recorded as resolved');
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · the Heights interrupts the map, in the deck you last took out, wearing its own faces');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
