// DRIVER 13 — what shape is move.laneDepth's "column in front of me", really?
// d3 asserted "straight ray" from endDist === depth. That only proves the lane
// is a GEODESIC (hex-distance-optimal), not that it is one of the six
// directions. Measure the actual cube direction of each step.
import { bootMatch } from './boot.mjs';
const { page, close } = await bootMatch();
const R = await page.evaluate(() => {
  const cube = (x, y) => { const cx = x - ((y - (y & 1)) / 2); return [cx, -cx - y, y]; };
  const rows = [];
  for (const ay of [8, 9]) {
    const ax = 6, depth = 4;
    const lane = [{ x: ax, y: ay }];
    for (let s = 1; s <= depth; s++) lane.push({ x: ax, y: ay - s });
    const dirs = [];
    for (let i = 1; i < lane.length; i++) {
      const A = cube(lane[i-1].x, lane[i-1].y), B = cube(lane[i].x, lane[i].y);
      dirs.push([B[0]-A[0], B[1]-A[1], B[2]-A[2]].join(','));
    }
    const distinct = new Set(dirs);
    const end = distance(lane[0], lane[lane.length-1]);
    // what a TRUE straight ray of the same length looks like from the same tile
    const d0 = hexDirToward(ax, ay, ax, ay - depth);
    let ray = { x: ax, y: ay }; const rayTiles = [];
    for (let k = 0; k < depth; k++) { ray = hexStep(ray.x, ray.y, d0); rayTiles.push(ray.x + ',' + ray.y); }
    rows.push({
      startRow: ay, lane: lane.map(p => p.x + ',' + p.y).join(' → '),
      stepCubeDirs: dirs.join(' | '), distinctDirections: distinct.size,
      endHexDistance: end, steps: depth, isGeodesic: end === depth,
      isSingleHexDirection: distinct.size === 1,
      trueStraightRayWouldBe: rayTiles.join(' → '),
    });
  }
  return rows;
});
for (const r of R) console.log(JSON.stringify(r, null, 1));
await close();
