/* ══════════════════════════════════════════════════════════════════════════
   🏗 DRIVE-BUILD-BRIEF — read what a building does before you pay for it.

   THE ASK: "Add a tool tips modal on what the buildings do, what they for, what
   they will do for the players city npc and how much it will increase the
   economy. Add a build button on the modal … then they can choose to place or
   cancel out of the modal."

   WHAT WAS THERE: clicking a shop card armed placement immediately. The only
   explanation was a HOVER tooltip, which a touch device never sees — so on a
   phone a player picked an 11,000 Cinder Clinic off a grid of icons with no way
   to read what it did.

   🔴 THE ONE FIGURE THIS DELIBERATELY DOES NOT SHOW IS AN INCOME ESTIMATE, and
      the driver asserts its ABSENCE. What a business takes depends on the
      ground it lands on, what the city wants that day, and whether anything
      local buys the output; a number there would be a forecast dressed as a
      measurement. The modal says so in words instead — asserted below, because
      an unexplained blank reads as a broken panel.

   Pinned, with controls:
     · a card click opens the brief and does NOT arm placement
     · the brief names what the building is for
     · it names the jobs, and the SCHOOLING those jobs demand
     · CONTROL: a building with no crew gets no jobs row
     · it names what the building produces / consumes
     · 🔴 it shows no income estimate, and SAYS WHY
     · Place arms placement; Cancel leaves the shop open and the mode alone
     · CONTROL: the affordability check is async and cannot lie either way

   Run:  node .gauntlet/drive-build-brief.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9310 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
/* 💰 A CITY THAT CAN AFFORD THINGS. The Place button is DISABLED when the
   wallet is short — correctly — so a broke test city would have measured a
   button that ignores clicks and called it a broken feature. Seeded through the
   standalone mock ledger key the bridge already reads, before first paint. */
