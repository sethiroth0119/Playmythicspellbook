/* 🎬 v121v152 — THE THREE REBUILT CINEMATICS, INTEGRATED.
   Run: node _cinemerge_smoke.mjs

   Owner: "Replace the cinematic animation for these animations we already have
   with these new one and make sure card art is showing before the end result
   where it shows the Sprite or unit Character Box Portrait."

   Three separate sessions each rebuilt one cinematic, each on its own branch cut
   from v121v118, and each bumped THE SAME version knobs. None was deployed.
   Bringing them together is mostly about the things three parallel branches
   cannot know about each other — which is what most of these checks are. */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const SW  = readFileSync('./public/sw.js', 'utf8').replace(/\r\n/g, '\n');
const page = (n) => readFileSync('./public/vfx/' + n + '.html', 'utf8').replace(/\r\n/g, '\n');

/* ── no merge wreckage ────────────────────────────────────────────────────── */
for (const [name, body] of [['index.html', SRC], ['sw.js', SW],
                            ['vfx/kalon.html', page('kalon')], ['vfx/fusion.html', page('fusion')],
                            ['vfx/archon.html', page('archon')]]) {
  ok(!/^<<<<<<< |^>>>>>>> |^=======$/m.test(body), 'no conflict markers survived in ' + name);
}
ok((SW.match(/^const CACHE_VERSION = /gm) || []).length === 1,
  'sw.js declares CACHE_VERSION EXACTLY ONCE — the cherry-pick left two, which is a redeclaration, a SyntaxError, and a service worker that never parses',
  String((SW.match(/^const CACHE_VERSION = /gm) || []).length));
