/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-VAULT — the driven half of the Ops Vault readout.

   The cap (8,000 units) and the deposit fee (500 🔥) are enforced in ONE place,
   index.html's boeDepositRes, and until this round nothing rendered either of
   them. A player met the ceiling as a toast at the moment of refusal and had no
   way to see it coming.

   The risk in fixing that is a SECOND COPY of the rule: a panel that draws its
   own ceiling drifts from the one that refuses the deposit, and the drawn one
   is the half the player believes. So the numbers travel over the bridge from
   the enforcing helpers (__boeVault), and this driver proves the panel prints
   what the bridge said rather than anything of its own:

     1  THE BRIDGE CARRIES A CEILING — vaultState() reports cap/fee/used/room,
        and room is exactly cap − used, computed from the vault contents.
     2  THE PANEL PRINTS IT — the room row and the fee note appear in the modal
        DOM, WITH A CONTROL: a bridge reporting cap 0 must print NEITHER, since
        a made-up "0 / 0" would be worse than the old silence.
     3  THE ALL-IN BUTTON CANNOT ASK FOR A REFUSAL — with more in camp than the
        vault has room for, "All in" offers the room, not the camp pile. The
        control is the same tile under a cap the vault is nowhere near, where it
        must still offer the whole pile.
     4  THE READOUT IS THE BRIDGE'S, NOT THE PANEL'S — move the ceiling
        underneath a rendered panel and repaint: the row follows. A panel that
        had hardcoded 8,000 passes 1–3 and fails this.

   Run:  node .gauntlet/drive-vault.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8800 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });

await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});

/* Pre-seed the standalone mock vault so the page boots with a vault that is
   already 7,900 full — the interesting state, and the one a fresh mock never
   reaches on its own. The key is read once and memoised, so it has to be in
   place before the module script runs. */
await page.addInitScript(() => {
  try { localStorage.setItem('mythic_city_mockvault_v1', JSON.stringify({ metal: 7900 })); } catch (e) {}
});

const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 260)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 260)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('\n0. boot');
const boot = await page.evaluate(() => ({ nc: !!window.__nc, panel: !!(window.__nc && window.__nc.vaultPanel) }));
ok('the page booted with the diagnostics seam', boot.nc);
ok('the seam exposes the vault panel', boot.panel);
if (!boot.panel) { console.log('\nno seam — nothing below can be trusted'); await browser.close(); server.close(); process.exit(1); }

/* ── 1. THE BRIDGE CARRIES A CEILING ─────────────────────────────────── */
console.log('\n1. the bridge reports a ceiling, and room is derived from it');
const st = await page.evaluate(async () => await window.__nc.vaultState());
ok('cap is reported', (st.cap | 0) > 0, 'cap=' + st.cap);
ok('fee is reported', (st.fee | 0) > 0, 'fee=' + st.fee);
ok('used reflects the seeded 7,900', (st.used | 0) === 7900, 'used=' + st.used);
ok('room === cap − used (not a second sum)', (st.room | 0) === (st.cap | 0) - (st.used | 0),
   st.room + ' === ' + st.cap + ' − ' + st.used);

/* ── 2. THE PANEL PRINTS IT, WITH A CONTROL ──────────────────────────── */
console.log('\n2. the modal prints the room row and the fee note — control: a bridge with no cap');
const painted = await page.evaluate(async () => {
  const read = () => {
    const box = document.getElementById('cardpicker');
    if (!box) return null;
    const room = box.querySelector('#v-room');
    return {
      html: box.innerHTML,
      room: room ? room.textContent : null,
      hasRoomRow: !!room,
      feeNote: /A deposit costs/.test(box.innerHTML),
    };
  };
  const close = () => { const b = document.getElementById('cardpicker'); if (b) b.remove(); };

  close();
  await window.__nc.vaultPanel('metal');
  const capped = read();
  close();

  /* CONTROL. Blind the bridge to the ceiling and reopen. Nothing else changes.
     A panel that draws its own 8,000 renders the row here anyway — which is
     exactly the failure this control exists to catch. */
  const B = window.MythicCityBridge;
  const real = B.vaultState;
  B.vaultState = async () => {
    const s = await real();
    return { ready: s.ready, canBank: s.canBank, bank: s.bank };  // no cap/fee/room
  };
  await window.__nc.vaultPanel('metal');
  const blind = read();
  close();
  B.vaultState = real;
  return { capped, blind };
});
ok('the room row is in the modal', !!(painted.capped && painted.capped.hasRoomRow), 'reads: ' + (painted.capped && painted.capped.room));
ok('the room row shows 100 / 8,000', !!(painted.capped && /100\s*\/\s*8,000/.test(painted.capped.room || '')),
   JSON.stringify(painted.capped && painted.capped.room));
