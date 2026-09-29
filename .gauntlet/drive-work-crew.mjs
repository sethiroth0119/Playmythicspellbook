/* ══════════════════════════════════════════════════════════════════════════
   👷 DRIVE-WORK-CREW — the Unit Work Crew, PORTED rather than merged.

   THE HANDOFF: a finished feature on `claude/unit-traits-abilities-rf3r88`,
   never deployed, whose own first warning is about the ways a careless merge
   destroys city work.

   🔴 WHY THIS WAS PORTED AND NOT MERGED. That branch's node-city is 40,261
      lines; this tree's is 50,517. It is city-visual + 9 commits, and this tree
      has moved a long way past city-visual — merging the branch would have
      dragged the city backwards by ~10,000 lines, which is precisely the class
      of silent loss the handoff is written to prevent. So the two new modules
      were copied whole (they are pure and self-contained) and the 40-hunk
      node-city patch + 13-hunk host patch were re-applied against this tree,
      with the collisions resolved by hand.

   ⚠ ONE COLLISION WAS A REAL TRAP. openCardPicker takes THREE arguments on that
     branch and the crew passes its `showWork` flag as the fourth. This tree's
     picker already takes five — so ported as-is, `true` would have landed in
     `emptyMsg` and the work profiles would never have rendered. The flag is the
     sixth argument here and the module's call site was corrected to match.

   Pinned, with controls:
     · both modules load, and the city mounts the crew
     · a unit's work profile is DERIVED from salt + card id, and is STABLE
     · CONTROL: a different salt gives a different profile  ← proves it is rolled
     · the boost is capped at exactly ×2.00 (BOOST_CAP is a promise the UI prints)
     · condition multiplier floors at 0.30, never 0
     · CONTROL: the picker flag is the SIXTH argument, not the fourth
     · ext.crew is the save key — renaming it orphans every roster

   Run:  node .gauntlet/drive-work-crew.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const P = 9560 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = { src: {} };

/* ── the source-level facts the handoff says must not be reversed ─────────── */
{
  const nc = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8');
  const crew = fs.readFileSync(path.join(ROOT, 'src', 'work', 'crew.city.js'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  out.src = {
    modulesExist: fs.existsSync(path.join(ROOT, 'src', 'work', 'work.js')),
    cityMounts: /import\('\.\.\/src\/work\/crew\.city\.js/.test(nc),
    hostLoadsWork: /import \* as Work from '\.\/src\/work\/work\.js/.test(idx),
    /* 🔑 ext.crew IS A SAVE KEY — renaming it orphans every player's roster. */
    saveKey: nc.indexOf("MythicCitySave.register('crew'") >= 0,
    /* 🔴 THE PICKER FLAG. Fourth argument = emptyMsg in this tree; the flag has
       to be sixth, and the call site has to agree with the signature. */
    pickerTakesSixth: /function openCardPicker\(title, filter, onPick, emptyMsg, onClose, showWork\)/.test(nc),
    /* ⚠ POSITION, NOT LITERAL TEXT. This pinned the exact string
       `}, null, null, true);` and broke the moment slot five stopped being
       null: the enlist dialog now passes a `restore` callback there so it can
       hide itself while the card picker is up and put itself back on every
       exit. The claim was never about what those two slots CONTAIN — it is
       that the flag sits in slot SIX, past emptyMsg and onClose. Matching the
       shape survives the next legitimate change to four and five; matching
       the text failed the build for a change that cannot break the claim.
       ⚠ The companion check below (callDoesNotPassFourth) is what stops this
         looser pattern from passing a genuinely wrong call site. */
    callPassesSixth: /\},\s*[^,()]+,\s*[^,()]+,\s*true\);/.test(crew),
    callDoesNotPassFourth: !/\}, true\);/.test(crew),
    /* the crew eats AFTER the service layer draws — a starving city must not
       starve its kitchens to feed its workers */
    upkeepWired: /CREW\.upkeep\(dtMin, svcDraw\)/.test(nc),
    panelOnVitals: /CREW\.renderPanel\(\)/.test(nc),
    /* 🔴 the iframe buster is DERIVED, never a literal (handoff warning #4) */
    iframeDerived: /f\.src = 'node-city\/index\.html\?v=' \+ \(window\.BUILD_VERSION \|\| 'dev'\)/.test(idx),
    iframeNoLiteral: !/node-city\/index\.html\?v=v?12[0-9]/.test(idx),
  };
}

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
await pg.waitForFunction('!!window.__nc', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);

