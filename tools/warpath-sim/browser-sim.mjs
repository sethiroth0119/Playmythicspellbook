// ─────────────────────────────────────────────────────────────────────────────
// 🖥 WARPATH stage 2 — four real browser contexts.
//
// Stage 1 (sim.mjs) proves the SERVER can host four players. It does not prove
// the CLIENT can, because it never loads one: it calls the RPCs directly and so
// skips public/warpath/warpath-app.js, warpath-net.js, and the postMessage
// bridge that public/index.html:215588 uses to forward every call.
//
// This runs the shipped sub-app in four independent Chromium contexts against
// the same Postgres, through a bridge that answers exactly the way the real
// parent does — including refusing a call whose arguments do not match a
// function signature, which is how PostgREST behaves and is where the
// interesting result lives.
//
//   PHASE A  FAITHFUL — the client as shipped. Nothing is added to its calls.
//   PHASE B  COMPAT   — the shim fills in the one argument the client never
//                       sends, so the rest of the client can be exercised at
//                       all: four heroes moving, camping, harvesting, ending
//                       turns and fighting each other through the real UI.
//
//   node tools/warpath-sim/browser-sim.mjs            # both phases
//   node tools/warpath-sim/browser-sim.mjs --headed   # watch it
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { startShim } from './shim.mjs';

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const TURNS = Number(flag('turns', 10));

const EXEC = process.env.WP_CHROMIUM || '/opt/pw-browsers/chromium';
let PASS = 0, FAIL = 0;
const pass = m => { PASS++; console.log(`  ✔ ${m}`); };
const fail = m => { FAIL++; console.log(`  ✘ FAIL ${m}`); };
const note = m => console.log(`  • ${m}`);
const head = m => console.log(`\n── ${m} ${'─'.repeat(Math.max(0, 66 - m.length))}`);

/** Everything below reaches into the iframe, which is where the sub-app lives. */
const app = page => page.frameLocator('#f');
const inFrame = (page, fn, ...a) =>
  page.frames().find(f => f.url().endsWith('/index.html')).evaluate(fn, ...a);

async function bootSeats(browser, shim, n) {
  const pages = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 780 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(`    [seat ${i} pageerror] ${e.message}`));
    await page.goto(shim.url(i), { waitUntil: 'load' });
    await page.waitForTimeout(400);
    pages.push(page);
  }
  return pages;
}

const state = page => inFrame(page, () => window.WarpathNet.rpc('warpath_state', {}));

