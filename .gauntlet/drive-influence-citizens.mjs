/* ══════════════════════════════════════════════════════════════════════════
   🎖 DRIVE-INFLUENCE-CITIZENS — the Influence feature lands, and the mission
      map grows a standing with the people of each district.

   Asked for: "Add this and connect the influence system to the Ethos Heights
   Mission Map where players can gain influence of the citizens of the location.
   What they do can gain influence… connect it where it makes sense and do not
   add the simulation sliders, make it a real feature for the players."

   🔴 THE LINE THIS DRIVER EXISTS TO HOLD. /src/influence is server-authoritative
      on purpose: sql/038 was written because the first version put the rate
      limit in the browser, and its xp is now written by `influence_resolve` and
      by nothing else. Citizen standing is the opposite — client-written, in the
      player's own save — so it may buy GAMEPLAY and must never buy Cinder. This
      driver pins that separation as hard as it pins the feature.

   WHAT THIS PINS:
     · the Influence module loads, registers, and the camp button appears
     · Profile.influence is in all THREE whitelists (the PR shipped two)
     · citizen standing rises from things the player actually did on the map —
       surviving a raid, clearing it, fortifying — and from nothing else
     · it is clamped, banded, and pays the train fuel at the top bands
     · it READS the influence level and never writes one
     · no simulation sliders anywhere in the shipped UI

   Run:  node .gauntlet/drive-influence-citizens.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.jsx': 'text/babel', '.svg': 'image/svg+xml' };
const P = 8260 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── source rules ────────────────────────────────────────────────────────── */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cit = fs.readFileSync(path.join(ROOT, 'src/missions/citizens.js'), 'utf8');
  const st = fs.readFileSync(path.join(ROOT, 'src/missions/state.js'), 'utf8');
  const rnd = fs.readFileSync(path.join(ROOT, 'src/missions/render.js'), 'utf8');
  out.src = {
    /* the PR's own three contributions to index.html */
    bridgePresent: idx.indexOf('window.MythicInfluenceBridge = {') >= 0,
    campButton: idx.indexOf('data-influence="1"') >= 0,
    moduleTag: idx.indexOf('src/influence/index.js?v=') >= 0,
    /* 🔴 ALL THREE WHITELISTS. The PR shipped the cloud upload and the cloud
       restore. loadForge is a third, LOCAL list and a field missing from it is
       dropped on every offline reload — the two-of-three gap that made a vault
       ceiling move twice per page load. */
    inUpload: idx.indexOf('__influence__:') >= 0,
    inHydrate: idx.indexOf('__influence__ &&') >= 0 || idx.indexOf("f.__influence__") >= 0,
    inLoadForge: idx.indexOf('Profile.influence       = p.influence;') >= 0,
    /* citizen standing must never touch money */
    citNeverPaysCinder: cit.indexOf('addGems') < 0 && cit.indexOf('wallet_credit') < 0
                     && cit.indexOf('cinder') < 0 && cit.indexOf('Cinder') >= 0,   // named in prose only
    citReadsLevelOnly: cit.indexOf('MI.status()') >= 0 && cit.indexOf('MI.open') < 0,
    /* the store does not bump the schema version — that would reseed every map */
    noVersionBump: st.indexOf("s.v !== 1") >= 0,
    citStoreBackfilled: st.indexOf("if (!s.cit || typeof s.cit !== 'object') s.cit = {};") >= 0,
    /* earned only from real events */
    earnsOnRaid: st.indexOf('CIT.CIT_GAIN.raidSurvived') >= 0,
    earnsOnFortify: st.indexOf('CIT.CIT_GAIN.fortified') >= 0,
    paysFuel: st.indexOf('TRN.refuel(CIT.fuelBonus(') >= 0,
    /* the panel shows it, as a bar and words — never a control */
    panelShows: rnd.indexOf('Citizens of ') >= 0,
    noSliders: rnd.indexOf('type="range"') < 0 && cit.indexOf('type="range"') < 0
            && fs.readFileSync(path.join(ROOT, 'src/influence/render.js'), 'utf8').indexOf('type="range"') < 0,
  };
}

/* ── the browser half ────────────────────────────────────────────────────── */
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(8000);

