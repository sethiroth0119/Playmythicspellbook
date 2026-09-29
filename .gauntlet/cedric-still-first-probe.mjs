/* The animated Cedric is delayed 8 s; the still must be on stage before then,
   and the animation must replace it once it lands.
   Usage: node .gauntlet/cedric-still-first-probe.mjs   (:8787 up) */
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.route('**/cedric-idle.webp*', async (r) => { await new Promise(res => setTimeout(res, 8000)); r.continue(); });
const p = await ctx.newPage();
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window._mmMount === 'function');
await p.evaluate(() => { App.screen = 'title'; App.titleHub = 'main'; _mmMount(); });
const read = () => p.evaluate(() => {
  const d = document.getElementById('mm-frame').contentDocument;
  const on = [...d.querySelectorAll('.char-img.on')][0];
  return on ? (on.getAttribute('src') || '').split('/').pop() + (on.complete && on.naturalWidth ? ' decoded' : ' pending') : 'none';
});
await p.waitForTimeout(4000); const early = await read();
await p.waitForTimeout(9000); const late = await read();
await b.close();
const ok1 = /cedric-still\.webp decoded/.test(early), ok2 = /cedric-idle\.webp decoded/.test(late);
console.log((ok1 ? '  ok   ' : '  FAIL ') + 'at 4 s the still is on stage: ' + early);
console.log((ok2 ? '  ok   ' : '  FAIL ') + 'at 13 s the animation replaced it: ' + late);
process.exit(ok1 && ok2 ? 0 : 1);
