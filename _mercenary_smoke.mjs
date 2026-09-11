/* ⚔ THE MERCENARY BOARD, WIRED IN AND ON THE PHONE (v121v66).

   Asked for: "Setup this system and add it as an app on the phone."

   The feature arrived as a module built on an old branch (v120x0) whose
   index.html is ~60 versions behind this one, so it was cherry-picked rather
   than merged: the module files verbatim, the migration renumbered off a
   three-way 038 collision, and exactly three index.html hunks.

   What this suite defends:

     · THE MODULE IS REACHED THROUGH THE BRIDGE, never bare globals. Profile,
       RESOURCES, Forge and Cloud are top-level consts and invisible to an ES
       module — the whole reason MythicMercBridge exists.
     · THE TILE ACTUALLY APPEARS. The module is deferred, so it registers
       AFTER the first render, and renderTitle() hides the tile while
       window.MythicMercenaries is undefined. Nothing listened for the ready
       event on the source branch, so on a cold load the tile was simply
       absent. That listener is pinned here.
     · COLLECT CHECKS FOR ROOM BEFORE IT CLAIMS. A claim is a one-shot insert
       server-side; goods that do not fit afterwards exist nowhere. The phone
       must not be terser about this than the desktop.
     · THE PHONE NEVER DRAWS "nothing" OVER AN UNANSWERED FETCH — the Luni bug,
       which shipped once already.

   Run: node _mercenary_smoke.mjs */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const HS  = readFileSync('./public/src/phone/handset.js', 'utf8');

/* ── the module landed intact ── */
{
  const files = ['index.js', 'merc.api.js', 'merc.badges.js', 'merc.bridge.js', 'merc.manifest.js', 'merc.render.js', 'merc.state.js'];
  const missing = files.filter((f) => !existsSync('./public/src/mercenary/' + f));
  ok(missing.length === 0, 'all seven module files are present', missing.join(', '));
  ok(existsSync('./sql/122_mercenary_board.sql'), 'the migration is present');
}
{
  /* Three sql/038_* files already existed. A fourth would have been a silent
     collision in a directory where the number IS the running order. */
  const sql = readFileSync('./sql/122_mercenary_board.sql', 'utf8');
  ok(!existsSync('./sql/038_mercenary_board.sql'), 'and is NOT filed as a fourth 038, which already collides three ways');
  ok(/merc_post_contract/.test(sql) && /merc_deliver/.test(sql) && /merc_claim/.test(sql), 'it carries the RPCs the module calls');
  ok(/on conflict on constraint merc_claims_pkey/.test(sql),
    'the pkey ON CONFLICT target is intact — a bare column list breaks EVERY claim at runtime');
  const src = readFileSync('./public/src/mercenary/merc.render.js', 'utf8');
  ok(/sql\/122_mercenary_board\.sql/.test(src) && !/038_mercenary_board/.test(src),
    'the module points players at the file that actually exists');
}

