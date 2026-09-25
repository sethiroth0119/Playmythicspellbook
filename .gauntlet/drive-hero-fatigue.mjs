/* ══════════════════════════════════════════════════════════════════════════
   😴 DRIVE-HERO-FATIGUE — tired heroes, injured heroes, and a night's sleep.

   THE ASK, three parts:
     1. "every battle heroes get tired"
     2. "when they are fatigued and battle again they get an injured debuff and
        take double damage from all things"
     3. "the rest go up over time, within 24 hours being full reset depending
        on how tired they are"

   WHAT WAS THERE. Fatigue was collected and never spent. spendHeroEnergy added
   it on every battle, and the ONLY ways down were a meal (−10), the Med-bay, a
   Cinder restore or a bed — nothing on a clock. Meanwhile the battle POOL
   refilled +5 every five minutes, and the panel's "✓ Fully Rested" was computed
   from the pool ALONE. That is the screenshot in the report: Lyra at 40/40
   battles, Fatigue 100/100, and a green ✓ Fully Rested underneath it. Nothing
   in the game read the fatigue number at all, so the bar was decoration.

   WHAT IT DOES NOW:
     · fatigue bleeds off in real time — 100 → 0 in 24 h, so half as tired is
       half as long. Settled on read, like the pool, so it works while closed.
     · deploying at ≥80 stamps Injured: DOUBLE damage from every source, applied
       in applyDamageTriggers — the one function combat, spells, traps and DoT
       all pass through.
     · the panel says which heroes will fight hurt, and when they will not.

   Pinned, with controls, because a debuff that never fires and one that always
   fires are the same screenshot:
     · a battle raises fatigue          + CONTROL: it is proportional, not flat
     · 24 h clears a full bar           + CONTROL: 12 h clears half of one
     · ≥80 deploys Injured              + CONTROL: 79 does not
     · Injured doubles a hit            + CONTROL: the same hit undoubled
     · Injured doubles a POISON TICK    ← "from all things", not just attacks
     · CONTROL: it is doubled ONCE, not ×4 through two code paths
     · CONTROL: the enemy hero is never injured by the player's fatigue

   Run:  node .gauntlet/drive-hero-fatigue.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8800 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof getHeroEnergy === "function" && typeof applyDamageTriggers === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof getHeroEnergy === 'function' && typeof applyDamageTriggers === 'function'
             && typeof isHeroFatigued === 'function' && typeof spendHeroEnergy === 'function';
  if (!o.reachable) return o;
  window.saveProfile = () => {};
  const HID = 'probe-hero';
  Profile.heroes = Profile.heroes || {};
  Profile.heroes[HID] = { level: 1 };                 // cap 20 → 5 fatigue a battle
  const reset = (fatigue, agoMs) => {
    Profile.heroEnergy = Profile.heroEnergy || {};
    Profile.heroEnergy[HID] = { energy: 20, fatigue: fatigue, stress: 0,
      lastRestAt: Date.now(), lastFatigueAt: Date.now() - (agoMs || 0) };
    return Profile.heroEnergy[HID];
  };

  // ── 1 · every battle tires them ────────────────────────────────────────
  reset(0, 0);
  const f0 = getHeroEnergy(HID).fatigue | 0;
  spendHeroEnergy(HID, 1);
  o.afterOneBattle = getHeroEnergy(HID).fatigue | 0;
  spendHeroEnergy(HID, 1);
  o.afterTwoBattles = getHeroEnergy(HID).fatigue | 0;
  o.startedAtZero = f0 === 0;
  /* CONTROL: the gain is scaled to the hero's POOL, not a flat number — a
     level 11 hero with 40 slots must not hit the injured line in the same
     number of fights as a level 1 with 20. */
  Profile.heroes[HID] = { level: 11 };
  reset(0, 0); spendHeroEnergy(HID, 1);
  o.lv11AfterOneBattle = getHeroEnergy(HID).fatigue | 0;
  Profile.heroes[HID] = { level: 1 };

  // ── 2 · a night's sleep ────────────────────────────────────────────────
  const H = 60 * 60 * 1000;
  reset(100, 24 * H); o.full_after24h = getHeroEnergy(HID).fatigue | 0;   // 0
  reset(100, 12 * H); o.full_after12h = getHeroEnergy(HID).fatigue | 0;   // ~50
  reset(50, 12 * H);  o.half_after12h = getHeroEnergy(HID).fatigue | 0;   // 0
  reset(100, 1 * H);  o.full_after1h  = getHeroEnergy(HID).fatigue | 0;   // ~96
  // CONTROL: a clock dragged backwards must not mint rest, or stall recovery.
  reset(100, -6 * H); o.clockBackward = getHeroEnergy(HID).fatigue | 0;   // still 100
  // CONTROL: it stops at zero and does not run negative.
  reset(10, 48 * H);  o.overshoot = getHeroEnergy(HID).fatigue | 0;       // 0

  // ── 3 · the line ───────────────────────────────────────────────────────
  reset(80, 0);  o.at80 = isHeroFatigued(HID);        // true
  reset(79, 0);  o.at79 = isHeroFatigued(HID);        // CONTROL: false
  reset(100, 0); o.safeMs = getHeroSafeRestMs(HID);   // >0
  reset(100, 0); o.restMs = getHeroFatigueRestMs(HID);
  reset(0, 0);   o.restMsWhenFresh = getHeroFatigueRestMs(HID);   // CONTROL: 0

  // ── 4 · double damage, from a hit AND from a poison tick ───────────────
  const mkHero = (injured) => ({ id: 'u1', name: 'Probe', owner: 'player', isHero: true,
    currentHp: 200, maxHp: 200, alive: true, statusEffects: [], _injured: !!injured });
  const hpAfter = (unit, dmg, type) => {
    const r = applyDamageTriggers(unit, dmg, type || 'physical');
    return (r && r.unit) ? (r.unit.currentHp | 0) : null;
  };
  o.hurtNormal  = 200 - hpAfter(mkHero(false), 30);          // CONTROL: 30
  o.hurtInjured = 200 - hpAfter(mkHero(true), 30);           // 60
  o.dotNormal   = 200 - hpAfter(mkHero(false), 9, 'status'); // CONTROL: 9
  o.dotInjured  = 200 - hpAfter(mkHero(true), 9, 'status');  // 18 — "all things"

  /* CONTROL: ONCE, NOT TWICE. calculateDamage carries its own damageTakenMult
     loop; if Injured were counted there as well, an attack would land at ×4
     while a poison tick stayed at ×2. This drives the real calculateDamage on a
     unit wearing the real status pill and checks the attack path agrees with
     the tick path. */
  try {
    const atk = { id: 'a', name: 'Foe', owner: 'ai', isHero: false, currentHp: 100, maxHp: 100,
      alive: true, statusEffects: [], stats: { atk: 20, def: 5, mag: 5, res: 5, spd: 5, hp: 100 },
      elements: ['neutral'], pos: { x: 0, y: 0 }, level: 1 };
    const defBase = { id: 'd', name: 'Probe', owner: 'player', isHero: true, currentHp: 200, maxHp: 200,
      alive: true, stats: { atk: 10, def: 10, mag: 5, res: 5, spd: 5, hp: 200 },
      elements: ['neutral'], pos: { x: 1, y: 0 }, level: 1 };
    const move = { name: 'Test', power: 40, type: 'physical', element: 'neutral', range: 1, accuracy: 100 };
    const clean = calculateDamage(move, atk, { ...defBase, statusEffects: [] }, null, { noCrit: true, ev: true });
    const pill  = calculateDamage(move, atk, { ...defBase, statusEffects: [{ type: 'injured', turnsLeft: 999 }] }, null, { noCrit: true, ev: true });
    o.calcClean = clean && clean.damage;
    o.calcWithPill = pill && pill.damage;
    o.pillIsInert = (clean && pill) ? (clean.damage === pill.damage) : null;   // must be TRUE
  } catch (e) { o.calcErr = String(e).slice(0, 160); }

  // ── 5 · CONTROL: the enemy is not injured by MY tiredness ──────────────
  o.enemyNeverInjured = (() => {
    try {
      const foe = { id: 'e', name: 'Foe', owner: 'ai', isHero: true, currentHp: 200, maxHp: 200,
        alive: true, statusEffects: [] };                     // no _injured stamp
      return (200 - hpAfter(foe, 30)) === 30;
    } catch (e) { return 'err'; }
  })();
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const near = (v, want, tol) => typeof v === 'number' && Math.abs(v - want) <= (tol || 1);
if (!out.reachable) bad.push('the hero-energy / damage functions are not reachable');
else {
  need('ASK 1: a battle tires the hero', out.startedAtZero && out.afterOneBattle > 0, out.afterOneBattle);
  need('…and a second one tires them further', out.afterTwoBattles > out.afterOneBattle, [out.afterOneBattle, out.afterTwoBattles]);
  need('CONTROL: the gain scales to the hero\'s pool, not a flat number',
       out.lv11AfterOneBattle > 0 && out.lv11AfterOneBattle < out.afterOneBattle,
       { lv1: out.afterOneBattle, lv11: out.lv11AfterOneBattle });

  need('ASK 3: a full bar is clear after 24 h', out.full_after24h === 0, out.full_after24h);
  need('…half-way there after 12 h', near(out.full_after12h, 50, 2), out.full_after12h);
  need('CONTROL: half as tired takes half as long', out.half_after12h === 0, out.half_after12h);
  need('CONTROL: an hour is an hour, not a reset', near(out.full_after1h, 96, 2), out.full_after1h);
  need('CONTROL: a backward clock neither mints rest nor stalls it', out.clockBackward === 100, out.clockBackward);
  need('CONTROL: recovery stops at zero', out.overshoot === 0, out.overshoot);

  need('ASK 2: at 80 fatigue the hero deploys injured', out.at80 === true, out.at80);
  need('CONTROL: at 79 they do not', out.at79 === false, out.at79);
  need('the panel can say when they are safe again', (out.safeMs | 0) > 0, out.safeMs);
  need('…and when they are fully rested', near(out.restMs, 24 * 3600 * 1000, 60000), out.restMs);
  need('CONTROL: a fresh hero needs no rest at all', out.restMsWhenFresh === 0, out.restMsWhenFresh);

  need('CONTROL: an ordinary hit lands for what it says', out.hurtNormal === 30, out.hurtNormal);
  need('ASK 2: an injured hero takes DOUBLE from a hit', out.hurtInjured === 60, out.hurtInjured);
  need('CONTROL: an ordinary poison tick is undoubled', out.dotNormal === 9, out.dotNormal);
  need('"FROM ALL THINGS": a poison tick doubles too', out.dotInjured === 18, out.dotInjured);
  need('CONTROL: doubled ONCE — the status pill is inert in calculateDamage',
       out.pillIsInert === true, { clean: out.calcClean, withPill: out.calcWithPill, err: out.calcErr });
  need('CONTROL: the enemy is never injured by the player\'s fatigue', out.enemyNeverInjured === true, out.enemyNeverInjured);
  need('no page errors', errs.length === 0, errs.slice(0, 3));
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — battles tire, tired heroes fight injured, and a day\'s rest clears it.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
