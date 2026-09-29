/* ══════════════════════════════════════════════════════════════════════════
   🔀 DRIVE-CORP-SWITCHER — "our corporation vault lost everything"

   Nothing was lost. Grimalkin Lord founded TWO corporations five hours apart,
   both named River Meadows Corp, both tagged RIVE — the deployed corp_members
   permits two rows for one player even though the schema declares user_id as
   its primary key. All 362,706 units they deposited went to d7e01ff9…; the
   other was never used. The resolver ranked "role matches founder|owner|ceo,
   then corp_id ascending", BOTH matched, and 75431c23… sorts first — so the
   game bound them to the EMPTY corporation and honestly reported an empty
   vault. It was the wrong vault, and index.html already computed Corp._multi
   for exactly this case with a comment saying the player "has no way to know
   which" — and then nothing read it.

   ⚠ THE FIXTURE IS THE REAL SHAPE. Two corps with the SAME name and tag, whose
     ids sort the wrong way round, one holding everything. A test with two
     distinguishable corporations would pass on the broken build.

   ⚠ THE CONTROL IS THE ONE-CORP PLAYER. The switcher must NOT render for them —
     a picker with one option is noise, and it is what almost everybody sees.

   Run:  node .gauntlet/drive-corp-switcher.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const P = 9300 + Math.floor(Math.random() * 400);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 980 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 170)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/corp/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction("!!(window.JB_action && /Guild & Hiring/.test(document.body.innerText))", null, { timeout: 120000 });
await pg.waitForTimeout(700);

/* The two ids are the real ones, and their ORDER is the point: '75431c23…'
   sorts before 'd7e01ff9…', which is why the old rule picked the empty one. */
const EMPTY = '75431c23-0b8d-4034-b540-02eb13db1966';
const FULL  = 'd7e01ff9-4b33-4b2b-b56b-32464f85ae81';

const ECON = (currentId, corps) => ({
  signedIn: true, handle: 'Grimalkin Lord', amOwner: true, cinders: 1000, aza: 0, mt: 0,
  memberCount: 1,
  corp: { id: currentId, name: 'River Meadows Corp', tag: 'RIVE', role: 'founder' },
  roster: [{ userId: 'u-grim', name: 'Grimalkin Lord', role: 'founder' }],
  requests: [], corpPickWhy: 'holdings',
  myCorps: corps,
});

async function open(econ) {
  await pg.evaluate(() => { document.querySelectorAll('.modal-head .x').forEach(x => x.click()); });
  await pg.waitForTimeout(200);
  await pg.evaluate((e) => {
    window.__JB.econ = e; window.__JB.ready = true;
    window.__acts = []; window.JB_action = (p) => { window.__acts.push(p); };
    window.dispatchEvent(new Event('jbdata'));
    window.dispatchEvent(new CustomEvent('jb:open', { detail: 'guild' }));
  }, econ);
  await pg.waitForFunction("!!document.querySelector('.modal-body')", null, { timeout: 15000 });
  await pg.waitForTimeout(400);
}

// ── A. TWO IDENTICAL CORPS, the empty one selected ────────────────────────
await open(ECON(EMPTY, [
  { id: EMPTY, name: 'River Meadows Corp', tag: 'RIVE', role: 'founder', held: 0, current: true },
  { id: FULL,  name: 'River Meadows Corp', tag: 'RIVE', role: 'founder', held: 362706, current: false },
]));

const twoCorp = await pg.evaluate(async () => {
  const o = {};
  const txt = document.body.innerText;
  o.shown = /You are in 2 corporations/i.test(txt);
  o.saysEmpty = /vault empty/i.test(txt);
  o.saysFull = /362,706 units in vault/i.test(txt);
  o.explains = /vault a deposit\s+reaches/i.test(txt.replace(/\s+/g, ' '));
  o.saysAuto = /Picked automatically because it is the one holding your goods/i.test(txt);
  const btns = Array.from(document.querySelectorAll('button')).filter(x => /Acting|Switch/.test(x.textContent));
  o.rows = btns.length;
  o.actingDisabled = btns.filter(x => /Acting/.test(x.textContent)).every(x => x.disabled);
  // Click the one that is NOT current.
  const target = btns.find(x => /Switch/.test(x.textContent));
  o.hasSwitch = !!target;
  if (target) { target.click(); await new Promise(r => setTimeout(r, 400)); }
  o.acts = (window.__acts || []).slice();
  return o;
});

// ── B. CONTROL · one corporation ⇒ no switcher at all ─────────────────────
await open(ECON(FULL, [
  { id: FULL, name: 'River Meadows Corp', tag: 'RIVE', role: 'founder', held: 362706, current: true },
]));
const oneCorp = await pg.evaluate(() => ({
  shown: /You are in \d+ corporations/i.test(document.body.innerText),
  switchBtns: Array.from(document.querySelectorAll('button')).filter(x => /Acting|Switch/.test(x.textContent)).length,
}));

// ── C. CONTROL · no list at all (an older host that does not send it) ──────
await open(Object.assign(ECON(FULL, []), { myCorps: undefined }));
const noList = await pg.evaluate(() => ({
  shown: /You are in \d+ corporations/i.test(document.body.innerText),
  guildStillRendered: /Guild & Hiring/i.test(document.body.innerText),
}));

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F500} CORP SWITCHER — TWO CORPORATIONS, ONE NAME\n');
console.log('  ── the case that lost a vault');
ok('the switcher renders when there is a choice', twoCorp.shown === true);
ok('\u{1F3AF} it lists BOTH identically-named corporations', twoCorp.rows === 2, twoCorp.rows + ' rows');
ok('\u{1F3AF} …and tells them apart by what each HOLDS',
  twoCorp.saysFull === true && twoCorp.saysEmpty === true,
  'one reads 362,706 units, the other reads empty');
ok('it says which vault a deposit reaches', twoCorp.explains === true);
ok('the corporation being acted in is marked and not clickable', twoCorp.actingDisabled === true);

console.log('\n  ── switching');
ok('the other corporation offers a Switch', twoCorp.hasSwitch === true);
const a = (twoCorp.acts || [])[0] || {};
ok('\u{1F3AF} clicking it dispatches corpPick', a.kind === 'corpPick', JSON.stringify(a));
ok('\u{1F3AF} …for the corporation that HOLDS the goods', a.corpId === 'd7e01ff9-4b33-4b2b-b56b-32464f85ae81',
  String(a.corpId));
ok('exactly one action was sent', (twoCorp.acts || []).length === 1, (twoCorp.acts || []).length + '');
ok('it explains the automatic pick when the host made one', twoCorp.saysAuto === true);

console.log('\n  ── CONTROLS');
ok('\u{1F3AF} a player in ONE corporation sees no switcher',
  oneCorp.shown === false && oneCorp.switchBtns === 0,
  oneCorp.switchBtns + ' switch rows');
ok('\u{1F3AF} a host that sends no list degrades to nothing, not to a crash',
  noList.shown === false && noList.guildStillRendered === true);

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
