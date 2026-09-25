/* ══════════════════════════════════════════════════════════════════════════
   🖥 DRIVE-WAREHOUSE-GLB — "let me put my own PC model in the warehouse"

   The warehouse's fittings are blocks. The owner wants to import a .glb and
   have the block PCs become that model. Three separate things have to line up
   for that to work, and each one has failed silently in this codebase before:

     1. the /dwelling importer must be able to WRITE the tag (room + propId).
        Until this pass it could not — there was no field, so a model could be
        imported and would simply never be found by the warehouse.
     2. /src/decorate/warehouse.js must SELECT on that tag rather than take
        every model in the library (a bedroom lamp is not a workstation).
     3. the mesh must actually replace the block at every workstation already
        standing in the building, without anyone re-placing anything.

   ⚠ THE CONTROL IS THE POINT. The same model, byte for byte, tagged
     'dwelling' instead, must leave the block PC alone. Without that half, a
     test that finds a custom mesh proves only that SOMETHING was loaded — it
     would pass just as happily if the filter were `return true`.

   ⚠ IT USES A REAL .glb. A hand-built single-triangle binary glTF, parsed by
     the same THREE.GLTFLoader the page loads. A fake blob would have been
     rejected by the parser and the fallback would have made the test pass for
     the wrong reason.

   Run:  node .gauntlet/drive-warehouse-glb.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

/* ── a minimal but VALID binary glTF: one triangle, POSITION only ───────── */
function makeGlb() {
  const bin = Buffer.alloc(36);
  const v = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  v.forEach((n, i) => bin.writeFloatLE(n, i * 4));
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  }), 'utf8');
  const pad = (b, f) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4, f)]) : b;
  const j = pad(json, 0x20), bn = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bn.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([head, jh, j, bh, bn]).toString('base64');
}
const GLB_B64 = makeGlb();

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const P = 9800 + Math.floor(Math.random() * 500);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + P;

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const only = (pg) => pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g')) return r.continue();
  return r.abort();
});

/* ─────────────────────────────────────────────────────────────────────────
   A. THE IMPORTER CAN WRITE THE TAG
   Driven through the real form controls, not by writing the record — the
   whole failure being fixed is that the FORM had nowhere to say this.
   ───────────────────────────────────────────────────────────────────────── */
const dw = await b.newPage({ viewport: { width: 1400, height: 900 } });
const dwErrs = []; dw.on('pageerror', e => dwErrs.push(String(e).slice(0, 160)));
await only(dw);
await dw.goto(base + '/dwelling/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await dw.waitForTimeout(4000);

const form = await dw.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const o = { hasRoom: !!$('aRoom'), hasProp: !!$('aProp') };
  if (!o.hasRoom) return o;
  // 'dwelling' must hide the replacement picker; 'wh' must reveal it.
  $('aRoom').value = 'dwelling'; $('aRoom').onchange();
  o.hiddenForDwelling = $('aPropWrap').style.display === 'none';
  $('aRoom').value = 'wh'; $('aRoom').onchange();
  o.shownForWarehouse = $('aPropWrap').style.display !== 'none';
  o.propOptions = Array.from($('aProp').options).map(x => x.value).filter(Boolean);
  return o;
});

/* ─────────────────────────────────────────────────────────────────────────
   B. SEED THE SHARED LIBRARY, THEN SEE WHAT THE WAREHOUSE MAKES OF IT
   Both runs use the SAME .glb bytes and the SAME model id. The only thing
   that differs between them is the tag the importer now writes.
   ───────────────────────────────────────────────────────────────────────── */
async function runWarehouse(record, glbB64) {
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await only(pg);
  await pg.goto(base + '/warehouse/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('!!window.storage', null, { timeout: 60000 });
  await pg.evaluate(async ([rec, b64]) => {
    await window.storage.set('mythic_custom_models_v1', JSON.stringify([rec]));
    await window.storage.set('mythic_glb_' + rec.id, b64);
  }, [record, glbB64]);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForFunction('!!window.WHDecor', null, { timeout: 120000 });
  await pg.waitForTimeout(3500);
  const out = await pg.evaluate(() => ({
    seen: window.WHDecor.modelCount(),
    ws: window.WHDecor.glbFor('workstation'),
    rack: window.WHDecor.glbFor('rack'),
    terminals: window.WHDecor.terminals(),
  }));
  out.errs = errs;
  await pg.close();
  return out;
}

const REC = { id: 'm_testpc', name: 'Test PC', ico: '🖥', r: 0.55, kind: 'glb', scale: 1,
              price: { aza: 0, cinder: 0 }, mount: 'floor', func: '', details: '' };

const tagged = await runWarehouse({ ...REC, room: 'wh', propId: 'workstation' }, GLB_B64);
const control = await runWarehouse({ ...REC, room: 'dwelling', propId: '' }, GLB_B64);

/* ── C. …and it does not leak into the bedroom's furniture market ──────── */
const leak = await dw.evaluate(async ([rec]) => {
  await window.storage.set('mythic_custom_models_v1', JSON.stringify([rec]));
  return true;
}, [{ ...REC, room: 'wh', propId: 'workstation' }]).then(async () => {
  await dw.reload({ waitUntil: 'domcontentloaded' });
  await dw.waitForTimeout(4500);
  return dw.evaluate(() => {
    const t = document.body.innerText || '';
    return { marketMentionsIt: /Test PC/.test(t) };
  });
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F5A5} WAREHOUSE · AN IMPORTED .glb BECOMES THE PCs\n');

console.log('  ── the importer can say where a model belongs');
ok('\u{1F3AF} a Room field exists at all', form.hasRoom === true);
ok('\u{1F3AF} …and a "replaces which fitting" picker', form.hasProp === true);
ok('the picker hides for a dwelling-only model', form.hiddenForDwelling === true);
ok('…and appears for a warehouse one', form.shownForWarehouse === true);
ok('every warehouse fitting is offered', (form.propOptions || []).includes('workstation'),
  JSON.stringify(form.propOptions));

console.log('\n  ── the tagged model reaches the warehouse');
ok('\u{1F3AF} the warehouse picks the model up', tagged.seen === 1, tagged.seen + ' model(s) loaded');
ok('\u{1F3AF} the workstation is drawn from it', tagged.ws === 'm_testpc', String(tagged.ws));
ok('…and only the workstation — other fittings keep their block', tagged.rack === null, String(tagged.rack));
ok('the building still has its terminal', tagged.terminals >= 1, tagged.terminals + '');
ok('no page errors', tagged.errs.length === 0, tagged.errs.slice(0, 2).join(' | '));

console.log('\n  ── CONTROL · the same .glb tagged for the dwelling');
ok('\u{1F3AF} the warehouse ignores it', control.seen === 0, control.seen + ' model(s) loaded');
ok('\u{1F3AF} the PCs stay blocks', control.ws === null, String(control.ws));
ok('the building is otherwise identical', control.terminals === tagged.terminals,
  control.terminals + ' vs ' + tagged.terminals);

console.log('\n  ── and it does not leak the other way');
ok('a warehouse-only model is absent from the dwelling market', leak.marketMentionsIt === false);
ok('the dwelling still runs clean', dwErrs.length === 0, dwErrs.slice(0, 2).join(' | '));

console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
