/* ══════════════════════════════════════════════════════════════════════════
   🧰 DRIVE-DESKS — Warehouse Worker and Weapon Smith, in a real browser.

   jsxcheck proves app.jsx parses. It cannot tell a role that appears in the
   hiring dropdown from one that was added to an array nothing renders, and it
   cannot tell a desk that OPENS the bench from a button that posts nothing.
   This project's most-repeated defect is a finished feature with no door, so
   the door is what is measured.

   Claims:
     1  BOTH ROLES ARE OFFERED — they appear in the apply dropdown, in the
        founder's per-member role <select>, and in the "roles you can hire"
        list, all three of which read CORP_ROLES.
     2  THE ROSTER RENDERS THE EXACT STRING — corp_members.role comes back as
        'Weapon Smith' / 'Warehouse Worker' and that is what is drawn, not a
        prettified or defaulted label.
     3  THE DESK IS A DOOR — a hired Weapon Smith gets a button that posts
        {kind:'openWeaponSmith'}; a Warehouse Worker gets {kind:'openCorpYard'}
        and {kind:'openWarehouse'}.
     4  IT SAYS WHICH MIGRATION IS MISSING — with the weaponsmith SQL
        unapplied the desk still opens and names it; same for the warehouse
        migration and for sql/047.
     5  IT DEGRADES — no `desks` on the econ at all (an un-reloaded host), and
        an unanswered probe (null), must not render a false failure or a NaN.
     6  NOBODY ELSE SEES IT — a plain member gets no desk panel.

   ⚠ DO NOT fulfil the React/ReactDOM/Babel <script> tags from node_modules.
     All three carry an `integrity` hash; substituted bytes are rejected by SRI
     SILENTLY — a blank page with a clean console. They come from the network.

   Run:  node .gauntlet/drive-desks.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const PORT = 8700 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

const DESKS_OK = {
  role: 'Weapon Smith',
  smith: { staff: true, licensed: false, loaded: true, sql: true, sqlLabel: 'sql/040_weaponsmith.sql … 042' },
  warehouse: { staff: true, owns: false, loaded: true, sql: true, sqlLabel: 'the warehouse migration',
               yardId: 'wh-1', corpSql: true, corpSqlLabel: 'sql/047_corp_desk_roles.sql' },
};

function econ(over) {
  return Object.assign({
    signedIn: true, corpChecked: true, isAdmin: false,
    corp: { id: 'corp-1', name: 'Ironhold', tag: 'IRN', role: 'Weapon Smith' },
    handle: 'Smitty', amOwner: false, cinders: 0, aza: 0, mt: 0,
    roster: [
      { userId: 'u-f', name: 'Founder',  role: 'founder' },
      { userId: 'u-s', name: 'Smitty',   role: 'Weapon Smith' },
      { userId: 'u-w', name: 'Wheeler',  role: 'Warehouse Worker' },
    ],
    memberCount: 3, memberCap: 25, requests: [], pendingHires: [],
    vault: [], transfers: [], corps: [], resources: [],
    depositable: { cards: [], items: [], resources: [] },
    guildChat: [], legalCases: [], agencyListings: [], myOwnedHouses: [],
    realEstateListings: [], convoys: [], opArt: {}, reArt: {}, opEcon: {},
    desks: DESKS_OK,
  }, over || {});
}

async function open(e) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  await page.addInitScript((seed) => { window.__JB = { econ: seed, ready: true }; }, e);
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  // ⚠ _jbridge.js DEFINES window.JB_action at load, clobbering any stub planted
  //   by addInitScript — so the recorder is installed after the page is up.
  await page.evaluate(() => { window.__ACTIONS = []; window.JB_action = (p) => { window.__ACTIONS.push(p); }; });
  // Guild & Hiring is a modal, opened by the sidebar's jb:open event.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jb:open', { detail: 'guild' })));
  await page.waitForTimeout(450);
  return { ctx, page, errs };
}

const readGuild = (page) => page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.card, .modal, div'))
    .find((n) => /Guild|Roster|Roles you can hire/i.test(n.textContent || '')) || document.body;
  const selects = Array.from(document.querySelectorAll('select')).map((s) =>
    Array.from(s.options).map((o) => o.value));
  const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim());
  return {
    text: (document.body.textContent || '').replace(/\s+/g, ' ').trim(),
    selects, buttons,
    deskText: (() => {
      const h = Array.from(document.querySelectorAll('div')).find((n) => /^🧰 Your desk/.test((n.textContent || '').trim()));
      return h && h.parentElement ? h.parentElement.textContent.replace(/\s+/g, ' ').trim() : '';
    })(),
  };
});

async function click(page, label) {
  return page.evaluate((l) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes(l));
    if (!b) return false;
    b.click(); return true;
  }, label);
}

// ── 1 / 2 ───────────────────────────────────────────────────────────────────
console.log('\n1 + 2. both roles are offered everywhere CORP_ROLES is read, and the roster prints the exact string');
{
  const { ctx, page, errs } = await open(econ({ amOwner: true, corp: { id: 'corp-1', name: 'Ironhold', tag: 'IRN', role: 'founder' } }));
  const s = await readGuild(page);
  ok('the guild screen mounted', /Roster/.test(s.text), errs.length ? 'pageerrors: ' + errs[0] : '');
  /* ⚠ Not "every <select> on the screen": the vault panel next door has its own
     sort control (qty/name/dep), and asserting over all of them made this fail
     on a control that has nothing to do with roles. A ROLE select is one that
     offers 'member' and 'CEO'; that is the set that must carry both new ones. */
  const roleSelects = s.selects.filter((o) => o.includes('member') && o.includes('CEO'));
  const withBoth = roleSelects.filter((o) => o.includes('Weapon Smith') && o.includes('Warehouse Worker'));
  ok('the founder gets a per-member role <select>', roleSelects.length >= 1,
     'role selects: ' + roleSelects.length + ' of ' + s.selects.length + ' selects');
  ok('🔴 EVERY role <select> offers both new roles', roleSelects.length > 0 && withBoth.length === roleSelects.length,
     JSON.stringify(roleSelects.map((o) => o.length)));
  ok('the option VALUE is the exact database string, not a slug',
     withBoth[0].includes('Weapon Smith') && withBoth[0].includes('Warehouse Worker'));
  ok('the "roles you can hire" list describes both', /Warehouse Worker/.test(s.text) && /Weapon Smith/.test(s.text));
  ok('🔴 the roster prints the exact corp_members.role strings',
     /Smitty[^]{0,40}Weapon Smith/.test(s.text) && /Wheeler[^]{0,40}Warehouse Worker/.test(s.text));
  ok('no NaN / undefined on the screen', !/NaN|undefined/.test(s.text));
  await ctx.close();

  /* The APPLY dropdown is a different control on a different branch — it is
     only rendered to someone who is NOT in a corporation yet, which is exactly
     the person who needs to be able to apply for these two jobs. */
  const out = await open(econ({ corp: null, amOwner: false, roster: [], desks: null,
                               corps: [{ id: 'corp-1', name: 'Ironhold', tag: 'IRN', members: 3 }] }));
  const o = await readGuild(out.page);
  const applySelects = o.selects.filter((x) => x.includes('member') && x.includes('CEO'));
  ok('🔴 an applicant can APPLY for either job',
     applySelects.length >= 1 && applySelects.every((x) => x.includes('Weapon Smith') && x.includes('Warehouse Worker')),
     JSON.stringify(applySelects));
  ok('no desk panel for someone in no corporation', !/Your desk/.test(o.text));
  await out.ctx.close();
}

