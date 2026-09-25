/* ══════════════════════════════════════════════════════════════════════════
   🔀 DRIVE-SHUFFLEZONES — the effect that emptied hands and graveyards

   The report: "sometimes the game discards all the cards from a player's hand
   or removes their graveyard from a card effect, and it is not supposed to. It
   randomly does it."

   It is not random. shuffleToDeck reads eff.shuffleZones to decide which zones
   it sweeps. The ENGINE default was fixed to 'grave' in v121f4 — but the card
   EDITOR kept writing `shuffleZones: v(...) || 'all'` for EVERY effect type, so
   an explicit 'all' was baked into the card and beat the safe default. Measured
   in the live database: 391 authored cards carried it.

   Whether a given card wiped hands therefore depended on its EDIT HISTORY,
   which is invisible from the card table. That is the randomness.

   Three things must hold, and each has a control that fails without the fix:
     A. the engine treats an ABSENT selector as 'grave' — never 'all'
     B. the editor no longer bakes 'all' into a card that cannot use it
     C. the sanitiser strips the dead knob but NEVER touches an authored one

   ⚠ C's control is Azathoth. Its rules text reads "shuffle all cards on the
     field…, graveyard, vanish, and hand in all players' hands and draw 5" — so
     its 'all' is REAL. A sanitiser that scored better by deleting it would be
     breaking a card, not fixing one.

   Run:  node .gauntlet/drive-shufflezones.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const SRC = fs.readFileSync('public/index.html', 'utf8');

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9750 + Math.floor(Math.random() * 200);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof applyOnPlayEffect === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

/* ── A. THE ENGINE ──────────────────────────────────────────────────────── */
const engine = await pg.evaluate(() => {
  const mkState = () => ({
    units: [{ id: 'h1', owner: 'player', isHero: true, alive: true, currentHp: 30, pos: { x: 1, y: 1 }, name: 'Hero' }],
    log: [],
    player: { hand: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }],
              graveyard: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }],
              void: [{ id: 'v1' }], deck: [{ id: 'd1' }], energy: 9, maxEnergy: 9 },
    ai: { hand: [{ id: 'a1' }], graveyard: [{ id: 'ag1' }], void: [], deck: [], energy: 9, maxEnergy: 9 },
  });
  const caster = { id: 'u1', owner: 'player', name: 'Test', alive: true, pos: { x: 1, y: 1 } };
  const run = (zones) => {
    const st = mkState();
    const card = { name: 'Test', onPlay: Object.assign({ type: 'shuffleToDeck' },
      zones === undefined ? {} : { shuffleZones: zones }) };
    let out = st;
    try { out = applyOnPlayEffect(st, caster, card) || st; } catch (e) { return { err: String(e.message || e).slice(0, 60) }; }
    return { hand: (out.player.hand || []).length, grave: (out.player.graveyard || []).length,
             vd: (out.player.void || []).length, deck: (out.player.deck || []).length };
  };
  return { absent: run(undefined), all: run('all'), grave: run('grave'), hand: run('hand') };
});

/* ── B. THE EDITOR ──────────────────────────────────────────────────────── */
const editor = {
  noLongerDefaultsAll: !/shuffleZones:\s*v\('ed-onplay-shufzones'\)\s*\|\|\s*'all'/.test(SRC),
  gatedOnEffect: /opType === 'shuffleToDeck' \? \(v\('ed-onplay-shufzones'\) \|\| 'grave'\) : undefined/.test(SRC),
  hydrateSafe: /onPlay\.shuffleZones \|\| 'grave'/.test(SRC),
  engineSafe: /const zones = eff\.shuffleZones \|\| 'grave'/.test(SRC),
  textSafe: /eff\.shuffleZones\|\|'grave'/.test(SRC),
};

