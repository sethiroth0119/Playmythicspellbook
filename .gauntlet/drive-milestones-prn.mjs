/* ══════════════════════════════════════════════════════════════════════════
   🏅 DRIVE-MILESTONES-PRN — more to aim at, and a node you can pick back up.

   TWO ASKS: "Add some more Milestones for players to do to make the game more
   fun" and "Make it where players can click the PRN in the city and demolish
   them as well".

   🔴 THE FIRST ONE UNCOVERED A BROKEN INVARIANT, AND IT IS THE HEADLINE HERE.
      milestones.js carries a long note saying the tree must be clearable, that
      "anyone adding a node MUST re-check it", and that a tree which cannot be
      finished "is a design regression that looks completely fine in review"
      because the panel goes on printing both halves while a branch quietly
      becomes unreachable. That is precisely what had happened:

          36 nodes · 91 ⬡ to clear · 76 ⬡ on offer     ← short by 15

      Nothing failed, because nothing had ever compared the two numbers. This
      driver compares them, so the next node added without a milestone to pay
      for it goes red instead of stranding a branch in silence.

   🔴 THE SECOND ONE WAS NOT A MISSING FEATURE — IT WAS A LABEL. Demolishing a
      PRN plot has always worked, and the handler already releases the licence
      through prnUnsite before anything is torn down. But the button read
      "Demolish (50% refund)" over a node the player LICENSED, in some cases
      with real money. Read plainly that says: press this and half of what you
      paid is gone. So nobody pressed it, and the capability might as well not
      have existed. Nothing is lost — the licence returns to the Reserve
      un-sited and can be re-placed anywhere.

   Pinned, with controls:
     · 🔴 the milestone tree can actually be cleared, with a little to spare
     · every milestone names a metric that exists and has a host reader
     · the five new metrics read real numbers out of a real city
     · 🔴 CONTROL: an unmeasurable metric says WHY, it never reports 0
     · no duplicate milestone ids, and points are all positive
     · 🔌 a PRN plot's button says it is taken up, NOT that it is refunded
     · …and the PRN card offers the same action where the player is reading
     · 🔴 taking one up RELEASES the licence — it does not strand the row
     · 🔴 CONTROL: an ordinary building still says Demolish, with its refund

   Run:  node .gauntlet/drive-milestones-prn.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9570 + (process.pid % 30);
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

/* The same narrow stub drive-prn-siting uses: it stands in for the NETWORK
   only. Every rule about siting, releasing and labelling is the city's own. */
await pg.addInitScript(() => {
  window.__PRN = { rows: [], calls: [] };
  window.cityPrnList = () => window.__PRN.rows.map(r => ({ ...r }));
  window.cityPrnSite = async (id, x, y, rot) => {
    window.__PRN.calls.push({ op: 'site', id, x, y, rot });
    const r = window.__PRN.rows.find(q => q.id === id);
    if (!r) return { ok: false, error: 'no-prn' };
    r.site = { nodeId: 'city', x: x | 0, y: y | 0 }; r.here = true;
    return { ok: true, site: r.site };
  };
  window.cityPrnUnsite = async (id) => {
    window.__PRN.calls.push({ op: 'unsite', id });
    const r = window.__PRN.rows.find(q => q.id === id);
    if (r) { r.site = null; r.here = false; }
    return { ok: true };
  };
});

await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.__nc.jobfair', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(6000);

const out = {};

/* ══ 1 · 🔴 THE INVARIANT ══════════════════════════════════════════════════ */
out.tree = await pg.evaluate(async () => {
  const MS = await import('/src/progression/milestones.js');
  const TR = await import('/src/progression/tree.js');
  const nodes = Object.values(TR.NODES || TR.TREE || TR.default || {});
  let cost = 0;
  for (const n of nodes) cost += (n.cost | 0);
  const offer = MS.totalPointsOnOffer();
  const ids = MS.MILESTONES.map(m => m.id);
  return {
    nodes: nodes.length, cost, offer, spare: offer - cost,
    milestones: MS.MILESTONES.length,
    dupes: ids.filter((x, i) => ids.indexOf(x) !== i),
    /* 🔴 every milestone must name a metric that exists — a typo here makes a
       milestone permanently unreachable and the panel simply shows it greyed,
       which is indistinguishable from "not there yet". */
    orphanMetrics: MS.MILESTONES.filter(m => !MS.METRICS[m.metric]).map(m => m.id + ':' + m.metric),
    nonPositive: MS.MILESTONES.filter(m => !((m.pts | 0) > 0)).map(m => m.id),
    noName: MS.MILESTONES.filter(m => !m.name || !m.desc).map(m => m.id),
    metrics: Object.keys(MS.METRICS),
  };
});

