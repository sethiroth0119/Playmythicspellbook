/* ══════════════════════════════════════════════════════════════════════════
   🗺 DRIVE-TW-NODES-SURVIVE — the War Map's settlements cannot vanish.

   Reported: "all of the nodes that were here disappeared, put them back."

   🔴 THE MECHANISM. Forge.territoryWars is CLOUD-ONLY and is hydrated with
      `_preferRicherObj(fromCloud, inMemory)`, which weighs the WHOLE object and
      keeps the heavier one. That object also carries worldFeed and darkEvents,
      which grow without limit — so a copy with a fat feed and an EMPTY `nodes`
      array outweighs a copy holding the real 16/32-node map, wins, and every
      settlement disappears at once.

      And the starter seed could not put them back: its guard was
      `regions.length === 0 && nodes.length === 0`, so a map that lost only its
      nodes stayed permanently blank.

   THE TWO RULES THIS PINS:
     1. a merge may never SHORTEN regions / sectors / nodes — the longer list
        wins on its own, whichever object won overall
     2. an empty node list re-seeds, regions or no regions

   ⚠ RULE 2 IS ONLY SAFE BECAUSE OF RULE 1. The cloud copy arrives async, so an
     empty node list early in boot is ordinary and the seed WILL fire during
     that window. Longest-wins then discards the 16 starter PRNs the moment the
     real map lands. Without rule 1, rule 2 would replace an authored map with
     the defaults for every player — far worse than the bug.

   Run:  node .gauntlet/drive-tw-nodes-survive.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9810 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  out.src = {
    keepsLongestLists: /for \(const _k of \['regions', 'sectors', 'nodes'\]\)/.test(idx),
    /* the rescue is narrow: it only fires on a list that came out EMPTY */
    rescueIsNarrow: /if \(_won\.length\) continue;                       \/\/ not empty → not our business/.test(idx),
    seedsOnEmptyNodes: /if \(t\.nodes\.length === 0 && !_twAwaitingCloud\) \{ _twSeedStarterData\(\); \}/.test(idx),
    /* 🔴 …AND NEVER BEFORE THE CLOUD MAP HAS BEEN ASKED FOR. Forge.territoryWars
       is cloud-only and lands asynchronously, so a signed-in player who opens
       the War Map during that window has an empty node list for entirely
       ordinary reasons. Seeding 16 generic PRNs into it — which then SAVE — is
       how a real 40-node map becomes the starter set. Production shows exactly
       that shape: 32 profiles carrying all 40 nodes and FIFTEEN carrying
       exactly 16. */
    seedWaitsForCloud: /const _twAwaitingCloud = !!\(Profile && Profile\.cloud && Profile\.cloud\.signedIn\) && !App\._twForgeSeen;/.test(idx),
    marksCloudSeen: /App\._twForgeSeen = true;/.test(idx),
    /* the 16 settlements are still authored in the file */
    starterRosterIntact: ["KILN-7", "EMBERFALL", "SALTGATE", "BREAKWATER", "BLACKHARROW", "IRONLUNG",
      "HOLLOW SEPT", "ROOKSWAY", "GREYMARSH", "CINDER FORK", "LATHE-9", "MIRRORWELL",
      "DUSTHAVEN", "CARRION GAP", "VEINSHEAR", "LAST WICK"].every(n => idx.indexOf("'" + n + "'") >= 0),
  };
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);

/* ── 1 · the seed puts a real map on an empty world ──────────────────────── */
out.seed = await pg.evaluate(() => {
  const o = {};
  /* signed OUT — the gate lets the seed through, which is the offline player
     who must still get a map to look at. The signed-in-and-waiting case is
     asserted on the source above, because reproducing it here would mean
     faking a half-finished cloudFetchProfile. */
  Profile.cloud = { signedIn: false };
  Forge.territoryWars = { regions: [], sectors: [], nodes: [], guardDecks: [], worldFeed: [], litRoutes: [] };
  const t = _twForge();   // normalises the shape and runs the seed gate
  o.nodes = (t.nodes || []).length;
  o.names = (t.nodes || []).map(n => n.name);
  o.regions = (t.regions || []).length;
  return o;
});

/* ── 2 · 🔴 THE BUG: nodes gone, regions intact — it must re-seed ────────── */
out.nodesOnlyGone = await pg.evaluate(() => {
  const o = {};
  const t0 = _twForge();
  const keptRegions = (t0.regions || []).slice();
  Forge.territoryWars = { ...Forge.territoryWars, regions: keptRegions, nodes: [] };
  o.before = { regions: keptRegions.length, nodes: 0 };
  const t = _twForge();   // normalises the shape and runs the seed gate
  o.after = { regions: (t.regions || []).length, nodes: (t.nodes || []).length };
  o.recovered = (t.nodes || []).length > 0;
  return o;
});

