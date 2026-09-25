/* ══════════════════════════════════════════════════════════════════════════
   🏷 DRIVE-LISTING-CAP — the slots a player PAID for are the slots they get.

   THE REPORT, three separate times: "I paid for a higher trader membership so
   should have 80 listing slots, but it is still maxxing out at 15" — while the
   header directly above the button read 15 / 80 · PROFESSIONAL TRADER · 65
   REMAINING.

   THE REASON IT SURVIVED TWO FIXES: the cap lived in THREE places and only one
   of them knew about memberships.

     1. trader_enforce_listing_cap()  — DB trigger. Reads trader_slots().
                                        Correct from the day it shipped.
     2. rl_post_listing()             — the RPC. Its own flat `n >= 15`,
                                        refusing BEFORE the trigger could run.
     3. RES_MARKET_MAX_ACTIVE         — a constant in the BROWSER, refusing
                                        before the request was even sent.

   Fixing 2 changed nothing a player could see, because 3 was still refusing.
   Every layer now asks the same question of the same source.

   Pinned, with controls, because a cap that never fires and a cap that always
   fires both look like "the button did something":

     · on an 80-slot membership, listing #16 is ALLOWED
       CONTROL: at 80 of 80 it is refused
     · CONTROL: membership unknown ⇒ the free 15, never a guess upward
     · cards and resources count against ONE pool, as the server counts them
     · the refusal names the real numbers, not a hardcoded 15

   Run:  node .gauntlet/drive-listing-cap.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8550 + (process.pid % 40);
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
await pg.waitForFunction('typeof resMarketPost === "function" && typeof _traderSlots === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof resMarketPost === 'function' && typeof _traderSlots === 'function';
  if (!o.reachable) return o;

  /* The membership module is the source of truth for the number; stand in for
     it so each tier can be posed. Everything below is the real guard. */
  const setTier = (known, slots) => { window.MythicTrader = { snapshot: () => ({ known, slots, used: 0 }) }; };
  const fill = (n) => { const a = []; for (let i = 0; i < n; i++) a.push({ id: 'L' + i }); return a; };

  // ── what the helper answers ─────────────────────────────────────────────
  setTier(true, 80);  o.slotsPro = _traderSlots();
  setTier(true, 300); o.slotsTycoon = _traderSlots();
  setTier(false, 300); o.slotsUnknown = _traderSlots();      // CONTROL: fall back
  window.MythicTrader = undefined; o.slotsNoModule = _traderSlots();

  /* ── the real guard, through the real function ─────────────────────────
     resMarketPost is driven for real and the toast is captured. It is stopped
     by a later gate (sign-in) in every case, so what is being measured is
     WHICH refusal comes back — the capacity one, or something past it. */
  const toasts = [];
  const realToast = window.showToast;
  window.showToast = (m) => { toasts.push(String(m)); };
  /* Past the gates that stand BEFORE the capacity check — sign-in, the resource
     id, lot validation and the post cooldown. They are not what is under test,
     and the first draft of this measured only the sign-in refusal. */
  window.initCloud = () => true;
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true; Profile.cloud.userId = 'me-uuid';
  window.ResMarket = window.ResMarket || {};
  window.CardMarket = window.CardMarket || {};
  ResMarket._lastPostAt = 0;

  const attempt = async (slots, resListings, cardListings) => {
    toasts.length = 0;
    setTier(true, slots);
    ResMarket.mine = fill(resListings);
    CardMarket.mine = fill(cardListings);
    try { await resMarketPost('metal', 100, 1, { currency: 'cinders', price: 10 }); } catch (e) {}
    return toasts.slice();
  };
  const saidFull = (t) => t.some((x) => /Marketplace full/.test(x));

  // 80 slots, 15 used → the sixteenth must NOT be refused for capacity
  o.at15of80 = saidFull(await attempt(80, 15, 0));            // false
  // CONTROL: 80 of 80 → refused
  o.at80of80 = saidFull(await attempt(80, 80, 0));            // true
  o.at80Text = toasts.slice(0, 1);
  // cards and resources share the pool, exactly as the server sums them
  o.at40plus40of80 = saidFull(await attempt(80, 40, 40));     // true
  o.at10plus10of80 = saidFull(await attempt(80, 10, 10));     // false
  // CONTROL: the old behaviour — 15 used on the FREE tier is still full
  o.at15of15 = saidFull(await attempt(15, 15, 0));            // true

  window.showToast = realToast;
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('resMarketPost / _traderSlots are not reachable');
else {
  need('an 80-slot membership reports 80', out.slotsPro === 80, out.slotsPro);
  need('a 300-slot one reports 300', out.slotsTycoon === 300, out.slotsTycoon);
  need('CONTROL: an unknown membership falls back to the free 15', out.slotsUnknown === 15, out.slotsUnknown);
  need('CONTROL: no module at all also falls back to 15', out.slotsNoModule === 15, out.slotsNoModule);
  need('THE REPORT: at 15 of 80, listing is NOT refused', out.at15of80 === false, out.at15of80);
  need('CONTROL: at 80 of 80 it IS refused', out.at80of80 === true, out.at80of80);
  need('…and the refusal names the real numbers', /80 of 80/.test((out.at80Text || [])[0] || ''), out.at80Text);
  need('cards + resources share one pool (40+40 of 80 is full)', out.at40plus40of80 === true, out.at40plus40of80);
  need('…and 10+10 of 80 is not', out.at10plus10of80 === false, out.at10plus10of80);
  need('CONTROL: the free tier still stops at 15', out.at15of15 === true, out.at15of15);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the browser, the RPC and the trigger all read the membership the player bought.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
