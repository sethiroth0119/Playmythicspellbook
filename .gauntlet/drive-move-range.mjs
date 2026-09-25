/* ══════════════════════════════════════════════════════════════════════════
   📏 DRIVE-MOVE-RANGE — do the move buttons print the reach the move HAS?

   THE ASK: "add the range of moves on the buttons."

   The move ring already prints it (⬡ N on each chip). The unit modal printed
   `range ${m.range}` — the AUTHORED number, which ignores everything
   getEffectiveAttackRange adds: the Watchtower location aura, the Archmage +1
   on spells, cosmic range nodes, and the prime-weapon floor. So a hero with any
   of those read one number on the button while the board drew arrows to a
   different set of tiles.

   This renders both menus for the SAME unit and the SAME move and compares
   three numbers that must agree:

       the ring chip's ⬡ N   ==   the modal's "range N"   ==   getEffectiveAttackRange()

   ⚠ THE THIRD IS THE AUTHORITY, not the tie-breaker between the first two: it
     is the function renderBattle's validAttacks and _hoverAttackReach both call
     to decide where the arrows go. Two buttons agreeing with each other and
     disagreeing with the board is the failure this is looking for.
   ⚠ A unit with a range bonus is what makes the test bite. If the starter
     roster has none, one is STAMPED on the caster (_skillRange, the same field
     buildHero sets from the cosmic tree) so the authored and effective numbers
     genuinely differ — otherwise both readings are trivially equal and the file
     passes without testing anything.

   Run: node .gauntlet/drive-move-range.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 7620 + (process.pid % 70);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof initGame==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);

const out = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rep = { rows: [] };
  try {
    localStorage.setItem('mg_onboarded', '1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay,.modal-overlay').forEach(e => e.remove());
  } catch (e) {}
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
  try { if (typeof _uiAutoScale === 'function') _uiAutoScale(); } catch (e) {}
  renderBattleNow();
  await sleep(1200);
  try { document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e => e.remove()); } catch (e) {}
  App.state.turn = 'player';
  App.state.player.energy = 9;

  const caster = (App.state.units || []).find(u => u && u.alive && u.owner === 'player'
    && (u.knownMoves || []).some(id => { const m = lookupMove(id); return m && m.kind === 'attack'; }));
  if (!caster) { rep.fatal = 'no player unit with an attack'; return rep; }

  /* Make the authored and effective numbers differ, so the comparison bites. */
  const bonusBefore = caster._skillRange | 0;
  caster._skillRange = bonusBefore + 1;
  rep.bonus = { field: '_skillRange', was: bonusBefore, now: caster._skillRange };
  rep.caster = caster.name || caster.id;

  const attacks = (caster.knownMoves || []).map(id => lookupMove(id)).filter(m => m && m.kind === 'attack');

  /* ── the ring ──
     ⚠ _uhmRect is a top-level `let`, so it is a global LEXICAL binding and is
       NOT on window (the globals trap in CLAUDE.md). `window._uhmRect = …`
       assigns a different property, _openMoveRing still sees no anchor and
       returns false, and the ring never draws — which reads here as "the chips
       have no range on them". Direct eval runs in this scope's chain and does
       reach the real binding. */
  try {
    const _r = (document.querySelector('.battle-screen') || document.body).getBoundingClientRect();
    window.__anchorRect = _r;
    eval('_uhmRect = window.__anchorRect');
  } catch (e) { rep.anchorErr = String(e).slice(0, 80); }
  App.ui.selectedUnitId = caster.id;
  const opened = _openMoveRing(caster.id);
  rep.ringOpened = !!opened;
  const ringRange = {};
  document.querySelectorAll('#move-ring [data-mvr-move]').forEach(ch => {
    const id = ch.getAttribute('data-mvr-move');
    const t = (ch.querySelector('.mvr-rng') || {}).textContent || '';
    const n = /(\d+)/.exec(t);
    ringRange[id] = n ? +n[1] : null;
  });
  try { _closeMoveRing(); } catch (e) {}

  /* ── the modal ── */
  App.ui.selectedMoveId = null; App.ui.actionMode = null;
  App.ui.modalUnitId = caster.id;
  renderBattleNow();
  await sleep(400);
  const modalRange = {};
  document.querySelectorAll('.modal-move[data-move]').forEach(btn => {
    const id = btn.getAttribute('data-move');
    const t = (btn.querySelector('.modal-move-meta') || {}).textContent || '';
    const n = /range\s+(\d+)/i.exec(t);
    modalRange[id] = n ? +n[1] : null;
  });
  App.ui.modalUnitId = null;
  renderBattleNow();

  for (const m of attacks) {
    rep.rows.push({
      move: m.name || m.id, id: m.id,
      authored: m.range | 0,
      effective: getEffectiveAttackRange(caster, m) | 0,
      ring: ringRange[m.id] == null ? null : ringRange[m.id],
      modal: modalRange[m.id] == null ? null : modalRange[m.id],
    });
  }
  return rep;
});
await b.close(); srv.close();

if (out.fatal) { console.log('FATAL: ' + out.fatal); process.exit(1); }
const ok = (v) => v ? '[32mok[0m' : '[31mNO[0m';
console.log('\n📏 MOVE RANGE ON THE BUTTONS · ring vs modal vs the board\n');
console.log('  caster: ' + out.caster + '   (+1 range stamped on ' + out.bonus.field + ' so the numbers differ)\n');
console.log('  move                  authored  effective   ring   modal   agree');
let pass = out.rows.length > 0, bites = false;
for (const r of out.rows) {
  const agree = r.ring === r.effective && r.modal === r.effective;
  if (r.effective !== r.authored) bites = true;
  if (!agree) pass = false;
  console.log('  ' + String(r.move).padEnd(22) + String(r.authored).padStart(8) + String(r.effective).padStart(11)
    + String(r.ring === null ? '—' : r.ring).padStart(7) + String(r.modal === null ? '—' : r.modal).padStart(8)
    + '   ' + ok(agree));
}
if (!bites) { console.log('\n  ⚠ the bonus did not change any number — this run proved nothing'); pass = false; }
console.log('\n  VERDICT: ' + (pass ? '[32mBOTH MENUS PRINT THE REACH THE BOARD USES[0m' : '[31mA BUTTON DISAGREES WITH THE BOARD[0m') + '\n');
process.exit(pass ? 0 : 1);
