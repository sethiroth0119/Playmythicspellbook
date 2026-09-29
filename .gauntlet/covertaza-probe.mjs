/* ══════════════════════════════════════════════════════════════════════════
   COVERT AZA PROBE — the debrief says what was GIVEN.
   (bug-mu7bk9gy / bug-mu8rh141 / bug-mu8x9c2u)

   🔴 THE AZA IS NOT LOST, and this probe does not pretend otherwise. Measured on
   the live database: aza_reward_log holds cv_resource 80 calls / 80 PAID and
   cv_recruit 12 / 12, and user_progress.sovereigns equals
   user_profiles.sovereigns for every player who has run one. sov_reward pays,
   and both copies of the balance hold it.

   What was wrong is the sentence. The mission report was built from a hardcoded
   constant BEFORE the server answered — `const a = 1; … payout = '+N Cinder, +1
   Aza'` — so it promised the Aza even when sov_reward refused, which it does on
   the rate limit (2 a week for a Resource Run, 1 a fortnight for a Recruitment
   Drive) and whenever the player is offline. That text is stored on the mission
   and re-read every time the debrief is opened, so a player comparing it with
   their wallet concludes the Aza went missing. Three reports, one cause.

   So: drive _covertCollect with sovReward stubbed to PAY and to REFUSE, and
   read the line the player is left with in each case.

   Usage: node .gauntlet/covertaza-probe.mjs [root] [--index candidate.html]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r187/public');
const INDEX = flag('index', null);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9420 + Math.floor(Math.random() * 60);
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
await page.waitForFunction('typeof _covertCollect === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(1500);

const checks = [];
const ok = (name, pass, note) => { checks.push({ pass }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ COVERT AZA PROBE ══');
console.log('  index : ' + (INDEX || "(the root's own)") + '\n');

const R = await page.evaluate(async () => {
  const out = {};
  const run = async (missionId, grant) => {
    Profile.covertActions = [{
      id: 'probe-' + missionId + '-' + grant, missionId,
      endsAt: Date.now() - 1000, collected: false, unitIds: [],
    }];
    window.sovReward = async () => grant;          // the server's answer
    window.addCinders = window.addCinders || (() => {});
    /* ⚠ READ THE HISTORY ENTRY — that is what the player re-reads.
       _covertCollect moves the mission out of Profile.covertActions, unshifts
       a COPY into Profile.covertActionHistory and returns a SECOND copy. So
       the live array is empty (reading it reported "(no reward line)" for
       every case, control included) and the returned snapshot is a detached
       object that a later async update cannot reach. The history entry is the
       one the debrief modal renders, so it is the one worth asserting on. */
    const id = 'probe-' + missionId + '-' + grant;
    try { _covertCollect(id); } catch (e) { return 'threw: ' + e.message; }
    await new Promise(r => setTimeout(r, 300));    // let the grant resolve
    const h = (Profile.covertActionHistory || []).find(x => x && x.id === id);
    return (h && h.reward) || '(no reward line)';
  };
  out.resPaid    = await run('cv_resource', 1);
  out.resRefused = await run('cv_resource', 0);
  out.recPaid    = await run('cv_recruit', 2);
  out.recRefused = await run('cv_recruit', 0);
  out.resPaid3   = await run('cv_resource', 3);   // if the server ever pays more
  return out;
});

console.log('  resource run, server PAID 1 : ' + R.resPaid);
console.log('  resource run, server REFUSED: ' + R.resRefused);
console.log('  recruit,      server PAID 2 : ' + R.recPaid);
console.log('  recruit,      server REFUSED: ' + R.recRefused);
console.log('  resource run, server PAID 3 : ' + R.resPaid3 + '\n');

const hasAza = (s) => /\+\s*\d+\s*Aza/i.test(String(s));
ok('1a a PAID resource run reports the Aza', hasAza(R.resPaid) && /\+1 Aza/.test(R.resPaid));
ok('1b a REFUSED resource run does NOT claim any Aza', !hasAza(R.resRefused), R.resRefused);
ok('1c …and says why instead', /limit|offline/i.test(R.resRefused));
ok('2a a PAID recruitment drive reports the Aza', /\+2 Aza/.test(R.recPaid));
ok('2b a REFUSED recruitment drive does NOT claim any Aza', !hasAza(R.recRefused), R.recRefused);
ok('2c …and still records the contacts half', /recruit contacts/i.test(R.recRefused));
ok('3a the amount is the SERVER\'s, not a constant — 3 granted reads as +3 Aza', /\+3 Aza/.test(R.resPaid3), R.resPaid3);
ok('3b the Cinder half is always stated (it is granted locally and is certain)',
   /Cinder/.test(R.resPaid) && /Cinder/.test(R.resRefused) && /Cinder/.test(R.recRefused));

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