/* ── the seam ── */
ok(/window\.MythicMercBridge = \{/.test(SRC), 'the bridge is on window, not a top-level const');
{
  const i = SRC.indexOf('window.MythicMercBridge = {');
  const seg = SRC.slice(i, SRC.indexOf('window.MythicCityBridge = {', i));
  ok(seg.length > 2000, 'and it is the whole bridge, not a stub', String(seg.length));
  ok(/adoptBalance:/.test(seg), 'it carries adoptBalance — the ONLY Cinder write the module may make');
  ok(!/spendGems:|addGems:/.test(seg), 'and deliberately no spendGems/addGems: escrow already moved the money server-side');
  ok(/refundRes:/.test(seg) && /addRes:/.test(seg), 'refundRes (uncapped undo) and addRes (capped create) stay separate');
  ok(/resources: \(\) => \{/.test(seg), 'resources are read live, so a Forge resource published later is tradeable');
}
/* every symbol the bridge reaches for must still exist in this file */
{
  const need = ['function spendResources', 'function addRes', '_refundRes', 'getAllCustomCards', '_resOwnCount',
                '_resTakeOwned', '_resGiveOwned', '_gemsTaxExempt', '_frTaxLedger', 'gcConfirm', 'const RESOURCES', 'SALVAGE_RES'];
  const gone = need.filter((n) => SRC.indexOf(n) < 0);
  ok(gone.length === 0, 'every symbol the bridge depends on is still in index.html', gone.join(', '));
}

/* ── the tile, and the reason it used to be missing ── */
ok(/id: 'btn-mercenaries'/.test(SRC), 'the main-menu tile exists');
ok(/window\.MythicMercenaries\)\s*\?\s*\{ id: 'btn-mercenaries'/.test(SRC.replace(/\s+/g, ' ')) || /\(\(typeof window !== 'undefined' && window\.MythicMercenaries\)/.test(SRC),
  'and resolves to null until the module registers');
ok(/window\.addEventListener\('mythic:mercenaries-ready'/.test(SRC),
  'the ready event is LISTENED for — without this the tile is absent on a cold load');
{
  const i = SRC.indexOf("window.addEventListener('mythic:mercenaries-ready'");
  const seg = SRC.slice(i, i + 320);
  ok(/App\.screen === 'title'/.test(seg), 'and only repaints the menu the tile belongs to');
  ok(/\{ once: true \}/.test(seg), 'exactly once');
}
ok(/<script type="module" src="src\/mercenary\/index\.js\?v=v121v66merc1"><\/script>/.test(SRC),
  'the module tag is present with a bumped ?v= — a missed bump ships invisibly');

/* ── the phone app ── */
ok(/\{ id: 'merc',\s+name: 'Mercenaries',/.test(HS), 'the phone has a Mercenaries app');
ok(/else if \(id === 'merc'\) \{ mercLoaded = false;/.test(HS), 'opening it resets the fetch latch, like Luni');
ok(/window\.MythicMercenaries \|\| null/.test(HS), 'it reads the module directly — no second seam to disagree with');
{
  /* The Luni bug, which shipped once: the app read arrays that only the
     desktop screen ever filled, and drew "nothing is listed" over them. */
  const i = HS.indexOf('function mercEnsure(');
  ok(i > 0 && /Promise\.resolve\(M\.loadAll\(\)\)/.test(HS.slice(i, i + 400)), 'the app fetches on open rather than trusting the hub to have run');
  ok(/mercLoading \? 'Reading the board…' : 'No open contracts\.'/.test(HS),
    'and says "Reading the board" instead of "No open contracts" while it waits');
  ok(/mercLoading \? 'Reading the board…' : 'Nothing waiting\.'/.test(HS), 'same on the Collect tab');
}
{
  /* The one that costs goods if it regresses. */
  const i = HS.indexOf('function renderMercCollect(');
  const seg = HS.slice(i, i + 2600);
  ok(i > 0 && /M\.manifest\.acceptable\(items, c\)/.test(seg), 'Collect asks whether the stash has room BEFORE claiming');
  ok(/fit\.ok \? '' : ' disabled'/.test(seg), 'and disables the button when it does not');
  ok(/make room first/.test(seg), 'saying so in numbers rather than failing silently');
  ok(/cash \? \{ ok: true \}/.test(seg), 'a Cinder payout skips the check — it takes no stash space');
  ok(/r\.already \? 'That one was already collected\.'/.test(seg), 'a double tap is reported, never retried');
  ok(/mercBusy/.test(seg), 'and a claim in flight blocks a second one');
}
{
  const i = HS.indexOf('function renderMercTicket(');
  const seg = HS.slice(i, i + 2400);
  ok(i > 0 && /M\.api\.apply\(c\.id, ''\)/.test(seg), 'a contract can be applied for from the phone');
  ok(/Your own contract/.test(seg), 'your own posting cannot be applied to');
  ok(seg.indexOf(">Applied · ' + esc(already)") > 0, 'and an existing application shows its status instead of a second Apply');
  ok(/employer has no button to withhold it/.test(seg), 'the escrow promise is stated where the player decides');
}
ok(/Posting needs the full board/.test(HS) && /Delivering needs the full board/.test(HS),
  'the two flows that need the stash pickers point at the desktop board rather than half-implementing it');
ok(/S\.missing/.test(HS) && /not set up on this world yet/.test(HS), 'an unapplied migration explains itself on the phone too');
ok(/S\.offline/.test(HS) && /Sign in to take contracts/.test(HS), 'and so does being signed out');

/* ── versions move together ── */
ok(/window\.BUILD_VERSION = 'v121v(6[6-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v66 or later');
/* At or after the build that added the app — the tag moves on every later
   handset change, so pinning it to one exact version makes this suite fail on
   somebody else's unrelated bump. */
ok(/src\/phone\/handset\.js\?v=v121v(6[6-9]|[7-9]\d|\d{3,})/.test(SRC), 'the handset tag moved with it');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
