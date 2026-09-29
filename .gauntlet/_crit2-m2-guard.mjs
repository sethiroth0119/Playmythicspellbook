/* ══════════════════════════════════════════════════════════════════════════
   CRITIC PROBE — the out-of-order dedup guard in _onRemoteStateArrived, driven
   DIRECTLY, on one real page. Deliberately NOT the builder's harness: this one
   authors the payload and calls the shipped handler, so the only thing under
   test is the guard expression itself.

   Cases (receiver: myTurn=false so the M1 authority gate is inert by its own
   `MatchBroadcast.myTurn === true` term; lastSeenTurn forced to 9):
     c1  turn=3  _resync=true   askedAt set        → expect ADOPT   (the fix)
     c2  turn=3  _resync=true   no ask             → expect DROP    (conditionality)
     c3  turn=3  _resync=false  askedAt set        → expect DROP    (ARM 2: guard is a guard)
     c4  turn=12 _resync=false  no ask             → expect ADOPT   (instrument liveness)
     c5  turn=3  _resync=true   awaitingResync     → expect ADOPT   (reconnect route)
   Adoption is read as MatchBroadcast.lastRecvSnapshot changing identity AND
   lastSeenTurn moving to the packet's turn (the dedup line's own side effect).

   Instrument check: every case is ALSO run against a minted tree whose
   `_wantResyncAnswer` is hard-true (the round-1, unconditional bypass). c2 must
   flip DROP→ADOPT there and c3 must not move. If the probe cannot tell those
   two trees apart it is not measuring the guard.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const SRC  = path.join(ROOT, 'index.html');
const PORT = 8790 + (process.pid % 40);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };

const srcText = fs.readFileSync(SRC, 'utf8');
const WANT = 'const _wantResyncAnswer = !!(MatchBroadcast.awaitingResync || MatchBroadcast._resyncAskedAt);';
const n = srcText.split(WANT).length - 1;
if (n !== 1) { console.log('❌ expected exactly 1 _wantResyncAnswer decl, found ' + n); process.exit(2); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crit-m2-'));
const R1 = path.join(TMP, 'round1.html');
fs.writeFileSync(R1, srcText.replace(WANT, 'const _wantResyncAnswer = true;'));

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = p === '/index.html' ? SRC : p === '/round1.html' ? R1 : path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const CASES = [
  { id: 'c1', turn: 3,  resync: true,  asked: true,  awaiting: false, expect: 'adopt' },
  { id: 'c2', turn: 3,  resync: true,  asked: false, awaiting: false, expect: 'drop'  },
  { id: 'c3', turn: 3,  resync: false, asked: true,  awaiting: false, expect: 'drop'  },
  { id: 'c4', turn: 12, resync: false, asked: false, awaiting: false, expect: 'adopt' },
  { id: 'c5', turn: 3,  resync: true,  asked: false, awaiting: true,  expect: 'adopt' },
  /* c6 — THE PRODUCTION SHAPE OF A STALE ANSWER. Every adopt arm in the
     builder's driver empties the receiver's board first (forceStuck), so
     "un-stick" is measured from zero units. The stuck-turn watchdog does NOT
     require an empty board — it fires on 9 s of silence while waiting — and an
     answer can only BE stale if the answerer itself regressed. So: healthy
     4-unit receiver, armed ask, peer answers with its rebuilt 2-unit board.
     Adoption is expected (that is the bar), and the point of the case is to
     measure what the receiver loses. */
  { id: 'c6', turn: 3,  resync: true,  asked: true,  awaiting: false, expect: 'adopt', pad: 2 },
];

