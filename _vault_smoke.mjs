/* 🏰 VAULT CAPACITY SMOKE — paid vault space may never get smaller.

   sql/031 exists because a gear clean repossessed containers players had paid
   Ⓐ Aza for, and there is NO purchase ledger to restore them from: a support
   ticket and a human decision is the only path back. That makes every way of
   losing this number a bug that costs real money to undo, so the ways are
   pinned here rather than argued about.

   THE FUNCTIONS ARE THE SHIPPED ONES. They are cut out of index.html and
   evaluated, not reimplemented — a copy of getVaultLayout() in this file would
   pass while the real one lost vaults, which is the failure mode a smoke test
   is for. Run: node _vault_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');
function fn(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name + ' in index.html');
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function num(name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*(-?[0-9.]+)').exec(SRC);
  if (!m) throw new Error('cannot find const ' + name);
  return Number(m[1]);
}

const VAULT_COLS = num('VAULT_COLS'), VAULT_ROWS = num('VAULT_ROWS');
const NAMES = ['_vaultPaidRows', '_vaultPaidExtra', '_vaultNotePaid', '_vaultAdoptPaid',
               '_defaultVaultLayout', 'getVaultLayout', '_vaultKeepPaid'];
const Profile = {};
const api = new Function('Profile', 'VAULT_COLS', 'VAULT_ROWS',
  NAMES.map(fn).join('\n') + '\nreturn {' + NAMES.join(',') + '};')(Profile, VAULT_COLS, VAULT_ROWS);
const { getVaultLayout, _vaultAdoptPaid, _vaultNotePaid, _vaultKeepPaid } = api;

const reset = (layout) => {
  for (const k in Profile) delete Profile[k];
  if (layout !== undefined) Profile.vaultLayout = layout;
};

console.log('\n=== 0. the shipped defaults ===');
ok(VAULT_ROWS === 8 && VAULT_COLS === 10, 'a fresh vault is ' + VAULT_ROWS + '×' + VAULT_COLS);
reset();
ok(getVaultLayout().rows === VAULT_ROWS, 'no layout at all → the default, not a crash');

console.log('\n=== 1. the receipt is written from an old save that predates it ===');
reset({ rows: 40, cols: 10, stashExtra: 4500, placements: [] });
getVaultLayout();
ok(Profile.vaultRowsPaid === 40, 'reading a 40-row vault records 40 rows paid', Profile.vaultRowsPaid);
ok(Profile.vaultExtraPaid === 4500, '…and the 4,500 of Relic-door surplus', Profile.vaultExtraPaid);

console.log('\n=== 2. THE REPORTED BUG: a poisoned `{}` from the cloud ===');
/* The upload used to write {} whenever Profile.vaultLayout was falsy, and {} is
   TRUTHY — so the hydration guard passed and assigned it over a good layout. */
reset({ rows: 40, cols: 10, stashExtra: 4500, placements: [] });
getVaultLayout();
_vaultAdoptPaid({});
ok(Profile.vaultLayout.rows === 40, 'the merge itself refuses the empty object', Profile.vaultLayout.rows);
ok(getVaultLayout().rows === 40, 'an empty object from the cloud does NOT shrink a 40-row vault', getVaultLayout().rows);
ok(getVaultLayout().stashExtra === 4500, '…and does not take the Relic surplus either', getVaultLayout().stashExtra);

console.log('\n=== 3. an OLDER cloud row loses to a newer local one ===');
reset({ rows: 40, cols: 10, placements: [] });
getVaultLayout();
_vaultAdoptPaid({ rows: 8, cols: 10, placements: [] });
/* ⚠ THE RAW OBJECT FIRST, AND THAT ORDER IS THE TEST. getVaultLayout() does not
   just read the floor, it WRITES it back onto the layout — so calling it before
   this line repairs the very object the line is trying to inspect, and the check
   passes under a blind overwrite. Found by driving the sabotage: the round went
   green with the merge deleted. Raw first, then through the floor. */
ok(Profile.vaultLayout.rows === 40, 'the MERGE refuses the stale row, not just the floor', Profile.vaultLayout.rows);
ok(getVaultLayout().rows === 40, 'a stale 8-row cloud row cannot shrink the vault', getVaultLayout().rows);

console.log('\n=== 4. …and a BIGGER cloud row still wins (the merge is not one-way) ===');
reset({ rows: 8, cols: 10, placements: [] });
getVaultLayout();
_vaultAdoptPaid({ rows: 40, cols: 10, placements: [] });
ok(getVaultLayout().rows === 40, 'a 40-row cloud row raises an 8-row local vault', getVaultLayout().rows);

console.log('\n=== 5. contents still sync — capacity is the only thing pinned ===');
reset({ rows: 40, cols: 10, placements: [{ uid: 'a' }, { uid: 'b' }] });
getVaultLayout();
_vaultAdoptPaid({ rows: 40, cols: 10, placements: [] });
ok(getVaultLayout().placements.length === 0, 'an EMPTY placements array is real news and is taken');
reset({ rows: 40, cols: 10, placements: [{ uid: 'a' }] });
getVaultLayout();
_vaultAdoptPaid({ rows: 40, cols: 10 });
ok(getVaultLayout().placements.length === 1, 'an ABSENT placements array is no news and keeps what we had');

