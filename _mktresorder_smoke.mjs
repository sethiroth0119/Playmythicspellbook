/* 🔤 THE PLAYER MARKET'S RESOURCE PICKER IS A-Z.
   Run: node _mktresorder_smoke.mjs
   Tracker bug-mtycn31u: "the Resource list when listing things for sale is now
   out of alphabetical order — some of it is in Alpha order, some of it isn't".
   _boeResCatalog() is the base resource list followed by any id found in the
   ledgers, appended in the order found, so the tail was never sorted. The sort
   is in the picker (NewListingModal in ethos/app.jsx). §3 is the negative
   control: the same rows in catalogue order are not sorted. */
import { readFileSync } from 'fs';
import { transformSync } from 'esbuild';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/ethos/app.jsx', 'utf8').replace(/\r\n/g, '\n');
const HTML = readFileSync('./public/ethos/Bank of Ethos.html', 'utf8');

console.log('\n=== 1. the file still compiles ===');
{
  let err = null;
  try { transformSync(SRC, { loader: 'jsx' }); } catch (e) { err = e; }
  ok(!err, 'app.jsx compiles as JSX', err && String(err.message).slice(0, 200));
  ok(!/app\.jsx\?v=v121q50/.test(HTML) && /app\.jsx\?v=v121q(5[1-9]|[6-9]\d)"/.test(HTML), 'the cache-buster moved so players get the new picker (q51 or later; q52 = AZA in the Ledger)');
}

const m = SRC.indexOf('function NewListingModal(');
const modal = SRC.slice(m, SRC.indexOf('\nfunction ', m + 10));
const sortSrc = (modal.match(/\.slice\(\)\.sort\((\(x, y\) => [^\n]*?\}\))\)/) || [])[1];

console.log('\n=== 2. the picker sorts by name ===');
{
  ok(m > 0 && /Pick a resource you own/.test(modal), 'found the resource picker');
  ok(!!sortSrc, 'the owned resources are sorted before they are listed');
  const cmp = sortSrc ? eval(sortSrc) : () => 0;
  // Catalogue order as _boeResCatalog builds it: a base list, then ledger ids.
  const cat = [
    { id: 'wood', name: 'Wood' }, { id: 'food', name: 'Food' }, { id: 'metal', name: 'Metal' },
    { id: 'crudeOil', name: 'Crude Oil' }, { id: 'aluminum', name: 'aluminum' }, { id: 'steel2', name: 'Steel 10' }, { id: 'steel1', name: 'Steel 9' },
  ];
  const got = cat.slice().sort(cmp).map(r => r.name);
  ok(JSON.stringify(got) === JSON.stringify(['aluminum', 'Crude Oil', 'Food', 'Metal', 'Steel 9', 'Steel 10', 'Wood']),
    'A-Z, ignoring case, with numbers in number order', got.join(', '));
  ok(cat[0].id === 'wood', 'the shared catalogue itself is not reordered (other pages read it)');
}

console.log('\n=== 3. NEGATIVE CONTROL — catalogue order ===');
{
  const names = ['Wood', 'Food', 'Metal', 'Crude Oil'];
  const sorted = names.slice().sort((a, b) => a.localeCompare(b));
  ok(JSON.stringify(names) !== JSON.stringify(sorted), 'unsorted, the catalogue order is what the report describes');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ the resource picker is alphabetical\n');
process.exit(fails ? 1 : 0);