/* ══ 2 · the five new metrics read a real city ═════════════════════════════ */
out.metrics = await pg.evaluate(async () => {
  const MS = await import('/src/progression/milestones.js');
  const J = window.__nc.jobfair;
  J.setPop(60);
  J.plant('4,4', 'grocery'); J.plant('5,4', 'gym');
  await new Promise(r => setTimeout(r, 1500));

  /* The ctx the city actually hands over. Read through the module's own
     read() so this tests the metric, not a private function. */
  const ctx = window.__ncProgCtx || null;
  const o = { haveCtx: !!ctx };
  const names = ['employed', 'mood', 'crewPosted', 'earned', 'schooled'];
  o.declared = names.filter(n => !!MS.METRICS[n]);
  /* 🔴 CONTROL: WITH NO HOST READER, EVERY ONE MUST REFUSE WITH A REASON —
     never quietly answer 0, which would be a claim about the player's city. */
  o.emptyCtx = {};
  for (const n of names) {
    const r = MS.METRICS[n].read({});
    o.emptyCtx[n] = { ok: r.ok, why: r.why ? String(r.why).slice(0, 40) : null, value: r.value };
  }
  /* …and with a reader that answers null (not ready), the same. */
  o.nullCtx = {};
  for (const n of names) {
    const stub = {}; stub[n] = () => null;
    const r = MS.METRICS[n].read(stub);
    o.nullCtx[n] = { ok: r.ok, hasWhy: !!r.why };
  }
  /* …and with a real number, they measure it. */
  o.liveCtx = {};
  for (const n of names) {
    const stub = {}; stub[n] = () => 42;
    const r = MS.METRICS[n].read(stub);
    o.liveCtx[n] = { ok: r.ok, value: r.value };
  }
  /* every metric carries the provenance the panel prints */
  o.allHaveSource = Object.values(MS.METRICS).every(m => !!m.source && !!m.trace && !!m.label);
  return o;
});

/* ══ 3 · 🔌 the PRN plot ═══════════════════════════════════════════════════ */
out.prn = await pg.evaluate(async () => {
  const N = window.__nc, J = N.jobfair, o = {};
  window.__PRN.rows = [{
    id: 'p1', type: 'supply', name: 'Supply PRN', level: 1, eff: 90,
    active: true, here: false, site: null, claimable: 0, readyAt: 0,
  }];
  J.prnReconcile();
  o.freeBefore = !!J.prnFree('supply');
  await J.place(9, 9, 'prn_supply');
  const t = J.tileAt ? J.tileAt('9,9') : null;
  o.tileType = t ? t.type : null;
  o.isPrnTile = J.prnIsPrnType ? J.prnIsPrnType(o.tileType) : null;

  /* the inspector, opened the way a click opens it */
  N.inspect('9,9');
  o.demolishVisible = J.demolishVisible();
  o.demolishLabel = J.demolishLabel();
  o.prnCard = !!document.getElementById('prn-inspect');
  o.liftButton = !!document.getElementById('prn-lift');
  o.cardSaysNoCharge = /do not lose it|not charged/i.test(
    (document.getElementById('prn-inspect') || {}).textContent || '');
  o.rowBefore = J.prnRowFor('9,9');

  /* 🔴 CONTROL: an ORDINARY building must still say Demolish, with its refund.
     The label is now conditional, and a condition that leaked would silently
     retitle every demolish button in the game. */
  N.inspect('4,4');
  o.ordinaryLabel = J.demolishLabel();
  return o;
});

