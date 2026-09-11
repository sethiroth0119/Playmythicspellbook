/* 🌾 v121v102 — the owner's 2026-09-10 afternoon list.

   1. Homestead: the tab bar sits at the TOP (it was under the bottom edge and
      the update toast); Animal Feed is ground from corn, bread and fruit once
      the Feed Mill stands; every building costs more (resources ×2, Cinder ×1.5).
   2. "Resources deducted, nothing listed / banked / contributed": the Reserve
      refunds a failed write through the unclamped _refundRes (addSalvage
      clamped it away on a full stash); the vault write proves it touched a
      row (a 0-row update reported success).
   3. The phone leaderboard says where YOU stand.

   Run: node _farmfeed_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const FARM = readFileSync('./public/src/farm/index.js', 'utf8').replace(/\r\n/g, '\n');
const HS = readFileSync('./public/src/phone/handset.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the farm ── */
ok(/feedMillRecipe: \{ inputs: \{ corn: 6, bread: 4, fruit: 4 \}, output: \{ animalFeed: 24 \} \},/.test(FARM), 'Animal Feed is ground from corn, bread and fruit');
ok(!/inputs: \{ food: 8, water: 6 \}/.test(FARM), 'the rations-and-water recipe is gone');
ok(/desc: 'Grinds corn, bread and fruit into Animal Feed\. Nothing on the farm eats without it\.',/.test(FARM), 'the Feed Mill card says so');
ok(/if \(!isReady\(s, 'feedmill'\)\) return \{ ok: false, why: has\(s, 'feedmill'\) \? 'the Feed Mill is still under construction' : 'build the Feed Mill first' \};/.test(FARM), 'the mill gate still stands — no feed until the Feed Mill is built');
for (const id of ['corn', 'bread', 'fruit']) ok(new RegExp("\\{ id: '" + id + "',\\s+name: ").test(SRC), id + ' is a ledger resource the farm bridge can read and spend');
ok(/\.farm-bar\{position:absolute;left:50%;top:10px;transform:translateX\(-50%\);/.test(FARM), 'the tab bar is at the top');
ok(!/\.farm-bar\{position:absolute;left:50%;bottom:10px;/.test(FARM), '…and no longer at the bottom');
ok(/@media \(max-width:760px\)\{\.farm-panel\{left:0;right:0;top:auto;bottom:0;[^}]*\}\.farm-bar\{top:4px;bottom:auto;gap:1px;padding:3px\}[^}]*\}[^}]*\}\.farm-hud\{top:64px;left:6px\}/.test(FARM), 'on a phone the bar is at the top and the HUD sits under it; the panel uses the bottom the bar left');
{
  const block = FARM.slice(FARM.indexOf('const FARM_BUILDINGS = ['), FARM.indexOf('\n];', FARM.indexOf('const FARM_BUILDINGS = [')) + 3);
  const rows = [...block.matchAll(/\{ cinder: (\d+)((?:, [a-zA-Z]+: \d+)*) \}/g)];
  ok(rows.length >= 30, 'every building level has a cost row', rows.length);
  const mill = block.slice(block.indexOf("id: 'feedmill'"), block.indexOf("id: 'coop'"));
  ok(/\{ cinder: 33000, wood: 60, stone: 40, water: 20 \}/.test(mill) && /\{ cinder: 90000, wood: 140, stone: 90, metal: 40 \}/.test(mill) && /\{ cinder: 225000, wood: 300, stone: 200, metal: 120 \}/.test(mill), 'Feed Mill: 22,000/30/20/10 → 33,000/60/40/20 (Cinder ×1.5, resources ×2), and so on up the levels');
  const barn = block.slice(block.indexOf("id: 'barn'"), block.indexOf("id: 'sty'"));
  ok(/\{ cinder: 135000, wood: 240, stone: 120, metal: 60 \}/.test(barn), 'Cattle Barn L1: 90,000/120/60/30 → 135,000/240/120/60');
  ok(rows.every((r) => Number(r[1]) % 500 === 0), 'no fractional Cinder from the ×1.5');
}
ok(/src\/farm\/index\.js\?v=v121v1[0-9][0-9]farm[2-9]/.test(SRC), 'the farm module buster moved (farm2 or later), so every player gets the new recipe and costs');

/* ── 2. the unwind paths ── */
ok(/try \{ if \(typeof _refundRes === 'function'\) _refundRes\(resId, qty\); else addSalvage\(\{ \[resId\]: qty \}\); \} catch \(_\) \{\}\n\s*try \{ if \(typeof _persistResourcesSoon === 'function'\) _persistResourcesSoon\(\); \} catch \(_\) \{\}\n\s*_frErr\(e\);/.test(SRC), 'a failed Reserve contribution refunds through the UNCLAMPED _refundRes and persists');
ok(!/try \{ addSalvage\(\{ \[resId\]: qty \}\); \} catch \(_\) \{\}\n\s*_frErr\(e\);/.test(SRC), 'the clamped addSalvage refund is gone from that path');
ok(/const q = t\.update\(\{ resources: next, updated_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('user_id', uid\);\n\s*const up = await \(\(q && typeof q\.select === 'function'\) \? q\.select\('user_id'\) : q\);\n\s*if \(up && up\.error\) throw up\.error;\n\s*if \(up && Array\.isArray\(up\.data\) && up\.data\.length === 0\) throw new Error\('bank row not written'\);/.test(SRC), 'the vault write selects the row it touched and a 0-row update is a failure (so the deposit unwinds and refunds); a client without .select (the gauntlet fakes) is left alone');
{
  /* run the vault seam's write step against fakes: 0 rows → throws, 1 row → ok */
  const body = SRC.slice(SRC.indexOf('async function _boeResTx(mutate, opts) {'), SRC.indexOf('\n}\n', SRC.indexOf('async function _boeResTx(mutate, opts) {')) + 3);
  const mk = (rowsBack) => {
    const g = { _boeResChain: Promise.resolve(), _boeResEpoch: 1, BankEthos: { resources: { ore: 1 } }, Profile: { cloud: { userId: 'u1' } },
      _boeRow: async () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: rowsBack, error: null }) }) }) }),
      _boeResCommit: () => {}, _boeResReset: () => {}, console: { warn: () => {} } };
    const fn = new Function('g', 'with (g) { ' + body + ' return _boeResTx; }')(g);
    return fn((n) => { n.ore = 5; return n; });
  };
  const bad = await mk([]);
  ok(bad && bad.ok === false && bad.error && /bank row not written/.test(String(bad.error.message || bad.error)), 'run for real: a write that touched no row comes back ok:false', JSON.stringify(bad && { ok: bad.ok, err: String(bad.error) }));
  const good = await mk([{ user_id: 'u1' }]);
  ok(good && good.ok === true, 'a write that touched the row is ok:true', JSON.stringify(good && { ok: good.ok, err: String(good.error) }));
}

/* ── 3. the phone leaderboard ── */
ok(/const myIdx = me \? rows\.findIndex\(\(r\) => String\(r\.owner_id \|\| r\.user_id \|\| ''\) === String\(me\)\) : -1;/.test(HS) && /You are <strong>#' \+ \(myIdx \+ 1\) \+ '<\/strong> of the ' \+ rows\.length \+ ' ranked/.test(HS) && /You are not in the top ' \+ rows\.length \+ ' on this board yet\./.test(HS) && /Sign in to see where you stand\./.test(HS), 'the board says your place, or that you are not in the top yet, or to sign in');

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 102, 'BUILD_VERSION is v121v102 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