ok('the fee note is in the modal', !!(painted.capped && painted.capped.feeNote));
ok('CONTROL — no cap from the bridge, NO room row invented', !!(painted.blind && painted.blind.hasRoomRow === false));
ok('CONTROL — no cap from the bridge, NO fee note invented', !!(painted.blind && painted.blind.feeNote === false));

/* ── 3. ALL-IN CANNOT ASK FOR A REFUSAL ──────────────────────────────── */
console.log('\n3. "All in" offers the room, not the pile — control: a vault with space to spare');
const allin = await page.evaluate(async () => {
  const label = () => {
    const box = document.getElementById('cardpicker');
    const b = box && box.querySelector('[data-v="max-dep"]');
    return b ? b.textContent : null;
  };
  const close = () => { const b = document.getElementById('cardpicker'); if (b) b.remove(); };
  const g = window.__nc.game;

  g.res.metal = 5000;                       // far more in camp than the 100 of room
  close();
  await window.__nc.vaultPanel('metal');
  const tight = label();
  close();

  /* CONTROL: same tile, same camp pile, a vault that is nearly empty. If the
     clamp were a blanket cap on the button rather than the vault's headroom,
     this would come back clamped too. */
  const B = window.MythicCityBridge;
  const real = B.vaultState;
  B.vaultState = async () => {
    const s = await real();
    return Object.assign({}, s, { used: 10, room: (s.cap | 0) - 10 });
  };
  await window.__nc.vaultPanel('metal');
  const loose = label();
  close();
  B.vaultState = real;
  return { tight, loose, camp: g.res.metal | 0 };
});
ok('with 5,000 in camp and 100 of room, All in offers 100', /\(100\)/.test(allin.tight || ''), JSON.stringify(allin.tight));
ok('CONTROL — with room to spare it offers the whole 5,000 pile', /\(5000\)/.test(allin.loose || ''), JSON.stringify(allin.loose));

/* ── 4. THE READOUT IS THE BRIDGE'S ──────────────────────────────────── */
console.log('\n4. move the ceiling under a live panel — the row follows');
const follows = await page.evaluate(async () => {
  const close = () => { const b = document.getElementById('cardpicker'); if (b) b.remove(); };
  const roomText = () => {
    const el = document.querySelector('#cardpicker #v-room');
    return el ? el.textContent : null;
  };
  close();
  const B = window.MythicCityBridge;
  const real = B.vaultState;
  let cap = 8000, used = 7900;
  B.vaultState = async () => {
    const s = await real();
    return Object.assign({}, s, { cap, used, room: Math.max(0, cap - used) });
  };
  await window.__nc.vaultPanel('metal');
  const before = roomText();
  /* A RETUNE, not a deposit: the vault gets bigger. Nothing in the panel knows
     the number 8,000 or the number 25,000 — it only knows what it was handed. */
  cap = 25000;
  close();
  await window.__nc.vaultPanel('metal');
  const after = roomText();
  close();
  B.vaultState = real;
  return { before, after };
});
ok('before the retune the row reads 100 / 8,000', /100\s*\/\s*8,000/.test(follows.before || ''), JSON.stringify(follows.before));
ok('after it reads 17,100 / 25,000 — the panel owns no number of its own',
   /17,100\s*\/\s*25,000/.test(follows.after || ''), JSON.stringify(follows.after));

const errs = logs.filter((l) => l.startsWith('pageerror'));
console.log('\npage errors: ' + errs.length);
errs.slice(0, 6).forEach((e) => console.log('   ' + e));

console.log(fails ? '\n❌ ' + fails + ' CHECK(S) FAILED' : '\n✅ ALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
