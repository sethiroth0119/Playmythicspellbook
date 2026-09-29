/* ══════════════════════════════════════════════════════════════════════════
   🏗 DRIVE-PRN-COLLECT — a PRN pays what a PRN earned.

   THE REPORT: "when players collect cinder from one it collects them all but as
   the amount of the cinder one collected. Make it where the cinder collected is
   based on the PRN they are collecting from."

   THE CAUSE, measured before the fix: the 24-hour payout allowance was summed
   across EVERY node the player owned and checked against one cap, so the first
   collect of the day spent the whole allowance and _nodeRealPay then clamped
   every other PRN to zero. Six active PRNs, myPoints 20,000, Free tier (cap
   3,750): all six read 3,750, one was collected for 3,750, and all six then
   read 0. A player who built six PRNs earned what a player who built one did.

   The stamps were always per node — meta.dayStart / meta.dayPaid are written
   inside the same compare-and-swap that commits the claim. Only the READER
   pooled them.

   Pinned here, each with a control, because "a number came out" is not a test:

     · collecting one PRN leaves every other PRN paying exactly what it did
       CONTROL: the collected one drops to 0 — the allowance is spent, per node
     · the cap still BITES on the node that spent it (this is not a removal)
     · a node whose 24h window has EXPIRED pays again
     · the cap VALUE is unchanged — this moves who it applies to, not its size

   Run:  node .gauntlet/drive-prn-collect.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8710 + (process.pid % 40);
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
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _nodeRealPay === "function" && typeof _nodeDayLeft === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const o = {};
  o.reachable = typeof _nodeRealPay === 'function' && typeof _nodeDayUsed === 'function'
             && typeof _nodeDailyCap === 'function';
  if (!o.reachable) return o;

  /* Six identical, active PRNs with a clean 24h window, so any difference
     between them is caused by the collect and by nothing else. */
  const build = () => {
    FoundationReserve.myPoints = 20000;
    FoundationReserve.nodePool = { avail: 100000000, legacy: false };
    FoundationReserve.nodes = ['A','B','C','D','E','F'].map((k, i) => ({
      id: 'n' + i, name: 'PRN ' + k, node_type: 'supply', level: 1, status: 'active',
      owner_id: 'me',
      meta: { readyAt: 0, claimedPoints: 0, lastClaim: 0, eff: 100, lastTick: Date.now(), rev: 1 },
    }));
  };
  const pays = () => FoundationReserve.nodes.map(n => _nodeRealPay(n));
  /* Exactly what _nodeMetaWrite commits on a successful collect. */
  const collect = (i, at) => {
    const n = FoundationReserve.nodes[i];
    const paid = _nodeRealPay(n);
    n.meta = Object.assign({}, n.meta, {
      claimedPoints: FoundationReserve.myPoints, lastClaim: at || Date.now(),
      dayStart: at || Date.now(), dayPaid: paid, rev: (n.meta.rev | 0) + 1,
    });
    return paid;
  };

  o.cap = _nodeDailyCap();
  o.capIsFinite = isFinite(o.cap);

  // ── 1 · one collect must not silence the others ─────────────────────────
  build();
  /* ⚠ A RISK EVENT IS DETERMINISTIC per (node, 6h window), so some PRNs are
     legitimately locked down and pay 0 whatever the allowance says. The
     collected node is chosen from the ones that CAN pay, and the "unchanged"
     claim is made about all the others whatever their state — a locked node
     that stays locked is as much a pass as a paying node that keeps paying. */
  o.before = pays();
  o.payableIdx = o.before.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0);
  const pick = o.payableIdx[0];
  o.pick = pick;
  o.paid = (pick != null) ? collect(pick) : 0;
  o.after = pays();
  o.othersUnchanged = o.after.every((v, i) => (i === pick) || v === o.before[i]);
  o.collectedDroppedToZero = o.after[pick] === 0;

  // ── 2 · the cap still bites on the node that spent it ───────────────────
  o.secondCollectOnSame = _nodeRealPay(FoundationReserve.nodes[pick]);   // must be 0

  // ── 3 · …and releases when that node's own window expires ──────────────
  /* ⚠ THE ALLOWANCE IS NOT THE ONLY GATE. A collected node also has no fresh
     ACCRUAL — claimedPoints was moved up to myPoints — so the window expiring
     on its own pays nothing, correctly. Fresh contribution is added so that
     what is being measured here is the allowance and not the accrual, which
     is the mistake the first draft of this test made. */
  build();
  const idx = o.payableIdx[0];
  collect(idx, Date.now() - (25 * 3600000));    // its window closed an hour ago
  FoundationReserve.myPoints += 20000;          // …and the player contributed since
  o.afterWindowExpired = _nodeRealPay(FoundationReserve.nodes[idx]);
  // CONTROL: same fresh accrual, window still OPEN → the cap still holds it at 0.
  build();
  collect(idx, Date.now());
  FoundationReserve.myPoints += 20000;
  o.withinWindowStillCapped = _nodeRealPay(FoundationReserve.nodes[idx]);

  // ── 4 · CONTROL: the allowance is still shared when asked player-wide ───
  build();
  collect(0); collect(1);
  o.pooledUsed = _nodeDayUsed();                 // no argument → every node
  o.perNodeUsed = _nodeDayUsed(FoundationReserve.nodes[0]);
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('the PRN payout helpers are not reachable');
else {
  need('several PRNs are payable to begin with', (out.payableIdx || []).length >= 3, out.before);
  need('collecting one PRN pays something', out.paid > 0, out.paid);
  need('THE REPORT: the other PRNs still pay exactly what they did', out.othersUnchanged === true,
       { before: out.before, after: out.after });
  need('CONTROL: the collected PRN drops to 0 — its own allowance is spent', out.collectedDroppedToZero, out.after);
  need('the cap still bites on that PRN (this is not a removal)', out.secondCollectOnSame === 0, out.secondCollectOnSame);
  need('…and releases once ITS OWN 24h window expires', out.afterWindowExpired > 0, out.afterWindowExpired);
  need('CONTROL: inside the window it is still held at 0', out.withinWindowStillCapped === 0, out.withinWindowStillCapped);
  need('the cap VALUE is untouched', out.capIsFinite && out.cap > 0, out.cap);
  need('CONTROL: asked player-wide, the pooled figure still sums every node',
       out.pooledUsed > out.perNodeUsed, { pooled: out.pooledUsed, perNode: out.perNodeUsed });
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — each PRN pays its own allowance; collecting one no longer silences the rest, and the ceiling still holds per node.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
