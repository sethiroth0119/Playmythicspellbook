/* ══════════════════════════════════════════════════════════════════════════
   🗺 DRIVE-WORLD-MAP-SHARED — one map, read by everyone.

   Asked for: "this map needs a multiplayer feature where the game knows that
   all these on the map belong to other players… and yes [do the migration]."

   🔴 THE PROBLEM, MEASURED ON PRODUCTION BEFORE ANY CODE CHANGED. The War Map's
      regions, sectors and NODES lived inside each player's own
      user_profiles.forge blob, reconciled by _preferRicherObj — which keeps
      whichever whole object weighs more. Every account therefore carried its
      own vintage of the world:

        40 nodes … 31 profiles   ← the live map
        39 … 12 · 38 … 8 · 37 … 9 · 36 … 5 · 34 … 18
        16 nodes … 15 profiles   ← the STARTER SEED, over a real map
         0 nodes …  1 profile

      Two players could stand on the same node id and read different names.

   WHAT THIS PINS:
     · the client reads the shared map and ADOPTS it (that is the convergence)
     · it never publishes or adopts a BLANK world — the failure that started all
       of this was a map with no nodes winning a merge
     · publishing is admin-only and version-checked, so two admins cannot
       silently discard each other
     · nobody's profile is edited: the shared map is preferred at READ time

   Run:  node .gauntlet/drive-world-map-shared.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9830 + (process.pid % 40);
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
  const sql = fs.existsSync('sql/043_world_map_canonical.sql') ? fs.readFileSync('sql/043_world_map_canonical.sql', 'utf8') : '';
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  out.src = {
    migrationExists: !!sql,
    /* 🔴 every profile's copy is preserved BEFORE anything else happens */
    backsUpFirst: /create table if not exists public\.tw_world_map_backup_20260902/.test(sql)
      && sql.indexOf('tw_world_map_backup_20260902') < sql.indexOf('create table if not exists public.tw_world_map ('),
    /* the shared row is readable by everyone, writable by admins only */
    everyoneReads: /create policy twm_sel on public\.tw_world_map for select to authenticated using \(true\)/.test(sql),
    adminOnlyWrite: /create policy twm_upd on public\.tw_world_map for update to authenticated using \(is_admin\(\)\)/.test(sql),
    /* 🔴 the server refuses a blank world outright */
    refusesEmptyServerSide: /refused: the map has no nodes/.test(sql),
    versionChecked: /'stale', 'version', v_cur/.test(sql),
    /* …and the client refuses to send or adopt one */
    clientNeverPublishesBlank: /if \(!Array\.isArray\(t\.nodes\) \|\| !t\.nodes\.length\) return null;   \/\/ never publish a blank world/.test(idx),
    clientNeverAdoptsBlank: /if \(!doc \|\| !Array\.isArray\(doc\.nodes\) \|\| !doc\.nodes\.length\) return null;/.test(idx),
    /* an anon read of the shared row returns zero rows with no error — the same
       trap that locked node owners out of their own content */
    waitsForSession: /if \(!\(Profile\.cloud && Profile\.cloud\.userId\)\) return null;[\s\S]{0,400}tw_world_map/.test(idx),
    publishIsExplicit: /id="tw-publish-btn"/.test(idx),
    /* 🔴 THE CANONICAL MAP IS HELD AND RE-APPLIED, not adopted once. Applying
       at fetch time was not enough: cloudFetchProfile runs on its own schedule
       and hands Forge.territoryWars back to _preferRicherObj, which keeps
       whichever WHOLE object weighs more — and a 16-node profile blob with a
       fat worldFeed outweighs a 40-node shared map. That is why the starter map
       kept coming back after the first fix. */
    holdsTheDoc: /App\._twWorldMapDoc = doc;/.test(idx),
    reappliesOnEveryRead: /if \(_wm && Array\.isArray\(_wm\.nodes\) && _wm\.nodes\.length && t\.nodes !== _wm\.nodes\) \{/.test(idx),
    fetchesOnMapOpen: /function renderTerritoryWars[\s\S]{0,400}tw_cloudFetchWorldMap/.test(idx),
  };
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);

