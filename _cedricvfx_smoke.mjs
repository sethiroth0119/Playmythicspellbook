/* 🧍🎬 v121v142 — Cedric is the standard menu character; three new cinematics.
   Run: node _cedricvfx_smoke.mjs

   Owner: "Replace the character that is on the main menu and that transfer on
   the side of other menus. Have this breathing Cedric be the standard default
   across all pages from on out."
   Owner: "Add the Cosmic Punch to Effect VFX (plays when the effect fires)",
   "Add Geomax Summon VFX — plays when THIS unit is summoned", "Add lord gary to
   Summon VFX — plays when THIS unit is summoned."

   ⚠ EVERY ASSET WAS RECOMPRESSED BEFORE IT SHIPPED. Delivered: Cedric 51MB,
     Geomax 26MB (a 23.9MB HTML that is 10KB of code and three 2000x2000 base64
     PNGs), Gary 3.7MB, Cosmic Punch 2.1MB. The cinematics already in assets/vfx
     run 16KB-450KB, and there is an open laptop-performance report. */
import { readFileSync, existsSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const kb = (p) => Math.round(statSync(p).size / 1024);

/* ── Cedric: one definition, read by every surface ────────────────────────── */
ok(/const CEDRIC_MENU_ANIM  = '\/assets\/artwork\/ui\/cedric-idle\.webp';/.test(SRC), 'the loop has one definition');
ok(/const CEDRIC_MENU_STILL = '\/assets\/artwork\/ui\/cedric-still\.webp';/.test(SRC), '…and so does the still');
ok(/CEDRIC_MENU_ANIM\s*=\s*'\//.test(SRC) && /CEDRIC_MENU_STILL\s*=\s*'\//.test(SRC),
  'BOTH PATHS ARE ROOT-ABSOLUTE — the menu runs in an iframe at main-menu/, so a relative "assets/…" would resolve to main-menu/assets/… and 404');
{
  /* ⚠ Anchored on the NEXT function rather than a byte count. A fixed 1400-char
     window broke the moment the block comment above the Cedric return grew,
     which is a fragile way to fail: the code was right and the slice was short. */
  const _lo = SRC.indexOf('function _mdRoster() {');
  const _hi = SRC.indexOf('\nfunction ', _lo + 10);
  ok(_lo > 0 && _hi > _lo, 'the _mdRoster body is anchored end to end');
  const f = SRC.slice(_lo, _hi);
  /* ⚠ v121v156 — THESE PINS WERE INVERTED, DELIBERATELY, ON THE OWNER'S CALL.
     v142 gave the admin-curated roster precedence and this suite pinned that,
     on the reasoning that "silently overriding it would make that screen a
     lie". The owner asked twice for the opposite — "Remove this and stop it
     from trying to show characters I just want the live image at the start
     showing" — and reading the PUBLISHED roster here is exactly why clearing
     the Character Manager appeared not to work even after v155 fixed the local
     persistence: the entry was gone from the working copy and still on screen,
     because the menu was never looking at the working copy.

     The check did not get weaker. It now asserts the STRONGER property: the
     menu has ONE source, so nothing can put a character back on it. */
  ok(!/if \(out\.length\) return out;/.test(f),
    'THE ADMIN-CURATED ROSTER NO LONGER DRIVES THE MENU — it was read first, which is why a cleared Character Manager still showed a character');
  ok(/try \{ return \[_cedricMenuEntry\(\)\]; \} catch \(e\) \{\}/.test(f),
    'Cedric IS the menu character — one source, no rotation');
  ok(/THE ADMIN-CURATED ROSTER USED TO BE READ HERE AND IS DELIBERATELY GONE/.test(f),
    '…and the removal is explained in place, so nobody restores the precedence as a "fix"');
  ok(/The hero-art fallbacks below STAY/.test(f),
    '…while the hero fallbacks survive as the last thing between a missing asset and an empty silhouette');
  ok(/Removed rather than reordered/.test(f),
    'removed rather than reordered — left below Cedric it would be dead code that still reads as a feature');
}

/* ── the still-frame fallback ─────────────────────────────────────────────── */
{
  /* Starts at the DOC COMMENT: the reasoning for copying combat.js's probe
     rather than inventing a second one lives above the signature, and that
     reasoning is half of what this pin exists to protect. */
  const f = SRC.slice(SRC.indexOf('/* Should this device get the still instead of the loop?'), SRC.indexOf('function _cedricMenuEntry()'));
  ok(/prefers-reduced-motion: reduce/.test(f), 'reduced motion gets the still');
  ok(/getSettings\(\)\.gfxQuality/.test(f) && /if \(q === 'low'\) return true;/.test(f),
    "…so does the player's own graphics setting, which _memShedGraphics latches to low under memory pressure");
  /* ⚠ v121v152 — THIS PIN WAS INVERTED, DELIBERATELY, ON THE OWNER'S CALL.
     It used to REQUIRE the combat.js hardware probe (4 cores / 4GB → still).
     The owner was looking at the still on their own machine and asked for the
     breathing Cedric: that branch was the only test here that GUESSED, and it
     was the one firing — a capable laptop reports those numbers and silently
     lost the animation, with nothing on screen to say why or any way to change
     it. The cost premise behind it was a 6MB whole-body loop; the loop is now
     the jacket-only one at 3.6MB.

     The check did not get weaker. It now asserts the STRONGER rule: the still
     is served only when a PERSON asked for less — never because we inferred
     something about their hardware. The two branches above are that rule. */
  ok(!/hardwareConcurrency/.test(f) && !/deviceMemory/.test(f),
    'THE HARDWARE SNIFF IS GONE — no silent downgrade based on a guess about the reader');
  ok(/A THIRD BRANCH USED TO LIVE HERE and its removal is the point/.test(f),
    '…and the removal is explained in place, so nobody helpfully puts the probe back');
  ok(/Do not reinstate it/.test(f),
    '…including what to reach for instead: the asset, not a silent guess');
}
ok(/THE DECISION IS MADE IN THE PARENT, not the iframe/.test(SRC),
  'the parent decides and hands the iframe a finished src — _mmData never sends the graphics setting across, so the iframe could not decide correctly even if asked');

/* ── the Cedric assets ────────────────────────────────────────────────────── */
{
  const anim = './public/assets/artwork/ui/cedric-idle.webp';
  const still = './public/assets/artwork/ui/cedric-still.webp';
  ok(existsSync(anim), 'the animated loop ships');
  ok(existsSync(still), 'the still ships');
  if (existsSync(anim)) ok(kb(anim) <= 7000, 'the loop is ' + kb(anim) + 'KB — down from 51MB delivered, on a screen the player sees every visit', kb(anim) + 'KB');
  if (existsSync(still)) ok(kb(still) <= 260, 'the still is ' + kb(still) + 'KB, cheap enough that a weak device pays almost nothing', kb(still) + 'KB');
}

/* ── the three cinematics are registered ──────────────────────────────────── */
ok(/cosmicPunch:    \{ label: '👊 Cosmic Punch',     file: 'assets\/vfx\/vfx-cosmic-punch' \},/.test(SRC),
  'COSMIC PUNCH is in the Effect VFX picker — "plays when the effect fires"');
ok(/geomax:       \{ label: '🌑 Geomax — Devourer of Existence',         file: 'assets\/vfx\/vfx-geomax\.html' \},/.test(SRC),
  'GEOMAX is in the per-unit Summon VFX picker');
ok(/lordGary:     \{ label: '🌀 Lord Gary — Gate of Zemore',             file: 'assets\/vfx\/vfx-lord-gary\.html' \},/.test(SRC),
  'LORD GARY is too');
{
  const f = SRC.slice(SRC.indexOf('const _ACE_VFX_NAME_MAP = ['), SRC.indexOf('function _aceVfxIdForUnit(u)'));
  ok(/\{ id: 'geomax',       any: \['geomax'\] \},/.test(f) && /\{ id: 'lordGary',     any: \['lord gary'\] \},/.test(f),
    'BOTH ARE IN THE NAME MAP TOO — the half that actually fires them in a match when the card\'s summonVfx was never set or was stripped on publish');
  ok(/Registering\n\s*only the picker would leave these working in the Forge and dead in a match/.test(f),
    '…and why that matters is written down, because the picker alone looks like it works');
}

/* ── the cinematic files, at a sane size ──────────────────────────────────── */
for (const [p, cap, what] of [
  ['./public/assets/vfx/vfx-geomax.html', 60, 'the Geomax page (was a 23.9MB HTML: 10KB of code + three base64 PNGs)'],
  ['./public/assets/vfx/vfx-lord-gary.html', 40, 'the Lord Gary page'],
  ['./public/assets/vfx/vfx-cosmic-punch.html', 40, 'the Cosmic Punch host page'],
  ['./public/assets/vfx/geomax-dragon.webp', 500, 'the Geomax dragon'],
  ['./public/assets/vfx/lord-gary-city.webp', 400, 'the Gary city plate'],
  ['./public/assets/vfx/cosmic-fist.webp', 400, 'the Cosmic Punch fist'],
]) {
  ok(existsSync(p), what + ' ships');
  if (existsSync(p)) ok(kb(p) <= cap, '…at ' + kb(p) + 'KB, in line with the 16-450KB the folder already carries', kb(p) + 'KB > ' + cap + 'KB');
}
for (const i of [0, 1, 2]) ok(existsSync('./public/assets/vfx/geomax-p' + i + '.webp'), 'Geomax planet ' + i + ' is a separate, cacheable file rather than base64 in the page');
ok(!/data:image\/png;base64/.test(readFileSync('./public/assets/vfx/vfx-geomax.html', 'utf8')),
  'NO base64 IMAGE IS LEFT IN THE GEOMAX PAGE — base64 is 33% larger than the bytes it carries and cannot be cached apart from the page');

/* ── Cosmic Punch was adapted, not merely copied ──────────────────────────── */
{
  const js = readFileSync('./public/assets/vfx/cosmic-punch.js', 'utf8');
  ok(!/import \* as THREE from 'three';/.test(js) && /const THREE = window\.THREE;/.test(js),
    'the ES module import is gone — every cinematic here loads the VENDORED UMD three with a plain <script src>, which cannot resolve a bare specifier');
  ok(!/import\.meta/.test(js),
    'import.meta is gone too — it is a SYNTAX error in a classic script, so the whole file would have failed to parse and the effect would simply never have existed');
  ok(/if \(THREE\.SRGBColorSpace !== undefined\)/.test(js) && /else if \(THREE\.sRGBEncoding !== undefined\)/.test(js),
    'the colour space works on BOTH builds — the vendored three predates SRGBColorSpace, so the original line would have stored undefined and rendered the fist washed out, a bug nobody files');
  ok(/window\.CosmicPunch = CosmicPunch;/.test(js), '…and the class is published for the host page');
  const page = readFileSync('./public/assets/vfx/vfx-cosmic-punch.html', 'utf8');
  ok(/<script src="three\.min\.js"><\/script>/.test(page), 'the host page loads the LOCAL three, not the package\'s jsDelivr import');
  /* ⚠ THIS PIN USED TO MATCH THE WORD "jsDelivr" — which the page's own comment
     contains, explaining why it does NOT use one. It would have failed forever
     while the code was entirely correct. Test for a real remote URL instead. */
  ok(!/(?:src|href)\s*=\s*["']https?:\/\//i.test(page),
    '…and no CDN URL survives — a cached game with no network is exactly when this must still work');
  ok(/setTimeout\(done, TOTAL_MS \+ 2500\);/.test(page),
    'it has a hard stop regardless — a cinematic that never ends is a WebGL context the host cannot reclaim');
  ok(/Math\.min\(\(t - last\) \/ 1000, 0\.05\)/.test(page),
    '…and the frame delta is clamped, so a backgrounded tab cannot fast-forward the animation on return');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 142, 'BUILD_VERSION is v121v142 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
