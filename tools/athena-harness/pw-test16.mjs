/* Athena Widgets round 16: 🗂 Screens & the Strings table. Screen list
   (catalogue + current), scanning the on-stage screen for strings, editing
   a string → page rule applied live, reset, find & replace, the Rules tab,
   save + ★ Live → applied from the live set, off-stage screens show saved
   rules only, export/import JSON, Widgets tab, admin gate. harness2.html. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const S = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { fails++; console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.AthenaUI && !!window.AthenaUI.openScreens, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => {
  document.getElementById('app').innerHTML = `<div id="hub"><h1 id="hub-title">RUIN EXCHANGE</h1><nav class="side"><button class="nav" data-act="shop">Card Shop</button><button class="nav" data-act="battle">Battle Hall</button><button class="nav" data-act="camp">The Camp</button></nav>
    <div class="cards"><div class="card" id="card-nodes"><span class="ic">🏙</span> City Nodes<small>Capture nodes</small></div><div class="card" id="card-vendor"><span class="ic">🛒</span> Vendor Market<small>Card packs</small></div></div><div id="junk" style="display:none">hidden text</div></div>`;
  // the fake bridge navigates by flipping the screen it reports
  const d0 = window.MythicBridge.ui.data; window.__screen = 'farm';
  window.MythicBridge.ui.data = () => Object.assign(d0(), { screen: window.__screen });
  window.MythicBridge.ui.actions.navigate = (s) => { window.__screen = s; window.__nav = s; };
});

await step('scan: strings of the on-stage screen (own text only, hidden skipped, one row per selector); screen list has catalogue + current', async () => {
  const r = await page.evaluate(() => {
    const rows = AthenaUI.screens.scan().map(r => ({ sel: r.sel, text: r.text, tag: r.tag, n: r.n }));
    const list = AthenaUI.screens.list();
    return { rows, n: list.length, hasTitle: !!list.find(s => s.id === 'title' && /hub/i.test(s.label)), hasCur: !!list.find(s => s.id === 'farm') };
  });
  const texts = r.rows.map(x => x.text);
  if (!texts.includes('RUIN EXCHANGE') || !texts.includes('Card Shop') || !texts.includes('City Nodes') || !texts.includes('Capture nodes') || texts.includes('hidden text') || texts.includes('🏙') || r.n < 50 || !r.hasTitle || !r.hasCur) throw new Error(JSON.stringify(r));
  return { strings: r.rows.length, screens: r.n };
});
await step('Screens view opens (admin) on the current screen; Strings tab lists them; editing a cell makes a live rule; reset removes it', async () => {
  const r = await page.evaluate(async () => {
    const V = await AthenaUI.openScreens();
    const rowsN = document.querySelectorAll('#aw-screens .aw-stable tbody tr').length;
    const inp = document.querySelector('#aw-screens input[data-sel="#hub-title"]');
    inp.value = 'RUIN BAZAAR'; inp.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 100));
    const live = document.getElementById('hub-title').textContent;
    const doc = await V.docFor('farm'); const rule = doc.page.rules.find(x => x.sel === '#hub-title'); const ruleText = rule && rule.text;
    const dirty = V.S.dirty.has('farm'); const ovRow = !!document.querySelector('#aw-screens tr.ov');
    document.querySelector('#aw-screens [data-reset="#hub-title"]').click();
    await new Promise(r => setTimeout(r, 150));
    return { open: AthenaUI.isScreensOpen(), rowsN, live, ruleText, dirty, ovRow, back: document.getElementById('hub-title').textContent, rules: doc.page.rules.length, sub: document.getElementById('aw-s-sub').textContent };
  });
  if (!r.open || r.rowsN < 6 || r.live !== 'RUIN BAZAAR' || r.ruleText !== 'RUIN BAZAAR' || !r.dirty || !r.ovRow || r.back !== 'RUIN EXCHANGE' || r.rules !== 0 || !/on stage/.test(r.sub)) throw new Error(JSON.stringify(r));
  return r;
});
await step('find & replace across the strings; Rules tab lists and deletes; search filters', async () => {
  const r = await page.evaluate(async () => {
    const V = AthenaUI.liveEditor ? null : null; const SV = (await AthenaUI.openScreens());
    document.getElementById('aw-s-find').value = 'Card'; document.getElementById('aw-s-repl').value = 'Relic'; document.getElementById('aw-s-doreplace').click();
    await new Promise(r => setTimeout(r, 150));
    const shop = document.querySelector('nav .nav[data-act="shop"]').textContent, vendorSmall = document.querySelector('#card-vendor small').textContent;
    const doc = await SV.docFor('farm'); const n1 = doc.page.rules.length;
    document.getElementById('aw-s-q').value = 'relic'; document.getElementById('aw-s-q').dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 120));
    const filtered = document.querySelectorAll('#aw-screens .aw-stable tbody tr').length;
    await SV.setTab('rules');
    const rulesRows = document.querySelectorAll('#aw-screens .aw-stable tbody tr').length;
    document.querySelector('#aw-screens [data-del]').click(); await new Promise(r => setTimeout(r, 100));
    return { shop, vendorSmall, n1, filtered, rulesRows, n2: doc.page.rules.length };
  });
  if (r.shop !== 'Relic Shop' || r.vendorSmall !== 'Relic packs' || r.n1 !== 2 || r.filtered !== 2 || r.rulesRows !== 2 || r.n2 !== 1) throw new Error(JSON.stringify(r));
  return r;
});
await step('save + ★ Live → device doc live; close; runtime applies from the live set; off-stage screen shows saved rules only', async () => {
  const r = await page.evaluate(async () => {
    const SV = await AthenaUI.openScreens();
    await SV.setTab('strings'); document.getElementById('aw-s-q').value = ''; document.getElementById('aw-s-q').dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 120));
    await SV.setLive(); await new Promise(r => setTimeout(r, 200));
    const liveN = AthenaUI.live().filter(d => d.kind === 'page' && d.page.screen === 'farm').length;
    const liveTag = !!document.querySelector('#aw-screens .aw-srow[data-screen="farm"] .tag.live');
    await SV.setScreen('title');
    const offStage = /not on stage/.test(document.getElementById('aw-s-sub').textContent) && !!document.querySelector('#aw-screens .aw-sempty');
    await SV.close(true);
    await AthenaUI.reload(); await new Promise(r => setTimeout(r, 250));
    document.getElementById('hub').appendChild(document.createElement('i')); await new Promise(r => setTimeout(r, 200));
    return { liveN, liveTag, offStage, applied: document.querySelector('#card-vendor small').textContent, closed: !document.getElementById('aw-screens') };
  });
  if (r.liveN !== 1 || !r.liveTag || !r.offStage || r.applied !== 'Relic packs' || !r.closed) throw new Error(JSON.stringify(r));
  return r;
});
await step('export/import JSON round-trips page docs (text only); Widgets tab lists docs; Go there navigates through the bridge; admin gate', async () => {
  const r = await page.evaluate(async () => {
    const SV = await AthenaUI.openScreens({ screen: 'farm' });
    const doc = await SV.docFor('farm');
    const json = { v: 1, kind: 'athena-pages', pages: [Object.assign(JSON.parse(JSON.stringify(doc)), { id: 'other', page: { screen: 'title', rules: [{ sel: '#nope', text: 'Hello', style: { color: 'red', background: 'url(x)' } }] } })] };
    const n = SV.importJson(json);
    const t = await SV.docFor('title');
    await SV.setTab('widgets'); const wrows = document.querySelectorAll('#aw-screens .aw-stable tbody tr').length;
    await SV.go('camp'); const nav = window.__nav, cur = document.getElementById('aw-s-sub').textContent;
    await SV.close(true);
    const a = window.MythicBridge.isAdmin; window.MythicBridge.isAdmin = () => false; const denied = await AthenaUI.openScreens(); window.MythicBridge.isAdmin = a;
    return { n, tRules: t.page.rules.length, tText: t.page.rules[0] && t.page.rules[0].text, noUrl: t.page.rules[0] && !t.page.rules[0].style.background, dirtyTitle: SV.S.dirty.has('title'), wrows, nav, denied: !denied };
  });
  if (r.n !== 1 || r.tRules !== 1 || r.tText !== 'Hello' || !r.noUrl || !r.dirtyTitle || r.wrows < 1 || r.nav !== 'camp' || !r.denied) throw new Error(JSON.stringify(r));
  return r;
});
await page.evaluate(async () => { window.__screen = 'farm'; await AthenaUI.openScreens({ screen: 'farm' }); });
await page.waitForTimeout(300);
await page.screenshot({ path: S + '/shots/r16-01-screens.png' });
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