const PROBE = (c) => {
  const out = { id: c.id, err: null };
  try {
    const me  = findHeroById(STARTER_HEROES[0].id);
    const foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep = { hero: me, heroId: me.id, multiplayer: true, opponentName: 'Bex' };
    App.screen = 'battle';
    // Receiver's own board.
    App.state = initGame(me, foe, [], false, null);
    App.state.currentTurn = 'ai';
    if (c.pad) {
      const base = App.state.units.find(u => u.owner === 'player') || App.state.units[0];
      const extra = [];
      for (let i = 0; i < c.pad; i++) {
        extra.push({ ...base, id: 'pad_' + i, isHero: false, name: 'Pad ' + i,
          pos: { x: 1 + i, y: 6 } });
      }
      App.state = { ...App.state, units: [...App.state.units, ...extra] };
    }
    out.unitsBefore = App.state.units.length;
    // The SENDER's board — a genuinely different unit set, serialized by the
    // shipped serializer so the payload is shaped like a real one.
    const sender = initGame(foe, me, [], true, null);
    sender.currentTurn = 'player';          // sender says the turn is ITS own
    sender.turnNumber = c.turn;
    const snap = _serializeBattleStateForBroadcast(sender);
    MatchBroadcast.matchId = 'm-crit';
    MatchBroadcast.myUserId = 'me';
    MatchBroadcast.opponentId = 'opp';
    MatchBroadcast.channel = null;
    MatchBroadcast.myTurn = false;
    MatchBroadcast.lastSeenTurn = 9;
    MatchBroadcast.lastRecvSnapshot = { turnNumber: 99, units: [], _sentinel: true };
    MatchBroadcast.awaitingResync = !!c.awaiting;
    MatchBroadcast._resyncAskedAt = c.asked ? Date.now() : 0;
    MatchBroadcast.gameOverResolved = true;   // never submit a result from a probe
    const beforeRecv = MatchBroadcast.lastRecvSnapshot;
    const payload = { from: 'opp', turn: c.turn, state: snap, newLog: [] };
    if (c.resync) payload._resync = true;
    _onRemoteStateArrived(payload);
    out.recvChanged  = MatchBroadcast.lastRecvSnapshot !== beforeRecv;
    out.recvIsPacket = MatchBroadcast.lastRecvSnapshot === snap;
    out.lastSeenTurn = MatchBroadcast.lastSeenTurn | 0;
    out.units        = (App.state && App.state.units || []).length;
    out.askedAfter   = MatchBroadcast._resyncAskedAt | 0;
    out.awaitingAfter = !!MatchBroadcast.awaitingResync;
    out.senderUnits  = (snap.units || []).length;
  } catch (e) { out.err = String(e).slice(0, 200); }
  return out;
};

async function runTree(browser, urlPath, label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 150)));
  await page.route('**/*', r => {
    const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
  });
  await page.goto('http://127.0.0.1:' + PORT + urlPath, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function" && typeof _onRemoteStateArrived === "function" && typeof _serializeBattleStateForBroadcast === "function"',
    null, { timeout: 240000 });
  const rows = [];
  for (const c of CASES) {
    const r = await page.evaluate(PROBE, c);
    // Adopted == the dedup line's own two side effects both happened.
    r.adopted = !!(r.recvIsPacket && r.lastSeenTurn === c.turn);
    r.expect = c.expect;
    r.fail = r.err ? true : (r.adopted !== (c.expect === 'adopt'));
    rows.push(r);
    console.log('   ' + label.padEnd(10) + c.id
      + '  turn=' + String(c.turn).padEnd(3)
      + '_resync=' + String(!!c.resync).padEnd(6)
      + 'asked=' + String(!!c.asked).padEnd(6)
      + 'awaiting=' + String(!!c.awaiting).padEnd(6)
      + '→ recvIsPacket=' + String(r.recvIsPacket).padEnd(6)
      + 'lastSeenTurn=' + String(r.lastSeenTurn).padEnd(3)
      + 'units=' + String(r.unitsBefore) + '→' + String(r.units).padEnd(4)
      + 'askedAfter=' + String(r.askedAfter ? 'armed' : '0').padEnd(6)
      + ' expect ' + c.expect.toUpperCase().padEnd(6)
      + (r.err ? ('❌ THREW ' + r.err) : (r.fail ? '❌ FAIL' : '✅ pass')));
  }
  await ctx.close();
  return { rows, errs };
}

const browser = await chromium.launch({ headless: true });
console.log('\n🔎 CRITIC PROBE — dedup guard, direct handler invocation\n');
const fixed = await runTree(browser, '/index.html', 'FIXED');
console.log('');
const round1 = await runTree(browser, '/round1.html', 'ROUND1');
await browser.close();
server.close();

const g = (t, id) => t.rows.find(r => r.id === id);
const fixFails = fixed.rows.filter(r => r.fail).map(r => r.id);
// The instrument check: the SAME probe must read the two trees differently, and
// differently in exactly the place the change is.
const sensitive = (g(round1, 'c2').adopted === true) && (g(round1, 'c3').adopted === false)
               && (g(fixed, 'c2').adopted === false);
console.log('\n  fixed tree failures: ' + (fixFails.length ? fixFails.join(',') : 'none'));
console.log('  instrument sensitivity (c2 DROP on fixed, ADOPT on round-1; c3 DROP on both): '
  + (sensitive ? '✅ the probe can tell the trees apart' : '❌ probe is blind — its greens mean nothing'));
console.log('  page errors: fixed=' + fixed.errs.length + ' round1=' + round1.errs.length);
if (fixed.errs.length) console.log('   ' + fixed.errs.slice(0, 3).join('\n   '));
console.log('\n  ' + (!fixFails.length && sensitive ? '🟢 GUARD BEHAVES AS THE BAR DESCRIBES' : '🔴 SOMETHING IS WRONG') + '\n');
process.exit(!fixFails.length && sensitive ? 0 : 1);
