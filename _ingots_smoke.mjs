/* 🧱 INGOTS ARE A REAL RESOURCE NOW (v121v70).

   Reported: "the ingot resource is not being shown, my players are saying they
   are getting it but it is not showing up in any vault." Both halves were true.
   A Smelting Works really does make ingots — and they went to CITY_STOCK, which
   is city furniture, not the player's ledger, so no vault could ever show them.

   The promotion has to move THREE things together or a player's ingots reset
   every session, and this suite is what holds them together:

     · index.html's RESOURCES gains the row (which is what RESOURCE_IDS,
       _ensureResources, the market guard and the cost renderers all derive
       from);
     · node-city DROPS it from CITY_STOCK, so the production branch that
       diverts stock ids stops catching it and it banks to the ledger instead;
     · and the stock a city ALREADY holds is migrated, because STOCK_KEYS no
       longer names it — serialize() would not write it back and it would
       simply be gone. Measured on the live database before shipping: 2 cities
       holding 2,934 between them, the biggest pile 2,608.

   Run: node _ingots_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC  = readFileSync('./public/node-city/index.html', 'utf8');
const block = (src, start, end) => { const i = src.indexOf(start); return i < 0 ? '' : src.slice(i, src.indexOf(end, i)); };

/* ── site 1 ── */
{
  const res = block(SRC, 'const RESOURCES = [', '\n];');
  ok(/\{ id: 'ingots',\s+name: 'Ingots',\s+icon: '🧱'/.test(res), 'ingots is a row in RESOURCES');
  ok(!/id: 'stone',\s+name: 'Stone',\s+icon: '🧱'/.test(res), 'and it did NOT take stone\'s icon — the city HUD chose 🪨 for stone so 🧱 could stay ingots');
}
ok(/RESOURCE_IDS = RESOURCES\.map/.test(SRC), 'RESOURCE_IDS still derives from the list, so the market guard follows for free');

/* ── site 2 ── */
{
  const stock = block(NC, 'const CITY_STOCK = {', '\n};');
  ok(stock.length > 100, 'CITY_STOCK is still there for the other refined goods', String(stock.length));
  ok(!/\bingots:/.test(stock), 'but ingots has LEFT it — production now banks to the player ledger');
  ok(/\brations:/.test(stock) && /\bcomponents:/.test(stock) && /\bplanks:/.test(stock),
    'and nothing else was disturbed on the way out');
}
{
  /* CITY_STOCK was the only thing giving the HUD a name and an icon for it,
     and line ~19473 reads RES_META[r].ico UNGUARDED. */
  const meta = block(NC, 'const RES_META = {', '\n};');
  ok(/ingots:\s+\{ name: 'Ingots',\s+ico: '🧱' \}/.test(meta), 'RES_META names it, so a shortage warning cannot throw inside a render');
}
ok(/if \(CITY_STOCK\[r\]\) \{/.test(NC), 'the stock-diverting branch is intact for the goods that ARE still city stock');
ok(/function haveOf\(r\) \{ return CITY_STOCK\[r\] \? stockOf\(r\) : \(game\.res\[r\] \| 0\); \}/.test(NC),
  'and consumers now read ingots from the ledger mirror, because that is where it lives');

/* ── site 3: the migration ── */
{
  const i = NC.indexOf('THE INGOT MIGRATION');
  ok(i > 0, 'the migration exists');
  const seg = NC.slice(i, i + 1200);
  ok(/const _oldIngots = Math\.floor\(\+\(s\.stock && s\.stock\.ingots\) \|\| 0\);/.test(seg), 'it reads the pile out of the OLD save shape');
  ok(/await MythicCityBridge\.addRes\('ingots', _oldIngots\)/.test(seg), 'and hands it to the ledger it now belongs in');
  ok(/s\.stock\.ingots = 0;/.test(seg) && /delete game\.stock\.ingots;/.test(seg), 'clearing the key so it runs exactly once');
  ok(/if \(_oldIngots > 0\)/.test(seg), 'a city with none does nothing at all');
  ok(/toast\(/.test(seg), 'and the player is told where their ingots went');
  /* It must run BEFORE the STOCK_KEYS loop: that loop no longer names ingots,
     so anything left to it is dropped. */
  const iLoop = NC.indexOf('for (const r of STOCK_KEYS) {', i);
  ok(iLoop > i && (iLoop - i) < 1400, 'and it runs BEFORE the STOCK_KEYS restore, which no longer names ingots');
}
ok(/2,934/.test(NC) || /2934/.test(NC), 'the measured live figure is recorded next to the migration');

/* ── the claim the old comment made, corrected ── */
ok(/__salvage__:\s+\(Profile\.salvage && typeof Profile\.salvage === 'object'\) \? Profile\.salvage : \{\}/.test(SRC),
  'Profile.salvage uploads WHOLE — there is no per-id cloud whitelist to add ingots to');
ok(/there is no per-id\n\s+whitelist to add to/.test(SRC), 'and the promotion note says so rather than repeating the stale claim');
ok(/window\.BUILD_VERSION = 'v121v(7[0-9]|[8-9]\d|\d{3,})'/.test(SRC), 'build v121v70 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