/* ── the module's own arithmetic, in the browser that will run it ────────── */
out.work = await pg.evaluate(async () => {
  const o = {};
  let W = null;
  try { W = await import('/src/work/work.js?probe=1'); } catch (e) { return { err: String(e).slice(0, 140) }; }
  o.loaded = !!W;
  /* WORK is the tuning object (BOOST_CAP, COND_FLOOR…); the 13 kinds live in
     WORK_TYPES / WORK_BY_ID. */
  o.kinds = Object.keys(W.WORK_BY_ID || {}).length;
  o.boostCap = W.WORK && W.WORK.BOOST_CAP;
  o.passives = (W.PASSIVES || []).length;

  /* 🔴 DERIVED, NOT STORED — the same salt and card id must give the same
     profile every time, because nothing is written down. */
  const card = { id: 'u_test_001', element: 'Fire', rarity: 'Rare', level: 5, name: 'Probe' };
  /* profileFor(card, salt) — card first. */
  const a1 = W.profileFor(card, 'SALT-A');
  const a2 = W.profileFor(card, 'SALT-A');
  o.stable = JSON.stringify(a1) === JSON.stringify(a2);
  /* CONTROL: a different salt must give a DIFFERENT profile, or "derived" is
     just a constant wearing a hash. */
  /* ⚠ The module memoises on salt|id|level, so the cache must be cleared or a
     second salt would return the FIRST profile and 'saltMatters' would pass by
     reading a cache hit rather than a new roll. */
  try { W.clearProfileCache(); } catch (e) {}
  const bProf = W.profileFor(card, 'SALT-B');
  o.saltMatters = JSON.stringify(a1) !== JSON.stringify(bProf);
  o.sample = { suits: (a1.suits || []).length, passives: (a1.passives || []).length };

  /* 🔴 THE CAP IS A PROMISE THE UI PRINTS. Throw an absurd crew at multFrom and
     it must still clamp to exactly 2.00. */
  try {
    const many = Array.from({ length: 40 }, () => ({ power: 5 }));
    o.cap = W.multFrom(many);
  } catch (e) { o.cap = 'threw'; }

  /* condition floors at 0.30 — a starving city degrades, it does not become
     unrecoverable. */
  try { o.condFloor = W.condMul(0); o.condFull = W.condMul(100); } catch (e) { o.condFloor = 'threw'; }
  return o;
});

/* ── the city mounted it ─────────────────────────────────────────────────── */
out.city = await pg.evaluate(() => {
  const o = {};
  o.crewMounted = (() => { try { return !!(window.__nc && window.__nc.crew ? window.__nc.crew() : null); } catch (e) { return null; } })();
  /* ⚠ NOT ASSERTED HERE. window.MythicWork is registered by the HOST page's
     script tag; a standalone node-city never loads index.html, so it is
     legitimately undefined in this context. Its presence is asserted against
     the host source instead (hostLoadsWork). */
  o.hasWorkGlobal = typeof window.MythicWork;
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, W = out.work || {}, C = out.city || {};

need('both modules are present', S.modulesExist === true, S.modulesExist);
need('the city mounts the crew', S.cityMounts === true, S.cityMounts);
need('the host loads work.js', S.hostLoadsWork === true, S.hostLoadsWork);
need('🔑 ext.crew is still the save key', S.saveKey === true, S.saveKey);
need('🔴 the picker takes showWork as its SIXTH argument', S.pickerTakesSixth === true, S.pickerTakesSixth);
need('…and the call site passes it there', S.callPassesSixth === true, S.callPassesSixth);
need('🔴 CONTROL: …and NOT in slot four, where emptyMsg lives',
     S.callDoesNotPassFourth === true, S.callDoesNotPassFourth);
need('the crew draws its upkeep through svcDraw', S.upkeepWired === true, S.upkeepWired);
need('the panel rides the vitals beat', S.panelOnVitals === true, S.panelOnVitals);
need('🔴 the iframe cache-bust is DERIVED from BUILD_VERSION', S.iframeDerived === true, S.iframeDerived);
need('🔴 CONTROL: …and no stale literal survives', S.iframeNoLiteral === true, S.iframeNoLiteral);

need('work.js loads in the browser', W.loaded === true, W.err || W);
need('…with its 13 kinds of work', (W.kinds | 0) === 13, W.kinds);
need('…and its passives', (W.passives | 0) > 0, W.passives);
need('a profile is STABLE for one salt + card', W.stable === true, W);
need('🔴 CONTROL: …and CHANGES with the salt, so it is really rolled', W.saltMatters === true, W);
need('🔴 the boost caps at exactly ×2.00', W.cap === 2, W.cap);
need('condition floors at 0.30, never 0', W.condFloor === 0.3, W.condFloor);
need('…and is 1 at full condition', W.condFull === 1, W.condFull);
need('CONTROL: the standalone city runs without the host global — the crew is optional',
     C.crewMounted === true, C);
need('no page errors', errs.length === 0, errs.slice(0, 4));

console.log(JSON.stringify(out, null, 2).slice(0, 2600));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the work crew is in this tree, on this city, without dragging the city backwards.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
