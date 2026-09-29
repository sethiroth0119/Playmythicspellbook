/* 📜💀 v121v126 — the battle log reads like a duel log: the card that spoke,
   what it did, what killed whom, and a status wearing off. Plus the eight
   approved tracker fixes, the BUNKER label and the Abra Blade pointer.
   Run: node _battlelog_smoke.mjs */
import { readFileSync, existsSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const HS = readFileSync('./public/src/phone/handset.js', 'utf8').replace(/\r\n/g, '\n');
const HUD = readFileSync('./public/base/hud.jsx', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the log shows the card ── */
/* ⚠ v121v136 gave _bcLogRow a SECOND ARGUMENT — the name→card index, built once
   for the whole list because the row function runs up to 400 times per render.
   The claim this pin makes is unchanged (one row built per entry, never one
   interpolated string); only the arity moved, so the pin follows it. */
ok(/function _bcLogRow\(l, idx\) \{/.test(SRC) && /visible\.slice\(-400\)\.reverse\(\)\.map\(l => _bcLogRow\(l, _idx\)\)/.test(SRC), 'every row is built from the entry, not interpolated into one string');
/* ⚠ THIS PIN USED TO REQUIRE THE FRAME FALLBACK. v121v134 removed it because the
   owner named it as the wrong thing to show — "it is show the old card frame and
   an emoji" where the card art belongs — so the pin now requires its ABSENCE.
   The claim it was actually written to protect is untouched: the art is resolved
   at RENDER time and never stored on the entry, because the log is copied into
   every replay snapshot and sent whole over the socket, where a data: URL on an
   entry would be paid for a thousand times over. */
{
  /* ⚠ ENDS AT THE v121v136 INDEX, NOT AT _bcLogRow. That function's signature
     changed, so an indexOf for 'function _bcLogRow(l) {' returned -1 and
     slice(start, -1) handed this pin almost the whole file — which then found
     _abilityFrameUrl somewhere else entirely and failed for the wrong reason.
     A slice end that can silently become -1 is a pin that tests nothing. */
  const _artEnd = SRC.indexOf('/* 🎴 v121v136 — NAME → CARD');
  if (_artEnd < 0) { ok(false, 'the _bcLogArt slice end anchor still exists'); }
  const f = SRC.slice(SRC.indexOf('function _bcLogArt(l) {'), _artEnd);
  ok(/function _bcLogArt\(l\) \{/.test(SRC) && /_abilityArtBest\(l\.cardId, false\)/.test(f),
    'the art is resolved from the card id at RENDER time, never stored on the entry');
  ok(!/_abilityFrameUrl/.test(f) && !/artUrl:/.test(f),
    '…and the generic card back is NOT drawn in its place — no art at all falls through to the emoji instead');
}
ok(/if \(!l \|\| !l\.cardId \|\| l\.hidden\) return '';/.test(SRC), 'a face-down card shows no art — the same redaction the on-screen flourish uses');
ok(!/artUrl: /.test(SRC.slice(SRC.indexOf('function _afxLogEntry'), SRC.indexOf('function _afxAnnounce'))),
  'an entry NEVER carries the art itself: the log is cloned into up to 1200 replay snapshots and sent whole over the socket');
ok(/\.bchrome \.logrow \.logart\{width:34px;height:46px/.test(SRC), 'the thumbnail has a size of its own');

/* ── 2. what activated ── */
ok(/function _afxLogEntry\(spec, state\) \{/.test(SRC) && /try \{ _afxLogEntry\(_spec, state\); \} catch \(e\) \{\}/.test(SRC),
  'every activation writes itself down, from the record the flourish already built');
ok(/sub: \[lines\.join\(' · '\), hit\]\.filter\(Boolean\)\.join\('   ➜ '\) \|\| '',/.test(SRC), '…with one line per effect and what it actually did to the board');
ok(/kind: 'activate',/.test(SRC) && /cardId: spec\.hidden \? null : \(spec\.cardId \|\| null\),/.test(SRC), '…and the card id, so the row can show its art');

/* ── 3. what killed it ── */
ok(/const _cause = _deathCauseLabel\(damageType, _pendingDmgSource, _dmgIn\);/.test(SRC), 'the cause of death is read for EVERY unit — it was computed for heroes only and spent on a toast');
ok(/msg: '💀 ' \+ \(nu\.name \|\| 'A unit'\) \+ ' is destroyed',/.test(SRC) && /sub: \(_cause \? 'by ' \+ _cause : ''\)/.test(SRC), '…and the log says what did it');
ok(/kind: 'death',/.test(SRC) && /cardId: nu\.originalCardId \|\| nu\.cardId \|\| null,/.test(SRC), '…beside the dead card\'s own art');
ok(/if \(nu\.isHero && !nu\.alive && _oldHp > 0\) \{\n\s*_recordHeroDeath\(/.test(SRC), 'the hero death toast is untouched');

/* ── 4. status ── */
ok(/wears off/.test(SRC) && /kind: 'status'/.test(SRC), 'a status wearing off is logged — it was silent for every status but stun');
ok(/\} else \{\n\s*\/\* ✨ v121v126 — expiry was silent/.test(SRC), '…at the one place a status is dropped');

/* ── 5. multiplayer ── */
ok(/sub: entry\.sub \|\| '', kind: entry\.kind \|\| '', cardId: entry\.cardId \|\| null,/.test(SRC), 'an opponent\'s entry carries the same fields (the relay copied only msg and color)');

/* ── 6. the eight approved tracker fixes ── */
ok(!/white-space:nowrap;padding:1px 7px;border-radius:999px/.test(SRC), 'bug-mtxefext — the corporate levy pills can wrap, so five cards in a row stop overflowing');
ok(/out\.push\(\{ id: id, name: _nm, ownerName: _own \|\| 'the owner' \}\);/.test(SRC), 'bug-mtxaegdu — the Client City list carries the node name and the owner');
/* bug-mtx789wa's fix (count from Profile.account.createdAt) was superseded by
   bug-mty87zhi: the camp bar now shows the WORLD day the website shows, which
   can never be stuck on Day 1. The point of this check is unchanged — the bar
   must read a day that is really computed, never the three stamps that are
   written nowhere. */
ok((/const day = \(typeof mythicWorldDay === 'function'\) \? mythicWorldDay\(\) : 1;/.test(SRC) && /function mythicWorldDay\(/.test(SRC))
   || /const f = \(Profile\.account && Profile\.account\.createdAt\) \|\| 0;/.test(SRC),
   'bug-mtx789wa / bug-mty87zhi — the camp clock reads a day that is really computed (the world day)');
ok(/' · LV ' \+ Math\.max\(1, \(n\.meta && n\.meta\.level \| 0\) \|\| \(n\.level \| 0\) \|\| 1\)/.test(SRC), 'bug-mtwuhbwu — the Reserve prints the level the city writes, not the column nothing writes');
ok(/\.concat\(_resMineTiles \|\| \[\]\);/.test(SRC), 'bug-mtxc1qhw — resource listings appear on Manage Listings');
ok(/App\._marketReturn = _campBackTarget\(\);/.test(SRC) && /App\.screen = App\._marketReturn \|\| 'title'; App\._marketReturn = null;/.test(SRC), '…and LUNI returns to the bunker when that is where you came from');
ok(/\(r\.currency === 'aza' \? '👑' : '🔥'\)/.test(HS), 'bug-mtxch4fy — an Aza listing shows Aza on the phone\'s Mine tab');
ok(/const _mine = \(typeof L\.mine === 'function'\) \? \(L\.mine\(\) \|\| \[\]\)\.map/.test(HS), '…and a phone search finds your own listings');
ok(/if \(_locAza > _srvAza && _srvAza > 0\) \{/.test(SRC), 'bug-mtx54ltn — Aza keeps the larger of local and server, as Cinder already did (a sale credit was being erased)');
ok(/if \(p\.missions        && typeof p\.missions        === 'object'\)/.test(SRC) && /__missions__:/.test(SRC) && /if \(f\.__missions__ && typeof f\.__missions__ === 'object'\)/.test(SRC),
  'bug-mtxggyji — mission progress is in ALL THREE whitelists; it was in none, so every reload rerolled the week');

/* ── 7. the bunker, and the blade ── */
ok(/<div className="brand-name">BUNKER<\/div>/.test(HUD), 'the word beside the back button is BUNKER');
/* v121v130 moved both of these deliberately: the blade was rebuilt at 26px
   (owner: "make it smaller also it is too big") so the measured tip is 2,2
   rather than 3,3 / 5,4, and `html, body` joined the selector because `*`
   matches ELEMENTS — over a full-bleed background with no child under the
   pointer it fell through to the system arrow, which is why the blade was
   missing on the main menu. _resdupe_smoke pins the sizes and the hotspots. */
ok(/html, body, \*, \*::before, \*::after \{ cursor: url\('assets\/cursors\/abra-blade\.png'\) 2 2, default !important; \}/.test(SRC),
  'the Abra Blade is the pointer, hotspot on the tip — and it outranks the 863 cursor:pointer declarations in this file, many of them inline styles that beat any stylesheet rule (v121v127: the blade was turning back into the hand)');
ok(/cursor: url\('assets\/cursors\/abra-blade-glow\.png'\) 2 2, pointer !important;/.test(SRC) && /\[style\*="cursor:pointer"\]/.test(SRC),
  '…and over anything clickable the blade GLOWS — including elements carrying their own inline pointer');
ok(/textarea, \[contenteditable="true"\] \{ cursor: text !important; \}/.test(SRC) && /input\[type="range"\] \{ cursor: ew-resize !important; \}/.test(SRC),
  '…and a text box keeps its I-beam, a slider its grab handle');
{
  const p = './public/assets/cursors/abra-blade.png';
  ok(existsSync(p) && statSync(p).size < 16000, 'the cursor ships and is small (a browser drops a cursor over 128px)', statSync(p).size + ' bytes');
  const g = './public/assets/cursors/abra-blade-glow.png';
  ok(existsSync(g) && statSync(g).size < 16000, 'the glow variant ships and is small too', statSync(g).size + ' bytes');
  const meta = JSON.parse(readFileSync('./public/assets/cursors/abra-blade.json', 'utf8'));
  ok(meta.sizes['abra-blade.png'].w <= 64 && meta.sizes['abra-blade.png'].hotspot.x <= 6 && meta.sizes['abra-blade.png'].hotspot.y <= 6,
    'the hotspot was MEASURED off the rotated art, and sits on the tip', JSON.stringify(meta.sizes['abra-blade.png']));
}

/* ── 8. 🎴 v121v129 — THE CARD THAT WAS PLAYED, with its art ──────────────────
   Owner, with a screenshot of a log that is all text: "Show card art for units
   that are played." v121v126 built the row that can draw it — _bcLogRow
   resolves the art at RENDER time from l.cardId — but the five places that
   announce a card being PLAYED all pushed a bare { msg, color }, the oldest
   shape in the file and the one thing the renderer cannot draw. So a whole
   match of deploys scrolled past as sentences while the activations that
   followed them showed their art. */
ok(/kind: 'play', cardId: card\.id \|\| null, cardType: 'unit', icon: card\.icon \|\| '⚔', hidden: !!card\.isSubterfuge \}\]/.test(SRC),
  'a unit YOU play carries its card id, so the row can draw it');
ok(/kind: 'play', cardId: best\.id \|\| null, cardType: 'unit', icon: best\.icon \|\| '⚔', hidden: !!best\.isSubterfuge \}\]/.test(SRC),
  '…and one the AI plays does too');
ok(/kind: 'play', cardId: cheapest\.id \|\| null, cardType: 'unit', icon: cheapest\.icon \|\| '⚔' \}\)/.test(SRC),
  '…including the one it drops as an interception');
ok(/cardId: u\.originalCardId \|\| u\.cardId \|\| null,/.test(SRC),
  'an opponent\'s unit arriving over the socket carries the ORIGINAL card id — the battle instance id is not what the thumbnail is filed under');
ok(/kind: 'play', cardId: card\.id \|\| null, cardType: card\.type \|\| 'spell', icon: card\.icon \|\| '✨' \}\]/.test(SRC),
  '…and a spell the enemy casts is a card being played too');
ok(/hidden: !!card\.isSubterfuge \}\]/.test(SRC) && /hidden: !!best\.isSubterfuge \}\]/.test(SRC),
  '🃏 a face-down SET is marked hidden on both sides — the same redaction the on-screen flourish uses, so a Subterfuge play does not leak its art');
ok(/\.bchrome \.logrow\.lk-play\{background:linear-gradient/.test(SRC), 'a played card gets its own tint, like a death and an activation');
{
  /* run the row's redaction rule for real — it is the whole of the privacy */
  const art = (l) => (!l || !l.cardId || l.hidden) ? '' : 'IMG:' + l.cardId;
  ok(art({ cardId: 'cc_1', hidden: false }) === 'IMG:cc_1', 'run for real: a played card draws its art');
  ok(art({ cardId: 'cc_1', hidden: true }) === '', 'run for real: a face-down one draws nothing, even though the entry carries the id');
  ok(art({ cardId: null }) === '', 'run for real: an entry with no card draws nothing rather than an empty frame');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 126, 'BUILD_VERSION is v121v126 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