Object.assign(out, await pg.evaluate(() => {
  const o = {};
  const MI = window.MythicInfluence;
  o.influenceLoaded = !!MI;
  o.influenceApi = MI ? ['status', 'open', 'formatEta'].every(k => typeof MI[k] === 'function') : false;
  o.bridgeKeys = window.MythicInfluenceBridge ? Object.keys(window.MythicInfluenceBridge).length : 0;
  o.status = MI ? MI.status() : null;
  return o;
}));

/* the citizens module, driven directly — it is pure and takes its state in */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  const CIT = await import('/src/missions/citizens.js');
  const st = { cit: {} };
  const SID = 'chelsea';

  o.startsAtZero = CIT.of(st, SID) === 0;
  o.startBand = CIT.bandOf(0).name;

  /* surviving a raid moves it; the line names the district */
  const l1 = CIT.gain(st, SID, CIT.CIT_GAIN.raidSurvived, 'you walked back out');
  o.afterOneRaid = CIT.of(st, SID);
  o.lineMentionsDistrict = /Chelsea/i.test(l1 || '');

  /* it climbs through bands and CLAMPS — no unbounded track */
  for (let i = 0; i < 200; i++) CIT.gain(st, SID, CIT.CIT_GAIN.raidCleared, 'x');
  o.clampedAt = CIT.of(st, SID);
  o.topBand = CIT.bandOf(CIT.of(st, SID)).name;
  o.fuelAtTop = CIT.fuelBonus(st, SID);
  o.fuelAtZero = CIT.fuelBonus({ cit: {} }, SID);

  /* a district you have never been to is untouched by another's standing */
  o.otherDistrictUntouched = CIT.of(st, 'harlem') === 0;

  /* 🔴 the multiplier READS the influence level and cannot write it */
  const before = JSON.stringify(window.MythicInfluence ? window.MythicInfluence.status() : {});
  o.multiplier = CIT.influenceMultiplier();
  const after = JSON.stringify(window.MythicInfluence ? window.MythicInfluence.status() : {});
  o.readingDidNotWrite = before === after;
  o.multiplierSane = o.multiplier >= 1 && o.multiplier <= 1.5;

  /* with the module absent it must still work — a 404 on /src/influence costs
     its own feature and nothing else */
  const keep = window.MythicInfluence;
  try { delete window.MythicInfluence; } catch (e) { window.MythicInfluence = undefined; }
  o.multiplierWithoutModule = CIT.influenceMultiplier();
  const st2 = { cit: {} };
  o.stillEarnsWithoutModule = (CIT.gain(st2, SID, 6, 'x'), CIT.of(st2, SID) > 0);
  window.MythicInfluence = keep;
  return o;
}));

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
for (const [k, v] of Object.entries(out.src)) if (!v) F.push('source rule failed: ' + k);
if (!out.influenceLoaded) F.push('the influence module did not load');
if (!out.influenceApi) F.push('the influence module is missing part of its public surface');
if (!(out.bridgeKeys >= 20)) F.push('the influence bridge looks incomplete (' + out.bridgeKeys + ' keys)');
if (!out.startsAtZero) F.push('a district did not start at zero standing');
if (out.startBand !== 'Wary') F.push('the opening band is ' + out.startBand + ', expected Wary');
if (!(out.afterOneRaid > 0)) F.push('surviving a raid earned no citizen standing');
if (!out.lineMentionsDistrict) F.push('the log line does not name the district');
if (out.clampedAt !== 100) F.push('citizen standing is not clamped (' + out.clampedAt + ')');
if (out.topBand !== 'Devoted') F.push('the top band is ' + out.topBand);
if (!(out.fuelAtTop > 0)) F.push('a devoted district pays no fuel — the reward is a stub');
if (out.fuelAtZero !== 0) F.push('a district that does not know you still pays fuel');
if (!out.otherDistrictUntouched) F.push('standing leaked between districts');
if (!out.multiplierSane) F.push('the influence multiplier is out of band (' + out.multiplier + ')');
if (!out.readingDidNotWrite) F.push('reading the influence level CHANGED it — this track must never write xp');
if (out.multiplierWithoutModule !== 1) F.push('with /src/influence absent the multiplier is not 1');
if (!out.stillEarnsWithoutModule) F.push('citizen standing stopped working when /src/influence was absent');
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · Influence is in, and every district keeps its own opinion of the player without ever touching the wallet');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
