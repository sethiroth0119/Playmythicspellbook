/* 💽 A FULL BROWSER STORE FREES ROOM WITHOUT LOSING A CITY.  Run: node _citystorage_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Tracker: bug-mu424ej6 "Browser Storage Warning" — "When I am loading client
   cities I am starting to see [LOCAL SAVE FAILED]. It started off with just one
   city, but now I see it on others. I have increased cache to maximum."

   Every city a browser opens keeps a copy at cityKey() (~80–210 KB) and nothing
   ever removed one, so a mayor's client cities filled the ~5 MB origin budget
   and every save after that was refused. node-city now evicts OTHER cities'
   copies, least recently used first — but only a copy the server is proven to
   hold, because the local copy is also the offline save and the in-flight
   rescue.

   §2 runs the real helpers against a localStorage with a hard quota.
   §4 is a negative control: remove the "server holds it" test and the newer-
   than-the-server copy is evicted — the loss the guard exists to prevent. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');

function fnText(name, src) {
  const s = src || SRC;
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, started = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* A localStorage that refuses writes past `quota` characters, like a browser. */
function store(quota) {
  const m = new Map();
  const used = () => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; };
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => {
      v = String(v);
      const prev = m.has(k) ? k.length + m.get(k).length : 0;
      if (used() - prev + k.length + v.length > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      m.set(k, v);
    },
    _map: m,
  };
}
const BASE = 'mythic_node_city_v2';
const savedAtOf = (raw) => { try { const v = +(JSON.parse(raw) || {}).savedAt; return Number.isFinite(v) ? v : 0; } catch (e) { return 0; } };
const blob = (savedAt, size) => JSON.stringify({ savedAt, pad: 'x'.repeat(size) });

function helpers(ls, src) {
  const body = ['_cityIdxRead', '_cityIdxTouch', '_isQuotaError', '_cityMakeRoom'].map(n => fnText(n, src)).join('\n');
  return new Function('localStorage', 'CITYKEY_BASE', 'CITY_IDX_KEY',
    body + '\nreturn { _cityIdxRead, _cityIdxTouch, _isQuotaError, _cityMakeRoom };')(ls, BASE, BASE + '__idx');
}

console.log('\n=== 1. the save path asks for room only when the refusal is about space ===');
{
  const i = SRC.indexOf('B.saveCity = async (json, opts) => {');
  const save = SRC.slice(i, i + 9000);
  ok(/if \(!_isQuotaError\(eq\)\) throw eq;/.test(save), 'a refusal that is not about space still fails loudly, unchanged');
  ok(/_cityMakeRoom\(_k, \(\) => localStorage\.setItem\(_k, out\), _savedAtOf\)/.test(save), 'a space refusal makes room and retries the SAME write');
  ok(/if \(localStorage\.getItem\(_k\) !== out\) throw eq;/.test(save), '…and only calls it saved if that write is actually on disk');
  ok(/_cityIdxTouch\(cityKey\(\), _savedAtOf\(json\)\);/.test(save), 'an accepted SERVER save records what the server now holds');
  const load = SRC.slice(SRC.indexOf('B.loadCity = async () => {'));
  ok(/if \(!B\.loadUnsafe && want && sameNode\) _cityIdxTouch\(cityKey\(\), ss\);\n\s*return server;/.test(load),
    'a TRUSTWORTHY load that the server won records it too — and a refused or ambiguous read does not');
}

console.log('\n=== 2. run for real, against a store with a hard quota ===');
{
  const ls = store(2600);
  const H = helpers(ls);
  const kOld = BASE + ':u1@N-1', kNewer = BASE + ':u1@N-2', kLegacy = BASE + ':u1@N-3', kConf = BASE + ':u1@N-1:conflict', kCur = BASE + ':u1@N-9';
  ls.setItem(kOld, blob(100, 500));      H._cityIdxTouch(kOld, 100);          // server holds exactly this
  ls.setItem(kNewer, blob(300, 500));    H._cityIdxTouch(kNewer, 250);        // local is NEWER than the server
  ls.setItem(kLegacy, blob(50, 500));                                        // written before records existed
  ls.setItem(kConf, blob(400, 300));                                         // a kept conflict copy
  // make kOld the least recently used
  const idx = H._cityIdxRead(); idx[kOld].t = 1; idx[kNewer].t = 2; ls.setItem(BASE + '__idx', JSON.stringify(idx));

  const cur = blob(500, 600);
  let threw = false;
  try { ls.setItem(kCur, cur); } catch (e) { threw = H._isQuotaError(e); }
  ok(threw, 'the store is genuinely full: the current city\'s save is refused for space');

  const gone = H._cityMakeRoom(kCur, () => ls.setItem(kCur, cur), savedAtOf);
  ok(gone.length === 1 && gone[0] === kOld, 'exactly one copy was removed — the least recently used one the server holds', JSON.stringify(gone));
  ok(ls.getItem(kCur) === cur, 'and the refused save is now on disk');
  ok(ls.getItem(kNewer) !== null, 'a copy NEWER than the server\'s is kept — it may be the only copy of those builds');
  ok(ls.getItem(kLegacy) !== null, 'a copy with no record is kept — nothing proves the server has it');
  ok(ls.getItem(kConf) !== null, 'a kept conflict copy is never a candidate');
  ok(!(kOld in H._cityIdxRead()), 'the removed city\'s record goes with it');
}

console.log('\n=== 3. nothing safe to remove: the save fails exactly as before ===');
{
  const ls = store(1500);
  const H = helpers(ls);
  const kA = BASE + ':u1@N-1', kCur = BASE + ':u1@N-9';
  ls.setItem(kA, blob(300, 900)); H._cityIdxTouch(kA, 100);    // newer than the server: not evictable
  const cur = blob(500, 700);
  const gone = H._cityMakeRoom(kCur, () => ls.setItem(kCur, cur), savedAtOf);
  ok(gone.length === 0 && ls.getItem(kCur) === null && ls.getItem(kA) !== null,
    'no copy is removed and the save stays refused — the loud failure path runs, as it did before', JSON.stringify(gone));
  ok(H._isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }) && H._isQuotaError({ code: 1014 }) && !H._isQuotaError(new TypeError('x')),
    'the space test knows Firefox\'s names for it and nothing else');
}

console.log('\n=== 4. NEGATIVE CONTROL — drop the "server holds it" test ===');
{
  const real = fnText('_cityMakeRoom');
  const broken = real.replace("if (savedAtOf(blob) > Number(idx[k].srv)) continue;", '');
  ok(broken !== real, 'the control removed the guard');
  const src = SRC.replace(real, broken);
  const ls = store(1500);
  const H = helpers(ls, src);
  const kA = BASE + ':u1@N-1', kCur = BASE + ':u1@N-9';
  ls.setItem(kA, blob(300, 900)); H._cityIdxTouch(kA, 100);
  const gone = H._cityMakeRoom(kCur, () => ls.setItem(kCur, blob(500, 700)), savedAtOf);
  ok(gone.length === 1 && ls.getItem(kA) === null,
    'without it, the copy that was NEWER than the server is deleted — §3 would go red on this');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ a full store frees room without losing a city\n');
process.exit(fails ? 1 : 0);
