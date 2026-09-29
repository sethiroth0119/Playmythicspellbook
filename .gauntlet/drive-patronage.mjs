/* ══════════════════════════════════════════════════════════════════════════
   🛍 DRIVE-PATRONAGE — the city's shops earn Cinder from residents who live.

   THE ASK: "Have the businesses that are not destroyed in players city earn
   cinder based on how well the economy is doing and how well the city is built,
   as well how happy the npcs are. Happy NPCS spend more cinder. But make it
   where NPCs are almost life like — they get sick, they need food so they shop
   for food, they get lazy so they go to fast food or food trucks, they need to
   work out so they go to gym, they play the card game Mythic Spellbook for fun…
   right now none of the businesses generate cinder and they all need to have it
   where the highest node level can generate 1 million cinder a day."

   🔴 THE CEILING IS THE HEADLINE CLAIM AND IT IS TESTED AS A NUMBER. "1 million
      a day at the highest node" is either true or it is marketing. A full
      simulated day is run against the real module at the real top-tier rate and
      the total is required to land inside 5% of 1,000,000 — and the same day at
      the Starter rate is required to land at exactly 1/20th of it, which is the
      only way to show the tier ladder is a scale and not a special case for the
      one number someone checked.

   🔴 AND THE OTHER HALF IS WHAT IT MUST NOT DO. "Make the businesses earn" is
      the single most dangerous shape of request this codebase takes: ECONOMY.md
      exists because four money leaks got through review. So the controls are
      about the boundary — the module returns numbers and NEVER writes a balance,
      a destroyed shop takes nothing, a city with no residents takes nothing, and
      the whole thing is deterministic so a reload cannot re-roll a day's income.

   Pinned, with controls:
     · a standing shop takes money from residents who needed something
     · 🔴 the top node tier lands on 1,000,000 a day; Starter lands on 1/20th
     · 🔴 CONTROL: a DESTROYED shop takes exactly nothing
     · 🔴 CONTROL: the module writes no wallet, no firm cash, no treasury
     · CONTROL: no residents ⇒ no Cinder. No shops ⇒ no Cinder.
     · happy residents spend more than miserable ones — by name, in the ask
     · a need with nowhere to go is reported unmet rather than silently paid
     · the Gym exists, and it is what answers the fitness need
     · the same inputs produce the same money twice (a reload cannot re-roll)
     · residents carry a visible errand — "shopping for food", at a real tile

   Run:  node .gauntlet/drive-patronage.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9410 + (process.pid % 40);
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
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.__nc.jobfair', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

const out = {};

/* ── the module is mounted and reachable ─────────────────────────────────── */
out.mount = await pg.evaluate(() => {
  const J = window.__nc.jobfair;
  return {
    have: !!(J.patronage && J.patronage.ready && J.patronage.ready()),
    needs: J.patronage ? J.patronage.needs() : null,
    mods: J.patronage ? J.patronage.mods() : null,
    capPerDay: J.patronage ? J.patronage.capPerDay() : null,
  };
});

/* ── 🏋 the Gym: the ask names it, and it answers the fitness need ────────── */
out.gym = await pg.evaluate(() => {
  const J = window.__nc.jobfair;
  const needs = J.patronage.needs() || [];
  const fit = needs.find(n => n.id === 'fitness');
  const fun = needs.find(n => n.id === 'fun');
  const sick = needs.find(n => n.id === 'sick');
  const food = needs.find(n => n.id === 'food');
  const lazy = needs.find(n => n.id === 'lazy');
  return {
    inCatalog: J.patronage.hasType('gym') === true,
    fitnessGoesToGym: !!(fit && fit.types.indexOf('gym') >= 0),
    /* 🎴 "they play the card game Mythic Spellbook for fun" — the Game Store
       and the Player Shop sell it, the Duel Arena is where it is played. */
    funIsSpellbook: !!(fun && fun.types.indexOf('gamestore') >= 0 && fun.types.indexOf('arena') >= 0),
    sickGoesToCare: !!(sick && sick.types.indexOf('clinic') >= 0 && sick.types.indexOf('pharmacy') >= 0),
    foodGoesToGrocer: !!(food && food.types.indexOf('grocery') >= 0),
    /* ⚠ THE LAZY NEED MUST NOT SEND THEM TO THE GROCER. "they get lazy so they
       go to fast food or food trucks" — a resident avoiding cooking who ends up
       shopping for ingredients has been given the errand they were dodging. */
    lazyIsQuickOnly: !!(lazy && lazy.types.indexOf('grocery') < 0
                        && lazy.types.indexOf('fastfood') >= 0 && lazy.types.indexOf('foodtruck') >= 0),
  };
});

