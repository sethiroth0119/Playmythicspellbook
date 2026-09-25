/* ⚡ ONE NAME PER RESOURCE.  Run: node _resalias_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Tracker bug-mu4fo0lg: "the Electricity resource has been triplicated … All 3
   should be combined into 1."

   The war map names node resources ELEC, BIO, ETHER, …; two copies of a
   four-key map lowercased the rest into ids that exist nowhere (`elec`), and the
   Card Shop dividend deposited the raw key (`ELEC`). Measured in stashes:
   electricity (72 players), elec (7, 104 units), ELEC (2, 963) — and the same
   for ether/ETHER, bio/BIO, crystal/CRYSTAL, plus uppercase FOOD/FUEL/MED/WOOD.

   §4 is the one that matters most. The cloud hydration takes a per-id MAX when
   the device has no pending edit, so a fold on ONE side, met by a stale copy on
   the other, keeps both the alias and the folded balance — and uploads the
   duplicate. §4 runs that merge with both sides folded first, and its negative
   control folds only one side and requires the duplicate to appear. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const TERROIR = readFileSync('./public/src/city/terroir.js', 'utf8').replace(/\r\n/g, '\n');

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
function blockAfter(marker, open, close, src) {
  const s = src || SRC;
  const i = s.indexOf(marker); if (i < 0) throw new Error('cannot find ' + marker);
  let d = 0, j = s.indexOf(open, i), e = -1;
  for (let k = j; k < s.length; k++) { if (s[k] === open) d++; else if (s[k] === close) { d--; if (d === 0) { e = k; break; } } }
  return s.slice(j, e + 1);
}
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += d || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); i = e < 0 ? src.length : e; continue; }
    out += c; i++;
  }
  return out;
}

const RESOURCE_IDS = [...blockAfter('const RESOURCES = [', '[', ']').matchAll(/id:\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
const CANON = new Function('return ' + blockAfter('const TW_RES_CANON = {', '{', '}'))();
const iAlias = SRC.indexOf('const RES_ALIAS = (() => {');
const aliasExpr = SRC.slice(iAlias + 'const RES_ALIAS = '.length, SRC.indexOf('})();', iAlias) + 4);
const RES_ALIAS = new Function('TW_RES_CANON', 'RESOURCE_IDS', 'return ' + aliasExpr)(CANON, RESOURCE_IDS);
const twResId = new Function('TW_RES_CANON', 'RESOURCE_IDS', fnText('twResId') + '\nreturn twResId;')(CANON, RESOURCE_IDS);
const fold = new Function('RES_ALIAS', fnText('_foldResAliases') + '\nreturn _foldResAliases;')(RES_ALIAS);
const total = (o) => Object.values(o).reduce((t, v) => t + (Number(v) || 0), 0);

console.log('\n=== 1. every war-map key names a real resource ===');
{
  const twKeys = (/const _TW_RES_KEYS = \[([^\]]+)\]/.exec(SRC) || [, ''])[1].match(/'([A-Z]+)'/g).map(x => x.slice(1, -1));
  ok(twKeys.length === 10, 'the ten war-map keys are read from _TW_RES_KEYS', twKeys.join(','));
  const badgeKeys = [...blockAfter('const _TW_RES_BADGE = {', '{', '}').matchAll(/([A-Z]+):\{/g)].map(m => m[1]).filter(k => k !== 'CINDER');
  const bad = [...new Set(twKeys.concat(badgeKeys))].filter(k => RESOURCE_IDS.indexOf(twResId(k)) < 0);
  ok(bad.length === 0, 'every map key and every badge key resolves to an id in RESOURCES', bad.join(','));
  ok(Object.values(CANON).every(v => RESOURCE_IDS.indexOf(v) >= 0), 'every canonical target is itself a real resource');
  ok(twResId('ELEC') === 'electricity' && twResId('elec') === 'electricity' && twResId('Elec') === 'electricity',
    'ELEC resolves to electricity in any case — the reported triplicate');
  ok(twResId('electricity') === 'electricity' && twResId('crudeOil') === 'crudeOil',
    'a real id authored as a yield key passes through unchanged');
  ok(twResId('NOT_A_THING') === 'supplies', 'an unknown key still pays, as supplies, and never as an invented id');
}

console.log('\n=== 2. the city\'s seam table says the same thing ===');
{
  /* terroir.js is a module and cannot read TW_RES_CANON; its table is its own.
     Two tables means they can drift, so this is the check that they have not. */
  const seam = new Function('return ' + blockAfter('seamAliases: {', '{', '}', TERROIR))();
  const disagree = Object.keys(seam).filter(k => CANON[k] !== undefined && CANON[k] !== seam[k]);
  ok(disagree.length === 0, 'terroir seamAliases agree with TW_RES_CANON on every key they share',
    disagree.map(k => k + ': terroir ' + seam[k] + ' vs ' + CANON[k]).join('; '));
  ok(seam.ELEC === 'electricity', 'terroir names ELEC electricity (it was energyDrink, a stand-in from before electricity existed)', seam.ELEC);
  ok(Object.keys(seam).filter(k => CANON[k] === undefined).length === 0,
    'terroir knows no key the game does not', Object.keys(seam).filter(k => CANON[k] === undefined).join(','));
}