/* ── C. THE SANITISER ───────────────────────────────────────────────────── */
const san = await pg.evaluate(() => {
  const before = Forge.customCards;
  Forge.customCards = [
    // dead knob on an effect that cannot read it → must be stripped
    { id: 'z1', name: 'Search Card',  onPlay: { type: 'searchDeck', shuffleZones: 'all' } },
    { id: 'z2', name: 'Damage Card',  onPlay: { type: 'damage',     shuffleZones: 'all' } },
    // 🔴 CONTROL — authored. Azathoth's rules text really does say "all".
    { id: 'z3', name: 'Azathoth',     onPlay: { type: 'shuffleToDeck', shuffleZones: 'all', shuffleSide: 'both' } },
    { id: 'z4', name: 'The Watcher',  onPlay: { type: 'shuffleToDeck', shuffleZones: 'grave' } },
    // on-grave slot is swept too
    { id: 'z5', name: 'Library',      onPlay: { type: 'searchDeck', shuffleZones: 'all' },
                                      onGrave: { type: 'summon', shuffleZones: 'all' } },
    // nothing to do — must not be corrupted
    { id: 'z6', name: 'Plain',        onPlay: { type: 'heal', amount: 3 } },
  ];
  const n = _sanitiseCardShuffleKnobs();
  const by = {}; Forge.customCards.forEach(c => { by[c.id] = c; });
  const out = {
    stripped: n,
    z1: 'shuffleZones' in by.z1.onPlay,
    z2: 'shuffleZones' in by.z2.onPlay,
    z3: by.z3.onPlay.shuffleZones,          // must survive
    z4: by.z4.onPlay.shuffleZones,          // must survive
    z5play: 'shuffleZones' in by.z5.onPlay,
    z5grave: 'shuffleZones' in by.z5.onGrave,
    z6amount: by.z6.onPlay.amount,
    count: Forge.customCards.length,
  };
  Forge.customCards = before;
  return out;
});

/* ── D. saveForge runs it ───────────────────────────────────────────────── */
const wired = /try \{ _sanitiseCardShuffleKnobs\(\); \} catch \(e\) \{\}/.test(SRC);

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F500} SHUFFLE-TO-DECK · WHY HANDS AND GRAVEYARDS VANISHED\n');
console.log('  start: hand 5 · grave 3 · void 1 · deck 1\n');

console.log('  ── A. the engine, driven through the real applyOnPlayEffect');
ok('\u{1F3AF} an ABSENT selector leaves the HAND alone',
  engine.absent.hand === 5, 'hand ' + engine.absent.hand + '/5');
ok('\u{1F3AF} …and sweeps only the graveyard', engine.absent.grave === 0 && engine.absent.vd === 1,
  'grave ' + engine.absent.grave + ' · void ' + engine.absent.vd);
ok('an explicit grave behaves the same', engine.grave.hand === 5 && engine.grave.grave === 0);
ok('\u{1F3AF} CONTROL · an explicit ALL still empties everything',
  engine.all.hand === 0 && engine.all.grave === 0 && engine.all.vd === 0,
  'hand ' + engine.all.hand + ' grave ' + engine.all.grave + ' void ' + engine.all.vd
  + '  — the destructive reading stays available when ASKED for');
ok('an explicit hand takes the hand and spares the grave',
  engine.hand.hand === 0 && engine.hand.grave === 3,
  'hand ' + engine.hand.hand + ' grave ' + engine.hand.grave);

console.log('\n  ── B. every default agrees on "grave"');
ok('\u{1F3AF} the editor no longer writes || \'all\'', editor.noLongerDefaultsAll);
ok('\u{1F3AF} …and only writes the key for shuffleToDeck at all', editor.gatedOnEffect);
ok('the hydrate defaults to grave', editor.hydrateSafe);
ok('the engine defaults to grave', editor.engineSafe);
ok('the card text says grave', editor.textSafe);

console.log('\n  ── C. the sanitiser, on real card shapes');
ok('\u{1F3AF} a dead knob on searchDeck is stripped', san.z1 === false);
ok('\u{1F3AF} a dead knob on damage is stripped', san.z2 === false);
ok('\u{1F3AF} …in the on-grave slot too', san.z5grave === false);
ok('\u{1F534} CONTROL · Azathoth’s AUTHORED \'all\' survives', san.z3 === 'all',
  String(san.z3) + '  — its rules text really does say all');
ok('\u{1F534} CONTROL · The Watcher’s authored \'grave\' survives', san.z4 === 'grave', String(san.z4));
ok('a card with nothing to clean is untouched', san.z6amount === 3);
ok('no card was added or dropped', san.count === 6, san.count + ' cards');
// z1, z2, z5.onPlay and z5.onGrave — the Library card carries a dead knob in
// BOTH slots, which is exactly the shape that made this bug hard to see.
ok('it reported what it did', san.stripped === 4, san.stripped + ' stripped');

console.log('\n  ── D. it is actually called');
ok('\u{1F3AF} saveForge runs the sanitiser', wired === true,
  'so the fix reaches a device the moment its owner does anything');

console.log('\npage errors: ' + errs.length); errs.slice(0, 3).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
