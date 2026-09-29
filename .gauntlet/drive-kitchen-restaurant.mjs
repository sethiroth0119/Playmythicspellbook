/* ══════════════════════════════════════════════════════════════════════════
   🍔 DRIVE-KITCHEN-RESTAURANT — does the ported kitchen actually connect?

   The Mythic Kitchen was built on another branch against an index.html three
   megabytes smaller than this one. Three things were carried across by hand —
   a title tile, window.MythicKitchenBridge, and one <script type="module"> —
   and the module's own bridge layer is DESIGNED to survive a missing key by
   substituting a zero and warning once. That is the right call for the player
   and a trap for whoever ports it: a bridge that is half wired looks fine on
   screen and quietly reports that you cannot afford anything.

   So this asserts the seam itself, not the vibe:

     1 the module registered            — window.MythicKitchen exists
     2 the bridge is COMPLETE           — every key the module's NULL_BRIDGE
                                          names is a live function here, and
                                          `cloud` is a getter, not a snapshot
     3 the bridge RESOLVES              — each reader actually returns a value
                                          of the right shape rather than the
                                          null-bridge zero, which is what a
                                          missing top-level `const` looks like
                                          from inside an ES module
     4 the tile is on the title screen  — and it is gated on the module, so a
                                          failed import is a MISSING tile
     5 the Restaurant operation exists  — in OPS_ECON, with a label, and its
                                          food input names a real resource
     6 the catalog lists it by NAME     — Just Business builds from
                                          Object.keys(OPS_ECON) and falls back
                                          to the raw key, so a missing label
                                          ships a shop row reading "restaurant"

   ⚠ SIGNED OUT ON PURPOSE. Everything here is reachable without an account;
     nothing asserted below needs Supabase, so the driver never needs a
     credential and can run anywhere.

   Run: node .gauntlet/drive-kitchen-restaurant.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.woff2':'font/woff2' };
const PORT = 8190 + (process.pid % 40);

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
/* The kitchen's own console warnings are the thing we most want to see: its
   bridge layer warns ONCE per missing key instead of throwing. */
const warns = [];
pg.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') { const t = m.text(); if (/Kitchen|MythicKitchen|CONTRACT/i.test(t)) warns.push(t.slice(0, 200)); } });

await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
/* The module is type="module": it resolves after the parser, so wait for the
   registration rather than a fixed sleep. */
await pg.waitForFunction('typeof window.MythicKitchenBridge === "object"', null, { timeout: 180000 });
await pg.waitForTimeout(3000);