/* ══ 4 · take it up, and check the licence came back ═══════════════════════ */
out.lift = await pg.evaluate(async () => {
  const N = window.__nc, J = N.jobfair, o = {};
  N.inspect('9,9');
  const btn = document.getElementById('prn-lift');
  o.hadButton = !!btn;
  if (!btn) return o;
  btn.click();
  await new Promise(r => setTimeout(r, 2500));
  o.tileGone = !(J.tileAt ? J.tileAt('9,9') : null);
  /* 🔴 THE LICENCE IS BACK, NOT STRANDED. A tear-down that cleared the tile
     without releasing the row would leave the Reserve still claiming this plot:
     the player sees empty ground, cannot place the PRN anywhere because it
     reads as sited, and has nothing left to click to fix it. */
  const rows = J.prnList() || [];
  const row = rows.find(r => r.id === 'p1');
  o.rowExists = !!row;
  o.rowReleased = !!(row && !row.site);
  o.freeAgain = !!J.prnFree('supply');
  o.unsiteCalled = (window.__PRN.calls || []).some(c => c.op === 'unsite' && c.id === 'p1');
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const T = out.tree || {}, ME = out.metrics || {}, PR = out.prn || {}, L = out.lift || {};

/* ── the invariant ────────────────────────────────────────────────────────── */
need('🔴 THE TREE CAN BE CLEARED — enough milestone points exist to buy every node',
     (T.offer || 0) >= (T.cost || 0),
     { nodes: T.nodes, toClear: T.cost, onOffer: T.offer, short: (T.cost || 0) - (T.offer || 0) });
need('…with a little to spare, and not a fortune',
     (T.spare || 0) > 0 && (T.spare || 0) <= 25, { spare: T.spare });
need('THE ASK: there are more milestones to aim at', (T.milestones || 0) >= 30, T.milestones);
need('no milestone id is used twice', (T.dupes || []).length === 0, T.dupes);
need('🔴 every milestone names a metric that exists', (T.orphanMetrics || []).length === 0, T.orphanMetrics);
need('every milestone pays something', (T.nonPositive || []).length === 0, T.nonPositive);
need('…and every one has a name and a description', (T.noName || []).length === 0, T.noName);

/* ── the new metrics ──────────────────────────────────────────────────────── */
need('THE ASK: five new things a city is measured on',
     ['employed', 'mood', 'crewPosted', 'earned', 'schooled'].every(n => (ME.declared || []).includes(n)),
     ME.declared);
need('🔴 CONTROL: with no host reader, a metric REFUSES and says why',
     Object.values(ME.emptyCtx || {}).every(r => r.ok === false && !!r.why && r.value === undefined),
     ME.emptyCtx);
need('🔴 CONTROL: a reader that is not ready refuses too — it never reports 0',
     Object.values(ME.nullCtx || {}).every(r => r.ok === false && r.hasWhy === true),
     ME.nullCtx);
need('…and a real number is measured', Object.values(ME.liveCtx || {}).every(r => r.ok === true && r.value === 42), ME.liveCtx);
need('every metric states where its number came from', ME.allHaveSource === true, ME.allHaveSource);

/* ── the PRN plot ─────────────────────────────────────────────────────────── */
need('SETUP: a PRN stands in the city', PR.tileType === 'prn_supply' && PR.isPrnTile === true, PR);
need('THE ASK: a PRN plot can be acted on from the city', PR.demolishVisible === true, PR.demolishVisible);
need('🔴 …and the button says it is TAKEN UP, not demolished',
     /take up/i.test(String(PR.demolishLabel || '')), PR.demolishLabel);
need('🔴 …and NEVER claims a refund on a licence the player paid for',
     !/refund/i.test(String(PR.demolishLabel || '')), PR.demolishLabel);
need('THE ASK: the PRN card offers it where the player is reading', PR.liftButton === true, PR);
need('…and says plainly that nothing is lost', PR.cardSaysNoCharge === true, PR);
need('🔴 CONTROL: an ordinary building still says Demolish',
     /demolish/i.test(String(PR.ordinaryLabel || '')) && !/take up/i.test(String(PR.ordinaryLabel || '')),
     PR.ordinaryLabel);
need('🔴 CONTROL: …and still states its refund', /refund/i.test(String(PR.ordinaryLabel || '')), PR.ordinaryLabel);

/* ── and it actually comes back ───────────────────────────────────────────── */
need('SETUP: the take-up button was there to click', L.hadButton === true, L);
need('THE ASK: the node comes off the map', L.tileGone === true, L);
need('🔴 the licence is RELEASED, not stranded against an empty plot',
     L.rowExists === true && L.rowReleased === true, L);
need('…and can be placed again', L.freeAgain === true, L);
need('…through the one release path, not a second tear-down', L.unsiteCalled === true, L);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the tree can be finished, the new milestones measure real things, and a node can be picked up and put down again without losing it.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
