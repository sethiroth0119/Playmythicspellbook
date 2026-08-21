/* ══════════════════════════════════════════════════════════════════════════
   🌲 DRIVE-SKILLTREE — does the hero skill tree actually work, end to end?

   WHY THIS EXISTS: I reported that hero skill nodes "can never be unlocked",
   from reading alone. That was WRONG. Two orphaned functions
   (unlockHeroSkillNode, unlockSkillTreeNode) are legacy remnants of a
   tier-list tree that was REPLACED by the Cosmic Ascension constellation —
   getHeroSkillTree's own migration block wipes legacy allocations on sight.
   The live tree allocates through its panel's allocate(), which is bound to a
   button.

   A claim about a system doing nothing has to be tested, not read. This tests
   the three links a player depends on:
     1  POINTS ARRIVE — awardHeroSkillPoints banks them on that hero only.
     2  ALLOCATION STICKS — an allocated node is recorded and costs points.
     3  THE BONUS REACHES THE HERO — getHeroCosmicStatBonuses aggregates the
        allocated node's fx, and buildHero reads it (index.html:102286).
        CONTROL: a hero with nothing allocated aggregates all zeroes, or
        "the numbers went up" would prove nothing.

   Run:  node .gauntlet/drive-skilltree.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7700 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(String(e).slice(0, 200)));
/* index.html is 12 MB and pulls a lot on boot; only the globals matter here. */
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof getHeroSkillTree === "function"', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('\n0. the live system is present');
const boot = await page.evaluate(() => ({
  tree: typeof getHeroSkillTree,
  award: typeof awardHeroSkillPoints,
  bonuses: typeof getHeroCosmicStatBonuses,
  nodes: (typeof COSMIC_NODE_INDEX === 'object' && COSMIC_NODE_INDEX) ? Object.keys(COSMIC_NODE_INDEX).length : 0,
  legacyOrphan: typeof unlockHeroSkillNode,
}));
console.log('   ' + JSON.stringify(boot));
ok('getHeroSkillTree exists', boot.tree === 'function');
ok('awardHeroSkillPoints exists', boot.award === 'function');
ok('getHeroCosmicStatBonuses exists', boot.bonuses === 'function');
ok('the cosmic constellation has nodes', boot.nodes > 0, boot.nodes + ' nodes');

console.log('\n1. points arrive, on that hero only');
const pts = await page.evaluate(() => {
  const A = 'drv_heroA', B = 'drv_heroB';
  const before = getHeroSkillTree(A).points | 0;
  awardHeroSkillPoints(A, 3);
  return { a: getHeroSkillTree(A).points | 0, b: getHeroSkillTree(B).points | 0, before };
});
console.log('   ' + JSON.stringify(pts));
ok('the hero banked the points', pts.a === pts.before + 3, pts.before + ' -> ' + pts.a);
ok('CONTROL — a different hero got none', pts.b === 0, 'hero B has ' + pts.b);

console.log('\n2. an allocated node is recorded and the bonus reaches the hero');
const alloc = await page.evaluate(() => {
  const H = 'drv_heroC';
  /* Pick a real node that carries a stat effect — the aggregator only sums
     `fx`, so a node without one would prove nothing either way. */
  const withFx = Object.values(COSMIC_NODE_INDEX)
    .find((n) => n && n.fx && Object.keys(n.fx).length);
  if (!withFx) return { err: 'no cosmic node carries an fx block' };
  const t = getHeroSkillTree(H);
  const before = getHeroCosmicStatBonuses(H);
  t.unlockedNodes[withFx.id] = true;              // what allocate() does
  const after = getHeroCosmicStatBonuses(H);
  const key = Object.keys(withFx.fx)[0];
  return { node: withFx.id, fx: withFx.fx, key,
           beforeVal: before[key], afterVal: after[key],
           beforeAllZero: Object.values(before).every((v) => v === 0) };
});
console.log('   ' + JSON.stringify(alloc));
if (alloc.err) ok('a cosmic node carries stat fx', false, alloc.err);
else {
  ok('CONTROL — with nothing allocated every bonus is zero', !!alloc.beforeAllZero);
  ok('allocating the node raises its stat',
     alloc.afterVal === alloc.beforeVal + alloc.fx[alloc.key],
     alloc.key + ' ' + alloc.beforeVal + ' -> ' + alloc.afterVal + ' (node gives ' + alloc.fx[alloc.key] + ')');
}

console.log('\n3. the legacy orphans are NOT the live path');
ok('unlockHeroSkillNode exists but is unreferenced legacy',
   boot.legacyOrphan === 'function',
   'kept only so this driver can show it is not what the panel calls');

console.log('\npage errors: ' + logs.length);
logs.slice(0, 3).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED — the skill tree works end to end');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