const idxSrc0 = fs.readFileSync('public/index.html', 'utf8');
let fails = 0;
const ok = (label, cond, detail) => {
  if (!cond) fails++;
  console.log('  ' + (cond ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m') + ' ' + label + (detail ? '\n         ' + detail : ''));
};

const out = await pg.evaluate(async () => {
  const rep = {};
  const B = window.MythicKitchenBridge || {};

  rep.moduleRegistered = typeof window.MythicKitchen === 'object' && !!window.MythicKitchen;
  rep.hasOpen = !!(window.MythicKitchen && typeof window.MythicKitchen.open === 'function');

  /* 2 · completeness — the module's own contract list, read from the module so
     this driver cannot drift from it. */
  let contract = [];
  try {
    const m = await import('./src/kitchen/kitchen.bridge.js');
    const nb = m.bridge();                    // NULL_BRIDGE when unpublished
    contract = Object.keys(nb).filter(k => k !== '_null' && k !== '_raw');
    rep.bridgeIsReal = nb._null === false;    // false = it found the real one
  } catch (e) { rep.importErr = String(e).slice(0, 160); }
  rep.contract = contract;
  rep.notFunctions = contract.filter(k => k !== 'cloud' && typeof B[k] !== 'function');

  /* `cloud` must be a live getter. A copied value is frozen at page-load and is
     null forever for anyone who signs in later. */
  const d = Object.getOwnPropertyDescriptor(B, 'cloud');
  rep.cloudIsGetter = !!(d && typeof d.get === 'function');

  /* 3 · do the readers RESOLVE? A bridge whose body references a top-level
     `const` that does not exist throws, and the module then serves a zero. */
  const probe = {};
  for (const [k, args] of [['resources', []], ['getRes', ['food']], ['resourceCap', []],
                           ['resourceUnits', []], ['gems', []], ['signedIn', []],
                           ['displayName', []], ['cityProd', []], ['isAdmin', []],
                           ['meta', ['food']], ['kitchenState', []]]) {
    try { const v = B[k].apply(B, args); probe[k] = (v && typeof v === 'object') ? (Array.isArray(v) ? 'array[' + v.length + ']' : 'object') : String(v); }
    catch (e) { probe[k] = 'THREW: ' + String(e).slice(0, 80); }
  }
  rep.probe = probe;
  rep.threw = Object.entries(probe).filter(([, v]) => String(v).startsWith('THREW')).map(([k]) => k);
  /* meta() must never be null — every call site renders it straight into an
     icon + label, so a null is a blank bin on screen. */
  try { const m = B.meta('food'); rep.metaShape = !!(m && m.id && m.name && m.icon && m.color); rep.metaIcon = m && m.icon; } catch (e) { rep.metaShape = false; }

  /* 4 · the tile.
     🔴 CORRECTION TO THIS DRIVER'S FIRST PREMISE. It used to set
     App.screen='title', render(), and assert #btn-kitchen was in the DOM. That
     is testing for a screen the design does not reach: offline mode was removed,
     so a signed-out page sits on the auth gate and renderTitle() paints NO
     portals at all. Measured with the neighbouring tile as a control —
     #btn-bank-ethos was equally absent and the whole tile list came back empty —
     so a missing kitchen tile there was evidence of nothing, and "fixing" the
     port to satisfy it would have been chasing the driver's mistake into the
     product.

     What can honestly be checked without an account is the GATE, which is the
     only thing the port actually changed: the tile entry is
        (window.MythicKitchen) ? {…} : null
     inside a .filter(Boolean) list, so the tile exists iff the module loaded.
     That ternary is evaluated here directly, along with the badge closure —
     which runs on every title render and reads three collections off the
     kitchen state, so a throw in it would take the whole title screen down. */
  rep.tileResolves = !!(typeof window !== 'undefined' && window.MythicKitchen);
  try {
    const K = window.MythicKitchen.state || {};
    const up = (K.tickets || []).filter(t => t && (t.state === 'open' || t.state === 'ready')).length;
    let badge;
    if (up > 0) badge = '🎫 ' + up + ' order' + (up === 1 ? '' : 's') + ' up';
    else {
      const landed = (K.convoys || []).filter(c => c && c.state === 'arrived').length + (K.inbound || []).length;
      if (landed > 0) badge = '📦 ' + landed + ' convoy' + (landed === 1 ? '' : 's') + ' to claim';
      else {
        const moving = (K.convoys || []).filter(c => c && c.state === 'transit').length;
        badge = moving > 0 ? ('🚚 ' + moving + ' in transit')
              : (K.shift && K.shift.running) ? ('🟢 Day ' + (K.shift.day | 0) + ' · service on')
              : '🔥 Fire up the grill';
      }
    }
    rep.badge = badge;
  } catch (e) { rep.badge = 'THREW: ' + String(e).slice(0, 90); }

  /* The control, recorded every run so the claim above stays honest: if a
     future build DOES paint portals signed out, this flips and the assertion
     below should be tightened to a real DOM check. */
  try {
    App.screen = 'title'; render();
    await new Promise(r => setTimeout(r, 400));
    rep.anyTileRendered = document.querySelectorAll('[id^="btn-"]').length;
    rep.kitchenInDom = !!document.getElementById('btn-kitchen');
  } catch (e) { rep.tileErr = String(e).slice(0, 140); }

  /* 5 + 6 · the operation. OPS_ECON / OP_LABELS are top-level consts, so they
     are reachable only through direct eval from this page context. */
  try {
    rep.econ  = eval('(typeof OPS_ECON !== "undefined" && OPS_ECON.restaurant) ? JSON.parse(JSON.stringify(OPS_ECON.restaurant)) : null');
    rep.label = eval('(typeof OP_LABELS !== "undefined") ? (OP_LABELS.restaurant || null) : null');
    rep.inCatalog = eval('(typeof OPS_ECON !== "undefined") ? Object.keys(OPS_ECON).indexOf("restaurant") >= 0 : false');
    /* the food input must name a real resource, or the op draws nothing */
    rep.foodIsReal = eval('(typeof RESOURCES !== "undefined") ? RESOURCES.some(function(r){return r && r.id === "food";}) : false');
    /* the interior ternary — a walk-in like cardshop/dojo/bank */
    rep.interiorOk = eval('(function(){ try { var s = window.cityOpsState && window.cityOpsState(); return true; } catch(e){ return "THREW: " + e; } })()');
  } catch (e) { rep.evalErr = String(e).slice(0, 160); }

  return rep;
});

await b.close(); srv.close();

console.log('\n🍔 MYTHIC KITCHEN + RESTAURANT · does the port connect?\n');
ok('the kitchen module registered (window.MythicKitchen)', out.moduleRegistered);
ok('…and exposes open()', out.hasOpen);
ok('the module resolved the REAL bridge, not its null fallback', out.bridgeIsReal === true,
   out.importErr ? 'import error: ' + out.importErr : 'contract keys: ' + (out.contract || []).length);
ok('every contract key is a live function on the bridge',
   (out.notFunctions || []).length === 0, 'missing/not-a-function: ' + JSON.stringify(out.notFunctions));
ok('cloud is a live GETTER, not a frozen snapshot', out.cloudIsGetter);
ok('no reader THREW (a throw = a missing top-level const → silent zeros)',
   (out.threw || []).length === 0, 'threw: ' + JSON.stringify(out.threw));
ok('meta() returns a complete bin shape (id/name/icon/colour)', out.metaShape === true, 'food icon: ' + out.metaIcon);
/* 🔴 THE TILE IS GONE ON PURPOSE (owner's call). The kitchen is a business you
   own, so its doors are My Companies and the city building — not the Ruin
   Exchange menu. Asserted as an ABSENCE, because a tile that creeps back in is
   exactly the kind of regression a port re-introduces. */
ok('the Ruin Exchange tile is GONE (two doors: My Companies + the city)',
   (idxSrc0.split("id: 'btn-kitchen'").length - 1) === 0);
ok('…but the module is still registered, so the remaining doors work',
   out.tileResolves === true);
ok('the tile badge closure runs without throwing (it paints on every title render)',
   typeof out.badge === 'string' && !out.badge.startsWith('THREW'), 'badge: ' + out.badge);
ok('CONTROL · no portal renders signed out, so an absent tile here means nothing',
   out.anyTileRendered === 0,
   'tiles in DOM: ' + out.anyTileRendered + ' · kitchen among them: ' + out.kitchenInDom
   + (out.anyTileRendered > 0 ? '  ← portals now render signed out; tighten this to a real DOM check' : ''));
ok('OPS_ECON carries the restaurant row', !!out.econ, JSON.stringify(out.econ));
ok('…priced and staffed as specified (320k / 780 / 190 / 10)',
   !!out.econ && out.econ.startup === 320000 && out.econ.ratePerWorkerHr === 780
   && out.econ.salaryPerWorkerHr === 190 && out.econ.maxWorkers === 10);
ok('…earns Cinder, not resources (yields is empty)',
   !!out.econ && out.econ.yields && Object.keys(out.econ.yields).length === 0);
ok('…and eats food, which is a REAL resource id',
   !!out.econ && !!out.econ.inputs && out.econ.inputs.food === 1.0 && out.foodIsReal === true);
ok('OP_LABELS gives it a display name (else the shop shows "restaurant")',
   out.label === 'Restaurant', 'label: ' + out.label);
ok('it is in OPS_ECON (the PRICE table — necessary, and not sufficient)', out.inCatalog === true);

/* 🔴 THE CHECK THIS DRIVER WAS MISSING, AND WHY IT PASSED ANYWAY.
   The handoff states "the Just Business catalog is built from
   Object.keys(OPS_ECON)". It is not. OperaFind — the screen a player actually
   shops on — renders a HARDCODED array, OPERATIONS in public/corp/screens.jsx,
   and that file carries two comments left by the same bug biting the Warehouse
   and then the Weapon Smith: "a type added to OPS_ECON in index.html is
   invisible until it is listed in this array too."
   So the first version of this driver asserted the handoff's claim, went green,
   and the operation was priced, labelled, and impossible to find or buy.
   These three are source-level on purpose: Just Business is an iframe that
   needs a signed-in player with a corporation, which this driver cannot reach —
   so the chain is asserted where it is written, and the in-app render stays
   honestly unverified below. */
const jsxScreens = fs.readFileSync('public/corp/screens.jsx', 'utf8');
const jsxShell   = fs.readFileSync('public/corp/shell.jsx', 'utf8');
const idxSrc     = fs.readFileSync('public/index.html', 'utf8');
ok('SOURCE · the card is in the OperaFind registry (screens.jsx OPERATIONS)',
   (jsxScreens.split("{ id: 'restaurant',").length - 1) === 1,
   'the hardcoded array the shop actually renders');
ok('SOURCE · owning it adds a My Companies entry (shell.jsx COMPANY_PAGES)',
   (jsxShell.split("  restaurant:  { label: 'Mythic Kitchen'").length - 1) === 1);
ok('SOURCE · that entry is handled by the parent (index.html JB_action)',
   (idxSrc.split("a.kind === 'openMythicKitchen'").length - 1) === 1,
   'emitter and handler must agree on the action string');
ok('SOURCE · the emitter and the handler use the SAME action string',
   /action: 'openMythicKitchen'/.test(jsxShell) && idxSrc.includes("a.kind === 'openMythicKitchen'"),
   'a mismatch here is a sidebar row that silently does nothing');
ok('cityOpsState() still runs after the interior edit', out.interiorOk === true, String(out.interiorOk));
ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
ok('the kitchen bridge layer logged no missing-key warnings',
   warns.filter(w => /missing|not published|not a finished bridge/i.test(w)).length === 0,
   warns.slice(0, 3).join(' | '));

console.log('\n' + (fails ? '\x1b[31m❌ ' + fails + ' FAILED\x1b[0m' : '\x1b[32m✅ ALL PASS\x1b[0m') + '\n');
process.exit(fails ? 1 : 0);
