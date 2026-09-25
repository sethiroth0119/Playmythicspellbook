/* ============================================================================
 * _flashstow_smoke.mjs — ⚪ THE WHITE WASH + 🎒 THE SALVAGE RECEIPT.
 *                                             node _flashstow_smoke.mjs
 * ----------------------------------------------------------------------------
 * 🔴 THE WHITE FLASH WAS REPORTED THREE TIMES AND "FIXED" TWICE BEFORE THIS.
 * Both earlier attempts were greps, and each found a different full-screen white
 * layer that was real, was genuinely white, and was not the one playing — the
 * board canvas 'flash' pass, then G.flashEl, then .mvfx-flash. Every one of them
 * is still off, and none of them was the bug.
 *
 * It was found by MEASUREMENT: build the real overlay, ask the Web Animations
 * API what it paints. #febx-root is fixed/inset-0 at z-index 4200, .febx-flash
 * covers 100% of the viewport in rgb(255,246,232), and its keyframes are
 * [0%:0 8%:0.9 100%:0] — a near-white sheet at 90% on every hit frame.
 *
 * So this file asserts the things a grep could not have told anyone:
 *   • the layer cannot paint (the switch is off AND the rule obeys it),
 *   • the layer is still REACHABLE from all three sequencer sites, so the
 *     switch is a switch rather than a half-removal,
 *   • the FIGURE flash is untouched, because that is the VFX the owner asked to
 *     keep seeing rather than the background they asked to lose.
 * ==========================================================================*/
import fs from 'fs';

const IDX = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const CMB = fs.readFileSync(new URL('./public/src/battle/combat.js', import.meta.url), 'utf8');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ══ the white wash ═══════════════════════════════════════════════════════ */
ok('the hit flash is behind ONE switch', /var FEBX_HIT_FLASH = false;/.test(CMB),
   'two half-removals is how a feature comes back by accident');
ok('…and the rule actually reads it',
   /\.febx-flash\{position:absolute;inset:0;opacity:0;background:#fff6e8;'\s*\n\s*\+ \(FEBX_HIT_FLASH \? '' : 'display:none;'\) \+ '\}'/.test(CMB),
   'a switch nothing consults is a comment');
ok('…and OFF means display:none, not opacity:0',
   /FEBX_HIT_FLASH \? '' : 'display:none;'/.test(CMB),
   'opacity:0 still leaves a 100%-viewport node the sequencer can animate back up — three call sites touch e.flash');

/* the node and its three touch points must SURVIVE, or this is a deletion
   pretending to be a switch */
ok('the flash node is still built', /'<div class="febx-flash"><\/div>'/.test(CMB));
ok('…and still bound', /flash: q\('\.febx-flash'\)/.test(CMB));
ok('the static poster frame still touches it', /e\.flash\.style\.opacity = '\.14';/.test(CMB));
ok('the live hit frame still touches it', /e\.flash\.classList\.add\('on'\);/.test(CMB));
ok('settle still clears it', /e\.flash\.style\.opacity = '0';/.test(CMB));

/* 🔴 the VFX the owner wants KEPT */
ok('the defender FIGURE flash is untouched',
   /\.febx-fig\.flash \.febx-art\{filter:brightness\(4\) saturate\(0\) contrast\(1\.4\);\}/.test(CMB),
   'that is the hit VFX itself — a filter on the figure, not a sheet over the board');
ok('the scrim is still DARK, not white',
   /\.febx-scrim\{background:radial-gradient\(ellipse 70% 58% at 50% 50%,rgba\(6,5,10,\.86\)/.test(CMB));

/* the earlier fixes must stay fixed — a regression in any of them reads
   identically to this bug coming back */
ok("the earlier fix holds: .mvfx-flash's branch is still a no-op",
   /if \(vfx\.screenFx === 'flash'\) \{ \/\* intentionally nothing/.test(IDX));
ok('the earlier fix holds: the board flash element stays at opacity 0',
   /G\.flashEl\.style\.opacity = 0;/.test(IDX));

/* the cache-buster, or the fix reaches nobody with a warm service worker */
ok('combat.js carries a fresh ?v=', /src\/battle\/combat\.js\?v=121v167noflash/.test(IDX),
   'the service worker caches these like any asset — an unbumped module ships the old file');

/* 🔴 and the comment that nearly caused a FOURTH wrong diagnosis */
ok('the stale "not wired into the damage path" claim is corrected',
   /STALE COMMENT CORRECTED/.test(IDX),
   'it argued the whole cinematic was inert while FEBattle.play is called from three places');
ok('…and the correction names the count', /called from\n.*THREE places/.test(IDX) || /THREE places/.test(IDX));
const calls = (IDX.match(/window\.FEBattle\.play\(\{/g) || []).length;
ok('FEBattle.play really is called three times', calls === 3, 'found ' + calls
   + ' — if this moved, the corrected comment is now wrong too');

/* ══ the salvage receipt ══════════════════════════════════════════════════ */
ok('the salvage summary is a modal', /showGameAlert\(\{ title: '\u{1F392} Salvage'/u.test(IDX));
ok('…and no longer a 6.5s one-line toast',
   !/showToast\('\u{1F392} ' \+ \(gStr \? 'Stowed ' \+ gStr : 'Took nothing'\)\n\s*\+ \(pStr/u.test(IDX),
   'five clauses joined by · on one line is a bar of run-together text on a phone');
ok('it itemises each pile separately',
   /_row\('\u{1F392}', 'Stowed', gained/u.test(IDX)
   && /_row\('\u{1F512}', 'Protected in your stash', protectedNow/u.test(IDX)
   /* 🪦 is U+1FAA6 (HEADSTONE). Written as \u{1FA66} first, which is a different
      (unassigned) codepoint — the assertion went red while the code was right.
      Spelled with the literal character now rather than an escape I can
      transpose: the source of truth is what the file contains, not my memory of
      a hex value. */
   && /_row\('🪦', 'Dropped — left behind on purpose', dropped/u.test(IDX));
ok('…and says outright when nothing was taken',
   /You took nothing from this one/.test(IDX),
   'an empty modal is worse than the toast it replaced');
ok('…and calls out a FULL bag',
   /const _full = _slots >= _cap;/.test(IDX),
   'a full bag is the REASON something was left behind — making the player infer it from two numbers hides the cause');
ok('the battle-log line is KEPT as the durable record',
   /msg: '\u{1F392} Stowed: '/u.test(IDX),
   'the modal is dismissed and gone; one of them being the record does not make the other redundant');
ok('a failed modal still confirms something happened',
   /the modal is the presentation, not the transaction/.test(IDX),
   'the bag is already written by then — silence would be the worst outcome');

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