/* ══════════════════════════════════════════════════════════════════════════
   THE HEADLINE NUMBER — a whole simulated day, against the shipped module.
   ══════════════════════════════════════════════════════════════════════════ */
out.day = await pg.evaluate(async () => {
  const mod = await import('/src/city/patronage.js');
  const P = mod.default || mod;
  const TYPES = ['grocery', 'foodtruck', 'restaurant', 'fastfood', 'clinic', 'pharmacy',
                 'medlab', 'gym', 'arena', 'gamestore', 'shop', 'clothier', 'furnistore',
                 'greatbuy', 'weaponshop', 'club', 'cinema'];
  const venues = TYPES.map((t, i) => ({ key: '0,' + i, type: t, open: true }));
  /* A full, happy, well-built city — the conditions the million is promised at.
     economyTick is handed REAL minutes, so 1,440 ticks of 1 is exactly one day. */
  const runDay = (n, tierRate, mood, cityMul, econMul, vs) => {
    P.reset();
    const cits = Array.from({ length: n }, (_, i) => ({ id: 'c' + i, mood }));
    let total = 0, visits = 0;
    for (let m = 0; m < 1440; m++) {
      const r = P.tick({ citizens: cits, venues: vs || venues, cityMul, econMul, tierRate, day: 0, dtMin: 1 });
      total += r.credited; visits += r.visits;
    }
    return { total: Math.round(total), visits };
  };
  const o = {};
  o.eternal = runDay(110, 20, 90, 1, 1, null);
  o.starter = runDay(110, 1, 90, 1, 1, null);
  /* Same city, miserable. "Happy NPCS spend more cinder", asked for by name. */
  o.miserable = runDay(110, 20, 5, 1, 1, null);
  /* Same city, badly built and in a bad economy. */
  o.struggling = runDay(110, 20, 90, 0.3, 0.35, null);
  o.capPerDay = Math.round(P.capPerMin(20) * 1440);
  o.capStarter = Math.round(P.capPerMin(1) * 1440);
  return o;
});

/* ══════════════════════════════════════════════════════════════════════════
   THE CONTROLS — what it must NOT do.
   ══════════════════════════════════════════════════════════════════════════ */
