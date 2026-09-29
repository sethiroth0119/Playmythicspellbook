/* ══════════════════════════════════════════════════════════════════════════
   CAPITAL NOTE PROBE — a player with no capital is told. (bug-mucvogzk)

   "never gets over 1070 cinder per hour, which is a figure I've been at for
    weeks … nothing I do changes it."

   He held five anchors and not one was role='main'. _nodeTownBoost returns a
   flat 1 for anything that is not the capital, so he collected the unboosted
   base — while the UI showed only 🏘 TOWN on every node, which reads as a label
   rather than a problem. MEASURED on the live database: 4 of 7 node owners were
   in that state, 16 nodes between them. sql/168 repaired the accounts; the note
   is what stops it recurring in silence.

   The note must be TRUE and QUIET:
     · shown when anchors are held and none is the capital;
     · hidden the moment one is;
     · hidden for a player with no anchors at all (it cannot nag somebody it
       does not apply to);
     · and it must NOT promote anything — a roleless node still reads as a town,
       because defaulting the other way would hand a brand-new node the
       capital's boost the moment it appeared.

   Usage: node .gauntlet/capitalnote-probe.mjs [root] [--index candidate.html]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r189/public');
const INDEX = flag('index', null);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9610 + Math.floor(Math.random() * 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (INDEX && p === '/index.html') f = path.resolve(INDEX);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof _nodeIsMain === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(1500);

const checks = [];
const ok = (name, pass, note) => { checks.push({ pass }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ CAPITAL NOTE PROBE ══');
console.log('  index : ' + (INDEX || "(the root's own)") + '\n');

const R = await page.evaluate(() => {
  const out = {};
  const has = typeof window._frNoCapitalNote === 'function';
  out.hasFn = has;
  if (!has) return out;
  const set = (nodes) => { FoundationReserve.nodes = nodes; return window._frNoCapitalNote(); };

  /* the reporter's shape: five anchors, four towns, one roleless, no main */
  out.reporter = set([
    { id: 'a', meta: { role: 'town' } }, { id: 'b', meta: { role: 'town' } },
    { id: 'c', meta: { role: 'town' } }, { id: 'd', meta: { role: 'town' } },
    { id: 'e', meta: {} },
  ]);
  /* after sql/168 promoted the oldest */
  out.withCapital = set([
    { id: 'a', meta: { role: 'main' } }, { id: 'b', meta: { role: 'town' } },
    { id: 'c', meta: {} },
  ]);
  /* a player who owns nothing */
  out.noNodes = set([]);
  /* every node roleless — still no capital, so still shown */
  out.allRoleless = set([{ id: 'a', meta: {} }, { id: 'b', meta: {} }]);
  /* a single anchor that IS the capital */
  out.oneMain = set([{ id: 'a', meta: { role: 'main' } }]);

  /* the note must not have promoted anything */
  FoundationReserve.nodes = [{ id: 'x', meta: {} }];
  window._frNoCapitalNote();
  out.stillRoleless = (FoundationReserve.nodes[0].meta || {}).role === undefined;
  out.rolelessReadsAsTown = window._nodeIsMain(FoundationReserve.nodes[0]) === false;
  return out;
});

if (!R.hasFn) { ok('the note exists at all', false, '_frNoCapitalNote absent'); }
else {
  const shown = (s) => typeof s === 'string' && s.indexOf('no capital') >= 0;
  console.log('  reporter shape → ' + (shown(R.reporter) ? 'NOTE SHOWN' : 'nothing') );
  console.log('  with a capital → ' + (shown(R.withCapital) ? 'NOTE SHOWN' : 'nothing'));
  console.log('  no anchors     → ' + (shown(R.noNodes) ? 'NOTE SHOWN' : 'nothing') + '\n');
  ok('1a the reporter\'s shape (5 anchors, no capital) is told', shown(R.reporter));
  ok('1b …the note says what to press', /Make capital/.test(R.reporter || ''));
  ok('2a a player WITH a capital is not nagged', !shown(R.withCapital));
  ok('2b a single anchor that is the capital is not nagged', !shown(R.oneMain));
  ok('3a a player with no anchors at all is not nagged', !shown(R.noNodes));
  ok('3b anchors that are all roleless still count as having no capital', shown(R.allRoleless));
  ok('4a the note PROMOTES NOTHING — the node is still roleless afterwards', R.stillRoleless === true);
  ok('4b …and a roleless node still reads as a town, never a main', R.rolelessReadsAsTown === true);
}

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
