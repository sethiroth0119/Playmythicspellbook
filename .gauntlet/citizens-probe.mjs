/* ══════════════════════════════════════════════════════════════════════════
   CITIZEN INFLUENCE PROBE — does "the influence go up" on the Ethos Heights
   INFLUENCE panel, and does it STAY up?

   Real modules in the loaded page (/src/missions/state.js is imported by URL,
   so it is the same instance index.js mounted):
     A. fortify() on a clear district raises that district's citizens.
     B. creditRuns() with a survived msn_ raid raises that district's citizens
        (+survived, +cleared when the faction goes).
     C. the panel HTML (influenceHtml) shows the raised numbers.
     D. saveProfile() writes it and a RELOAD brings it back (loadForge's local
        whitelist) — checked on the raw Profile before any module touches it.
     E. the cloud payload carries it (__missionMap__) so another device sees it.

   Usage: node .gauntlet/citizens-probe.mjs [candidate.html]   (:8787 up)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
const R = [];
const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });

async function boot() {
  await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
  await p.waitForFunction(() => window.MythicMissionBridge && window.MythicMissions, null, { timeout: 60000 });
}

await boot();
const s1 = await p.evaluate(async () => {
  const out = {};
  const B = window.MythicMissionBridge;
  const S = await import('/src/missions/state.js');
  const TAB = await import('/src/missions/influence-tab.js');
  const P = B.profile();
  delete P.missionMap;                         // a clean board for the probe
  P.rlcCompleted = (P.rlcCompleted || []).filter(id => id.indexOf('msn_') !== 0);
  S.debugReset();
  out.startVillage = S.citizens('village').value;
  out.fortOk = S.fortify('village');           // village is clear on the seed board
  out.village = S.citizens('village').value;
  // a survived raid into Harlem (The Scum, 38%) — one run, id as graph.js builds it
  const id = 'msn_harlem_scum_38_1';
  P.rlcCompleted.push(id);
  out.creditLines = S.creditRuns(P.rlcCompleted);
  out.harlem = S.citizens('harlem').value;
  out.harlemHold = S.hold('harlem');
  const html = TAB.influenceHtml({});
  out.panelStanding = (html.match(/Standing <b>(\d+)<\/b>/) || [])[1];
  out.panelHasVillage = /The Village[\s\S]*?· (\d+)\/100/.test(html) ? html.match(/The Village[\s\S]*?· (\d+)\/100/)[1] : null;
  out.saved = B.saveProfile();
  let raw = null; try { raw = JSON.parse(localStorage.getItem('hg_profile') || 'null'); } catch (e) {}
  out.diskCit = raw && raw.missionMap && raw.missionMap.cit;
  // E. the cloud payload — find the builder by the key it must carry
  out.payloadHasKey = null;
  try {
    const src = [...document.scripts].map(s => s.textContent).join('\n');
    out.payloadHasKey = src.indexOf('__missionMap__') >= 0;
  } catch (e) {}
  return out;
});
ok('A0 village starts Wary 0', s1.startVillage === 0, s1.startVillage);
ok('A1 fortify() on a clear district succeeds', s1.fortOk === true);
ok('A2 …and the village citizens go UP', s1.village > 0, s1.village);
ok('B1 a survived raid credits Harlem citizens', s1.harlem > 0, s1.harlem + ' lines=' + JSON.stringify(s1.creditLines) + ' hold=' + JSON.stringify(s1.harlemHold));
ok('C1 the panel total reflects it', (s1.panelStanding | 0) === s1.village + s1.harlem, 'panel=' + s1.panelStanding);
ok('C2 the panel row for The Village shows it', (s1.panelHasVillage | 0) === s1.village, s1.panelHasVillage);
ok('D0 saveProfile wrote missionMap.cit to disk', s1.diskCit && s1.diskCit.village === s1.village, JSON.stringify(s1.diskCit));

await boot();
const s2 = await p.evaluate(async () => {
  const P = window.MythicMissionBridge.profile();
  // RAW read, before the map module's mm() can reseed or re-credit anything
  const raw = P.missionMap ? JSON.parse(JSON.stringify(P.missionMap)) : null;
  // clean up the probe's fake clear so it does not linger in a real save
  P.rlcCompleted = (P.rlcCompleted || []).filter(id => id !== 'msn_harlem_scum_38_1');
  return { raw };
});
ok('D1 after RELOAD Profile.missionMap survives the load whitelist', !!s2.raw, s2.raw ? 'present' : 'undefined (dropped by loadForge)');
ok('D2 …with the citizens intact', s2.raw && s2.raw.cit && s2.raw.cit.village === s1.village && s2.raw.cit.harlem === s1.harlem, JSON.stringify(s2.raw && s2.raw.cit));
ok('D3 …and the train/fortify/credited state intact', s2.raw && s2.raw.credited && s2.raw.credited.indexOf('msn_harlem_scum_38_1') >= 0 && s2.raw.fort && s2.raw.fort.village === 2, JSON.stringify(s2.raw && { credited: s2.raw.credited, fort: s2.raw.fort }));
ok('E1 the cloud payload names __missionMap__', s1.payloadHasKey === true, s1.payloadHasKey);

let fail = 0;
for (const r of R) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.detail ? '  [' + r.detail + ']' : '')); }
if (errs.length) console.log('page errors:', errs.slice(0, 5));
console.log(fail ? fail + ' FAILED' : 'ALL PASS');
await b.close();
process.exit(fail ? 1 : 0);
