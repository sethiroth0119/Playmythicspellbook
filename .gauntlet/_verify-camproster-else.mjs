/* CRITIC driver — Camp tab node roster (city name + vitals), theme-bar pass.
   Fresh-context critic. Renders for real, measures DESIGN-BAR §1-§5. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'D:/game-deploy';
const ROOT = path.resolve(REPO, 'public');
const THREE_DIR = path.resolve(REPO, '.gauntlet/three171');
const SHOTS = path.resolve(REPO, 'tmp/verify-camproster-else');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8930 + (process.pid % 60);

const ROWS = {
  normal: [
    { userId: 'u-ash', camp: 'Ashfall Hollow', player: 'Kael', prestige: 5120, contrib: 61, corp: 'ASH', isYou: false,
      city: 'Ashfall', cityHere: true, pop: 1240, supplies: 6, needs: 3 },
    { userId: 'u-me', camp: 'Saltmarsh Rest', player: 'You', prestige: 340, contrib: 23, corp: 'ASH', isYou: true,
      city: 'Saltmarsh', cityHere: false, pop: 880, supplies: 4, needs: 5 },
    { userId: 'u-bri', camp: 'Briarfell Watch', player: 'Mira', prestige: 118, contrib: 7, corp: null, isYou: false,
      city: null, cityHere: null, pop: null, supplies: null, needs: null },
  ],
  // 40-char camp_name cap + long city name + big numbers: the pathological row
  stress: [
    { userId: 'u-1', camp: 'Wretched Hollow of the Nine Long Sorrows', player: 'Quartermaster Elowen of Greyharbor',
      prestige: 98765, contrib: 100, corp: 'GREYHARBOUR', isYou: true,
      city: 'New Greyharbor of the Endless Salt Marsh', cityHere: false, pop: 1234567, supplies: 18, needs: 24 },
    { userId: 'u-2', camp: 'A', player: 'B', prestige: 0, contrib: 0, corp: null, isYou: false,
      city: 'C', cityHere: true, pop: 0, supplies: 0, needs: 0 },
    { userId: 'u-3', camp: 'Briarfell Watch', player: 'Mira', prestige: 118, contrib: 7, corp: null, isYou: false,
      city: null, cityHere: null, pop: null, supplies: null, needs: null },
  ],
  // the best-effort city lookup FAILED for everyone: label, never a row
  nocity: [
    { userId: 'u-a', camp: 'Ashfall Hollow', player: 'Kael', prestige: 512, contrib: 41, corp: 'ASH', isYou: false,
      city: null, cityHere: null, pop: null, supplies: null, needs: null },
    { userId: 'u-b', camp: 'Saltmarsh Rest', player: 'You', prestige: 340, contrib: 62, corp: null, isYou: true,
      city: null, cityHere: null, pop: null, supplies: null, needs: null },
  ],
  hostile: [
    { userId: 'h-obj', camp: { n: 'x' }, player: { p: 1 }, prestige: 'lots', contrib: null, corp: { c: 'A' }, isYou: false,
      city: { name: 'Object City' }, cityHere: 'yes', pop: 'many', supplies: [1], needs: {} },
    { userId: 'h-xss', camp: '<b>Bold</b> & "q"', player: 'Mira', prestige: '12abc', contrib: '7', corp: '   ', isYou: true,
      city: '<img src=x onerror=alert(1)>', cityHere: false, pop: '99', needs: '2', supplies: '3' },
  ],
};

function parentHtml(q) {
  const set = q.get('set') || 'normal';
  const rows = ROWS[set] || ROWS.normal;
  return '<!doctype html><meta charset="utf-8"><title>crit harness</title>' +
    '<style>html,body{margin:0;height:100%;background:#0a0a0b}iframe{border:0;width:100vw;height:100vh}</style>' +
    '<script>' +
    'window.getRes=function(){return 0};window.addRes=function(){};window.spendResources=function(){return false};' +
    'window.addCinders=function(){return true};window.spendCinders=function(){return false};window.getCinders=function(){return 0};' +
    'window.cityStateLoad=async function(){return null};window.cityStateSave=function(){return false};' +
    'window.cityOwnerIdentity=function(){return {viewerId:"u-me",viewerName:"You",ownerId:"u-me",ownerName:"You",isOwner:true}};' +
    'window.cityCampRoster=async function(){return {ready:true,why:null,nodeId:"N-20",viewerId:"u-me",source:"fetch",camps:' +
      JSON.stringify(rows) + '}};' +
    '</script><iframe id="f" src="/node-city/index.html"></iframe>';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/__parent') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(parentHtml(u.searchParams)); }
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

async function boot(url, w = 1400, h = 900) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 160)));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
      const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
      const f = path.join(THREE_DIR, rel);
      return fs.existsSync(f)
        ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
        : route.fulfill({ status: 404, body: 'no three' });
    }
    if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const h2 = await page.waitForSelector('#f', { timeout: 60000 });
  const frame = await h2.contentFrame();
  await frame.waitForFunction('!!(window.__nc && window.__nc.campRoster)', null, { timeout: 180000 });
  await frame.waitForFunction('!!(window.__nc && (window.__nc.rail || window.__ncRail))', null, { timeout: 180000 });
  await frame.evaluate(() => { if (window.__nc && !window.__nc.rail && window.__ncRail) window.__nc.rail = window.__ncRail; });
  await page.waitForTimeout(3500);
  return { page, frame, logs };
}

/* ── the MEASURED design-bar probe, run inside the city frame ───────── */
const PROBE = () => {
  const px = (s) => parseFloat(s) || 0;
  const rgb = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const gcs = (el) => el ? getComputedStyle(el) : null;
  const q = (s) => document.querySelector(s);
  const chrome = [];
  const add = (label, el, prop) => {
    if (!el) { chrome.push({ label, missing: true }); return; }
    const v = gcs(el)[prop];
    const c = rgb(v);
    chrome.push({ label, prop, value: v, r: c && c.r, g: c && c.g, b: c && c.b, a: c && c.a,
      bMinusR: c ? c.b - c.r : null });
  };
  // Chrome surfaces: page ground, rail modal, card, roster panel, its borders
  add('html bg', document.documentElement, 'backgroundColor');
  add('body bg', document.body, 'backgroundColor');
  const card = q('#campcard');
  const roster = q('#camproster');
  const railWrap = roster && roster.closest('[id]') ;
  add('#campcard bg', card, 'backgroundColor');
  add('#camproster bg', roster, 'backgroundColor');
  add('#camproster border-top color', roster, 'borderTopColor');
  add('#camproster border-left color', roster, 'borderLeftColor');
  const row = q('#camproster .crrow');
  add('.crrow border-bottom', row, 'borderBottomColor');
  add('.crn color', q('#camproster .crn'), 'color');
  add('.crvk color', q('#camproster .crvk'), 'color');
  add('.crvn color', q('#camproster .crvn'), 'color');
  add('.crcity color', q('#camproster .crcity'), 'color');
  add('.crnil color', q('#camproster .crnil'), 'color');
  add('.crmark color', q('#camproster .crmark'), 'color');
  add('.crelse color', q('#camproster .crelse'), 'color');
  add('.crelse border', q('#camproster .crelse'), 'borderTopColor');
  add('.crme border', q('#camproster .crme'), 'borderTopColor');
  add('.seg i track', q('#camproster .seg i'), 'backgroundColor');
  add('.seg i.on', q('#camproster .seg i.on'), 'backgroundColor');
  add('.crhead color', q('#camproster .crhead'), 'color');
  // the rail modal shell around the card, whatever it is
  let shell = card && card.parentElement;
  let depth = 0;
  while (shell && depth < 4) { add('shell^' + (depth + 1) + ' #' + (shell.id || shell.className.split(' ')[0] || '?') + ' bg', shell, 'backgroundColor'); shell = shell.parentElement; depth++; }

  // radii
  const radii = [];
  const radSel = ['#campcard', '#camproster', '#camproster .crrow', '#camproster .crme',
    '#camproster .crelse', '#camproster .seg i', '#camproster .crlist', '#crburnbox', '#camproster .crv'];
  for (const s of radSel) {
    const el = q(s); if (!el) { radii.push({ sel: s, missing: true }); continue; }
    const cs = gcs(el);
    radii.push({ sel: s, tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius,
      br: cs.borderBottomRightRadius, bl: cs.borderBottomLeftRadius,
      max: Math.max(px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius)) });
  }
  // fonts
  const fonts = [];
  for (const s of ['#camproster .crhead', '#camproster .crn', '#camproster .crsub',
                   '#camproster .crcity', '#camproster .crvn', '#camproster .crvk',
                   '#camproster .crburn', '#camproster .crnil', '#camproster .crelse', '#camproster .crme']) {
    const el = q(s); if (!el) { fonts.push({ sel: s, missing: true }); continue; }
    const cs = gcs(el);
    fonts.push({ sel: s, family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight,
      tracking: cs.letterSpacing, transform: cs.textTransform, style: cs.fontStyle });
  }
  // overflow: page-level and per-cell clipping
  const ov = { docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth };
  const clipped = [];
  document.querySelectorAll('#camproster .crn, #camproster .crsub, #camproster .crcity, #camproster .crvn, #camproster .crv').forEach((el) => {
    if (el.scrollWidth > el.clientWidth + 1) clipped.push({ cls: el.className, text: el.textContent.slice(0, 40), scrollW: el.scrollWidth, clientW: el.clientWidth });
  });
  const rosterOv = roster ? { scrollW: roster.scrollWidth, clientW: roster.clientWidth } : null;
  const listOv = q('#camproster .crlist') ? { scrollW: q('#camproster .crlist').scrollWidth, clientW: q('#camproster .crlist').clientWidth } : null;
  // column alignment: the Pop and Supply key x across rows (staircase test)
  const cols = {};
  ['crvpre', 'crvpop', 'crvsup'].forEach((k) => {
    const xs = Array.from(document.querySelectorAll('#camproster .crv.' + k)).map((e) => +e.getBoundingClientRect().left.toFixed(1));
    const ws = Array.from(document.querySelectorAll('#camproster .crv.' + k)).map((e) => +e.getBoundingClientRect().width.toFixed(1));
    cols[k] = { lefts: xs, spread: xs.length ? +(Math.max(...xs) - Math.min(...xs)).toFixed(1) : null, widths: ws };
  });
  // right edges of every .crv — do the value columns line up as a ledger?
  const rights = Array.from(document.querySelectorAll('#camproster .crv')).map((e) => ({
    cls: e.className, right: +e.getBoundingClientRect().right.toFixed(1), text: e.textContent.slice(0, 24) }));
  // any element visually escaping the roster frame?
  const rb = roster ? roster.getBoundingClientRect() : null;
  const escapes = [];
  if (rb) document.querySelectorAll('#camproster *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > rb.right + 0.6 || r.left < rb.left - 0.6)) escapes.push({ cls: el.className || el.tagName, l: +r.left.toFixed(1), r: +r.right.toFixed(1) });
  });
  // visible fraction of the YOU chip and the 'elsewhere' tag inside their clipping parents
  const vis = [];
  ['#camproster .crme', '#camproster .crelse'].forEach((s) => {
    const el = q(s); if (!el) { vis.push({ sel: s, missing: true }); return; }
    const r = el.getBoundingClientRect();
    const p = el.parentElement.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, p.right) - Math.max(r.left, p.left));
    vis.push({ sel: s, frac: r.width ? +(w / r.width).toFixed(3) : 0, left: +r.left.toFixed(1), parentRight: +p.right.toFixed(1) });
  });
  const text = roster ? roster.textContent.replace(/\s+/g, ' ').trim() : null;
  return { chrome, radii, fonts, ov, clipped, rosterOv, listOv, cols, rights, escapes, vis,
    rowCount: document.querySelectorAll('#camproster .crrow').length,
    youCount: document.querySelectorAll('#camproster .crme').length,
    nilCount: document.querySelectorAll('#camproster .crnil').length,
    elseCount: document.querySelectorAll('#camproster .crelse').length,
    rosterRect: rb ? { w: +rb.width.toFixed(1), h: +rb.height.toFixed(1), x: +rb.x.toFixed(1), y: +rb.y.toFixed(1) } : null,
    text: text && text.slice(0, 900) };
};

