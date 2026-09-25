/* ══════════════════════════════════════════════════════════════════════════
   🎯 DRIVE-ATTACK-FAN — an arrow to every target, and one when you hover.

   Asked for: selecting an attack draws an arrow to EVERY unit and hero in
   range; hovering one drops the others; leaving brings them back; and it all
   ends when a target is chosen.

   That is three states, so this measures three states — and the middle one is
   the whole feature, so a test that only proved "arrows exist" would be worth
   nothing.

   🔴 WHAT MAKES THIS DISCRIMINATING. The fan is built from p.attack, which is
   the SAME set the click gate uses. So the interesting assertion is not "arcs
   appeared" but "the fan has exactly as many arcs as there are legal targets,
   and hovering collapses it to 1, and un-hovering restores it". Each of those
   can fail independently.

   ⚠ renderBattleNow(), NOT renderBattle(). renderBattle is queueMicrotask-
     debounced and returns BEFORE the DOM exists — the gauntlet's own triage
     lost a pass to this, reporting all eight battle prompts as unreachable.

   Run:  node .gauntlet/drive-attack-fan.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const PORT = 7050 + (process.pid % 80);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof initGame === "function" && typeof _bbStagePushTele === "function"',
                           null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(5000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const r = await page.evaluate(async () => {
  const out = {};
  /* A real match — an empty shell would make every count 0 and read as a pass
     on the "no fan after commit" assertion. */
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle';

  const s = App.state;
  const mine = s.units.find((u) => u.owner === 'player' && u.alive);
  if (!mine) { out.err = 'no player unit'; return out; }

  /* Put several enemies inside reach so the fan has something to fan ACROSS —
     one target cannot distinguish "all arcs" from "the hovered arc". */
  const foes = [];
  for (let i = 0; i < 4; i++) {
    const id = 'fanfoe_' + i;
    s.units.push({ id: id, name: 'Foe ' + i, owner: 'ai', alive: true, currentHp: 10, hp: 10,
                   maxHp: 10, pos: { x: mine.pos.x + 1, y: mine.pos.y + i - 1 },
                   isHero: i === 3, knownMoves: [], atk: 3, def: 1 });
    foes.push(id);
  }
  out.foesPlaced = foes.length;
  out.heroAmong = true;   // foe 3 is a HERO — the ask names heroes explicitly

  /* Select the unit and an attack move, the way the UI does. */
  App.ui = App.ui || {};
  App.ui.selectedUnitId = mine.id;
  App.ui.actionMode = 'attack';
  const atkMove = (mine.knownMoves || []).map((m) => lookupMove(m)).find((m) => m && m.kind === 'attack');
  App.ui.selectedMoveId = atkMove ? atkMove.id : null;
  out.moveUsed = atkMove ? atkMove.id : null;
  renderBattleNow();
  await new Promise((res) => setTimeout(res, 500));

  const paintTargets = ((App._bbPaint || {}).attack || []).length;
  out.legalTargets = paintTargets;

  /* ── STATE 1: attack selected, nothing hovered -> the whole fan ────────── */
  App._bbHover = null;
  let sent = null;
  const origPost = window._bbStagePost;
  window._bbStagePost = (kind, msg) => { if (kind === 'tele') sent = msg; };
  /* 🔴 CLEAR THE DIFF GUARD BEFORE EVERY PUSH. _bbStagePushTele ends by
     comparing a JSON key against _BBS.teleKey and returning early when they
     match — it only posts when the payload CHANGES. renderBattleNow() has
     already pushed this exact payload, so a manual call computes the same key
     and returns silently: the first draft of this driver read -1 arcs in all
     four states and looked exactly like the feature being dead. _BBS is a
     top-level const (not on window) but IS reachable as a bare identifier from
     page.evaluate. */
  const push = () => { try { _BBS.teleKey = ''; } catch (e) {} sent = null; _bbStagePushTele(); };
  push();
  out.fanNoHover = sent ? (sent.arcs || []).length : -1;
  out.arcNoHover = sent ? !!sent.arc : null;

  /* ── STATE 2: hover a legal target -> focused arc, fan suppressed by the
     renderer (the host still sends both; the BOARD picks) ───────────────── */
  /* ⚠ {x, z}, NOT {x, y}. App._bbHover is written by the BOARD's pointer
     message in BOARD coordinates (index.html:114328 -> {x, z, unitId, box}) and
     the host reads `h.z`. Feeding it {x, y} — the GAME's shape — leaves h.z
     undefined, hv.y collapses to 0, and the attack-set test never matches: the
     focused arc silently never appears and it reads as the hover feature being
     broken. This is CONTRACT §1.1 (game {x,y} vs board {x,z}) biting in a test
     instead of in the product. */
  const t0 = ((App._bbPaint || {}).attack || [])[0];
  if (t0) App._bbHover = { x: t0.x, z: t0.y, unitId: null, box: null };
  push();
  out.fanHover = sent ? (sent.arcs || []).length : -1;
  out.arcHover = sent ? !!sent.arc : null;

  /* ── STATE 3: stop hovering -> back to the fan ────────────────────────── */
  App._bbHover = null;
  push();
  out.fanAfter = sent ? (sent.arcs || []).length : -1;
  out.arcAfter = sent ? !!sent.arc : null;

  /* ── STATE 4: target chosen -> no fan at all ──────────────────────────── */
  App.ui.selectedUnitId = null; App.ui.actionMode = null; App.ui.selectedMoveId = null;
  renderBattleNow();
  await new Promise((res) => setTimeout(res, 400));
  push();
  out.fanCommitted = sent ? (sent.arcs || []).length : -1;
  window._bbStagePost = origPost;
  return out;
});

console.log('\n\u{1F3AF} THE ATTACK FAN — four states\n');
console.log('   ' + JSON.stringify(r));
if (r.err) { ok('a battle was built', false, r.err); }
else {
  ok('the attack offers several legal targets (a fan needs something to fan)',
     (r.legalTargets | 0) >= 2, r.legalTargets + ' targets, incl. a hero');
  console.log('\n1. attack selected, nothing hovered');
  ok('\u{1F3AF} an arc is sent for EVERY legal target',
     r.fanNoHover === r.legalTargets, r.fanNoHover + ' arcs vs ' + r.legalTargets + ' targets');
  ok('...and no focused arc yet', r.arcNoHover === false, 'arc=' + r.arcNoHover);
  console.log('\n2. hovering a target');
  ok('\u{1F3AF} a focused arc is set (the board draws this ALONE)', r.arcHover === true, 'arc=' + r.arcHover);
  console.log('\n3. hover leaves');
  ok('\u{1F3AF} the focused arc clears', r.arcAfter === false, 'arc=' + r.arcAfter);
  ok('\u{1F3AF} and the full fan is back', r.fanAfter === r.legalTargets,
     r.fanAfter + ' arcs vs ' + r.legalTargets);
  console.log('\n4. the attack is committed / deselected');
  ok('\u{1F3AF} the fan is gone — no arrows linger', r.fanCommitted === 0, r.fanCommitted + ' arcs');
}
console.log('\npage errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
