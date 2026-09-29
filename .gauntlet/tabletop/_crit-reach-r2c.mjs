/* Dump the caret points and their OWN tile centres to JSON so the displacement
   can be DRAWN on the very frame it was measured on. Numbers convince a gate;
   a picture convinces a reader, and §12 is a legibility rule, so the finding
   has to survive being looked at. Writes _crit-reach-r2c.png + .json. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const SHOT = fileURLToPath(new URL('./_crit-shot-report.mjs', import.meta.url));
const REPORT = `(() => {
const keys = [...PAINT.move];
const pts = teleReachPoints();
return JSON.stringify(keys.map((k,i) => {
  const c = k.indexOf(','); const gx = +k.slice(0,c), gz = +k.slice(c+1);
  const g = project(gw(gx, gz, tileElev(gx, gz)));
  return { k, cx: +g.x.toFixed(1), cy: +g.y.toFixed(1), px: +pts[i].x.toFixed(1), py: +pts[i].y.toFixed(1), r: +pts[i].r.toFixed(2) };
}));
})()`;
const r = spawnSync(process.execPath, [
  SHOT, '.gauntlet/tabletop/_crit-reach-r2c.png', '--scene', 'crowd', '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: fileURLToPath(new URL('../../', import.meta.url)) });
process.stderr.write(r.stderr || '');
const j = JSON.parse(r.stdout);
fs.writeFileSync(fileURLToPath(new URL('./_crit-reach-r2c.json', import.meta.url)), j.boardshot.report);
console.log('wrote json, n =', JSON.parse(j.boardshot.report).length);