/* ── the convergence: a 16-node player adopts the shared 40 ──────────────── */
out.adopt = await pg.evaluate(async () => {
  const o = {};
  const shared = {
    regions: [{ id: 'R-1' }, { id: 'R-2' }],
    sectors: [{ id: 'S-1' }],
    nodes: Array.from({ length: 40 }, (_, i) => ({ id: 'N-' + String(i + 1).padStart(2, '0'), name: 'REAL ' + i })),
  };
  Cloud.ready = true;
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ doc: shared, version: 7 }], error: null }) }) }) }) };
  Profile.cloud = { signedIn: true, userId: 'me-1' };
  /* this player is one of the fifteen sitting on the starter seed */
  Forge.territoryWars = { regions: [{ id: 'R-1' }], sectors: [], nodes: Array.from({ length: 16 }, (_, i) => ({ id: 'N-' + i, name: 'STARTER ' + i })), litRoutes: ['a|b'], worldFeed: [{ x: 1 }] };
  o.before = Forge.territoryWars.nodes.length;
  _twWorldMapAt = 0;
  await tw_cloudFetchWorldMap();
  o.after = Forge.territoryWars.nodes.length;
  o.firstName = Forge.territoryWars.nodes[0].name;
  o.version = App._twWorldMapVersion;
  o.markedSeen = !!App._twForgeSeen;
  /* ⚠ per-player keys are NOT the shared map's business */
  o.litRoutesKept = (Forge.territoryWars.litRoutes || []).length;
  o.worldFeedKept = (Forge.territoryWars.worldFeed || []).length;
  return o;
});

/* ── 🔴 a blank shared map must never be adopted ─────────────────────────── */
out.blank = await pg.evaluate(async () => {
  const o = {};
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ doc: { regions: [], sectors: [], nodes: [] }, version: 8 }], error: null }) }) }) }) };
  o.before = Forge.territoryWars.nodes.length;
  _twWorldMapAt = 0;
  await tw_cloudFetchWorldMap();
  o.after = Forge.territoryWars.nodes.length;
  o.kept = (o.after === o.before);
  return o;
});

/* ── an anon read must not be trusted either ─────────────────────────────── */
out.anon = await pg.evaluate(async () => {
  const o = {};
  let asked = 0;
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => { asked++; return { data: [], error: null }; } }) }) }) };
  Profile.cloud = { signedIn: true, userId: null };
  _twWorldMapAt = 0;
  await tw_cloudFetchWorldMap();
  o.askedWithoutSession = asked;
  o.nodesUnchanged = Forge.territoryWars.nodes.length;
  return o;
});

/* ── publishing: admin only, refuses blank, handles a stale version ──────── */
out.publish = await pg.evaluate(async () => {
  const o = {};
  const calls = [];
  Profile.cloud = { signedIn: true, userId: 'me-1' };
  Cloud.client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true, version: 9 }, error: null } } };

  window.isAdmin = () => false;
  await tw_cloudPublishWorldMap();
  o.nonAdminSentNothing = (calls.length === 0);

  window.isAdmin = () => true;
  const keep = Forge.territoryWars.nodes;
  Forge.territoryWars.nodes = [];
  await tw_cloudPublishWorldMap();
  o.blankSentNothing = (calls.length === 0);

  Forge.territoryWars.nodes = keep;
  await tw_cloudPublishWorldMap();
  o.adminPublished = calls.length === 1 && calls[0].name === 'tw_publish_world_map';
  o.sentNodeCount = calls.length ? (calls[0].args.p_doc.nodes || []).length : 0;
  o.sentVersion = calls.length ? calls[0].args.p_version : null;
  /* 🔴 a stale publish must NOT force — the other admin's work is not ours */
  Cloud.client = { rpc: async () => ({ data: { ok: false, why: 'stale', version: 12 }, error: null }) };
  const r = await tw_cloudPublishWorldMap();
  o.staleRefused = (r === null);
  o.versionAdopted = App._twWorldMapVersion;
  return o;
});

