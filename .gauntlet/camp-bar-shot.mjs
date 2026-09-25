/* Renders Camp's real COMMAND bar (window._campCommandBarHtml) with the game's
   own stylesheet and photographs it. Camp itself is behind sign-in; the bar is a
   pure function of state, so it can be rendered on its own.
   Usage: node .gauntlet/camp-bar-shot.mjs <out.png>   (public server on :8787) */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = []; p.on('pageerror', e => errors.push(String(e.message || e)));
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load' });
await p.waitForFunction(() => typeof window._campCommandBarHtml === 'function');
const info = await p.evaluate(() => {
  const html = window._campCommandBarHtml();
  const host = document.createElement('div');
  host.id = 'barshot';
  host.className = 'forge-page camp-hud';
  host.style.cssText = 'position:fixed;left:20px;top:20px;width:1400px;z-index:2147483600;padding:12px;background:#0d0a14';
  host.innerHTML = html;
  document.body.appendChild(host);
  const a = host.querySelector('a[href="/handbook/"]');
  const r = a ? a.getBoundingClientRect() : null;
  const first = host.querySelector('nav > a, nav > button');
  return { found: !!a, text: a && a.textContent.trim(), target: a && a.target, rel: a && a.rel,
           visible: !!(r && r.width > 20 && r.height > 12), w: r && Math.round(r.width), h: r && Math.round(r.height),
           isFirstAction: first === a };
});
await p.addStyleTag({ content: 'body > *:not(#barshot){visibility:hidden!important}' });
const box = await p.locator('#barshot').boundingBox();
await p.screenshot({ path: process.argv[2], clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 140) } });
await b.close();
console.log(JSON.stringify({ ...info, errors }));
