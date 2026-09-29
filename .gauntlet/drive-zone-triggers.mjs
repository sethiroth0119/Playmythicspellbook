/* ══════════════════════════════════════════════════════════════════════════
   ⚰️🌌 DRIVE-ZONE-TRIGGERS — a card that acts from the graveyard AND the Void.

   "Graveyard / vanish triggers. A new trigger PHASE, not a new effect —
    something has to tick cards in those zones each turn and fire their
    abilities."

   Half of that already existed and the scouting was out of date in a useful
   way: `_applyInGraveTick` has walked the GRAVEYARD since it shipped, and its
   `default:` arm already delegates to the whole ONPLAY_TYPES catalogue — so
   damageFromGrave / drawFromVoid / recycleVoid were schedulable from the grave.
   What did NOT exist was the second pile: nothing ever walked `side.void`, so a
   banished card could carry any ability and would never be asked for it.

   What this pins:
     1. a card in the VOID with an `inVoid` block fires on the turn beat
     2. the same card in the GRAVEYARD still fires (no regression)
     3. `both` fires from either pile
     4. 🔴 CONTROLS: a card with NO zone block never fires; a card whose block
        names a DIFFERENT trigger never fires; and a grave-only card sitting in
        the Void stays silent — which is what proves the tick reads the pile it
        is walking rather than firing on anything it finds.

   Run:  node .gauntlet/drive-zone-triggers.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8720 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 860 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _applyInZoneTick === "function" && typeof initGame === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const o = {};
  o.reachable = typeof _applyInZoneTick === 'function' && typeof _applyInVoidTick === 'function'
             && typeof _applyInGraveTick === 'function';
  if (!o.reachable) return o;

  const board = () => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    const s = initGame(me, foe, [], true, null);
    s.log = []; s.turnNumber = 3; s.turn = 'player';
    s.player = { ...s.player, graveyard: [], void: [], hand: [], deck: [] };
    return s;
  };
  /* `drawCard` is the built-in arm — deterministic, needs no board geometry and
     no anchor hero, so what is under test is the SCHEDULER and not an effect's
     own targeting. chance 100, cooldown 0, so it fires whenever it is asked. */
  const blk = () => ({ trigger: 'turnStart', effect: 'drawCard', chance: 100, cooldown: 0, amount: 1 });
  const handSize = (s) => ((s.player && s.player.hand) || []).length;

  // 1 · the VOID fires
  {
    let s = board();
    s.player.deck = [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }];
    s.player.void = [{ id: 'ghost', name: 'Ghost', inVoid: blk() }];
    const after = _applyInVoidTick(s, 'player', 'turnStart');
    o.voidFired = handSize(after) > handSize(s);
  }
  // 2 · the GRAVEYARD still fires
  {
    let s = board();
    s.player.deck = [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }];
    s.player.graveyard = [{ id: 'bones', name: 'Bones', inGrave: blk() }];
    const after = _applyInGraveTick(s, 'player', 'turnStart');
    o.graveFired = handSize(after) > handSize(s);
  }
  // 3 · `both` fires from either pile
  {
    let s = board();
    s.player.deck = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];
    const card = { id: 'twin', name: 'Twin', inGrave: blk(), inVoid: blk() };
    s.player.graveyard = [JSON.parse(JSON.stringify(card))];
    s.player.void = [JSON.parse(JSON.stringify(card))];
    let after = _applyInGraveTick(s, 'player', 'turnStart');
    after = _applyInVoidTick(after, 'player', 'turnStart');
    o.bothFired = handSize(after) - handSize(s);          // must be 2
  }
  // 4 · CONTROL — no block, wrong trigger, and wrong pile
  {
    let s = board();
    s.player.deck = [{ id: 'c1' }, { id: 'c2' }];
    s.player.void = [{ id: 'inert', name: 'Inert' }];
    o.ctrlNoBlock = handSize(_applyInVoidTick(s, 'player', 'turnStart')) === handSize(s);

    let s2 = board();
    s2.player.deck = [{ id: 'c1' }, { id: 'c2' }];
    s2.player.void = [{ id: 'later', name: 'Later', inVoid: { ...blk(), trigger: 'turnEnd' } }];
    o.ctrlWrongTrigger = handSize(_applyInVoidTick(s2, 'player', 'turnStart')) === handSize(s2);

    /* 🔴 THE ONE THAT PROVES THE PILE IS READ. A card carrying only `inGrave`,
       sitting in the VOID, must stay silent — if it fired, the tick would be
       reading the card's blocks rather than the pile it was asked to walk, and
       every banished card in the game would start acting like a buried one. */
    let s3 = board();
    s3.player.deck = [{ id: 'c1' }, { id: 'c2' }];
    s3.player.void = [{ id: 'grv', name: 'GraveOnly', inGrave: blk() }];
    o.ctrlWrongPile = handSize(_applyInVoidTick(s3, 'player', 'turnStart')) === handSize(s3);
  }
  // 5 · the removal commit writes back to the pile it walked
  {
    let s = board();
    s.player.void = [{ id: 'ret', name: 'Returner', inVoid: { ...blk(), effect: 'selfReturn' } }];
    const after = _applyInVoidTick(s, 'player', 'turnStart');
    o.voidReturnLeftPile = ((after.player.void) || []).length === 0;
    o.voidReturnToHand = ((after.player.hand) || []).length === 1;
    o.graveUntouched = ((after.player.graveyard) || []).length === 0;
  }
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('the zone tick is not in this build');
else {
  need('a card in the VOID fires on the turn beat', out.voidFired === true);
  need('a card in the GRAVEYARD still fires', out.graveFired === true);
  need('`both` fires from each pile once', out.bothFired === 2, out.bothFired);
  need('CONTROL: no block, no fire', out.ctrlNoBlock === true);
  need('CONTROL: wrong trigger, no fire', out.ctrlWrongTrigger === true);
  need('CONTROL: a grave-only card in the Void stays silent', out.ctrlWrongPile === true);
  need('selfReturn leaves the VOID pile', out.voidReturnLeftPile === true);
  need('…and lands in hand', out.voidReturnToHand === true);
  need('…without touching the graveyard', out.graveUntouched === true);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — both piles tick, each reads its own block, and nothing fires that should not.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
