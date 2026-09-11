/* 🧾 v121v105 — the approved batch of 2026-09-10 (evening) + Classic Map removal.

   1. bug-mtvziq1a  reagents: inputs charged only when a building runs; a
                    scarce city stock is shared (0.9 × stock ÷ demand, carried
                    tick to tick) and scales draw AND output.
   2. bug-mtvzvnwt  Production Chain "Feeds" prints the whole list.
   3. bug-mtw1v5e2  Foundation Reserve: "Release node" frees a licence slot.
   4. bug-mtw1qg89 / bug-mtw1jo7k / bug-mtubctds  rations, planks, remedies
                    are game RESOURCES; the Warehouse card sends a pile to the
                    stash.
   5. bug-mtw1eyki  "Shut down corporation" for founders (sql/130).
   6. The roguelite map is the 3D Ascent map only.

   Run: node _batch1_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const APP = readFileSync('./public/corp/app.jsx', 'utf8').replace(/\r\n/g, '\n');
const PD = readFileSync('./public/src/city/production.data.js', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/130_corp_dissolve.sql', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. fair share ── */
ok(/const demandFull = \{\};\n[\s\S]{0,400}?const SR = \{\};\n\s*\{ const demandPrev = economyTick\._demandFull \|\| \{\};\n\s*for \(const r in demandPrev\) if \(CITY_STOCK\[r\]\) SR\[r\] = demandPrev\[r\] > 0 \? Math\.max\(0, Math\.min\(1, 0\.9 \* stockOf\(r\) \/ demandPrev\[r\]\)\) : 1; \}/.test(NC), 'the share is read off the shelf at the START of the tick against last tick\'s full demand');
ok(/let runOk = true, share = 1;\n\s*if \(def\.use\) for \(const u in def\.use\) \{\n\s*if \(haveOf\(u\) <= 0\) runOk = false;\n\s*if \(CITY_STOCK\[u\]\) \{ const sr = SR\[u\]; if \(sr != null && sr < share\) share = sr; \}\n\s*\}/.test(NC), 'a building\'s share is the scarcest of its city-stock inputs');
ok(/demandFull\[r\] = \(demandFull\[r\] \|\| 0\) \+ def\.use\[r\] \* mult \* omRes \* dtMin;\n\s*if \(!runOk\) continue;\n\s*spendNeeds\[r\] = \(spendNeeds\[r\] \|\| 0\) \+ def\.use\[r\] \* mult \* omRes \* share \* dtMin;/.test(NC), 'full demand is counted for everyone; the CHARGE only for buildings that run, at their share');
ok(/if \(def\.gen\) for \(const r in def\.gen\) \{\n\s*if \(!runOk\) continue;/.test(NC) && /const om = \(\(r === 'cinder'\) \? omCin : omRes\) \* share;/.test(NC) && /def\.gen\[r\] \* mult \* share \* pwAvail\(k\)/.test(NC), 'output (goods, Cinder and power) is scaled by the same share');
ok(/economyTick\._demandFull = demandFull;\n\s*economyTick\._spendFrac = economyTick\._spendFrac \|\| \{\};/.test(NC), 'this tick\'s full demand is kept for next tick\'s share, right before the spend');
ok(!/spendNeeds\[r\] = \(spendNeeds\[r\] \|\| 0\) \+ def\.use\[r\] \* mult \* omRes \* dtMin;/.test(NC), 'the unconditional full charge is gone');
{
  /* the share rule, run: 0.09/min supply against 0.63/min demand never reaches 0 and never over-charges */
  let stock = 0, demandPrev = null;
  const supply = 0.09, demand = 0.63, dt = 1;
  const runs = [];
  for (let tick = 0; tick < 40; tick++) {
    /* the shipped order: share off the shelf NOW against last tick's demand,
       then production is banked, then the (scaled) charge is taken */
    const share = demandPrev == null ? 1 : Math.max(0, Math.min(1, 0.9 * stock / demandPrev));
    const runOk = stock > 0;
    const charge = runOk ? demand * share * dt : 0;
    runs.push(runOk ? share : 0);
    stock += supply * dt;                           // production banked
    demandPrev = demand * dt;                       // full demand, counted whether or not it ran
    stock = Math.max(0, stock - charge);
  }
  const late = runs.slice(20);
  ok(stock > 0 && late.every((s) => s > 0), 'with demand 7× supply the shelf never hits 0 after warm-up and every consumer keeps running (at a share)', 'stock=' + stock.toFixed(3) + ' minShare=' + Math.min(...late).toFixed(3));
  ok(Math.abs(late.reduce((a, b) => a + b, 0) / late.length * demand - supply) < 0.02, 'the running share converges to supply ÷ demand — consumers use what the smelters make, no more', (late.reduce((a, b) => a + b, 0) / late.length * demand).toFixed(3));
}

/* ── 2. the whole feeds list ── */
ok(/const listOf = \(arr\) => arr\.length\n\s*\? arr\.map\(\(m\) => m\.ico \+ ' ' \+ logEsc\(m\.name\)/.test(NC) && !/arr\.slice\(0, 4\)\.map\(\(m\) => m\.ico/.test(NC) && !/' \+' \+ \(arr\.length - 4\) \+ ' more'/.test(NC), 'the Production Chain feeds/fed-by lists print every building');

/* ── 3. release a node ── */
ok(/data-node-release="' \+ esc\(n\.id\) \+ '"/.test(SRC) && /nodeRelease\(b\.getAttribute\('data-node-release'\)\)\.then\(\(\) => render\(\)\)/.test(SRC), 'every node card has a Release button wired to nodeRelease');
{
  const body = SRC.slice(SRC.indexOf('async function nodeRelease(nodeId) {'), SRC.indexOf('async function nodeMaintain(nodeId) {'));
  ok(/if \(n\.owner_id && String\(n\.owner_id\) !== String\(me\)\)/.test(body) && /\.delete\(\)\.eq\('id', n\.id\)\.eq\('owner_id', me\)\.select\('id'\)/.test(body), 'only the member who licensed the node can release it, and the delete proves it touched a row');
  ok(/nothing is refunded/.test(body) && /gcConfirm\(/.test(body) && /await frFetch\(\)/.test(body), 'confirm says nothing is refunded; the reserve is re-read after');
}

/* ── 4. rations, planks, remedies ── */
{
  const rows = [...SRC.matchAll(/^\s*\{ id: '([A-Za-z]+)',\s+name: '[^']*',\s+icon: '[^']*', color: '#[0-9a-f]{6}' \},?$/gm)].map((m) => m[1]);
  const i = rows.indexOf('monsterParts');
  ok(i > 0 && rows.slice(i, i + 4).join(',') === 'monsterParts,rations,planks,remedies', 'the three goods are RESOURCES rows, appended LAST after the fishing ids', rows.slice(i, i + 4).join(','));
  ok(/\{ id: "rations",\s+name: "Rations",\s+icon: "🍱",\s+wt: 1\.0 \},\n\s*\{ id: "planks",\s+name: "Planks",\s+icon: "🪚",\s+wt: 1\.0 \},\n\s*\{ id: "remedies",\s+name: "Remedies",\s+icon: "🩹",\s+wt: 1\.0 \},/.test(SRC), 'SALVAGE_RES carries the three (the salvage ledger whitelist)');
  ok(/rations: 5, planks: 6, remedies: 9,/.test(SRC), 'each has a Cinder value');
  ok(/'primeSeafood', 'monsterParts',\n\s*'rations', 'planks', 'remedies',/.test(PD), 'production.data MINIGAME_IDS lists them, so the order rule (legacy + chain + minigame) still holds');
}
ok(/const STOCK_STASHABLE = \['rations', 'planks', 'remedies'\];/.test(NC), 'node-city names the stashable goods');
ok(/data-stash-send="' \+ r \+ '"/.test(NC) && /STOCK_STASHABLE\.filter\(\(r\) => Math\.floor\(stockOf\(r\)\) >= 1\)/.test(NC), 'the Warehouse card offers a Send button per stashable good that has any');
ok(/\$\('inspect'\)\.addEventListener\('click', async \(ev\) => \{\n\s*const b = ev\.target\.closest\('\[data-stash-send\]'\); if \(!b\) return;/.test(NC) && /game\.stock\[r\] = Math\.max\(0, stockOf\(r\) - n\);\n\s*const ok = await MythicCityBridge\.addRes\(r, n\);\n\s*if \(ok === false\) \{ game\.stock\[r\] = stockOf\(r\) \+ n;/.test(NC), 'sending moves the pile through the bridge and puts it back if the stash refused');
ok(/City goods — rations, planks and remedies can be sent to your stash/.test(NC), 'the card says so');
ok(/CITY_STOCK\[u\]/.test(NC) && /^const CITY_STOCK = \{\n  rations:/m.test(NC), 'inside the city they are still CITY_STOCK (the sim is unchanged)');

/* ── 5. shut down corporation ── */
ok(/create or replace function public\.corp_dissolve\(p_corp_id uuid\)/.test(SQL) && /where id = p_corp_id and founder_id = v_uid;/.test(SQL) && /the treasury still holds/.test(SQL) && /the vault still holds/.test(SQL) && /delete from corporations where id = p_corp_id and founder_id = v_uid;/.test(SQL), 'sql/130: founder only, refuses with money or items still held, then deletes the row (cascade)');
ok(/\} else if \(a\.kind === 'corpDissolve'\) \{/.test(SRC) && /rpc\('corp_dissolve', \{ p_corp_id: Corp\.mine\.id \}\)/.test(SRC) && /Corp\.mine = null; Corp\.roster = \[\]; Corp\.requests = \[\]; Corp\.vault = \[\]; Corp\.amOwner = false;/.test(SRC.slice(SRC.indexOf("a.kind === 'corpDissolve'"), SRC.indexOf("a.kind === 'corpDissolve'") + 2500)), 'the parent action calls the RPC and resets the corp state like Leave does');
ok(/act\(\{ kind: 'corpDissolve' \}\); onClose\(\);/.test(APP) && /window\.prompt\('Shut down '/.test(APP) && /t\.trim\(\)\.toLowerCase\(\) !== nm\.toLowerCase\(\)/.test(APP) && /\{amOwner && \(\n\s*<div style=\{\{ marginTop: 16 \}\}>\n\s*\{\/\* 🏢 SHUT DOWN/.test(APP), 'the founder sees a Shut down corporation button with a typed-name confirm, where Leave is for members');

/* ── 6. the 3D map only ── */
ok(!/mk\('🗺 Classic map'/.test(SRC), 'the Classic map button is gone');
ok(/3D ONLY \(owner, 2026-09-10\)[\s\S]{0,200}return true;/.test(SRC), 'the Ascent-map decision is always yes — no stored opt-out, no campaign opt-out');
{
  const body = SRC.slice(SRC.indexOf('function _rlcAscentUnmount() {') - 900, SRC.indexOf('function _rlcAscentUnmount() {'));
  ok(body.indexOf('return true;') < body.indexOf("localStorage.getItem('hg_ascent_map')"), '…and it returns before the old localStorage read');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 105, 'BUILD_VERSION is v121v105 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