console.log('\n=== 3. the fold moves units and never makes them ===');
{
  ok(!Object.keys(RES_ALIAS).some(a => RESOURCE_IDS.indexOf(a) >= 0), 'no real resource id is treated as an alias (food, stone, water … stay themselves)');
  ok(RES_ALIAS.ELEC === 'electricity' && RES_ALIAS.elec === 'electricity' && RES_ALIAS.ether === 'corruptedEssence' && RES_ALIAS.BIO === 'dna',
    'the ids actually found in stashes are all aliases');
  const s = { electricity: 5, elec: 104, ELEC: 963, ether: 366, food: 10, FOOD: 471, stone: 3 };
  const before = total(s);
  const moved = fold(s);
  ok(total(s) === before, 'the stash total is unchanged', before + ' → ' + total(s));
  ok(s.electricity === 1072 && !('elec' in s) && !('ELEC' in s), 'electricity + elec + ELEC become ONE balance', JSON.stringify(s));
  ok(s.food === 481 && !('FOOD' in s) && s.stone === 3, 'an uppercase copy of a real id folds into it; untouched ids stay put');
  ok(moved === 4, 'it reports what it moved', String(moved));
  const again = JSON.stringify(s);
  ok(fold(s) === 0 && JSON.stringify(s) === again, 'folding a folded stash changes nothing');
}

console.log('\n=== 4. the hydration merge cannot count a stash twice ===');
{
  /* The shipped branch for a device with no pending edit, verbatim. */
  const maxMerge = (loc, cl) => { for (const k in cl) { const cv = cl[k] | 0, lv = loc[k] | 0; if (cv > lv) loc[k] = cv; } return loc; };
  const staleCloud = () => ({ ELEC: 754, electricity: 10 });
  const foldedLocal = () => ({ electricity: 764 });

  { // both sides folded first — what the hydration now does
    const loc = foldedLocal(), cl = Object.assign({}, staleCloud());
    fold(cl); fold(loc);
    maxMerge(loc, cl);
    ok(loc.electricity === 764 && !('ELEC' in loc), 'a folded device meeting a stale cloud copy keeps exactly 764 electricity', JSON.stringify(loc));
  }
  { // a stale device meeting a folded cloud
    const loc = staleCloud(), cl = foldedLocal();
    fold(Object.assign({}, cl)); fold(loc);
    maxMerge(loc, cl);
    ok(loc.electricity === 764 && !('ELEC' in loc), '…and a stale device meeting a folded cloud copy keeps exactly 764', JSON.stringify(loc));
  }
  { // NEGATIVE CONTROL — fold only this device
    const loc = staleCloud(), cl = foldedLocal();
    maxMerge(loc, cl);            // the stale local keeps ELEC, takes the folded 764
    fold(loc);                    // then folds ELEC on top of it
    ok(loc.electricity === 1518,
      'CONTROL: fold one side only and the same 754 is counted twice (1,518) — the merge must see both sides folded', JSON.stringify(loc));
  }

  const hyd = SRC.slice(SRC.indexOf('const _cloudSalvage ='), SRC.indexOf('if (typeof _ensureResources === \'function\') _ensureResources();', SRC.indexOf('const _cloudSalvage =')));
  const code = stripComments(hyd);
  const iFoldCloud = code.indexOf('_foldResAliases(_cloudFolded)');
  const iFoldLocal = code.indexOf('_foldResAliases(Profile.salvage)');
  const iBranch = code.indexOf('if (!_haveLocalEdit)');
  ok(iFoldCloud > 0 && iFoldLocal > 0 && iFoldCloud < iBranch && iFoldLocal < iBranch,
    'the hydration folds BOTH copies before the first merge branch');
  ok(/const _loc = Profile\.salvage, _cl = _cloudFolded;/.test(code), 'and every branch reads the folded cloud copy');
  ok(/Object\.assign\(\{\}, _cloudSalvage\)/.test(code), 'the fetched row is cloned first — it is not ours to edit');
}

console.log('\n=== 5. every door that deposits a war-map key uses the real id ===');
{
  const add = stripComments(fnText('addRes'));
  ok(/if \(RES_ALIAS\[id\]\) id = RES_ALIAS\[id\];/.test(add), 'addRes — the one door every deposit comes through — files an alias under its real id');
  const ens = stripComments(fnText('_ensureResources'));
  ok(/_foldResAliases\(S\) > 0/.test(ens) && /_persistResourcesSoon\(\)/.test(ens),
    'reading the stash folds any alias and marks the device as the newer copy');
  ok(/const rid = twResId\(resKey\);/.test(SRC), 'a node\'s passive yield pays the real id');
  ok(/return twResId\(k\);/.test(stripComments(fnText('_twNodeResId'))), 'a node\'s upgrade cost names the same id its yield pays');
  ok(!/_TW_RES_ID_MAP/.test(SRC), 'the four-key map is gone, not left beside the real one');
  ok(/const _rk = twResId\(k\);\s*if \(_rk\) _produced\[_rk\]/.test(stripComments(SRC)), 'a collect moves the exchange under the real id, not a new "ELEC" commodity');
  ok(/resId = data\.resource \? twResId\(data\.resource\) : ''/.test(SRC), 'the card-shop dividend — the path that deposited raw ELEC — pays the real id');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ one name per resource\n');
process.exit(fails ? 1 : 0);