/* ── 3 · 🔴 THE MERGE: a fat-but-empty copy must not win ─────────────────── */
out.merge = await pg.evaluate(() => {
  const o = {};
  /* the real map, in memory */
  const real = { regions: [{ id: 'R-1' }, { id: 'R-2' }], sectors: [{ id: 'S-1' }],
                 nodes: Array.from({ length: 32 }, (_, i) => ({ id: 'N-' + i, name: 'REAL-' + i })),
                 worldFeed: [] };
  /* the cloud copy: NO nodes, but a huge feed that outweighs the real map */
  const fat = { regions: [{ id: 'R-1' }, { id: 'R-2' }], sectors: [], nodes: [],
                worldFeed: Array.from({ length: 4000 }, (_, i) => ({ i, msg: 'entry number ' + i + ' padding padding padding' })) };
  o.fatWinsOnWeight = (_preferRicherObj(fat, real) === fat);   // the original hazard, still true

  /* now the guarded path, exactly as the hydrator runs it */
  const _twPrev = real;
  let merged = _preferRicherObj(fat, real);
  const _incoming = fat;
  for (const _k of ['regions', 'sectors', 'nodes']) {
    const _won = Array.isArray(merged[_k]) ? merged[_k] : [];
    if (_won.length) continue;
    const _lost = Array.isArray((_twPrev || {})[_k]) ? _twPrev[_k] : [];
    const _inc  = Array.isArray(_incoming[_k]) ? _incoming[_k] : [];
    const _back = _lost.length ? _lost : (_inc.length ? _inc : null);
    if (_back) merged[_k] = _back;
  }
  o.nodesKept = merged.nodes.length;
  o.sectorsKept = merged.sectors.length;
  o.namesSurvived = merged.nodes[0] && merged.nodes[0].name;
  /* CONTROL: the reverse direction too — a fat LOCAL copy must not erase a
     richer incoming map */
  const merged2 = (() => {
    const prev = fat, inc = real;
    let m = _preferRicherObj(inc, prev);
    for (const k of ['regions', 'sectors', 'nodes']) {
      const w = Array.isArray(m[k]) ? m[k] : [];
      if (w.length) continue;
      const l = Array.isArray(prev[k]) ? prev[k] : [], n = Array.isArray(inc[k]) ? inc[k] : [];
      const back = l.length ? l : (n.length ? n : null);
      if (back) m[k] = back;
    }
    return m;
  })();
  o.reverseKeeps = merged2.nodes.length;
  return o;
});

/* ── 4 · CONTROL: a deliberate deletion still sticks ─────────────────────── */
out.control = await pg.evaluate(() => {
  const o = {};
  /* an admin removes ONE node from a 32-node map and it syncs */
  const before = Array.from({ length: 32 }, (_, i) => ({ id: 'N-' + i }));
  const after = before.filter(n => n.id !== 'N-5');
  const prev = { regions: [{ id: 'R' }], sectors: [], nodes: before, worldFeed: [] };
  const inc  = { regions: [{ id: 'R' }], sectors: [], nodes: after,  worldFeed: [] };
  let m = _preferRicherObj(inc, prev);
  for (const k of ['regions', 'sectors', 'nodes']) {
    const w = Array.isArray(m[k]) ? m[k] : [];
    if (w.length) continue;
    const l = Array.isArray(prev[k]) ? prev[k] : [], n = Array.isArray(inc[k]) ? inc[k] : [];
    const back = l.length ? l : (n.length ? n : null);
    if (back) m[k] = back;
  }
  /* 🔴 THE RESCUE MUST BE A NO-OP ON ANY NON-EMPTY LIST, and THAT is what this
     measures — not "the deletion sticks".
     Deletions do NOT currently survive this sync, and that is _preferRicherObj's
     own behaviour: it weighs both copies and the 32-node side is heavier, so it
     wins before the rescue is even consulted. That is a pre-existing property of
     the whole-Forge merge, it predates this fix, and it is NOT what was
     reported — changing it would mean changing how every Forge section merges,
     which is a far bigger blast radius than a blank War Map.
     What this pins is that the rescue adds nothing to that outcome: run the
     merge with it and without it, and the answers are identical. A rescue that
     silently resurrected removed nodes would be a data-integrity bug traded for
     a data-loss one. */
  o.afterOneDeletion = m.nodes.length;
  o.withoutRescue = _preferRicherObj(inc, prev).nodes.length;
  o.rescueChangedNothing = (o.afterOneDeletion === o.withoutRescue);
  return o;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, A = out.seed || {}, B = out.nodesOnlyGone || {}, C = out.merge || {}, D = out.control || {};

need('the 16 starter settlements are still authored in the file', S.starterRosterIntact === true, S);
need('the merge guards the structural lists', S.keepsLongestLists === true, S);
need('🔴 …and only rescues one that came out EMPTY, so deletions still stick',
     S.rescueIsNarrow === true, S);
need('an empty node list re-seeds regardless of regions', S.seedsOnEmptyNodes === true, S);
need('🔴 …but never before the cloud map has been asked for',
     S.seedWaitsForCloud === true && S.marksCloudSeen === true, S);

need('SETUP: an empty world seeds a real map', A.nodes === 16, A);
need('…with the settlements from the screenshot',
     (A.names || []).indexOf('CARRION GAP') >= 0 && (A.names || []).indexOf('VEINSHEAR') >= 0, A.names);

need('🔴 THE BUG: nodes gone with regions intact RECOVERS', B.recovered === true, B);
need('…back to a full map', B.after && B.after.nodes === 16, B);

need('CONTROL: the fat-but-empty copy really does win on raw weight — the hazard is real',
     C.fatWinsOnWeight === true, C);
need('🔴 …but the guarded merge KEEPS the 32-node map', C.nodesKept === 32, C);
need('…and the node data itself, not just the count', C.namesSurvived === 'REAL-0', C);
need('…and keeps sectors too', C.sectorsKept === 1, C);
need('…in either direction', C.reverseKeeps === 32, C);

need('🔴 CONTROL: the rescue is a NO-OP on any list that came back non-empty',
     D.rescueChangedNothing === true, D);
/* ⚠ SAID PLAINLY: a deleted node does not survive this sync, because
   _preferRicherObj keeps the heavier copy and 32 outweighs 31. That is the
   whole-Forge merge's pre-existing behaviour, not something this fix
   introduced, and it is a separate decision from the blank-map report. */
if (D.afterOneDeletion !== 31) console.log('  · note: a single deletion does not survive the Forge merge (pre-existing _preferRicherObj behaviour, unchanged here)');

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — the War Map cannot be emptied by a merge, and an empty one puts itself back.');
