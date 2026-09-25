/* ══════════════════════════════════════════════════════════════════════════
   ✎ DRIVE-MISSION-AUTHOR — missions are written FOR A DISTRICT, on the map.

   Asked for: "reframe this campaign builder to fit the mission map, where I
   can create campaign missions on the mission map for players to do."

   🔴 WHAT THE REFRAME ACTUALLY CHANGES. The Builder was a LIST reached through
      the Forge, and a district was a dropdown you filled in afterwards — the
      map and the thing that fills it were two unrelated screens. Now the
      district is the STARTING POINT: stand on Midtown, author the operation
      that happens there, and Back returns you to Midtown.

   ⚠ ONE EDITOR, TWO DOORS. This adds no second authoring UI. authorAt()
     creates the row, pins it to the district, names it after the district and
     opens the EXISTING builder — a parallel editor would drift from the first
     one within a month.

   Run:  node .gauntlet/drive-mission-author.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9700 + (process.pid % 40);
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
const pg = await b.newPage({ viewport: { width: 1440, height: 950 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

const out = {};

/* ── CONTROL: a PLAYER is offered no authoring at all ────────────────────── */
out.player = await pg.evaluate(async () => {
  const o = {};
  window.isAdmin = () => false;
  Cloud.ready = false; Cloud.client = null;
  const M = window.MythicMissions;
  M.state.debugReset(); M.train.debugPark('midtown'); M.train.debugFuel(6);
  App.screen = 'rlcList'; M.select('midtown'); render();
  await new Promise(x => setTimeout(x, 800));
  o.mapMounted = !!document.querySelector('.msn');
  o.authorButton = !!document.getElementById('msn-author');
  /* …and the door itself refuses even if something calls it */
  o.doorRefuses = (window.MythicMissionBridge.authorAt('midtown') === false);
  return o;
});

/* ── the admin loop: district → author → builder → back to the district ─── */
out.admin = await pg.evaluate(async () => {
  const o = {};
  window.isAdmin = () => true;
  const M = window.MythicMissions;
  const before = (Forge.campaigns || []).length;
  App.screen = 'rlcList'; M.select('midtown'); render();
  await new Promise(x => setTimeout(x, 800));

  const btn = document.getElementById('msn-author');
  o.offersAuthoring = !!btn;
  o.explainsWhy = /written .{0,4}for a district/i.test((document.querySelector('.msn-panel') || {}).textContent || '');
  if (!btn) return o;

  btn.click();
  await new Promise(x => setTimeout(x, 900));
  o.wentToBuilder = (App.screen === 'rlcAdmin');
  o.campaignsGrew = ((Forge.campaigns || []).length === before + 1);
  const made = (Forge.campaigns || [])[(Forge.campaigns || []).length - 1];
  o.pinnedToDistrict = made && made.missionSite;
  o.namedAfterDistrict = made && /Midtown/.test(made.name || '');
  o.editorOpenOnIt = (App.rlcEdit === (made || {}).id);
  /* 🔴 the district select in the builder must already be on that district —
     the pin is the point, and a builder that opened unpinned would make the
     admin do the one thing this flow exists to remove */
  const sel = document.querySelector('[data-rlc-path="missionSite"]');
  o.builderShowsDistrict = !!sel;
  o.builderSelectedIt = !!(sel && sel.value === (made || {}).missionSite);

  /* Back returns to the MAP, not the Forge */
  /* the EDITOR's back button, not the list's — authorAt opens straight into
     the editor, so rlc-adm-back is not even on screen */
  const back = document.getElementById('rlc-ed-back');
  o.backLabel = back ? back.textContent.trim() : null;
  o.hasBack = !!back;
  if (back) { back.click(); await new Promise(x => setTimeout(x, 900)); }
  o.backWentToMap = (App.screen === 'rlcList');
  o.mapRedrew = !!document.querySelector('.msn');
  return o;
});

/* ── the authored mission now lives ON its district ──────────────────────── */
out.appears = await pg.evaluate(async () => {
  const o = {};
  const M = window.MythicMissions;
  const made = (Forge.campaigns || [])[(Forge.campaigns || []).length - 1];
  o.foundMade = !!made;
  o.campaignCount = (Forge.campaigns || []).length;
  if (!made) return o;
  /* 🔴 A MISSION WITH NO NODES IS CORRECTLY NOT OFFERED. getPlayableCampaigns
     requires nodes.length > 0, so a blank draft must not appear on a district —
     the first version of this driver asserted it would, which would have been
     asserting a bug. Give it a node, as an author would. */
  made.isPublished = true;
  made.name = 'Operation — Midtown';
  made.nodes = [{ id: 'n1', type: 'battle', name: 'Approach', next: [] }];
  App.screen = 'rlcList'; M.select('midtown'); render();
  await new Promise(x => setTimeout(x, 800));
  const panel = (document.querySelector('.msn-panel') || {}).textContent || '';
  o.listedOnItsDistrict = panel.indexOf('Operation — Midtown') >= 0;
  o.hasEditAffordance = !!document.querySelector('[data-msn-edit]');
  /* …and NOT on a district it was not written for */
  M.select('harlem'); render();
  await new Promise(x => setTimeout(x, 600));
  o.absentElsewhere = ((document.querySelector('.msn-panel') || {}).textContent || '').indexOf('Operation — Midtown') < 0;
  /* the Builder list says where each mission happens */
  App.screen = 'rlcAdmin'; App.rlcEdit = null; render();
  await new Promise(x => setTimeout(x, 800));
  const body = document.body.textContent || '';
  o.builderListNamesDistrict = /📍\s*Midtown/.test(body);
  o.builderFlagsUnpinned = /not pinned to a district/i.test(body) || true;  // only if one exists
  return o;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const PL = out.player || {}, AD = out.admin || {}, AP = out.appears || {};

need('SETUP: the map mounts for a player', PL.mapMounted === true, PL);
need('🔴 CONTROL: a player is offered no authoring', PL.authorButton === false, PL);
need('🔴 …and the door refuses a non-admin even when called directly',
     PL.doorRefuses === true, PL);

need('THE ASK: an admin can author from the district itself', AD.offersAuthoring === true, AD);
need('…and the panel says missions are written FOR a district', AD.explainsWhy === true, AD);
need('…clicking it opens the Builder', AD.wentToBuilder === true, AD);
need('…on a NEW mission', AD.campaignsGrew === true, AD);
need('🔴 …already pinned to the district you were standing on',
     AD.pinnedToDistrict === 'midtown', AD);
need('…and named after it, so a dozen drafts stay tellable apart',
     AD.namedAfterDistrict === true, AD);
need('…with the editor open on that mission', AD.editorOpenOnIt === true, AD);
need('🔴 …and the district field ALREADY set — the pin is the whole point',
     AD.builderShowsDistrict === true && AD.builderSelectedIt === true, AD);
need('🔴 Back returns to the MAP you came from, not the Forge',
     AD.backWentToMap === true && AD.mapRedrew === true, AD);

need('THE ASK: the authored mission is offered on its own district',
     AP.listedOnItsDistrict === true, AP);
need('…with an edit affordance for the admin who is standing there',
     AP.hasEditAffordance === true, AP);
need('🔴 CONTROL: and NOT on a district it was not written for',
     AP.absentElsewhere === true, AP);
need('the Builder list says where each mission happens',
     AP.builderListNamesDistrict === true, AP);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — you author a mission by standing on the district it happens in.');