async function run(set, w, h) {
  const tag = set + '-' + w + 'x' + h;
  const ctx = await boot('http://127.0.0.1:' + PORT + '/__parent?set=' + set, w, h);
  await ctx.frame.evaluate(() => window.__nc.rail.open('campcard'));
  await ctx.frame.evaluate(() => window.__nc.campRosterRefresh());
  await ctx.page.waitForTimeout(900);
  const out = await ctx.frame.evaluate(PROBE);
  const clip = await ctx.frame.evaluate(() => {
    const c = document.getElementById('campcard'); if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10),
      width: Math.min(window.innerWidth - Math.max(0, r.x - 10), r.width + 20),
      height: Math.min(window.innerHeight - Math.max(0, r.y - 10), r.height + 20) };
  });
  await ctx.page.screenshot({ path: path.join(SHOTS, tag + '-card.png'), clip: clip || undefined }).catch((e) => console.log('shot fail ' + e.message.slice(0, 60)));
  await ctx.page.screenshot({ path: path.join(SHOTS, tag + '-full.png') }).catch(() => {});
  fs.writeFileSync(path.join(SHOTS, tag + '.json'), JSON.stringify(out, null, 1));
  console.log('\n===== ' + tag + ' =====');
  console.log('rows=' + out.rowCount + ' you=' + out.youCount + ' nocity=' + out.nilCount + ' elsewhere=' + out.elseCount);
  console.log('roster rect ' + JSON.stringify(out.rosterRect));
  console.log('CHROME (b-r > 8 fails):');
  out.chrome.forEach((c) => console.log('   ' + (c.bMinusR != null && c.bMinusR > 8 ? 'FAIL ' : '     ') + c.label.padEnd(34) + ' ' + (c.value || 'MISSING') + (c.bMinusR != null ? '   b-r=' + c.bMinusR.toFixed(0) : '')));
  console.log('RADII (>6 fails):');
  out.radii.forEach((r) => console.log('   ' + (r.max > 6 ? 'FAIL ' : '     ') + (r.sel || '').padEnd(28) + ' max=' + (r.missing ? 'MISSING' : r.max)));
  console.log('FONTS:');
  out.fonts.forEach((f) => console.log('   ' + (f.sel || '').padEnd(28) + ' ' + (f.missing ? 'MISSING' : f.family + ' | ' + f.size + ' | w' + f.weight + ' | ls' + f.tracking + ' | ' + f.transform + ' | ' + f.style)));
  console.log('OVERFLOW doc scrollW=' + out.ov.docScrollW + ' clientW=' + out.ov.docClientW + '   roster ' + JSON.stringify(out.rosterOv) + '  list ' + JSON.stringify(out.listOv));
  console.log('CLIPPED CELLS: ' + JSON.stringify(out.clipped));
  console.log('ESCAPES: ' + JSON.stringify(out.escapes.slice(0, 6)));
  console.log('COLS: ' + JSON.stringify(out.cols));
  console.log('RIGHT EDGES: ' + JSON.stringify(out.rights));
  console.log('CHIP VISIBILITY: ' + JSON.stringify(out.vis));
  console.log('TEXT: ' + out.text);
  if (ctx.logs.length) console.log('PAGE LOGS: ' + JSON.stringify(ctx.logs.slice(0, 5)));
  await ctx.page.close();
  return out;
}

const sets = (process.argv[2] || 'normal,stress,nocity,hostile').split(',');
for (const s of sets) {
  await run(s, 1400, 900);
}
await run('normal', 1024, 800);

await browser.close();
server.close();
console.log('\nshots -> ' + SHOTS);
