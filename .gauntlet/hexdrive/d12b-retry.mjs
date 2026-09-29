// DRIVER 12b — chase the one silent tile from d12. Is (9,2) genuinely unreachable,
// or was the 300 ms poll simply too short / something transient over it?
import { bootMatch } from './boot.mjs';

const { page, close } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.__bbHexCheck); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);

const armed = await page.evaluate(() => {
  App.replayViewing = true;
  window.__CLICKS = [];
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'board:tileClick') window.__CLICKS.push({ x: d.x, z: d.z });
  });
  const r = document.querySelector('#bb-stage-host').getBoundingClientRect();
  return { left: r.left, top: r.top };
});

const probe = async (x, z) => {
  const t = await page.evaluate(([x, z]) => {
    const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
    const w = bw.gw(x, z, bw.tileElev(x, z));
    const p = bw.project({ x: w.x, y: w.y, z: w.z });
    return p ? { px: p.x, py: p.y } : null;
  }, [x, z]);
  if (!t) return { tile: `${x},${z}`, verdict: 'no projection' };
  const cx = armed.left + t.px, cy = armed.top + t.py;
  const over = await page.evaluate(([cx, cy]) => {
    const el = document.elementFromPoint(cx, cy);
    return el ? (el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : '')) : 'none';
  }, [cx, cy]);
  const results = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => { window.__CLICKS.length = 0; });
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    let got = null;
    for (let i = 0; i < 40; i++) {                 // 1 s of patience, not 300 ms
      got = await page.evaluate(() => window.__CLICKS[0] || null);
      if (got) break;
      await page.waitForTimeout(25);
    }
    results.push(got ? `${got.x},${got.z}` : 'SILENT');
  }
  // and what does the board's own picker say for that pixel?
  const picked = await page.evaluate(([px, py]) => {
    const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
    try { const t = bw.pickTile(px, py); return t ? t.x + ',' + t.z : 'null'; } catch (e) { return 'THREW ' + e.message; }
  }, [t.px, t.py]);
  return { tile: `${x},${z}`, elementUnderCursor: over, clicks: results, pickTileSaysDirectly: picked };
};

for (const [x, z] of [[9, 2], [8, 2], [10, 2], [9, 1], [9, 3]]) {
  console.log(JSON.stringify(await probe(x, z)));
}
await close();