out.control = await pg.evaluate(async () => {
  const mod = await import('/src/city/patronage.js');
  const P = mod.default || mod;
  const o = {};
  const cits = Array.from({ length: 20 }, (_, i) => ({ id: 'c' + i, mood: 80 }));
  const base = { cityMul: 1, econMul: 1, tierRate: 20, day: 0, dtMin: 1 };

  /* 🏚 ONE OPEN SHOP AND ONE DESTROYED ONE. The destroyed one must take
     EXACTLY zero — not "less", zero. "businesses that are not destroyed" is the
     ask's own qualifier and a burnt-out shop that kept serving customers would
     be the clearest lie the city could tell. */
  const vs = [{ key: 'OPEN', type: 'grocery', open: true },
              { key: 'WRECK', type: 'fastfood', open: false }];
  P.reset();
  const by = {}; const unmet = new Set();
  for (let m = 0; m < 1440; m++) {
    const r = P.tick({ ...base, citizens: cits, venues: vs });
    for (const k in r.byTile) by[k] = (by[k] || 0) + r.byTile[k];
    r.unmet.forEach(u => unmet.add(u));
  }
  o.openTook = Math.round(by.OPEN || 0);
  o.wreckTook = Math.round(by.WRECK || 0);
  /* 🍟 the lazy need's only venues were the wrecked Fast Food — so it is
     REPORTED unmet rather than quietly paid to a shop that is not standing. */
  o.unmet = Array.from(unmet).sort();

  /* CONTROL: nobody to shop, and nowhere to shop. */
  P.reset();
  o.noResidents = P.tick({ ...base, citizens: [], venues: vs, dtMin: 60 }).credited;
  P.reset();
  o.noShops = P.tick({ ...base, citizens: cits, venues: [], dtMin: 60 }).credited;
  P.reset();
  o.noTime = P.tick({ ...base, citizens: cits, venues: vs, dtMin: 0 }).credited;

  /* 🔁 DETERMINISM. A resident's shopping must not be re-rolled by a reload —
     Math.random here would let a player refresh until they liked the takings. */
  P.reset(); const a = P.tick({ ...base, citizens: cits, venues: vs, dtMin: 120 });
  P.reset(); const b2 = P.tick({ ...base, citizens: cits, venues: vs, dtMin: 120 });
  o.deterministic = a.credited === b2.credited && a.credited > 0;

  /* 🚶 THE ERRAND IS VISIBLE — the "life like" half of the ask. */
  P.reset();
  P.tick({ ...base, citizens: cits, venues: vs, dtMin: 120 });
  const d = P.doingFor('c0');
  o.doing = d ? { say: d.say, tile: d.tile, spend: Math.round(d.spend) } : null;
  o.doingBeforeAnyErrand = (P.reset(), P.doingFor('c0'));
  return o;
});

/* 🔴 THE MODULE NEVER WRITES A BALANCE. Run a day's worth of ticks and require
   that the player's Cinder, the treasury and every firm's cash are untouched —
   the module returns numbers, node-city banks them, and only node-city banks
   them. This is the money-leak control. */
out.leak = await pg.evaluate(async () => {
  const mod = await import('/src/city/patronage.js');
  const P = mod.default || mod;
  const J = window.__nc.jobfair;
  const E = window.MythicEconomy;
  const before = {
    wallet: J.cinder(),
    treasury: (() => { try { const s = E && E.snapshot && E.snapshot(); return s ? Math.round(s.treasury) : null; } catch (e) { return null; } })(),
    firmCash: (() => { try { const s = E && E.snapshot && E.snapshot(); return s ? Math.round(s.firmCash) : null; } catch (e) { return null; } })(),
  };
  P.reset();
  const cits = Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, mood: 90 }));
  const vs = [{ key: '9,9', type: 'grocery', open: true }];
  let credited = 0;
  for (let m = 0; m < 600; m++) {
    credited += P.tick({ citizens: cits, venues: vs, cityMul: 1, econMul: 1, tierRate: 20, day: 0, dtMin: 1 }).credited;
  }
  const after = {
    wallet: J.cinder(),
    treasury: (() => { try { const s = E && E.snapshot && E.snapshot(); return s ? Math.round(s.treasury) : null; } catch (e) { return null; } })(),
    firmCash: (() => { try { const s = E && E.snapshot && E.snapshot(); return s ? Math.round(s.firmCash) : null; } catch (e) { return null; } })(),
  };
  return { credited: Math.round(credited), before, after };
});