// ── 3 ───────────────────────────────────────────────────────────────────────
console.log('\n3. the desk is a DOOR — every button posts a real action');
{
  const { ctx, page } = await open(econ());
  const s = await readGuild(page);
  ok('the desk panel rendered for a hired Weapon Smith', /Your desk/.test(s.text), s.deskText.slice(0, 90));
  ok('it names the position held', /Your desk — Weapon Smith/.test(s.text.replace(/\s+/g, ' ')));
  ok('a bench button exists', s.buttons.some((b) => /Open the bench/.test(b)), JSON.stringify(s.buttons.filter((b) => /bench|yard|warehouse/i.test(b))));
  ok('the yard buttons exist', s.buttons.some((b) => /Walk the yard/.test(b)) && s.buttons.some((b) => /warehouse office/i.test(b)));

  await click(page, 'Open the bench');
  await click(page, 'Walk the yard');
  await click(page, 'Your warehouse office');
  const acts = await page.evaluate(() => window.__ACTIONS);
  console.log('   posted: ' + JSON.stringify(acts));
  ok('🔴 the bench button posts {kind:"openWeaponSmith"}', acts.some((a) => a && a.kind === 'openWeaponSmith'));
  ok('🔴 "Walk the yard" posts {kind:"openCorpYard"}', acts.some((a) => a && a.kind === 'openCorpYard'));
  ok('🔴 the office button posts {kind:"openWarehouse"}', acts.some((a) => a && a.kind === 'openWarehouse'));
  ok('nothing else was posted', acts.length === 3, String(acts.length));
  await ctx.close();
}

