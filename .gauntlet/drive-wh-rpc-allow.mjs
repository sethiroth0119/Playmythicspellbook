/* ══════════════════════════════════════════════════════════════════════════
   🔌 DRIVE-WH-RPC-ALLOW — every warehouse RPC the client calls is allowed to.

   THE REPORT: "it say could not save the rate."

   THE CAUSE: _whRpc() checks WH_RPC_ALLOW before it touches the network and
   returns null for any name that is not on it. wh_set_rent_rate and
   wh_renew_unit were never added, so BOTH features shipped dead:

     · the Workstation's rate screen reported "Could not save that rate"
     · every term button on the rent-expired modal failed silently

   …while the SQL behind them was applied, owned by postgres, granted to
   `authenticated`, and provably working when called directly. The allowlist is
   the right design — it stops an iframe inventing a call — but adding to it is
   part of shipping an RPC, and I did not.

   🔴 SO THIS DOES NOT TEST THE TWO NAMES I JUST FIXED. Pinning those would
      catch this exact mistake and no other. It reads every _whRpc('…') and
      WH.rpc('…') call site out of BOTH files and checks each against the
      allowlist, so the NEXT new RPC that forgets this step fails here instead
      of in a player's hands.

   Pinned, with controls:
     · every RPC name the shell calls is on the allowlist
     · every RPC name the warehouse iframe calls is on the allowlist
     · CONTROL: the scan actually found the call sites (a regex that matches
       nothing would pass this file trivially)
     · CONTROL: an invented name IS rejected by the live gate
     · the two that were broken are callable

   Run:  node .gauntlet/drive-wh-rpc-allow.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const wh    = fs.readFileSync(path.join(ROOT, 'warehouse', 'index.html'), 'utf8');

/* Call sites, read out of the source. Both spellings: the shell calls
   _whRpc('name', …) directly; the iframe calls WH.rpc('name', …) and the parent
   funnels it through the same gate. */
const namesIn = (src, re) => {
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
};
const shellCalls = namesIn(shell, /_whRpc\(\s*'([a-z_]+)'/g);
const ifaceCalls = namesIn(wh,    /WH\.rpc\(\s*'([a-z_]+)'/g);

/* The allowlist, read out of the shell rather than retyped — a copy here would
   pass while the real one was wrong. */
const allowBlock = /const WH_RPC_ALLOW\s*=\s*\{([\s\S]*?)\n\};/.exec(shell);
const allowed = new Set();
if (allowBlock) {
  let m; const re = /([a-z_]+)\s*:\s*1/g;
  while ((m = re.exec(allowBlock[1]))) allowed.add(m[1]);
}

const missingShell = [...shellCalls].filter((n) => !allowed.has(n));
const missingIface = [...ifaceCalls].filter((n) => !allowed.has(n));

/* …and the live gate, driven, so this is not purely a source read. */
const M = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9200 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _whRpc === "function" && typeof WH_RPC_ALLOW === "object"', null, { timeout: 150000 }).catch(() => {});
await pg.waitForTimeout(2500);

const live = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof _whRpc === 'function' && typeof WH_RPC_ALLOW === 'object';
  if (!o.reachable) return o;
  o.setRate = !!WH_RPC_ALLOW['wh_set_rent_rate'];
  o.renew   = !!WH_RPC_ALLOW['wh_renew_unit'];
  /* CONTROL: the gate must actually refuse something. Signed out, _whRpc
     returns null for BOTH an allowed and a bogus name, so the distinction that
     matters here is the allowlist lookup itself, checked directly. */
  o.bogusRejected = !WH_RPC_ALLOW['wh_not_a_real_function'];
  o.allowCount = Object.keys(WH_RPC_ALLOW).length;
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
need('CONTROL: the scan found the allowlist', allowed.size > 20, allowed.size);
need('CONTROL: the scan found the shell\'s call sites', shellCalls.size >= 8, [...shellCalls]);
need('CONTROL: …and the iframe\'s', ifaceCalls.size >= 8, [...ifaceCalls]);
need('every RPC the shell calls is allowed', missingShell.length === 0, missingShell);
need('every RPC the warehouse iframe calls is allowed', missingIface.length === 0, missingIface);
if (!live.reachable) bad.push('_whRpc / WH_RPC_ALLOW not reachable in the page');
else {
  need('THE REPORT: wh_set_rent_rate is callable', live.setRate === true, live.setRate);
  need('…and wh_renew_unit with it', live.renew === true, live.renew);
  need('CONTROL: an invented name is still refused', live.bogusRejected === true, live.bogusRejected);
}
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify({
  allowlisted: allowed.size, shellCalls: [...shellCalls].sort(), ifaceCalls: [...ifaceCalls].sort(),
  missingShell, missingIface, ...live, pageErrors: errs.slice(0, 3),
}, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — every warehouse RPC the client calls is one it is allowed to call.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