/* ── 🔴 THE OVERWRITE THAT KEPT BRINGING THE STARTER MAP BACK ───────────── */
out.survivesProfileMerge = await pg.evaluate(async () => {
  const o = {};
  /* the shared 40 is held */
  o.held = !!(App._twWorldMapDoc && App._twWorldMapDoc.nodes.length === 40);
  /* now a profile sync lands and _preferRicherObj picks the player's own
     16-node blob, because its worldFeed makes it heavier — exactly what was
     happening in production */
  const stale = { regions: [{ id: 'R-1' }], sectors: [],
    nodes: Array.from({ length: 16 }, (_, i) => ({ id: 'S-' + i, name: 'STARTER ' + i })),
    worldFeed: Array.from({ length: 4000 }, (_, i) => ({ i, msg: 'padding padding padding ' + i })) };
  o.staleWinsOnWeight = (_preferRicherObj(stale, Forge.territoryWars) === stale);
  Forge.territoryWars = stale;
  o.rightAfterMerge = Forge.territoryWars.nodes.length;
  /* 🔴 …and the very next read through the single accessor puts it back */
  const t = _twForge();
  o.afterNextRead = (t.nodes || []).length;
  o.namesBack = t.nodes[0] && t.nodes[0].name;
  o.regionsBack = (t.regions || []).length;
  /* and it does not thrash: a second read changes nothing */
  const again = _twForge();
  o.stable = (again.nodes === t.nodes);
  return o;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, A = out.adopt || {}, B = out.blank || {}, N = out.anon || {}, PB = out.publish || {};

need('the migration is in the repo', S.migrationExists === true);
need('🔴 …and backs up every profile\'s map BEFORE creating anything', S.backsUpFirst === true, S);
need('every player reads the same row', S.everyoneReads === true, S);
need('…and only an admin may write it', S.adminOnlyWrite === true, S);
need('🔴 the server refuses to publish a map with no nodes', S.refusesEmptyServerSide === true, S);
need('…and publishes are version-checked', S.versionChecked === true, S);
need('the client refuses to send a blank world', S.clientNeverPublishesBlank === true, S);
need('…and refuses to adopt one', S.clientNeverAdoptsBlank === true, S);
need('…and will not trust a read made without a session', S.waitsForSession === true, S);
need('publishing is an explicit admin action, not a keystroke', S.publishIsExplicit === true, S);

need('SETUP: this player was on the 16-node starter seed', A.before === 16, A);
need('🔴 THE CONVERGENCE: they adopt the shared 40-node map', A.after === 40, A);
need('…with the real names', /^REAL /.test(A.firstName || ''), A);
need('…and record the version they hold', A.version === 7, A);
need('…and stop seeding, since a real map has now been consulted', A.markedSeen === true, A);
need('⚠ per-player keys survive — litRoutes and worldFeed are not the map\'s business',
     A.litRoutesKept === 1 && A.worldFeedKept === 1, A);

need('🔴 a BLANK shared map is never adopted', B.kept === true && B.after === 40, B);
need('🔴 a read with no session is never even made', N.askedWithoutSession === 0, N);
need('…and changes nothing', N.nodesUnchanged === 40, N);

need('a non-admin publishes nothing', PB.nonAdminSentNothing === true, PB);
need('🔴 an admin cannot publish a blank world', PB.blankSentNothing === true, PB);
need('an admin publishes the real map', PB.adminPublished === true && PB.sentNodeCount === 40, PB);
need('…carrying the version they read', PB.sentVersion === 7, PB);
need('🔴 a stale publish is refused rather than forced', PB.staleRefused === true, PB);
need('…and the newer version is adopted', PB.versionAdopted === 12, PB);

const SV = out.survivesProfileMerge || {};
need('the canonical map is HELD, not adopted once', S.holdsTheDoc === true, S);
need('…and re-applied on every read through the one accessor', S.reappliesOnEveryRead === true, S);
need('…and fetched when the map screen opens, not only from the hub',
     S.fetchesOnMapOpen === true, S);

need('SETUP: the shared 40-node map is held', SV.held === true, SV);
need('CONTROL: a 16-node profile blob really does win on weight — the overwrite is real',
     SV.staleWinsOnWeight === true && SV.rightAfterMerge === 16, SV);
need('🔴 …and the very next read puts the 40 back', SV.afterNextRead === 40, SV);
need('…with the real names, not STARTER', !/^STARTER/.test(SV.namesBack || ''), SV);
need('…and the regions with them', SV.regionsBack === 2, SV);
need('…and it does not thrash on a second read', SV.stable === true, SV);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — one map, everyone reads it, and no blank world can ever be published or adopted.');
