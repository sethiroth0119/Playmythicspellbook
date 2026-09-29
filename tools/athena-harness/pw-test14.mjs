/* Athena Widgets round 14: ✎ Edit UI — the live page editor. Page docs
   (normalizePage sanitising, pageCss), the runtime applying text / style /
   hide rules and surviving re-renders, screen scoping, the editor: open
   (admin), pick → select, text / colour / hide edits, undo, rules list,
   reset, save + set live → applied from the live set after close, replace
   with widget → designer opens with the selector target. harness2.html. */
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
await page.waitForFunction(() => !!window.AthenaUI && !!window.AthenaUI.openLiveEditor, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
// a fake "game page" to edit: a header, a sidebar of buttons, a card
await page.evaluate(() => {
  const app = document.getElementById('app');
  app.innerHTML = `<div id="hub"><h1 id="hub-title">RUIN EXCHANGE</h1><nav class="side"><button class="nav" data-act="shop">Card Shop</button><button class="nav" data-act="battle">Battle Hall</button><button class="nav" data-act="camp">The Camp</button></nav>
    <div class="cards"><div class="card" id="card-nodes"><span class="ic">🏙</span> City Nodes<small>Capture nodes</small></div><div class="card" id="card-vendor"><span class="ic">🛒</span> Vendor Market<small>Card packs</small></div></div></div>`;
});
await page.waitForTimeout(300);

await step('format: normalizePage sanitises (unknown props, url(), bad selector, empty rule dropped); pageCss scopes by screen', async () => {
  const r = await page.evaluate(() => {
    const F = AthenaUI.format;
    const d = F.normalize({ kind: 'page', name: 'p', page: { screen: 'hub!', rules: [
      { sel: '#hub-title', text: 'HELLO', style: { color: '#fff', 'background-image': 'url(x)', background: 'url(evil)', 'font-size': '20px', position: 'absolute' } },
      { sel: 'nav .nav', hide: true }, { sel: 'a{', text: 'x' }, { sel: '.card', style: { bogus: '1' } }, { sel: '#card-nodes', attrs: { title: 'tip', onclick: 'alert(1)', href: 'javascript:alert(1)' } },
    ] } });
    return { kind: d.kind, screen: d.page.screen, n: d.page.rules.length, r0: d.page.rules[0], r1: d.page.rules[1], attrs: d.page.rules[2] && d.page.rules[2].attrs, css: AthenaUI.format.pageCss([d]), root: d.root };
  });
  if (r.kind !== 'page' || r.screen !== 'hub' || r.n !== 3 || r.r0.text !== 'HELLO' || r.r0.style['background-image'] || r.r0.style.background || r.r0.style.color !== '#fff' || r.r0.style.position !== 'absolute' || !r.r1.hide || Object.keys(r.attrs).join() !== 'title' || r.root !== null) throw new Error(JSON.stringify(r));
  if (!/body\[data-aw-screen="hub"\] #hub-title\{color:#fff !important;font-size:20px !important;position:absolute !important\}/.test(r.css) || !/nav \.nav\{display:none !important\}/.test(r.css)) throw new Error(r.css);
  return { n: r.n, css: r.css.length };
});
await step('editor: opens (admin), programmatic select → panel shows selector; text edit rewrites the element text (icon child kept); colour + hide apply as CSS; rules list; undo', async () => {
  const r = await page.evaluate(async () => {
    const L = await AthenaUI.openLiveEditor({ screen: 'farm' });
    const card = document.getElementById('card-nodes');
    L.select(card);
    const selShown = document.querySelector('#aw-live .aw-lsel code').textContent;
    const tx = document.getElementById('aw-l-text'); const before = tx.value; tx.value = 'Ruined Nodes'; tx.dispatchEvent(new Event('change'));
    const text1 = card.textContent.replace(/\s+/g, ' ').trim(), iconKept = !!card.querySelector('.ic'), smallKept = !!card.querySelector('small');
    const ci = document.querySelector('#aw-live input[type=text][data-prop="color"]'); ci.value = '#ff0000'; ci.dispatchEvent(new Event('change'));
    const color = getComputedStyle(card).color;
    L.select(document.querySelector('nav .nav[data-act="camp"]'));
    document.getElementById('aw-l-hide').checked = true; document.getElementById('aw-l-hide').dispatchEvent(new Event('change'));
    const hidden = getComputedStyle(document.querySelector('nav .nav[data-act="camp"]')).display === 'none';
    const rules = Array.from(document.querySelectorAll('#aw-live .aw-lrules .r .lb')).map(x => x.textContent);
    L.undo(); const unhidden = getComputedStyle(document.querySelector('nav .nav[data-act="camp"]')).display !== 'none';
    return { open: AthenaUI.isLiveOpen(), selShown, before, text1, iconKept, smallKept, color, hidden, rules, unhidden, dirty: L.S.dirty, nRules: L.doc.page.rules.length, bodyScreen: document.body.getAttribute('data-aw-screen') };
  });
  if (!r.open || r.selShown !== '#card-nodes' || r.before !== 'City Nodes' || r.text1 !== '🏙 Ruined NodesCapture nodes' || !r.iconKept || !r.smallKept || r.color !== 'rgb(255, 0, 0)' || !r.hidden || r.rules.length !== 2 || !r.unhidden || !r.dirty || r.nRules !== 1 || r.bodyScreen !== 'farm') throw new Error(JSON.stringify(r));
  return r;
});
await step('runtime: a re-render that puts the original text back is corrected on the next sync; deleting the rule restores the original text', async () => {
  const r = await page.evaluate(async () => {
    const L = AthenaUI.liveEditor(); const card = document.getElementById('card-nodes');
    // simulate the game re-rendering the card's text
    Array.from(card.childNodes).filter(n => n.nodeType === 3).forEach(n => { if (n.nodeValue.trim()) n.nodeValue = ' City Nodes'; });
    card.appendChild(document.createElement('i'));   // a DOM mutation → observer → sync
    await new Promise(r => setTimeout(r, 200));
    const fixed = card.textContent.replace(/\s+/g, ' ').trim();
    document.querySelector('#aw-live .aw-lrules .r .x').click();
    await new Promise(r => setTimeout(r, 150));
    const restored = card.textContent.replace(/\s+/g, ' ').trim();
    return { fixed, restored, rules: L.doc.page.rules.length, colorBack: getComputedStyle(card).color };
  });
  if (r.fixed !== '🏙 Ruined NodesCapture nodes' || r.restored !== '🏙 City NodesCapture nodes' || r.rules !== 0 || r.colorBack === 'rgb(255, 0, 0)') throw new Error(JSON.stringify(r));
  return r;
});
await step('pick layer: hover highlights, click selects the element under the pointer (panel excluded); Esc stops picking', async () => {
  await page.evaluate(() => { AthenaUI.liveEditor().setPicking(true); });
  const box = await page.evaluate(() => { const b = document.getElementById('hub-title').getBoundingClientRect(); return { x: b.left + 10, y: b.top + 10 }; });
  await page.mouse.move(box.x, box.y); await page.waitForTimeout(50);
  const hl = await page.evaluate(() => document.getElementById('hub-title').classList.contains('aw-pick-hl'));
  await page.mouse.click(box.x, box.y); await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ sel: AthenaUI.liveEditor().S.sel, selCls: document.getElementById('hub-title').classList.contains('aw-live-sel'), msg: document.querySelector('#aw-picklayer .msg').textContent }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  const picking = await page.evaluate(() => AthenaUI.liveEditor().S.picking);
  if (!hl || r.sel !== '#hub-title' || !r.selCls || picking) throw new Error(JSON.stringify({ hl, r, picking }));
  return r;
});
await step('save + ★ Live (device) → close → runtime applies from the live set on reload; screen scoping keeps rules off other screens', async () => {
  const r = await page.evaluate(async () => {
    const L = AthenaUI.liveEditor();
    L.selectSelector('#hub-title');
    const tx = document.getElementById('aw-l-text'); tx.value = 'RUIN BAZAAR'; tx.dispatchEvent(new Event('change'));
    const fs = document.querySelector('#aw-live input[data-prop="font-size"]'); fs.value = '40px'; fs.dispatchEvent(new Event('change'));
    await L.setLive();
    const id = L.doc.id, source = L.S.source;
    await L.close(true);
    await AthenaUI.reload(); await new Promise(r => setTimeout(r, 250));
    const t = document.getElementById('hub-title');
    const applied = { text: t.textContent, size: getComputedStyle(t).fontSize, live: AthenaUI.live().filter(d => d.kind === 'page').length, info: AthenaUI.pages.info() };
    // other screen: flip the fake bridge's screen and resync
    const d0 = window.MythicBridge.ui.data; window.MythicBridge.ui.data = () => Object.assign(d0(), { screen: 'hub' });
    t.appendChild(document.createElement('i')); await new Promise(r => setTimeout(r, 200));
    const other = { text: t.textContent, size: getComputedStyle(t).fontSize, attr: document.body.getAttribute('data-aw-screen') };
    window.MythicBridge.ui.data = d0; t.appendChild(document.createElement('i')); await new Promise(r => setTimeout(r, 200));
    const back = { text: t.textContent, size: getComputedStyle(t).fontSize };
    return { id, source, applied, other, back, closed: !document.getElementById('aw-live') && !document.getElementById('aw-picklayer') };
  });
  if (r.source !== 'local' || r.applied.text !== 'RUIN BAZAAR' || r.applied.size !== '40px' || r.applied.live !== 1 || r.other.text !== 'RUIN EXCHANGE' || r.other.size === '40px' || r.other.attr !== 'hub' || r.back.text !== 'RUIN BAZAAR' || r.back.size !== '40px' || !r.closed) throw new Error(JSON.stringify(r));
  return r;
});
await step('reopen loads the live page doc for the screen; Replace with widget opens the designer targeting the selector', async () => {
  const r = await page.evaluate(async () => {
    const L = await AthenaUI.openLiveEditor({ screen: 'farm' });
    const loaded = { rules: L.doc.page.rules.length, name: L.doc.name, source: L.S.source };
    L.selectSelector('#card-vendor');
    document.getElementById('aw-l-widget').click();
    await new Promise(r => setTimeout(r, 400));
    const d = AthenaUI.designer(); const target = d && d.S.doc.target;
    AthenaUI.closeDesigner(); await L.close(true);
    return Object.assign(loaded, { target });
  });
  if (r.rules !== 1 || r.source !== 'local' || !r.target || r.target.mode !== 'selector' || r.target.selector !== '#card-vendor' || r.target.place !== 'replace') throw new Error(JSON.stringify(r));
  return r;
});
await step('non-admin: the editor refuses to open', async () => {
  const r = await page.evaluate(async () => { const a = window.MythicBridge.isAdmin; window.MythicBridge.isAdmin = () => false; const L = await AthenaUI.openLiveEditor(); window.MythicBridge.isAdmin = a; return { L: !!L, toast: window.__toasts.slice(-1)[0] }; });
  if (r.L || !/admin/.test(r.toast)) throw new Error(JSON.stringify(r));
  return r;
});
await page.evaluate(async () => { const L = await AthenaUI.openLiveEditor({ screen: 'farm' }); L.selectSelector('#card-nodes'); });
await page.waitForTimeout(200);
await page.screenshot({ path: S + '/shots/r14-01-live-ui.png' });
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
