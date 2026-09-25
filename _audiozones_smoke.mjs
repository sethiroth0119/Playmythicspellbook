/* 🔊 v121v123 — the Custom Audio Manager does what it says: a single uploaded
   track PLAYS (it could not, by construction), Save & apply cuts it over now,
   every stored clip is listed with its size and can be deleted, shuffle is a
   switch, and Just Business and the City Builder have music at all.
   Run: node _audiozones_smoke.mjs */
import { existsSync, readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the bug the owner hit ── */
ok(/const _menuPool = _musicPool\('mainMenu'\);\n\s*if \(_menuPool\.length >= 1\) \{/.test(SRC), 'the Main Menu binds its playlist when it holds ONE track — the `> 1` test is what made a single upload unplayable');
ok(/const _campPool = _musicPool\('camp'\);\n\s*if \(_campPool\.length >= 1\) \{/.test(SRC), '…and Camp & Hubs the same way');
ok(!/if \(_menuPool\.length > 1\) \{/.test(SRC) && !/if \(_campPool\.length > 1\) \{/.test(SRC), 'neither zone can fall through to the built-in theme while it holds an upload');

/* ── 2. a change takes hold now ── */
ok(/if \(!first\) \{ try \{ el\.currentTime = 0; const pr = el\.play\(\); if \(pr && pr\.catch\) pr\.catch\(\(\) => \{\}\); \} catch \(e\) \{\} \}/.test(SRC), 'a changed playlist starts playing instead of waiting for the current track to end');
ok(/id="cam-apply"/.test(SRC) && /💾 Save &amp; apply/.test(SRC), 'the manager has a Save & apply button');
ok(/_menuAudioSrc = null;\n\s*document\.querySelectorAll\('audio'\)\.forEach\(\(el\) => \{ try \{ el\._msSig = undefined; \} catch \(e\) \{\} \}\);/.test(SRC), '…which clears the "what is loaded" caches so every zone re-picks');
ok(/Saved — the music for this screen is playing from the new list\./.test(SRC), '…and says so');

/* ── 3. shuffle is a switch ── */
ok(/function _musicOrder\(slotId, n\) \{/.test(SRC) && /if \(cfg\.shuffle === false\) \{ const idx = \[\]; for \(let i = 0; i < n; i\+\+\) idx\.push\(i\); return idx; \}/.test(SRC), 'a zone can play its tracks in the order they were added');
ok(/data-act="shuffle"/.test(SRC) && /\(total > 1 \? \(cfg\.shuffle === false \? ' · in order' : ' · shuffles'\) : ''\)/.test(SRC), '…with a checkbox, and the header says which it is doing');
ok(/const sig = pool\.join\('\|'\) \+ '#' \+ \(_musicSlotCfg\(slotId\)\.shuffle === false \? 'seq' : 'shuf'\);/.test(SRC), 'flipping the switch re-picks immediately (it is part of the signature)');
ok(/el\._msQueue = _musicOrder\(slotId, p\.length\);/.test(SRC), '…and the auto-advance follows the same order');

/* ── 4. every stored clip, listed and deletable ── */
ok(/async function _camListFiles\(\)/.test(SRC) && /📁 Stored Audio/.test(SRC), 'the manager lists what this device holds');
ok(/ORPHAN — nothing points at it/.test(SRC) && /forge_customMusic_idx/.test(SRC), '…including orphans: deleting a track blanked its record and left the bytes behind, and nothing ever listed them');
ok(/data-act="filedel"/.test(SRC) && /Delete this clip from this device\? It cannot be undone\./.test(SRC), 'each one can be deleted, with a confirmation');
ok(/cfg\.tracks = \(cfg\.tracks \|\| \[\]\)\.filter\(\(t\) => !t \|\| t\.id !== id\);/.test(SRC), '…and deleting removes it from its zone too, so no zone is left pointing at bytes that are gone');

/* ── 5. two rooms that had no music ── */
ok(/\{ id: 'justBusiness', label: '💼 Just Business'/.test(SRC) && /\{ id: 'cityBuilder',  label: '🏙 City Builder'/.test(SRC), 'Just Business and the City Builder are zones');
ok(/function isInJustBusiness\(\)/.test(SRC) && /function isInCityBuilder\(\)/.test(SRC) && /document\.getElementById\('node-city-frame'\)/.test(SRC), '…asked the way the rest of the file asks — the city by its iframe, since it has no screen id');
ok(/if \(isInCityBuilder\(\) && _musicPool\('cityBuilder'\)\.length\) \{/.test(SRC) && /if \(isInJustBusiness\(\) && _musicPool\('justBusiness'\)\.length\) \{/.test(SRC), 'the router reaches both, and only when the zone actually holds a track');
ok(/try \{ if \(typeof syncMusicForScreen === 'function'\) syncMusicForScreen\(\); \} catch \(e\) \{\}\n\s*\/\/ Parent-side close pill/.test(SRC), 'opening the city tells the router by hand — no render() is guaranteed for an overlay');
ok(/try \{ if \(typeof stopCityBuilderMusic === 'function'\) stopCityBuilderMusic\(\); \} catch \(e\) \{\}/.test(SRC), '…and closing it stops the music and re-asks');
ok(/function playCityBuilderMusic\(\)/.test(SRC) && /function playJustBusinessMusic\(\)/.test(SRC) && /_armMenuAudioGesture/.test(SRC), 'both have a player, with the same autoplay-block recovery as every other zone');

/* ── 6. the rename, labels only ── */
ok(/name: 'Admin Controls', sub: 'Prices · audio · publishing · overrides',/.test(SRC) && /<h1 class="section-title">💰 Admin Controls<\/h1>/.test(SRC), 'the panel is called Admin Controls');
ok((SRC.match(/← Admin Controls/g) || []).length === 2 && /Admin Controls is admin-only\./.test(SRC), '…on the back buttons and the admin gate too');
ok((SRC.match(/App\.screen === 'pricingAdmin'/g) || []).length >= 1 && /App\.screen = 'pricingAdmin'/.test(SRC) && /id: 'btn-pricing-admin'/.test(SRC),
  'the SCREEN ID and the tile id are untouched — 13 places route on the id, and the tile id keys the uploaded tile art');

/* ── 7. run the order for real ── */
{
  const block = SRC.slice(SRC.indexOf('function _musicShuffleIdx(n) {'), SRC.indexOf('function _musicBind(el, slotId, isActiveFn) {'));
  const g = { Forge: { customMusic: { a: { onlyMine: false, tracks: [], shuffle: false }, b: { onlyMine: false, tracks: [] } } }, Math, Array, Object };
  g._musicSlotCfg = (id) => g.Forge.customMusic[id];
  const api = new Function('g', 'with (g) { ' + block + ' return { _musicShuffleIdx, _musicOrder }; }')(g);
  const seq = api._musicOrder('a', 5);
  ok(seq.join(',') === '0,1,2,3,4', 'run for real: shuffle off plays them in the order they were added', seq.join(','));
  const shuffled = [];
  for (let i = 0; i < 40; i++) shuffled.push(api._musicOrder('b', 5).join(','));
  ok(new Set(shuffled).size > 1 && shuffled.every((s2) => s2.split(',').sort().join(',') === '0,1,2,3,4'), 'run for real: shuffle on gives a different order without ever dropping or repeating a track');
}

/* ── 💀 v121v128 — VICTORY AND DEFEAT MUSIC ────────────────────────────────
   Owner: "We need victory and defeat music so add it for when victory or
   defeat is qued for a player." Victory had a loop and a playlist slot;
   DEFEAT had neither, so losing a match dropped straight into silence —
   isVictoryActive() is false the moment the loser is you, and the battle track
   is stopped by the same sync pass that would have started the victory one.
   The asset has been sitting in the build all along, referenced by nothing. */
ok(/\{ id: 'defeat',\s+label: '💀 Defeat',/.test(SRC), 'Defeat is a playlist slot the Audio Manager can stock, beside Victory');
ok(/const DEFEAT_MUSIC_SRC = 'assets\/Audio\/defeat%20music\.mp3';/.test(SRC), '…pointing at the track that shipped with the game and was never played');
ok(existsSync('./public/assets/Audio/defeat music.mp3'), '…and that file is really there', 'assets/Audio/defeat music.mp3');
ok(/function isDefeatActive\(\) \{/.test(SRC) && /return App\.state\.gameOver === 'ai';/.test(SRC),
  'defeat is asked the same question victory is, with the answer flipped');
{
  const d = SRC.slice(SRC.indexOf('function isDefeatActive()'), SRC.indexOf('function isDefeatActive()') + 400);
  ok(/if \(App\.screen !== 'battle'\) return false;/.test(d) && /if \(App\.replayViewing\) return false;/.test(d),
    '…including the replay exclusion — a replay of a loss is something you are watching, not something happening to you');
}
ok(/if \(isDefeatActive\(\)\) \{[\s\S]{0,420}playDefeatMusic\(\);/.test(SRC), 'the router plays it, at the same priority as victory');
{
  const branch = SRC.slice(SRC.indexOf('if (isDefeatActive()) {'), SRC.indexOf('if (isDefeatActive()) {') + 420);
  ok(!/stopVictoryMusic\(\)/.test(branch),
    '…and the defeat branch does NOT call stopVictoryMusic, which now stops BOTH — it would cut this track off in the same breath as starting it');
}
{
  const stop = SRC.slice(SRC.indexOf('function stopVictoryMusic()'), SRC.indexOf('function stopVictoryMusic()') + 800);
  ok(/_defeatAudioEl\.pause\(\)/.test(stop),
    'one stop ends the end-of-match moment: stopVictoryMusic is called from fourteen places and every one of them means the player has left it, so fourteen separate edits would only drift apart');
}
{
  const play = SRC.slice(SRC.indexOf('function playVictoryMusic()'), SRC.indexOf('function playVictoryMusic()') + 900);
  ok(/_defeatAudioEl\.pause\(\)/.test(play),
    '…and each loop silences its opposite DIRECTLY, so a result that flips inside one sync pass cannot leave both playing');
}
ok(/if \(_defeatAudioEl\) _defeatAudioEl\.volume = v;/.test(SRC), 'the music volume slider moves it too');

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 123, 'BUILD_VERSION is v121v123 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
