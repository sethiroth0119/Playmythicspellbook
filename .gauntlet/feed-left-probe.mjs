/* Battle Report sits over the left rail, not the board.
   Owner: "Can you move this to the left where it is not hovering over the board."
   Above 1100px the panel sits just right of --btl-rail-w (the sky above the red
   dock), 220-290px wide, height-capped; below that it stays centred. Usage: node .gauntlet/feed-left-probe.mjs   (:8787 up) */
import { chromium } from 'playwright';
const b = await chromium.launch();
let fails = 0;
for (const [W, H, expectLeft] of [[1920, 1080, true], [1440, 900, true], [1280, 800, true], [1100, 800, false], [1000, 700, false]]) {
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.waitForFunction(() => window.Juice && typeof window.Juice.eventChip === 'function');
  const r = await p.evaluate(() => {
    window.Juice.eventChip({ text: 'Aroa Stormrider Survivor — Countering', icon: '↩', kind: 'phase' });
    const el = document.getElementById('battle-event-feed');
    const rc = el.getBoundingClientRect();
    const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--btl-rail-w')) || 0;
    return { left: Math.round(rc.left), right: Math.round(rc.right), width: Math.round(rc.width), rail, maxH: parseFloat(getComputedStyle(el).maxHeight) || 0 };
  });
  /* second placement (owner: "over the red panel"): in the board column's sky,
     just right of the left rail, narrow, and capped in height */
  /* this page has no battle on it (UI auto-scale differs), so only the SHAPE is
     checked here: off-centre to the left, beside the rail, narrow, height-capped.
     The exact spot is measured on a real battle by feed-rail-shot.mjs. */
  const ok = expectLeft ? (r.left > r.rail * 0.7 && r.right < W / 2 && r.width >= 150 && r.width <= 300 && r.maxH > 0 && r.maxH <= H * 0.33)
                        : Math.abs((r.left + r.right) / 2 - W / 2) < 3;
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + W + 'x' + H + (expectLeft ? ' in the sky right of the left rail ' : ' centred ') + JSON.stringify(r));
  await p.close();
}
await b.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
