/* 🌦 v121v103 — Homestead: no repaint flash; the sky is the city's sky.

   Owner (2026-09-10): "Fix the flashing that all of the pages do like it
   refreshes… pressing buttons on the feed stock changes the weather. The
   weather should be exactly like how the city builder weather and time is."

   node-city publishes its live `wx` to localStorage on every change; the
   parent's farm bridge reads it and the city's clock (America/New_York); the
   farm's weatherAt() takes the city's answer first and rolls its own only for
   a player whose city has never run; the sky follows the clock; paint() diffs
   markup and writes only what changed.

   Run: node _farmsky_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const FARM = readFileSync('./public/src/farm/index.js', 'utf8').replace(/\r\n/g, '\n');

/* ── node-city publishes ── */
ok(/const _wxPub = \{ type: null, until: 0 \};\nfunction _wxPublish\(\) \{[\s\S]*?localStorage\.setItem\('nc_wx', JSON\.stringify\(\{ type: wx\.type, until: Math\.floor\(wx\.until \|\| 0\), at: Date\.now\(\) \}\)\);/.test(NC), 'node-city writes {type, until, at} to localStorage nc_wx');
ok(/function weatherTick\(dt\) \{\n  const now = Date\.now\(\);\n  if \(wx\.type !== _wxPub\.type \|\| wx\.until !== _wxPub\.until\) _wxPublish\(\);/.test(NC), '…on every change of type or deadline, checked at the top of every weather tick (start, end, and boot)');

/* ── the bridge ── */
ok(/cityWeather: \(\) => \{ try \{ const j = JSON\.parse\(localStorage\.getItem\('nc_wx'\) \|\| 'null'\); return \(j && typeof j === 'object'\) \? \{ type: String\(j\.type \|\| 'clear'\), until: Number\(j\.until\) \|\| 0, at: Number\(j\.at\) \|\| 0 \} : null; \}/.test(SRC), 'MythicFarmBridge.cityWeather reads it back (null when the city has never run)');
ok(/cityHour: \(\) => \{\n\s*try \{\n\s*const p = \{\}; for \(const part of new Intl\.DateTimeFormat\('en-US', \{ timeZone: 'America\/New_York', hour12: false, hour: '2-digit', minute: '2-digit' \}\)/.test(SRC), 'MythicFarmBridge.cityHour is the city\'s clock: America/New_York, the same formatter node-city estClock uses');
ok(/timeZone: 'America\/New_York', hour12: false,/.test(NC), '…and node-city really does light itself by that zone');
ok(/cityWeather: \(\) => \{ try \{ return \(typeof B\.cityWeather === 'function'\) \? B\.cityWeather\(\) : null; \}/.test(FARM) && /cityHour: \(\) => \{ try \{ return \(typeof B\.cityHour === 'function'\) \? B\.cityHour\(\) : null; \}/.test(FARM), 'the farm\'s host wraps both, absent-tolerant');

/* ── the farm reads the city first ── */
ok(/let _wxHost = null;\n/.test(FARM) && /_wxHost = h;   \/\/ 🌦 every weather reader sees the city's sky from here on\n\s*rootEl\.innerHTML = renderShell\(\);/.test(FARM), '_wxHost is set at mount, before the first paint');
ok(/function weatherAt\(seed, now\) \{\n  const city = cityWeatherAt\(now\); if \(city\) return city;\n  const idx = weatherWindowIndex\(now\);/.test(FARM), 'weatherAt: the city\'s answer first, the seeded roll only as fallback');
ok(/snow:  \{ label: 'Snow',   icon: '🌨', weight: 0,  grazeMul: 0\.5, eggMul: 0\.5 \},/.test(FARM), 'a snow row exists for the city\'s snow, weight 0 so the fallback never rolls it');
{
  /* run cityWeatherAt / skyForHour for real */
  const body = FARM.slice(FARM.indexOf('let _wxHost = null;'), FARM.indexOf('/* 🌦 Weather for the window containing `now` — the city\'s, or the seeded fallback. */'));
  const H = 3600000;
  const FARM_ECON = { weatherWindowH: 6, weather: { clear: { label: 'Clear' }, cloud: { label: 'Overcast' }, rain: { label: 'Rain' }, storm: { label: 'Storm' }, snow: { label: 'Snow' }, fog: { label: 'Fog' } } };
  const g = { H, FARM_ECON, weatherWindowIndex: (now) => Math.floor((now || Date.now()) / (6 * H)) };
  const api = new Function('g', 'with (g) { ' + body + ' return { set: (h) => { _wxHost = h; }, cityWeatherAt, skyForHour, cityHourNow }; }')(g);
  const now = Date.now();
  api.set({ cityWeather: () => ({ type: 'rain', until: now + 60000, at: now }), cityHour: () => 14.5 });
  ok(api.cityWeatherAt(now).key === 'rain' && api.cityWeatherAt(now).city === true && api.cityWeatherAt(now).label === 'Rain', 'city says rain until a minute from now → the farm says rain');
  api.set({ cityWeather: () => ({ type: 'storm', until: now - 1000, at: now - 9000 }) });
  ok(api.cityWeatherAt(now).key === 'clear', 'a front whose deadline passed while the city was shut reads as clear');
  api.set({ cityWeather: () => ({ type: 'tornado', until: now + 60000 }) });
  ok(api.cityWeatherAt(now).key === 'storm', 'tornado / fire rain / anomaly map to the farm\'s storm');
  api.set({ cityWeather: () => ({ type: 'cloudy', until: now + 60000 }) });
  ok(api.cityWeatherAt(now).key === 'cloud', 'cloudy → overcast');
  api.set({ cityWeather: () => null });
  ok(api.cityWeatherAt(now) === null, 'no published weather (city never ran) → null, so weatherAt falls back to the seeded roll');
  api.set(null);
  ok(api.cityWeatherAt(now) === null && api.cityHourNow() === null, 'no host → null, never a throw');
  ok(api.skyForHour(3, 'day') === 'night' && api.skyForHour(6, 'day') === 'dusk' && api.skyForHour(12, 'night') === 'day' && api.skyForHour(19.5, 'day') === 'dusk' && api.skyForHour(22, 'day') === 'night' && api.skyForHour(null, 'storm') === 'storm', 'skyForHour: night <5 and ≥21, dusk 5–7 and 19–21, day between; the chosen look when there is no clock');
}
ok(/season: seasonFor\(now\), weather: weatherAt\(s\.seed, now\), hour: cityHourNow\(\), terroir: terroirTier\(host\),/.test(FARM), 'the summary carries the city hour');
ok(/const skyKey = skyForHour\(v\.hour, look\.sky\);[^\n]*\n\s*const wk = \(v\.weather \? v\.weather\.key : 'clear'\) \+ '\|' \+ skyKey;\n\s*if \(wk !== wxKey\) \{ wxKey = wk; setWeather\(v\.weather \|\| \{ key: 'clear' \}, skyKey\); \}/.test(FARM), 'the 3D sky follows the clock and re-lights only when weather or sky band changes');
ok(/\$\{view\.hour != null \? ' · ' \+ fmtCityHour\(view\.hour\) : ''\}/.test(FARM) && /function fmtCityHour\(h\)/.test(FARM), 'the HUD prints "HH:MM city time" beside the weather');

/* ── no flash ── */
ok(/const setHtml = \(el, html\) => \{\n\s*if \(!el \|\| el\._farmHtml === html\) return false;\n\s*const st = el\.scrollTop; el\._farmHtml = html; el\.innerHTML = html;/.test(FARM), 'setHtml writes only when the markup changed and keeps the scroll');
ok(/if \(led\) setHtml\(led, renderLedger\(h, view\)\);/.test(FARM) && /if \(hud\) setHtml\(hud, renderHud\(h, view, m\.tab\)\);/.test(FARM) && /if \(panel && !m\.tab\) setHtml\(panel, ''\);/.test(FARM) && /setHtml\(panel, m\.tab === 'livestock' \? renderLivestock/.test(FARM) && /: renderHomestead\(h, s, view, m\.focus, m\.ui\)\);/.test(FARM), 'ledger, HUD and panel all go through it');
ok(!/led\.innerHTML = renderLedger/.test(FARM) && !/hud\.innerHTML = renderHud/.test(FARM) && !/panel\.innerHTML = m\.tab === 'livestock'/.test(FARM), 'no bare innerHTML rebuilds remain in paint()');
{
  const setHtml = new Function('return ' + FARM.slice(FARM.indexOf('const setHtml = (el, html) => {') + 'const setHtml = '.length, FARM.indexOf('  const paint = () => {')).trim().replace(/;$/, ''))();
  const el = { innerHTML: '', scrollTop: 40, writes: 0 };
  Object.defineProperty(el, 'innerHTML', { get() { return this._v || ''; }, set(v) { this._v = v; this.writes++; } });
  ok(setHtml(el, '<b>a</b>') === true && setHtml(el, '<b>a</b>') === false && setHtml(el, '<b>a</b>') === false && el.writes === 1, 'run for real: three paints of the same markup → one DOM write');
  ok(setHtml(el, '<b>b</b>') === true && el.writes === 2 && el.scrollTop === 40, 'a change writes once and the scroll position survives');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 103, 'BUILD_VERSION is v121v103 or later', v);
ok(/src\/farm\/index\.js\?v=v121v103farm3/.test(SRC) || /src\/farm\/index\.js\?v=v121v1[0-9][0-9]farm/.test(SRC), 'the farm module buster moved (farm3 or later)');
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