console.log('\n=== 6. the gear clean, the path sql/031 was written for ===');
reset({ rows: 40, cols: 10, stashExtra: 4500, placements: [{ uid: 'a' }] });
getVaultLayout();
Profile.vaultLayout = _vaultKeepPaid(Profile.vaultLayout);
ok(getVaultLayout().rows === 40, 'a gear clean keeps the paid rows', getVaultLayout().rows);
ok(getVaultLayout().placements.length === 0, '…and still clears the gear');

console.log('\n=== 7. THE DOUBLE WIPE — the receipt is not in the object ===');
/* Every earlier fix kept capacity by copying it out of the layout first. That
   only works if the layout is intact at the moment of the wipe. The mark lives
   outside it, so even a total loss of the object is recoverable. */
reset({ rows: 40, cols: 10, stashExtra: 4500, placements: [] });
getVaultLayout();
Profile.vaultLayout = null;
ok(getVaultLayout().rows === 40, 'the layout object destroyed outright — the vault comes back at 40', getVaultLayout().rows);
ok(getVaultLayout().stashExtra === 4500, '…with the Relic surplus intact', getVaultLayout().stashExtra);

console.log('\n=== 8. the mark itself only ever goes up ===');
reset();
_vaultNotePaid({ rows: 40, stashExtra: 4500 });
_vaultNotePaid({ rows: 8, stashExtra: 0 });
ok(Profile.vaultRowsPaid === 40 && Profile.vaultExtraPaid === 4500, 'a smaller layout never lowers the mark');
_vaultNotePaid(null); _vaultNotePaid(undefined); _vaultNotePaid('nonsense'); _vaultNotePaid(42);
ok(Profile.vaultRowsPaid === 40, 'rubbish input is ignored rather than thrown');

console.log('\n=== 9. ANTI-VACUITY — the pin can still fail ===');
/* If _vaultAdoptPaid ever went back to a blind overwrite, rounds 2 and 3 must go
   red. Prove the assertion is capable of failing by doing the old thing here. */
reset({ rows: 40, cols: 10, placements: [] });
getVaultLayout();
Profile.vaultLayout = { rows: 8, cols: 10, placements: [] };   // the OLD hydration, verbatim
ok(Profile.vaultLayout.rows === 8, 'a blind overwrite really does shrink the raw object (the bug is reachable)');
ok(getVaultLayout().rows === 40, '…and the floor is what puts it back — belt AND braces', getVaultLayout().rows);

console.log('\n=== 10. THE CEILING DOES NOT MOVE ON ITS OWN ===');
/* 📦 Reported: "Several times I have gone to the vault and had the max units
   change from the correct amount to a higher amount. Max was 2,002, randomly
   said 2,602. Currently 4,250, randomly says 4,850."
   🔴 BOTH JUMPS ARE THE SAME SIZE, which is the tell — nothing random was
   happening. getResourceCap() adds a term for a Warehouse standing in the CITY,
   and _cityProdStorage() read window.MythicCityProduction, which is only
   mounted once the city has been opened this session. Vault first: term 0, the
   lower number. City first: term live, the higher one. Reload: back to 0.
   The neighbouring _warehouseCapacity() had already solved exactly this for the
   warehouse OPERATION by holding its last trusted figure; this is the same
   failure with a different source and now gets the same answer. */
{
  const src = readFileSync('./public/index.html', 'utf8');
  const fn = (() => {
    const i = src.indexOf('function _cityProdStorage() {');
    return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i) + 2);
  })();
  ok(!!fn, 'found _cityProdStorage');
  ok(!/if \(!MP \|\| typeof MP\.storageBonus !== 'function'\) return 0;/.test(fn),
    'an unmounted city module no longer answers 0 — that zero IS the reported jump');
  ok(/return Math\.max\(0, Profile\.cityStoreLast \| 0\);/.test(fn),
    'it holds the last figure the city actually reported');
  ok(/if \(\(Profile\.cityStoreLast \| 0\) !== v\) \{ Profile\.cityStoreLast = v; \}/.test(fn),
    'and updates it when the city IS mounted — including downwards, so a demolished warehouse is not remembered forever');
  /* Remembering it only helps if it survives the tab closing, which is the case
     the report is actually about. */
  ok(/__cityStoreLast__:\s+\(Profile\.cityStoreLast \| 0\) \|\| 0,/.test(src), 'the figure is saved');
  ok(/if \(_fcsCap > 0 && !\(Profile\.cityStoreLast \| 0\)\) Profile\.cityStoreLast = _fcsCap;/.test(src),
    'and restored on a cold load, which is the load the player was seeing the low number on');
  /* The precedent must still be there — this fix is "do what the neighbour
     does", and it is worthless if the neighbour stops doing it. */
  ok(/return Math\.max\(0, Profile\.whCapLast \| 0\);/.test(src),
    '_warehouseCapacity still holds ITS last trusted figure — the pattern this copies');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
