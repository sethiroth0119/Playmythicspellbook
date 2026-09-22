/* 🧾 DONATED RESOURCES DO NOT COME BACK (bug-mu83ph17).

   Reported: "Donations to the foundation are being accepted but the resources
   are reappearing in vault. This is allowing over donations and rewards."

   Two holes, both a CLIENT debit paired with a SERVER credit:
   1. cloudFetchProfile merged the resource ledger with MAX(local, cloud). A
      second device still holding the pre-donation count out-voted the cloud's
      lower one and uploaded it back. Now the newer ledger (by __salvageAt__)
      wins whole; a stamp-less legacy row keeps the old MAX merge.
   2. A non-writer tab's saveProfile() writes nothing, so a donation made there
      was credited by the server and forgotten by the client. Now refused.

   Run: node _salvagesync_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

function world(profile, extra) {
  const ctx = Object.assign({ console, Date, JSON, Math, Number, Profile: profile, _ensureResources: () => profile.salvage }, extra || {});
  vm.createContext(ctx);
  vm.runInContext('var _salvageSig = null;\n' + [fnText('_salvageStampIfChanged'), fnText('_salvageHydrate')].join('\n'), ctx);
  return ctx;
}

console.log('── the two-device dupe ──');
{
  // Phone last played at T0 with 500 Metal. Desktop donated all 500 at T1 and uploaded.
  const phone = world({ salvage: { metal: 500, wood: 3 }, salvageAt: 1000 });
  const r = phone._salvageHydrate({ metal: 0, wood: 3 }, 2000);
  ok(r === 'adopted', 'a NEWER cloud ledger is adopted', r);
  ok(phone.Profile.salvage.metal === 0, 'the donated Metal stays donated (MAX kept 500 here)', phone.Profile.salvage.metal);
  ok(phone.Profile.salvageAt === 2000, 'and the stamp follows the adopted ledger', phone.Profile.salvageAt);
}
{
  const p = world({ salvage: { metal: 5, junk: 9 }, salvageAt: 1000 });
  const keep = p.Profile.salvage;
  p._salvageHydrate({ metal: 7 }, 1000);
  ok(p.Profile.salvage === keep, 'adopted IN PLACE (a caller holding the ledger across an await stays live)');
  ok(!('junk' in p.Profile.salvage) && p.Profile.salvage.metal === 7, 'a key the newer ledger does not have is dropped', JSON.stringify(p.Profile.salvage));
}
console.log('── nothing a device holds is lost ──');
{
  const p = world({ salvage: { metal: 50 }, salvageAt: 3000 });
  const r = p._salvageHydrate({ metal: 10, stone: 4 }, 2000);
  ok(r === 'max' && p.Profile.salvage.metal === 50 && p.Profile.salvage.stone === 4, 'a device that edited LATER keeps its ledger (MAX)', r + ' ' + JSON.stringify(p.Profile.salvage));
}
{
  const p = world({ salvage: { metal: 50 } });
  const r = p._salvageHydrate({ metal: 80 }, undefined);
  ok(r === 'max' && p.Profile.salvage.metal === 80, 'a stamp-less (older build) row keeps the old MAX merge', r);
}
console.log('── the stamp moves only on a real change ──');
{
  const p = world({ salvage: { metal: 5 } });
  p._salvageStampIfChanged();
  ok(!p.Profile.salvageAt, 'the first look after load is a baseline, not an edit');
  p._salvageStampIfChanged();
  ok(!p.Profile.salvageAt, 'saving an unchanged ledger does not stamp');
  p.Profile.salvage.metal = 4;
  p._salvageStampIfChanged();
  ok(p.Profile.salvageAt > 0, 'spending stamps the ledger');
  const q = world({ salvage: { metal: 5 }, salvageAt: 1 });
  q._salvageStampIfChanged(); q._salvageHydrate({ metal: 9 }, 5); q._salvageStampIfChanged();
  ok(q.Profile.salvageAt === 5, 'adopting the cloud ledger is not counted as a local edit', q.Profile.salvageAt);
}
console.log('── a reader tab cannot donate ──');
{
  const toasts = [];
  const prof = { salvage: { metal: 100 }, cloud: { signedIn: true, userId: 'u' } };
  let spent = 0, wrote = 0;
  const ctx = {
    console, Profile: prof, MultiTab: { amWriter: false },
    showToast: (m) => toasts.push(m), initCloud: () => true,
    _SALVAGE_BY_ID: { metal: {} }, _ensureResources: () => prof.salvage,
    spendResources: () => { spent++; return true; },
    Cloud: { client: { from: () => { wrote++; return {}; } } },
  };
  vm.createContext(ctx);
  vm.runInContext([fnText('_readerTabRefuses'), fnText('frDeposit'), fnText('frConvoyDispatch')].join('\n'), ctx);
  const r1 = await vm.runInContext('frDeposit("metal", 50)', ctx);
  const r2 = await vm.runInContext('frConvoyDispatch("metal", 50, false)', ctx);
  ok(r1 === false && r2 === false, 'deposit and convoy are refused in a reader tab');
  ok(spent === 0 && wrote === 0 && prof.salvage.metal === 100, 'nothing was deducted and nothing reached the server');
  ok(toasts.some(t => /read-only/.test(t)), 'and the player is told why');
  ctx.MultiTab.amWriter = true;
  ok(vm.runInContext('_readerTabRefuses("x")', ctx) === false, 'the writer tab is not refused');
  delete ctx.MultiTab;
  ok(vm.runInContext('_readerTabRefuses("x")', ctx) === false, 'no MultiTab at all (single tab / old browser) is not refused');
}
console.log('── wiring ──');
ok(/_salvageHydrate\(_cloudSalvage,/.test(SRC), 'cloudFetchProfile hydrates salvage through _salvageHydrate');
ok(/__salvageAt__:\s*Math\.max\(0, Number\(Profile\.salvageAt\)/.test(SRC), 'the upload carries __salvageAt__');
ok(/typeof p\.salvageAt === 'number'\)\s*Profile\.salvageAt\s*= p\.salvageAt/.test(SRC), 'a reload restores the stamp (the loader is a whitelist)');
ok(/lastLocalEditAt = Date\.now\(\);\s*\n\s*\/\/[^\n]*\n\s*_salvageStampIfChanged\(\);/.test(SRC), 'saveProfile stamps the ledger');
ok(/_readerTabRefuses\('bank resources'\)/.test(fnText('boeDepositRes')), 'the Bank of Ethos resource deposit has the same guard');
ok(/MultiTab\.amWriter === false\) return false;/.test(fnText('frConvoyTick')), 'only the writer tab delivers convoys');

console.log(fails ? `\n✗ ${fails} failed` : '\n✓ all passed');
process.exit(fails ? 1 : 0);
