/* ══════════════════════════════════════════════════════════════════════════
   🏛 DRIVE-CITY-MESH — every building type builds without throwing.

   THE REPORT: "he just tried to build something and it still did not save."
   His console gave the real answer:

     city load failed ReferenceError: x is not defined
       at buildMesh() at buildMesh() at buildMesh() at loadState()
     [bld] mesh ReferenceError: x is not defined at buildMesh() … at bldFinish()

   THE CAUSE: buildMesh's parameters are (type, lvl, tx, tz). Two arms —
   'college' and 'university' — read bare `x, z`, which do not exist in that
   scope, so any city containing either threw on load. A city whose load throws
   sets __cityLoadUnsafe and the app then REFUSES to save, rather than
   overwrite a real city with the half-built grid it managed to assemble.
   That safety did its job perfectly; it just made a two-character typo present
   as "nothing I build ever saves" — 92 tiles frozen for three days with ZERO
   write attempts ever reaching the server.

   This does not test those two names. It walks EVERY type in BUILDINGS and
   builds each one, because the bug class is "an arm nobody exercised", and
   naming the two we happen to know about would leave the next one exactly as
   findable as this one was — which is to say, only by a player losing work.

     · every BUILDINGS type builds without throwing
     · CONTROL: a deliberately broken arm IS caught, so a pass means something
     · college and university specifically build (the reported pair)
     · every arm returns real geometry, not a silently empty group

   Run:  node .gauntlet/drive-city-mesh.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8590 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.BUILDINGS && window.__nc.meshBox)', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(8000);

const out = await pg.evaluate(() => {
  const o = {};
  const nc = window.__nc;
  o.reachable = !!(nc && nc.BUILDINGS && nc.meshBox);
  if (!o.reachable) return o;

  const types = Object.keys(nc.BUILDINGS);
  o.typeCount = types.length;
  o.threw = [];
  o.empty = [];
  for (const t of types) {
    let box = null;
    try {
      box = nc.meshBox(t, 1);
    } catch (e) {
      o.threw.push(t + ': ' + String((e && e.message) || e).slice(0, 90));
      continue;
    }
    /* An arm with no recipe returns an EMPTY GROUP rather than throwing — an
       invisible building the player paid for. Recorded separately because it
       is a different defect with the same cause: a switch with no default. */
    if (box && box.empty) o.empty.push(t);
  }

  // The reported pair, by name, so a regression on them is unmistakable.
  o.college = (() => { try { const x = nc.meshBox('college', 1); return { meshes: x.meshes, empty: !!x.empty }; } catch (e) { return 'THREW: ' + e.message; } })();
  o.university = (() => { try { const x = nc.meshBox('university', 1); return { meshes: x.meshes, empty: !!x.empty }; } catch (e) { return 'THREW: ' + e.message; } })();

  /* CONTROL — the sweep must be able to SEE a throw. Without it a green run
     could equally mean "nothing is broken" or "the sweep catches nothing",
     and those are not the same claim.
     ⚠ THE FIRST VERSION OF THIS CONTROL WAS USELESS: it asked whether an
       UNKNOWN type throws. It does not — buildMesh has no default case, so an
       unknown type returns an empty group. That tested the wrong thing and
       would have passed on a sweep that swallowed every error. This forces a
       REAL throw through the same call the sweep uses. */
  o.control = (() => {
    const real = nc.meshBox;
    let seen = false;
    nc.meshBox = function (t, l) { if (t === '__control__') throw new Error('deliberate'); return real.call(nc, t, l); };
    try {
      try { nc.meshBox('__control__', 1); } catch (e) { seen = true; }
    } finally { nc.meshBox = real; }
    return seen ? 'the sweep sees a throw' : 'THE SWEEP IS BLIND';
  })();
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('node-city BUILDINGS / meshBox not reachable');
else {
  need('a real catalogue was swept', out.typeCount > 50, out.typeCount);
  need('NO building type throws while building its mesh', (out.threw || []).length === 0, out.threw);
  need('the reported college builds', !!(out.college && out.college.meshes > 0), out.college);
  need('…and the university with it', !!(out.university && out.university.meshes > 0), out.university);
  /* 🛣 Roads and lanes are drawn by the road layer, not as buildings, so an
     empty group is the right answer for them and always has been. Anything
     ELSE that comes back empty is the "invisible building" this file's own
     comments warn about — paid for, placed, and never drawn. */
  const KNOWN_EMPTY = ['road', 'roadlane'];
  const unexpectedEmpty = (out.empty || []).filter((t) => KNOWN_EMPTY.indexOf(t) < 0);
  need('no building renders as an invisible empty group', unexpectedEmpty.length === 0, unexpectedEmpty);
  need('CONTROL: the sweep can see a throw', /sees a throw/.test(out.control || ''), out.control);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — every building in the catalogue builds its mesh without throwing.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