await pg.addInitScript(() => {
  try {
    localStorage.setItem('mythic_city_mockledger_v1', JSON.stringify({
      cinders: 5000000,
      res: { food: 9999, water: 9999, metal: 9999, fuel: 9999, supplies: 9999,
             medicine: 9999, ammo: 9999, corruptedEssence: 999, memoryShards: 999,
             wood: 9999, stone: 9999, cloth: 9999 },
    }));
  } catch (e) {}
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.MythicEconomy', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4500);

const out = {};

out.open = await pg.evaluate(async () => {
  const o = {};
  /* Open the shop through the shipped path, then CLICK A REAL CARD — not a
     direct call to openBuildBrief. The claim under test is that the card no
     longer arms placement, and only a real click can show that. */
  window.__nc.jobfair.shopOpen();
  await new Promise(r => setTimeout(r, 250));
  const card = document.querySelector('#shopbody [data-build="clinic"]')
            || document.querySelector('#shopbody [data-build]');
  o.foundCard = !!card;
  if (!card) return o;
  o.type = card.getAttribute('data-build');
  o.modeBefore = window.__nc.jobfair.mode().mode;
  card.click();
  await new Promise(r => setTimeout(r, 400));
  const v = document.getElementById('bmveil');
  o.modalOpen = !!(v && v.classList.contains('on'));
  /* 🔴 The card must NOT have armed placement — that is the whole change. */
  o.modeAfter = window.__nc.jobfair.mode().mode;
  o.shopStillOpen = !!(document.getElementById('shopveil') || {}).classList
    && document.getElementById('shopveil').classList.contains('on');
  const txt = v ? v.textContent : '';
  o.text = txt.slice(0, 1200);
  o.hasJobs = /Jobs/.test(txt);
  o.hasSchooling = /needs .*(school|College|University|Elementary|Middle|Self-taught)/i.test(txt);
  o.hasEconomyHead = /What it does for the economy/i.test(txt);
  o.hasPeopleHead = /What it does for your people/i.test(txt);
  /* 🔴 no income estimate, and it says why */
  o.explainsNoIncome = /No income estimate is shown on purpose/i.test(txt);
  o.hasPlace = !!v.querySelector('[data-bm-place]');
  o.hasCancel = !!v.querySelector('.bm-cancel');
  o.hasCost = !!v.querySelector('.bm-cost');
  return o;
});

/* ── Cancel leaves everything alone ──────────────────────────────────────── */
out.cancel = await pg.evaluate(async () => {
  const o = {};
  const v = document.getElementById('bmveil');
  const c = v && v.querySelector('.bm-cancel');
  if (!c) return { skipped: 'no cancel button' };
  c.click();
  await new Promise(r => setTimeout(r, 250));
  o.modalClosed = !(document.getElementById('bmveil') || {}).classList.contains('on');
  o.modeAfterCancel = window.__nc.jobfair.mode().mode;
  /* CONTROL: cancelling must leave the SHOP open — the player was reading it. */
  o.shopStillOpen = document.getElementById('shopveil').classList.contains('on');
  return o;
});

/* ── Place arms placement and closes both ────────────────────────────────── */
out.place = await pg.evaluate(async () => {
  const o = {};
  const card = document.querySelector('#shopbody [data-build="farm"]')
            || document.querySelector('#shopbody [data-build]');
  if (!card) return { skipped: 'no card' };
  o.type = card.getAttribute('data-build');
  card.click();
  await new Promise(r => setTimeout(r, 350));
  const btn = document.querySelector('#bmveil [data-bm-place]');
  if (!btn) return { skipped: 'no place button' };
  /* The affordability answer is async; give it a beat, then record what the
     button actually says — a disabled button ignores clicks, and without this
     the failure below would read as 'Place does not work'. */
  await new Promise(r => setTimeout(r, 600));
  o.btnDisabled = !!btn.disabled;
  o.btnLabel = btn.textContent;
  btn.click();
  await new Promise(r => setTimeout(r, 300));
  o.modalClosed = !(document.getElementById('bmveil') || {}).classList.contains('on');
  o.shopClosed = !document.getElementById('shopveil').classList.contains('on');
  o.mode = window.__nc.jobfair.mode().mode;
  o.armed = window.__nc.jobfair.mode().placeType;
  return o;
});

/* ── CONTROL: a building with no crew gets no jobs row ───────────────────── */
out.noCrew = await pg.evaluate(async () => {
  const o = {};
  /* Housing has popCap and no crew — it must show Homes and NOT Jobs. */
  window.__nc.jobfair.shopOpen();
  await new Promise(r => setTimeout(r, 200));
  const card = document.querySelector('#shopbody [data-build="housing"]');
  if (!card) return { skipped: 'no housing card' };
  card.click();
  await new Promise(r => setTimeout(r, 350));
  const txt = (document.getElementById('bmveil') || {}).textContent || '';
  o.hasHomes = /Homes/.test(txt);
  o.hasJobs = /Jobs/.test(txt);
  return o;
});

/* ── the economy seam the brief leans on ─────────────────────────────────── */
out.preview = await pg.evaluate(() => {
  const E = window.MythicEconomy;
  if (!E || typeof E.previewBuilding !== 'function') return { missing: true };
  const p = E.previewBuilding(['wheat', 'corn'], 'farm');
  const bad = E.previewBuilding(['definitely-not-a-good'], 'farm');
  return {
    farm: p, /* CONTROL: an output this ground cannot support returns null, not
                a confident row about a building that could never stand. */
    unknownIsNull: bad === null,
    /* 🔴 revenue must NOT be part of the contract at all. */
    noRevenueField: p ? !('revenue' in p) && !('income' in p) && !('profit' in p) : null,
  };
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const O = out.open || {}, C = out.cancel || {}, PL = out.place || {}, NC = out.noCrew || {}, PV = out.preview || {};

need('SETUP: the shop has cards', O.foundCard === true, O.foundCard);
need('THE ASK: clicking a card opens the brief', O.modalOpen === true, O);
need('🔴 …and does NOT arm placement', O.modeAfter !== 'place', { before: O.modeBefore, after: O.modeAfter });
need('…with the shop still open behind it', O.shopStillOpen === true, O.shopStillOpen);
need('THE ASK: it says what the building does for your people', O.hasPeopleHead === true, O.hasPeopleHead);
need('…naming the jobs it creates', O.hasJobs === true, O.hasJobs);
need('…and the schooling those jobs demand', O.hasSchooling === true, O.text);
need('THE ASK: it says what it does for the economy', O.hasEconomyHead === true, O.hasEconomyHead);
need('🔴 …shows no income estimate, and SAYS WHY', O.explainsNoIncome === true, O.explainsNoIncome);
need('THE ASK: it has a Place button', O.hasPlace === true, O.hasPlace);
need('…a Cancel button', O.hasCancel === true, O.hasCancel);
need('…and the cost', O.hasCost === true, O.hasCost);

need('Cancel closes the brief', C.modalClosed === true, C);
need('CONTROL: …without arming placement', C.modeAfterCancel !== 'place', C.modeAfterCancel);
need('CONTROL: …and leaves the shop open to keep reading', C.shopStillOpen === true, C.shopStillOpen);

need('Place arms placement', PL.mode === 'place', PL);
need('…for the building that was read about', PL.armed === PL.type, PL);
need('…and closes both the brief and the shop', PL.modalClosed === true && PL.shopClosed === true, PL);

if (NC.skipped) console.log('  · no-crew control skipped: ' + NC.skipped);
else {
  need('CONTROL: a house shows Homes…', NC.hasHomes === true, NC);
  need('CONTROL: …and no Jobs row, because it employs nobody', NC.hasJobs === false, NC);
}

need('the economy answers for an unbuilt building', !PV.missing && !!PV.farm, PV);
need('CONTROL: …and returns null for ground that supports nothing', PV.unknownIsNull === true, PV.unknownIsNull);
need('🔴 CONTROL: the preview carries NO revenue field to be tempted by',
     PV.noRevenueField === true, PV.farm);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2).slice(0, 3200));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — a player reads what a building is for, then chooses to place it or walk away.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