ok((SRC.match(/window\.BUILD_VERSION = '/g) || []).length === 1,
  'index.html declares BUILD_VERSION exactly once');

/* ── THE SHARED STAMP: the trap all three handoffs led with ───────────────── */
{
  const want = (SRC.match(/const MECH_VFX_VER = '([^']+)'/) || [])[1];
  ok(!!want, 'MECH_VFX_VER is set', want);
  const stampLine = (SRC.match(/const _MECH_VFX_STAMP = \{[^}]*\}/) || [])[0] || '';
  for (const k of ['kalon', 'fusion', 'archon']) {
    const hostWants = (stampLine.match(new RegExp(k + ": '([^']+)'")) || [])[1];
    const pageHas = (page(k).match(/VFX_BUILD *= *"([^"]+)"/) || [])[1];
    ok(!!hostWants && hostWants === pageHas,
      'the ' + k + ' page stamp EXACTLY equals what the host expects — a mismatch is treated as a stale edge copy, so the host reloads once and then HIDES the overlay, which reads as "the cinematic silently stopped working"',
      hostWants + ' vs ' + pageHas);
    ok(!!hostWants && hostWants.indexOf(want + '-') === 0,
      '…and it carries the current MECH_VFX_VER, so the iframe cache-buster moves with the file', hostWants);
  }
  ok(/v120t7/.test(want || ''),
    'ALL THREE MOVED TOGETHER to one new version — the branches had kalon at v120t5 and archon at v120t6 against a repo at v120t3, and taking either alone would have silently killed the other two',
    want);
}

/* ── the rebuilt pages really are the rebuilt ones ────────────────────────── */
ok(/CK\.portal *= |portal *\(cx, cy, R, k, t, a\)|function portal/.test(page('kalon')) || /portal/.test(page('kalon')),
  'kalon.html carries the cosmic-portal rebuild');
ok(/corridor/.test(page('kalon')), '…including the corridor helper the flip happens inside');
ok(/DK\b/.test(page('kalon')), '…and the single DK backdrop budget');
ok(/BACKDROP/.test(page('archon')), 'archon.html carries its BACKDROP budget knob');
ok(/BARS_ON_BOARD/.test(page('archon')),
  '…and the bars solve for what the vignette already spent, because two scrims COMPOUND (measured at 45%, not 30%)');

/* ── CARD ART BEFORE THE BODY, in all three ───────────────────────────────── */
{
  /* ⚠ the window has to reach the ARCHON branch, which is the last of the three
     and sits well past the kalon/fusion ones — a short slice passes every other
     check in this block and silently skips that one. */
  const _lo = SRC.indexOf('async function _vfxPayloadFor');
  const _hi = SRC.indexOf('out.eyebrow', SRC.indexOf('out.tributes'));
  ok(_lo > 0 && _hi > _lo, 'the payload builder is anchored end to end');
  const f = SRC.slice(_lo, _hi);
  ok(/out\.card = \(await P\(_vfxCardFace\(d\.from \|\| d\.unit\)\)\) \|\| _VFX_BLANK_PX;/.test(f),
    'KALON is sent the base CARD FACE — it flips that card into the new form, so the card is on screen before the body');
  ok(/out\.tributes = await Promise\.all\(tribs\.map\(async t => \(await P\(_vfxCardFace\(t\)\)\) \|\| _VFX_BLANK_PX\)\);/.test(f),
    'ARCHON is sent the tribute CARD FACES — they fly in and burn before the Archon falls through the portal');
  ok(/out\.unit = body \|\| _VFX_BLANK_PX;/.test(f),
    'the body slot is never null — a null key is SKIPPED by the page\'s set(), which would leave its placeholder mech on screen');
  ok(/if \(!body\) body = _vfxCardFace\(d\.unit\);/.test(f),
    '…and falls back to the card face when a unit has no sprite, because a picture of the right unit beats the wrong unit');
}
ok(/function _fcxFrameHtml\(mat\) \{[\s\S]{0,240}_polyArtSrc\(mat\.cardId\)/.test(SRC),
  'FUSION draws every frame — materials AND the result — from the card art');

/* ── ONE fusion cinematic, not two ────────────────────────────────────────── */
ok(/App\.ui\._fcxPlayed = true;/.test(SRC), 'the new fusion cinematic records that it played');
{
  const lo = SRC.indexOf('let _newCinePlayed = false;');
  ok(lo > 0, 'the resolver tests it');
  const f = SRC.slice(lo, lo + 700);
  ok(/if \(App\.ui\) App\.ui\._fcxPlayed = false;/.test(f),
    'THE FLAG IS CONSUMED, not merely read — a later fusion resolved by a path that never mounted the new overlay must still get a cinematic rather than a silent summon');
  ok(/if \(!_newCinePlayed\) \{/.test(f) && /_playMechVfx\('fusion'/.test(f),
    'and the OLD 7s overlay only fires when the new one did not — back to back they put 13.2 seconds of cinematic in front of one summon');
}

/* ── Cedric actually breathes ─────────────────────────────────────────────── */
ok(existsSync('./public/assets/artwork/ui/cedric-idle.webp'), 'the loop is in the repo');
{
  const sz = readFileSync('./public/assets/artwork/ui/cedric-idle.webp').length;
  ok(sz > 100000 && sz < 5000000,
    'the jacket-only loop is SMALLER than the whole-body one it replaces (was 6.0MB) — fewer pixels change per frame, so it encodes smaller AND reads calmer',
    (sz / 1048576).toFixed(2) + 'MB');
}
{
  const lo = SRC.indexOf('function _menuCharStill() {');
  const hi = SRC.indexOf('function _cedricMenuEntry');
  ok(lo > 0 && hi > lo, 'the still-vs-loop decision is locatable');
  const f = SRC.slice(lo, hi);
  ok(/prefers-reduced-motion/.test(f),
    'prefers-reduced-motion still wins — an OS-level request from the person using the machine is not ours to override');
  ok(/q === 'low'/.test(f), "…and so does the game's own graphics setting, which _memShedGraphics latches under real memory pressure");
  ok(!/hardwareConcurrency/.test(f) && !/deviceMemory/.test(f),
    'THE HARDWARE SNIFF IS GONE — it was the only branch that GUESSED, and it was the one firing: a capable laptop reports 4 cores and silently lost the animation with nothing on screen to say why');
}

/* ── run the stamp rule for real ──────────────────────────────────────────── */
{
  const hostHides = (want, has) => want !== has;   // the host's actual test
  ok(hostHides('v120t7-kalon', 'v120t5-kalon'), 'run for real: an older page stamp is a mismatch — the host hides the overlay');
  ok(!hostHides('v120t7-kalon', 'v120t7-kalon'), 'run for real: an equal stamp plays');
  ok(hostHides('v120t7-kalon', ''), 'run for real: PRESENCE IS NOT ENOUGH — a cached page from an older deploy still carries a stamp');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 152, 'BUILD_VERSION is v121v152 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(SW), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
