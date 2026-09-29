/* ══════════════════════════════════════════════════════════════════════════
   🏠 DRIVE-DWELLING-SAVE — can a decorated home still be wiped?

   THE REPORT: furniture bought with real currency disappears after leaving,
   reloading or coming back later.

   THE MECHANISM, which this drives directly: load() caught its own failure and
   returned, leaving `placed` EMPTY because rebuild() never ran. save() could
   not tell that apart from an empty house, so the next write — a click, a
   purchase, walking out — committed `items: []` over the real one. IndexedDB
   throwing is ordinary: private browsing, a quota trip, a corrupt store.

   ⚠ THE STORAGE SHIM IS REPLACED BEFORE THE PAGE RUNS. dwelling/index.html
     opens with `if (window.storage) return;`, so an init script that defines
     window.storage first OWNS persistence for the run. That is what lets this
     driver seed a house, then make reads throw on demand, without touching the
     app's own code.

   ⚠ IT PROVES THE TEST CAN FAIL. Round 1 re-creates the OLD behaviour in the
     harness (write whatever is in the scene, no gate) against the same seeded
     house and must WIPE it. If that control survives, this driver is not
     exercising the bug and says so rather than passing.

   Run:  node .gauntlet/drive-dwelling-save.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
const P = 8140 + (process.pid % 50);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const SAVE_KEY = 'mythic_house_layout_v1';
const SNAP_KEY = SAVE_KEY + '_snapshots';
const HOUSE = (n) => ({ v: 2, rev: 7, wall: '#8899aa', pack: {}, owned: {},
  items: Array.from({ length: n }, (_, i) => ({ t: 'chair', x: i * 0.4 - 2, y: 0, z: 1, ry: 0 })) });

/* One page with a scripted storage layer. `mode` decides how reads behave. */
async function run({ seed, snapshots, readMode, act }) {
  const pg = await b.newPage({ viewport: { width: 1200, height: 820 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
    return r.abort();
  });
  await pg.addInitScript(({ seed, snapshots, readMode, SAVE_KEY, SNAP_KEY }) => {
    const mem = Object.create(null);
    if (seed) mem[SAVE_KEY] = JSON.stringify(seed);
    if (snapshots) mem[SNAP_KEY] = JSON.stringify(snapshots);
    window.__mem = mem;
    window.__writes = [];
    window.storage = {
      get: function (k) {
        if (readMode === 'throw' && k === SAVE_KEY) return Promise.reject(new Error('IDB unavailable'));
        if (readMode === 'corrupt' && k === SAVE_KEY) return Promise.resolve({ value: '{not json' });
        return Promise.resolve(mem[k] == null ? null : { value: mem[k] });
      },
      set: function (k, v) { window.__writes.push(k); mem[k] = v; return Promise.resolve(true); },
      delete: function (k) { delete mem[k]; return Promise.resolve(); },
    };
  }, { seed, snapshots, readMode, SAVE_KEY, SNAP_KEY });

  await pg.goto('http://127.0.0.1:' + P + '/dwelling/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg.waitForFunction('!!document.getElementById("saveBtn")', null, { timeout: 60000 }).catch(() => {});
  await pg.waitForTimeout(2200);            // let init() finish its load
  const out = await pg.evaluate(act);
  await pg.waitForTimeout(900);
  const after = await pg.evaluate(({ SAVE_KEY, SNAP_KEY }) => ({
    saved: window.__mem[SAVE_KEY] || null,
    snaps: window.__mem[SNAP_KEY] || null,
    writes: window.__writes.slice(),
    status: (document.getElementById('dwSaveStatus') || {}).textContent || '',
  }), { SAVE_KEY, SNAP_KEY });
  await pg.close();
  return { ...out, ...after, errs };
}
const itemsIn = (json) => { try { const d = JSON.parse(json); return (d.items || d || []).length; } catch (e) { return -1; } };

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F3E0} MY DWELLING — SAVE SAFETY\n');

/* ── 1. CONTROL. The OLD save, run in the harness against the same failure. ── */
const control = await run({
  seed: HOUSE(8), readMode: 'throw',
  act: () => {
    // Exactly what the shipped code used to do: serialise the scene and write.
    const items = [];   // the scene is empty, because the load threw
    window.storage.set('mythic_house_layout_v1', JSON.stringify({ items }), false);
    return { note: 'old behaviour reproduced' };
  },
});
console.log('  ── CONTROL · the OLD save path, same failed load');
ok('   it WIPES the 8-item house (so the probe can see the bug)',
   itemsIn(control.saved) === 0, itemsIn(control.saved) + ' items left');

/* ── 2. THE SHIPPED PATH, same failure. ─────────────────────────────────── */
const blocked = await run({
  seed: HOUSE(8), readMode: 'throw',
  act: () => { document.getElementById('saveBtn').click(); return {}; },
});
console.log('\n  ── SHIPPED · a load that throws');
ok('\u{1F3AF} the 8-item house SURVIVES a save after a failed load',
   itemsIn(blocked.saved) === 8, itemsIn(blocked.saved) + ' items still stored');
ok('\u{1F3AF} nothing was written to the house key at all',
   blocked.writes.indexOf(SAVE_KEY) < 0, blocked.writes.join(', ') || 'no writes');
ok('the player is told, and not with a cheery "saved"',
   /BLOCKED|could not be read/i.test(blocked.status), blocked.status.slice(0, 80));

/* ── 3. Corrupt JSON is the same class of failure. ──────────────────────── */
const corrupt = await run({
  seed: HOUSE(12), readMode: 'corrupt', snapshots: [HOUSE(12)],
  act: () => { document.getElementById('saveBtn').click(); return {}; },
});
console.log('\n  ── SHIPPED · unreadable JSON, with a snapshot available');
ok('\u{1F3AF} it recovers from the snapshot instead of losing the house',
   /Recovered/i.test(corrupt.status) || itemsIn(corrupt.saved) === 12,
   corrupt.status.slice(0, 70) || (itemsIn(corrupt.saved) + ' items'));

/* ── 4. THE HAPPY PATH still works — the anti-vacuity half. A guard that
       blocked everything would pass every check above and break the game. ── */
const happy = await run({
  seed: HOUSE(8), readMode: 'ok',
  act: () => { document.getElementById('saveBtn').click(); return {}; },
});
console.log('\n  ── SHIPPED · a normal load and save');
ok('\u{1F3AF} a good save still goes through', happy.writes.indexOf(SAVE_KEY) >= 0,
   happy.writes.join(', ') || 'nothing written');
ok('the house is intact afterwards', itemsIn(happy.saved) === 8, itemsIn(happy.saved) + ' items');
ok('the revision advanced (stale writes can be rejected later)',
   (() => { try { return JSON.parse(happy.saved).rev === 8; } catch (e) { return false; } })(),
   (() => { try { return 'rev ' + JSON.parse(happy.saved).rev; } catch (e) { return '?'; } })());
ok('the status says saved', /saved/i.test(happy.status), happy.status.slice(0, 60));

/* ── 5. An EXPLICIT clear must still be allowed to persist. ─────────────── */
const cleared = await run({
  seed: HOUSE(8), readMode: 'ok',
  act: () => { document.getElementById('clearBtn').click(); return {}; },
});
console.log('\n  ── SHIPPED · the player empties the house on purpose');
ok('\u{1F3AF} an explicit clear IS saved (the guard does not block real deletes)',
   itemsIn(cleared.saved) === 0, itemsIn(cleared.saved) + ' items after clear');

/* ── 6. A brand-new player has no house, and that must be saveable. ─────── */
const fresh = await run({
  seed: null, readMode: 'ok',
  act: () => { document.getElementById('saveBtn').click(); return {}; },
});
console.log('\n  ── SHIPPED · a player with no saved home yet');
ok('a first save works', fresh.writes.indexOf(SAVE_KEY) >= 0, fresh.writes.join(', ') || 'nothing written');

const allErrs = [].concat(control.errs, blocked.errs, corrupt.errs, happy.errs, cleared.errs, fresh.errs);
console.log('\npage errors: ' + allErrs.length); allErrs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
