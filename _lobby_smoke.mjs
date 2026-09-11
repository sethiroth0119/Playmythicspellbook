/* 🌐 v121v115 — the online / searching counts are gone from the Play Online
   tile for everyone and live in User Management instead.
   Run: node _lobby_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

const _t0 = SRC.indexOf("{ id: 'btn-play-online'");
const tile = SRC.slice(_t0, SRC.indexOf("{ id: '", _t0 + 10));   // this tile only, up to the next one
ok(/sub: \(Profile\.cloud && Profile\.cloud\.signedIn\) \? 'Find a real opponent · ranked' : 'Sign in to face real players',/.test(tile), 'the Play Online tile says only "Find a real opponent" (or "Sign in")');
ok(/badge: null,/.test(tile) && !/LobbyPresence/.test(tile) && !/searching/.test(tile) && !/isAdmin/.test(tile), '…no online count, no searching count, no badge — for admins too');
ok(/^function _umLobbyLine\(\) \{/m.test(SRC) && /return '🌐 Lobby right now: 🟢 ' \+ online \+ ' online · 🔍 ' \+ q \+ ' searching for a match';/.test(SRC), 'User Management paints the lobby line');
ok(/<div class="small-text" id="um-lobby-line"[^>]*>\$\{_umLobbyLine\(\)\}<\/div>/.test(SRC), '…in its header');
ok(/function renderUserManagement\(\) \{\n\s*_umLobbyWatch\(\);/.test(SRC) && /AdmUM\._lobbyUnsub = onLobbyPresence\(\(\) => \{ const el = document\.getElementById\('um-lobby-line'\); if \(el\) el\.textContent = _umLobbyLine\(\); \}\);/.test(SRC), '…and re-paints it in place on every presence tick (one subscription)');
/* run the line for real */
{
  const body = SRC.slice(SRC.indexOf('function _umLobbyLine() {'), SRC.indexOf('function _umLobbyWatch() {'));
  const line = new Function('LobbyPresence', body + '\nreturn _umLobbyLine();');
  ok(line({ count: 7, queueCount: 2 }) === '🌐 Lobby right now: 🟢 7 online · 🔍 2 searching for a match', 'run for real: 7 online, 2 searching');
  ok(line({}) === '🌐 Lobby right now: 🟢 0 online · 🔍 0 searching for a match', '…and zeros before presence has synced');
}
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 115, 'BUILD_VERSION is v121v115 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