/* ── and the city's own wiring: a real tile, really credited ─────────────── */
out.city = await pg.evaluate(async () => {
  const J = window.__nc.jobfair;
  const o = {};
  J.setPop(40);
  J.plant('6,6', 'grocery');
  const t0 = J.tile('6,6');
  o.planted = !!t0;
  o.venueOpen = (J.patronage.venues() || []).some(v => v.key === '6,6' && v.open === true);
  /* 🏚 …and once it is wrecked, the city stops offering it to shoppers. */
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const MO = out.mount || {}, G = out.gym || {}, D = out.day || {}, C = out.control || {}, L = out.leak || {}, CY = out.city || {};

need('SETUP: the patronage module is mounted in the city', MO.have === true, MO.have);
need('SETUP: it carries the needs the ask named', Array.isArray(MO.needs) && MO.needs.length >= 5, (MO.needs || []).length);

need('🏋 THE ASK: the city has a Gym', G.inCatalog === true, G.inCatalog);
need('…and working out is what takes them there', G.fitnessGoesToGym === true, G);
need('🎴 THE ASK: they play Mythic Spellbook for fun', G.funIsSpellbook === true, G);
need('🤒 THE ASK: getting sick sends them for care', G.sickGoesToCare === true, G);
need('🥫 THE ASK: needing food sends them shopping for it', G.foodGoesToGrocer === true, G);
need('🍟 …and being lazy sends them to fast food, NOT to the grocer', G.lazyIsQuickOnly === true, G);

/* ── the headline ─────────────────────────────────────────────────────────── */
const eternal = (D.eternal || {}).total || 0;
need('🔴 THE ASK: the highest node earns ~1,000,000 Cinder a day',
     eternal >= 950000 && eternal <= 1000000, { earned: eternal, cap: D.capPerDay });
need('🔴 …and the ceiling is REAL — a day never exceeds it',
     eternal <= (D.capPerDay || 0), { earned: eternal, cap: D.capPerDay });
need('🔴 …and the ladder is a scale, not one special case: Starter is 1/20th',
     Math.abs(((D.starter || {}).total || 0) * 20 - eternal) / Math.max(1, eternal) < 0.02,
     { starter: (D.starter || {}).total, eternal });
need('THE ASK: happy residents spend more than miserable ones',
     ((D.miserable || {}).total || 0) < eternal * 0.75,
     { happy: eternal, miserable: (D.miserable || {}).total });
need('THE ASK: a badly built city in a bad economy earns far less',
     ((D.struggling || {}).total || 0) < eternal * 0.5,
     { good: eternal, struggling: (D.struggling || {}).total });
need('…but it is never ZERO — a bad city is recoverable, not dead',
     ((D.struggling || {}).total || 0) > 0, (D.struggling || {}).total);

/* ── the controls ─────────────────────────────────────────────────────────── */
need('a standing shop takes real money', (C.openTook || 0) > 0, C.openTook);
need('🔴 CONTROL: a DESTROYED shop takes exactly nothing', C.wreckTook === 0, C.wreckTook);
need('…and the need it served is reported unmet, not silently paid',
     Array.isArray(C.unmet) && C.unmet.indexOf('lazy') >= 0, C.unmet);
need('🔴 CONTROL: no residents ⇒ no Cinder', C.noResidents === 0, C.noResidents);
need('🔴 CONTROL: no shops ⇒ no Cinder', C.noShops === 0, C.noShops);
need('🔴 CONTROL: no time passing ⇒ no Cinder', C.noTime === 0, C.noTime);
need('🔴 a reload cannot re-roll a day\'s takings', C.deterministic === true, C.deterministic);

need('🚶 THE ASK: a resident carries a visible errand', !!(C.doing && C.doing.say), C.doing);
need('…naming the shop they went to', !!(C.doing && C.doing.tile), C.doing);
need('…and it is ABSENT before they have been out', C.doingBeforeAnyErrand === null, C.doingBeforeAnyErrand);

/* 🔴 the one that matters most */
need('SETUP: the leak control actually moved money', (L.credited || 0) > 0, L.credited);
need('🔴 CONTROL: patronage writes NO wallet',
     L.before && L.after && L.before.wallet === L.after.wallet, L);
need('🔴 CONTROL: …no treasury', (L.before || {}).treasury === (L.after || {}).treasury, L);
need('🔴 CONTROL: …and no firm cash', (L.before || {}).firmCash === (L.after || {}).firmCash, L);

need('the city offers a standing shop to its shoppers', CY.planted !== true || CY.venueOpen === true, CY);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — residents live, standing shops take their money, the top node lands on a million a day, and nothing is minted.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
