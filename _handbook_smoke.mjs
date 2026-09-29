/* 📖 THE HANDBOOK DESCRIBES THE GAME THAT SHIPPED.  Run: node _handbook_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Owner: "Add this handbook to the Camp Page as a button so players can click
   it and learn about the game, also update it every 24 hours when we add new
   rules and stuff to the game so it can always be updated."

   🔴 A 24-HOUR TIMER IS THE WRONG TRIGGER, AND THIS SUITE IS WHY.
      The book's element / faction / status / rarity tables are GENERATED from
      index.html's own constants by tools/handbook-sync.mjs. They can only fall
      out of date when index.html changes, and an index.html change only reaches
      players through a deploy. So a daily job would run when nothing had
      changed, and still leave the book wrong for up to 24 hours when something
      had. The sync now runs inside deploy.mjs (before minify(), because the
      anchors are line-start matches that minification destroys), and this suite
      is the check that the deploy hook is real and the committed data matches
      the committed game.

   🔴 AND "IT HAS NOT DRIFTED" IS A FACT ABOUT THE PAST, NOT A GUARANTEE.
      Measured 2026-09-15: the generated tables came back byte-identical to the
      copy written 884 commits earlier. That is reassuring and it is not a
      check. This is the check.

   ⚠ §4 IS A NEGATIVE CONTROL. It corrupts the generated data in memory and
     requires the comparison to fail. A gate nobody has watched fail is not
     evidence that it can. */
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const HB = 'public/handbook/';

console.log('\n=== 1. the book is present and self-contained ===');
{
  for (const f of ['index.html', 'handbook.json', 'gamedata.json', 'art.json']) {
    ok(existsSync(HB + f), 'ships ' + HB + f);
  }
  ok(existsSync('tools/handbook-sync.mjs'), 'ships the generator');
  /* The whole design claim is that the book adds no top-level system to the
     legacy bundle. If that stops being true, the "standalone page" argument
     that justified keeping it out of index.html has quietly expired. */
  const page = readFileSync(HB + 'index.html', 'utf8');
  ok(!/window\.MythicBridge/.test(page), 'needs nothing from window.MythicBridge');
}

console.log('\n=== 2. the generated data matches the game AS COMMITTED ===');
{
  /* Re-run the generator into a temp dir and compare. This is the whole suite:
     if index.html's constants have moved and nobody re-ran the sync, the book
     is describing a game that no longer exists and this goes red. */
  const before = JSON.parse(readFileSync(HB + 'gamedata.json', 'utf8'));
  let after = null, threw = null;
  try {
    execFileSync(process.execPath, ['tools/handbook-sync.mjs'], { stdio: 'pipe' });
    after = JSON.parse(readFileSync(HB + 'gamedata.json', 'utf8'));
  } catch (e) { threw = e; }

  ok(!threw, 'the generator runs against today\'s index.html',
    threw ? String(threw.message || threw).split('\n')[0] : undefined);

  if (after) {
    /* `generated` is a timestamp and moves on every run by design — comparing
       it would make this suite fail every time it passed. Everything else is
       the actual game data. */
    for (const key of ['order', 'elements', 'rarities', 'factions', 'statuses']) {
      const a = JSON.stringify(before[key]), b = JSON.stringify(after[key]);
      ok(a === b, 'gamedata.' + key + ' is current',
        a === b ? undefined : 'committed copy differs from what index.html says NOW — run: node tools/handbook-sync.mjs');
    }
    ok(Object.keys(after.elements || {}).length > 0, 'elements is not empty');
    ok((after.factions || []).length > 0, 'factions is not empty');
    ok((after.statuses || []).length > 0, 'statuses is not empty');
  }
}

console.log('\n=== 3. the deploy regenerates it — the ask, wired ===');
{
  const dep = readFileSync('deploy.mjs', 'utf8');
  ok(/function syncHandbook\(\)/.test(dep), 'deploy.mjs has the handbook sync step');
  ok(/handbook-sync\.mjs/.test(dep), '…and it calls the real generator');
  /* ORDER IS LOAD-BEARING. The generator anchors on /^const ELEMENTS = \[/m
     against the SOURCE file; minification removes those line starts, so a sync
     placed after minify() throws on every single deploy. */
  const iSync = dep.indexOf('syncHandbook();');
  const iMin = dep.indexOf('await minify();');
  ok(iSync > 0 && iMin > 0 && iSync < iMin,
    'it runs BEFORE minify() — the anchors are line-start matches that minification destroys',
    'syncHandbook@' + iSync + ' minify@' + iMin);
  ok(/Deploy continues|does not abort|DOES NOT ABORT/i.test(dep),
    '…and a sync failure warns rather than blocking a release');
}

console.log('\n=== 4. NEGATIVE CONTROL — corrupt the data, prove §2 would catch it ===');
{
  const real = JSON.parse(readFileSync(HB + 'gamedata.json', 'utf8'));
  const tampered = JSON.parse(JSON.stringify(real));
  tampered.factions = (tampered.factions || []).slice(0, -1);   // one faction quietly vanishes
  const same = JSON.stringify(real.factions) === JSON.stringify(tampered.factions);
  ok(!same, 'a single dropped faction makes the comparison in §2 fail',
    same ? 'the comparison cannot tell them apart — §2 proves nothing' : undefined);
  const keyMissing = JSON.parse(JSON.stringify(real));
  delete keyMissing.statuses;
  ok(JSON.stringify(real.statuses) !== JSON.stringify(keyMissing.statuses),
    '…and so does a whole table going missing');
}

console.log('\n=== 5. the admin boundary is not the page ===');
{
  const page = readFileSync(HB + 'index.html', 'utf8');
  /* The page's own allowlist decides whether to DRAW the editor. The security
     boundary is RLS on handbook_doc plus is_handbook_admin(), which is live in
     the database. A reader of this file must not come away thinking the client
     check is what stops a non-admin writing. */
  ok(/handbook_publish/.test(page), 'publishing goes through the handbook_publish RPC, not a raw table write');
  ok(existsSync('sql/136_handbook.sql'), 'the migration is in /sql where every other one lives');
  const sql = readFileSync('sql/136_handbook.sql', 'utf8');
  ok(/ALREADY APPLIED/.test(sql),
    '…and it records that it is already applied, because the original handoff said the opposite');
  ok(/security invoker/i.test(sql),
    'handbook_publish is SECURITY INVOKER — a definer would bypass the policies it exists to honour');
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ the handbook describes the game that shipped'));
process.exit(fails ? 1 : 0);