// ═══════════════════════════════════════════════════════════════════════════
// PHASE A — the client exactly as shipped.
// ═══════════════════════════════════════════════════════════════════════════
async function phaseA(browser) {
  head('PHASE A — four browsers, the client as shipped, nothing added');
  const shim = await startShim({ port: 8791, players: 4, injectExp: false });
  const pages = await bootSeats(browser, shim, 4);

  // The sub-app enters by itself on boot (warpath-app.js:1457).
  await Promise.all(pages.map(p => p.waitForTimeout(2500)));
  const states = await Promise.all(pages.map(state));
  const inRun = states.filter(s => s && s.in_run).length;
  if (inRun === 4) pass('all four browsers entered the Warpath through the real client + bridge');
  else fail(`${inRun}/4 browsers entered: ${JSON.stringify(states.map(s => s && (s.reason || s.in_run)))}`);

  const runs = new Set(states.filter(s => s?.in_run).map(s => s.run.id));
  if (runs.size === 1) pass(`all four landed in ONE run (${[...runs][0]}) with slots ${states.map(s => s.me.slot).join(',')}`);
  else fail(`the four browsers landed in ${runs.size} different runs`);

  // Now try to actually play. These are the calls the shipped client makes.
  const p0 = pages[0];
  const camp = await inFrame(p0, () => window.WarpathNet.rpc('warpath_camp_place', {}).catch(e => ({ err: String(e.message || e) })));
  const st0 = states[0];
  const move = await inFrame(p0, ({ x, y }) =>
    window.WarpathNet.rpc('warpath_move', { p_x: x, p_y: y }).catch(e => ({ err: String(e.message || e) })),
    { x: st0.me.x + 1, y: st0.me.y });
  const end = await inFrame(p0, () => window.WarpathNet.rpc('warpath_end_turn', {}).catch(e => ({ err: String(e.message || e) })));

  const broken = [['warpath_camp_place', camp], ['warpath_move', move], ['warpath_end_turn', end]]
    .filter(([, r]) => r && r.err);
  if (broken.length === 0) pass('the client can move, camp and end its turn');
  else {
    fail(`${broken.length}/3 of the client's own calls were refused before reaching the database`);
    for (const [fn, r] of broken) note(`${fn} -> ${r.err}`);
    note('⚠ ROOT CAUSE: every mutating warpath_* RPC takes `p_exp uuid` as its FIRST '
       + 'parameter with NO DEFAULT (migration:1222, 1341, 1376, 1404, 1458, 1510, 1568, '
       + '1626, 1807, 1836, 1896), and public/warpath/warpath-app.js never sends it — '
       + 'grep the whole of public/ for `p_exp` and the only hit is an unrelated dojo call. '
       + 'PostgREST resolves functions by ARGUMENT NAME, so warpath_move({p_x,p_y}) does not '
       + 'match any overload and comes back PGRST202. public/index.html:215536 then rewrites '
       + 'that into "The Warpath is not installed on this server yet", so the real symptom in '
       + 'front of a player is a false installation error on every single action.');
  }
  // What the player actually sees.
  const toast = await app(p0).locator('#toast').textContent({ timeout: 2000 }).catch(() => null);
  if (toast) note(`the on-screen message after one click: "${String(toast).trim()}"`);
  const shots = await Promise.all(pages.map((p, i) =>
    p.screenshot({ path: `/var/tmp/wpsim/phaseA-seat${i}.png` }).then(() => `phaseA-seat${i}.png`)));
  note(`screenshots: ${shots.join(', ')}`);

  for (const p of pages) await p.context().close();
  await shim.stop();
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE B — same four browsers, with the missing argument supplied by the shim,
// so everything downstream of that one bug can be exercised.
// ═══════════════════════════════════════════════════════════════════════════
async function phaseB(browser) {
  head('PHASE B — four browsers playing, with p_exp supplied by the bridge');
  const shim = await startShim({ port: 8792, players: 4, injectExp: true });
  const pages = await bootSeats(browser, shim, 4);
  await Promise.all(pages.map(p => p.waitForTimeout(2500)));

  let states = await Promise.all(pages.map(state));
  if (states.every(s => s?.in_run)) pass('four browsers in one run, rendering');
  else { fail('boot failed in compat mode'); await shim.stop(); return; }

  // Real UI: pitch camp with the actual button on all four.
  for (const p of pages) {
    const b = app(p).locator('#b-camp');
    try { await b.click({ timeout: 3000 }); } catch { await b.click({ force: true, timeout: 3000 }).catch(() => {}); }
  }
  await Promise.all(pages.map(p => p.waitForTimeout(500)));
  states = await Promise.all(pages.map(state));
  const camped = states.filter(s => s.camp).length;
  if (camped === 4) pass('all four pitched camp by clicking #b-camp — the shipped button');
  else fail(`${camped}/4 camps pitched through the UI`);

  // Does one browser see another's camp once it has explored the tile?
  // Seat 1 walks towards seat 0's camp; all four end their turns each round,
  // exactly as four people at four keyboards would.
  const target = states[0].camp;
  let sawCamp = false, uiMoves = 0, rounds = 0;
  for (; rounds < 10 && !sawCamp; rounds++) {
    for (let hop = 0; hop < 6; hop++) {
      const st = await state(pages[1]);
      if (!st.in_run || st.me.status !== 'active' || st.me.moves_left < 1) break;
      if (!(await stepToward(pages[1], target.x, target.y))) break;
      uiMoves++;
      const after = await state(pages[1]);
      if ((after.others || []).some(o => o.camp)) { sawCamp = true; break; }
    }
    await Promise.all(pages.map((p, i) => clickEndTurn(pages, i)));
    await Promise.all(pages.map(p => p.waitForTimeout(150)));
  }
  if (sawCamp) pass(`seat 1 walked ${uiMoves} tiles over ${rounds} turns and warpath_state() now reports a rival camp to its client`);
  else note(`seat 1 made ${uiMoves} moves over ${rounds} turns without a rival camp appearing`);

  // Turn loop through the real End turn button, four browsers at a time.
  head('PHASE B — synchronised turns through the End turn button');
  let advanced = 0;
  for (let t = 0; t < TURNS; t++) {
    const before = (await state(pages[0])).run.turn;
    await Promise.all(pages.map((p, i) => clickEndTurn(pages, i)));
    await Promise.all(pages.map(p => p.waitForTimeout(250)));
    const after = (await state(pages[0])).run.turn;
    if (after > before) advanced++;
    if (after - before > 1) note(`⚠ turn jumped ${before} -> ${after} in one synchronised round`);
  }
  const bridgeErrors = (await Promise.all(pages.map(p => p.evaluate(() => window.__wpBridge.errors)))).flat();
  note(`${advanced}/${TURNS} synchronised End-turn rounds advanced the clock`);
  if (advanced < TURNS)
    note('⚠ the rounds that did not advance are the READ COMMITTED race in warpath_end_turn '
       + '(migration:1568) — see probes.mjs P2. In a browser it is the End turn button doing nothing.');
  if (bridgeErrors.length) {
    note(`${bridgeErrors.length} bridge-level errors during play:`);
    const seen = new Set();
    for (const e of bridgeErrors) {
      const k = `${e.fn}:${(e.message || '').slice(0, 60)}`;
      if (seen.has(k)) continue; seen.add(k);
      note(`   ${e.fn}: ${e.message}`);
    }
  }

  // ── A PvP battle driven by the button the player actually presses ────────
  head('PHASE B — a PvP battle through the shipped client and the battle bridge');
  const s0 = await state(pages[0]);
  const s1 = await state(pages[1]);
  await shim.obs.sql('update public.warpath_expeditions set x=$2, y=$3, moves_left=6 where id=$1',
                     [s1.me.expedition_id, s0.me.x + 1, s0.me.y]);
  await shim.obs.sql('update public.warpath_expeditions set moves_left=6 where id=$1', [s0.me.expedition_id]);

  // The client repolls on its own 12s timer in live mode (warpath-app.js:1477);
  // wait for it rather than reaching in, so the refresh path is exercised too.
  let actText = '';
  for (let i = 0; i < 16; i++) {
    await pages[0].waitForTimeout(1000);
    actText = String(await app(pages[0]).locator('#b-act').textContent({ timeout: 2000 }).catch(() => '')).trim();
    if (/^Challenge/.test(actText)) break;
  }
  if (/^Challenge/.test(actText)) {
    pass(`after its own 12s poll, seat 0's action button reads "${actText}" — the rival is inside 2-tile vision`);
    await app(pages[0]).locator('#b-act').click({ timeout: 5000 })
      .catch(() => app(pages[0]).locator('#b-act').click({ force: true, timeout: 5000 }));
    // The sub-app now posts 'warpath:battle' to the parent and waits for a verdict.
    await pages[0].waitForTimeout(1500);
    const handed = await pages[0].evaluate(() => window.__wpBridge.battles);
    if (handed.length) {
      pass(`the client handed the battle to the parent: ${handed.length} 'warpath:battle' message(s), `
         + `carrying ${handed[0].card_keys.length} card keys and hero ${handed[0].hero_id}`);
    } else fail('the client never posted warpath:battle to the parent');
    await pages[0].waitForTimeout(1200);
    const row = await shim.obs.sql(
      `select b.kind, b.status, b.winner_id, b.spoils, b.attacker_id from public.warpath_battles b
        where b.run_id = $1 order by b.opened_at desc limit 1`, [s0.run.id]);
    if (row.length && row[0].status === 'resolved') {
      pass(`and the verdict came back through warpath_battle_report: ${row[0].kind} resolved, `
         + `winner ${row[0].winner_id === s0.me.expedition_id ? 'seat 0' : 'seat 1'}, spoils ${JSON.stringify(row[0].spoils)}`);
    } else fail(`the battle did not resolve: ${JSON.stringify(row)}`);
    const loser = await shim.obs.sql(
      'select x, y, injured_turns, hero_hp, moves_left from public.warpath_expeditions where id=$1',
      [s1.me.expedition_id]);
    note(`the defeated hero: ${JSON.stringify(loser[0])} (its camp is at ${JSON.stringify((await state(pages[1])).camp)})`);
    const toast1 = String(await app(pages[1]).locator('#toast').textContent({ timeout: 2000 }).catch(() => '')).trim();
    note(`what the LOSER's screen says right now: "${toast1 || '(nothing — it has not repolled yet)'}"`);
    note('⚠ the loser is told nothing at the moment it happens. warpath_state() carries the '
       + "'hero_defeated' event in .events, but the client only repolls every 12 seconds "
       + '(warpath-app.js:1477), so a player can be robbed, injured and teleported across the '
       + 'map with the screen still showing them where they used to be.');
  } else {
    fail(`seat 0's action button never became a Challenge (it reads "${actText}")`);
  }

  await Promise.all(pages.map((p, i) => p.screenshot({ path: `/var/tmp/wpsim/phaseB-seat${i}.png` })));
  note('screenshots: phaseB-seat0..3.png');
  const calls = await fetch(`http://127.0.0.1:${shim.port}/__log`).then(r => r.json());
  const byFn = {};
  for (const c of calls) byFn[c.fn] = (byFn[c.fn] || 0) + 1;
  note(`RPCs that actually crossed the bridge: ${JSON.stringify(byFn)}`);
  const injected = shim.seats.reduce((n, s) => n + (s.injected || 0), 0);
  note(`p_exp values the bridge had to supply because the client never sends it: ${injected}`);

  for (const p of pages) await p.context().close();
  await shim.stop();
}

/** One step towards (tx,ty). Tile selection is a canvas hit-test, so this calls
 *  the same RPC #b-move calls (warpath-app.js:903) from inside the iframe —
 *  still through WarpathNet, still through the postMessage bridge. */
async function stepToward(page, tx, ty) {
  const st = await state(page);
  const dx = Math.sign(tx - st.me.x), dy = Math.sign(ty - st.me.y);
  if (!dx && !dy) return false;
  const r = await inFrame(page, ({ x, y }) =>
    window.WarpathNet.rpc('warpath_move', { p_x: x, p_y: y }).catch(e => ({ err: String(e.message || e) })),
    { x: st.me.x + dx, y: st.me.y + dy });
  return !!(r && r.ok);
}

/* Short timeouts and a forced click on the fallback: the sub-app raises a
   "TURN ENDED / waiting for N more Hero(es)" ribbon over the controls, and
   Playwright's actionability wait would otherwise spend 30s per seat per round
   discovering that. The click itself is still the shipped button. */
async function clickEndTurn(pages, i) {
  const b = app(pages[i]).locator('#b-endturn');
  try { await b.click({ timeout: 1500 }); return true; }
  catch { try { await b.click({ force: true, timeout: 1500 }); return true; } catch { return false; } }
}

// ── main ────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: EXEC, headless: !has('headed'),
                                        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  await phaseA(browser);
  await phaseB(browser);
} finally {
  await browser.close();
}
console.log(`\n════════ browser stage: ${PASS} passed, ${FAIL} failed ════════`);
process.exit(FAIL ? 1 : 0);