// ── 4 ───────────────────────────────────────────────────────────────────────
console.log('\n4. with a migration unapplied the desk still opens and names it');
{
  const smithMissing = JSON.parse(JSON.stringify(DESKS_OK));
  smithMissing.smith.sql = false;
  const { ctx, page } = await open(econ({ desks: smithMissing }));
  const s = await readGuild(page);
  ok('the bench desk is still there', /Weapon Smith’s bench|Weapon Smith’s bench/.test(s.text));
  ok('🔴 it names the weaponsmith migration', /sql\/040_weaponsmith\.sql/.test(s.text), (s.text.match(/sql\/[\w.… ]+/g) || []).join(' | '));
  ok('the bench button is still enabled — the role assigned either way',
     await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Open the bench/.test(x.textContent || '')); return !!b && !b.disabled; }));
  await ctx.close();

  const yardMissing = JSON.parse(JSON.stringify(DESKS_OK));
  yardMissing.warehouse.sql = false;
  const w1 = await open(econ({ desks: yardMissing }));
  const t1 = await readGuild(w1.page);
  ok('🔴 it names the warehouse migration', /warehouse migration|20260812000000_warehouse_storage/.test(t1.text));
  ok('and disables the yard walk rather than sending them nowhere',
     await w1.page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Walk the yard/.test(x.textContent || '')); return !!b && b.disabled; }));
  await w1.ctx.close();

  const corpMissing = JSON.parse(JSON.stringify(DESKS_OK));
  corpMissing.warehouse.corpSql = false;
  const w2 = await open(econ({ desks: corpMissing }));
  const t2 = await readGuild(w2.page);
  ok('🔴 it names sql/047 when the corp lookup is missing', /sql\/047_corp_desk_roles\.sql/.test(t2.text));
  ok('and still offers the worker their OWN office',
     await w2.page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /warehouse office/i.test(x.textContent || '')); return !!b && !b.disabled; }));
  await w2.ctx.close();

  const noYard = JSON.parse(JSON.stringify(DESKS_OK));
  noYard.warehouse.yardId = null;
  const w3 = await open(econ({ desks: noYard }));
  const t3 = await readGuild(w3.page);
  ok('"no yard built" is a DIFFERENT sentence from "migration missing"',
     /has not built a warehouse/.test(t3.text) && !/sql\/047/.test(t3.text), (t3.text.match(/founder has not[^.]*\./) || [''])[0]);
  await w3.ctx.close();
}

// ── 5 / 6 ───────────────────────────────────────────────────────────────────
console.log('\n5 + 6. it degrades, and nobody else sees it');
{
  const unknown = JSON.parse(JSON.stringify(DESKS_OK));
  unknown.smith.sql = null; unknown.warehouse.sql = null; unknown.warehouse.corpSql = null;
  const { ctx, page } = await open(econ({ desks: unknown }));
  const s = await readGuild(page);
  ok('🔴 an unanswered probe says "checking", never a false failure',
     /Checking with the server/.test(s.text) && !/sql\/040/.test(s.text) && !/sql\/047/.test(s.text));
  ok('no NaN / undefined', !/NaN|undefined/.test(s.text));
  await ctx.close();

  // An older host that has not been reloaded pushes no `desks` at all.
  const noDesks = econ(); delete noDesks.desks;
  const n = await open(noDesks);
  const t = await readGuild(n.page);
  ok('🔴 no `desks` on the econ → no panel, and the screen still renders', /Roster/.test(t.text) && !/Your desk/.test(t.text));
  ok('no NaN / undefined', !/NaN|undefined/.test(t.text));
  await n.ctx.close();

  const plain = econ({ corp: { id: 'corp-1', name: 'Ironhold', tag: 'IRN', role: 'member' },
                       desks: { role: 'member',
                                smith: { staff: false, licensed: false, loaded: true, sql: true, sqlLabel: '' },
                                warehouse: { staff: false, owns: false, loaded: true, sql: true, sqlLabel: '', yardId: null, corpSql: true, corpSqlLabel: '' } } });
  const m = await open(plain);
  const mt = await readGuild(m.page);
  ok('a plain member gets no desk panel', !/Your desk/.test(mt.text));
  ok('…but still sees the roster and the role list', /Roster/.test(mt.text) && /Weapon Smith/.test(mt.text));
  await m.ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (fails === 0 ? '✅ ALL PASS' : '❌ ' + fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);
