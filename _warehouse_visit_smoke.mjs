/* 🏗 VISITING SOMEBODY ELSE'S WAREHOUSE, and 📦 THE RESOURCE DEPOT.

   Asked for: "When a player is visiting another player's warehouse only
   allow them to pay their rental fee if they chose Later, if they owe the
   player. Do not allow them to interact with anything else." And: "Make a
   function where players can hold up to 20,000 in storage where they can
   put any resource in their wallet in it."

   What this file defends, headless, by lifting the shipped functions:
     · the yard's canUse(): owner everything, staff the floor, and a renter
       or visitor ONLY their own lapsed bay, only when they chose Later;
     · the prompt and the E press on that bay go to the host's pay-rent door;
     · the host marks Later, clears it on renewal, and tells the yard exactly
       which bays are owed here;
     · the depot: any wallet resource, 20,000 units across all of them,
       withdrawals clipped by the wallet's own ceiling;
     · the dwelling offers the function and the splash names the artwork.

   Run: node _warehouse_visit_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

function lifter(src) {
  return function fnText(name) {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('cannot find function ' + name);
    let d = 0, started = false;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '{') { d++; started = true; }
      else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
    }
    throw new Error('unbalanced ' + name);
  };
}
const YARD = readFileSync('./public/warehouse/index.html', 'utf8');
const HOST = readFileSync('./public/index.html', 'utf8');
const yf = lifter(YARD), hf = lifter(HOST);

console.log('\n=== 1. who may touch what in the yard ===');
{
  const units = [{ id: 'u1', bay_no: 1, mine: true }, { id: 'u2', bay_no: 2, mine: false }];
  function yard(role, owed) {
    const st = { is_owner: role === 'owner', is_staff: role === 'staff', viewer_role: role, units, warehouse: { id: 'w1' } };
    const toasts = [];
    const posted = [];
    const env = {
      WH: { state: () => st, owed: () => owed || [], payRent: (id) => posted.push(id) },
      App: { held: null, near: null },
      nextCrate: () => ({ c: { weight_kg: 22 }, s: { unit_id: 'u1' } }),
      bayFillText: () => '0', bayKnown: () => false, bayNoFor: () => 1,
      toast: (m) => toasts.push(m),
      openLifterModal: () => posted.push('LIFTER'), openUpgradeModal: () => posted.push('UPGRADE'),
    };
    const code = ['whRole', 'isStaff', 'isRenter', 'isVisitor', 'isOwner', 'owedFor', 'canUse', 'denyReason', 'promptFor'].map(yf).join('\n')
      + '\nreturn { whRole, canUse, denyReason, promptFor, owedFor };';
    const F = new Function(...Object.keys(env), code)(...Object.values(env));
    return { F, toasts, posted };
  }
  const S = (kind, unit) => ({ kind, unit });
  // owner
  let y = yard('owner');
  ok(['upgrade', 'workstation', 'lifter', 'truck', 'bay'].every((k) => y.F.canUse(S(k, units[1]))), 'the owner may use everything');
  // staff
  y = yard('staff');
  ok(y.F.canUse(S('workstation')) && y.F.canUse(S('truck')) && y.F.canUse(S('bay', units[1])) && !y.F.canUse(S('upgrade')), 'hired staff work the floor, never the upgrade');
  // renter, nothing owed
  y = yard('renter', []);
  ok(!y.F.canUse(S('bay', units[0])) && !y.F.canUse(S('truck')) && !y.F.canUse(S('workstation')) && !y.F.canUse(S('lifter')), 'a renter who owes nothing may touch NOTHING — not even their own bay or their van');
  ok(/not your warehouse/.test(y.F.denyReason(S('bay', units[0]))) && /pay rent you owe/.test(y.F.denyReason(S('bay', units[0]))), 'and the refusal says the one thing they could do: ' + y.F.denyReason(S('bay', units[0])));
  // renter, rent owed on their bay, chose Later
  y = yard('renter', [{ unit_id: 'u1', bay_no: 1 }]);
  ok(y.F.canUse(S('bay', units[0])), 'a renter who owes rent on Bay 1 and chose Later may use Bay 1…');
  ok(!y.F.canUse(S('bay', units[1])) && !y.F.canUse(S('truck')) && !y.F.canUse(S('workstation')), '…and still nothing else');
  ok(y.F.promptFor(S('bay', units[0])) === 'Pay the rent you owe on Bay 1', 'the prompt says so: ' + y.F.promptFor(S('bay', units[0])));
  // visitor with an owed row for a bay that is not theirs — cannot happen server-side, must not open anything
  y = yard('visitor', [{ unit_id: 'u2', bay_no: 2 }]);
  ok(!y.F.canUse(S('bay', units[1])) && !y.F.canUse(S('bay', units[0])), 'a visitor may not use a bay that is not marked mine, owed or not');
  ok(/visitor here/.test(y.F.denyReason(S('bay', units[1]))), 'and is told so as a visitor');
}

console.log('\n=== 2. the E press on an owed bay goes to the host, and the forklift is the owner\'s ===');
{
  ok(/if \(n\.kind === 'bay' && !isStaff\(\) && owedFor\(n\.unit\.id\)\) \{\s*WH\.payRent\(n\.unit\.id\);/.test(YARD), 'doInteract posts wh:payRent for an owed bay before any bay logic');
  ok(/if \(!isStaff\(\) && !Fork\.isDriving\(\)\) \{ toast\(denyReason\(null\), 3200\); return; \}/.test(YARD), 'Space refuses to board the forklift for a non-owner');
  ok(/payRent: function \(unitId\) \{ post\(\{ type: 'wh:payRent', unitId: unitId \}\); \}/.test(YARD), 'the bridge carries the payRent verb');
  ok(/if \(Array\.isArray\(d\.owed\)\) owed = d\.owed;/.test(YARD), 'and reads the owed list off wh:state');
}

console.log('\n=== 3. the host remembers Later, clears it on renewal, and lists what is owed here ===');
{
  const Profile = {};
  const saves = [];
  const env = { Profile, saveProfile: () => saves.push(1) };
  const code = ['_whPayLater', '_whPayLaterMark', '_whPayLaterClear'].map(hf).join('\n')
    + '\nlet _whRentals = null;\n' + hf('_whBayHasGoods') + '\n' + hf('_whOwedHere')
    + '\nreturn { mark: _whPayLaterMark, clear: _whPayLaterClear, owedHere: (st, rows) => { _whRentals = rows; return _whOwedHere(st); }, flags: _whPayLater };';
  const H = new Function(...Object.keys(env), code)(...Object.values(env));
  const rows = [
    { unit_id: 'u1', bay_no: 1, warehouse_id: 'w1', expired: true, used_kg: 40 },
    { unit_id: 'u5', bay_no: 5, warehouse_id: 'w1', expired: false },
    { unit_id: 'u9', bay_no: 9, warehouse_id: 'w2', expired: true, used_kg: 12 },
  ];
  const st = { warehouse: { id: 'w1' } };
  ok(H.owedHere(st, rows).length === 0, 'nothing is owed until Later was chosen');
  H.mark('u1'); H.mark('u9');
  const o = H.owedHere(st, rows);
  ok(o.length === 1 && o[0].unit_id === 'u1' && o[0].bay_no === 1, 'after Later: only the lapsed bay IN THIS building is owed (' + JSON.stringify(o) + ')');
  ok(H.owedHere({ warehouse: { id: 'w2' } }, rows).length === 1, 'the other building lists its own');
  H.clear('u1');
  ok(H.owedHere(st, rows).length === 0 && saves.length === 3, 'renewal clears the flag and every change saves the profile');
  ok(/if \(later\) later\.onclick = \(\) => \{ _whPayLaterMark\(r\.unit_id\); close\(\);/.test(HOST), 'the Later button marks the bay');
  ok(/close\(\);\s*_whPayLaterClear\(r\.unit_id\);/.test(HOST), 'a successful renewal clears it');
  ok(/if \(d\.type === 'wh:payRent'\) \{/.test(HOST) && /if \(r && r\.expired && _whBayHasGoods\(r\) && _whPayLater\(\)\[String\(r\.unit_id\)\]\) \{ _whLapsedSeen\.delete\(String\(r\.unit_id\)\); _whRentExpiredModal\(r\); \}/.test(HOST), 'the host opens the renewal modal only for an owed, Later-flagged bay');
  ok(/owed: _whOwedHere\(state\),/.test(HOST) && /if \(warehouseId\) \{ try \{ await _whFetchRentals\(\); \} catch \(e\) \{\} \}/.test(HOST), 'the yard is told what is owed, after the rentals were fetched');
}

console.log('\n=== 4. the depot — 20,000 units of anything in the wallet ===');
{
  const wallet = { metal: 30000, water: 500 };
  let cap = 100000, capUnits = () => Object.values(wallet).reduce((a, b) => a + b, 0);
  const Profile = {};
  const saves = [];
  const env = {
    Profile, saveProfile: () => saves.push(1),
    getRes: (id) => wallet[id] | 0,
    spendResources: (cost) => { for (const k in cost) if ((wallet[k] | 0) < cost[k]) return false; for (const k in cost) wallet[k] -= cost[k]; return true; },
    addRes: (id, n) => { const free = cap - capUnits(); const add = Math.max(0, Math.min(n, free)); wallet[id] = (wallet[id] | 0) + add; },
    getResourceCap: () => cap, getResourceUnits: capUnits,
    showToast: () => {},
  };
  const code = 'const DEPOT_CAP = 20000;\n' + ['_depot', 'depotTotal', 'depotFree', 'depotDeposit', 'depotWithdraw'].map(hf).join('\n')
    + '\nreturn { deposit: depotDeposit, withdraw: depotWithdraw, total: depotTotal, free: depotFree, DEPOT_CAP };';
  const D = new Function(...Object.keys(env), code)(...Object.values(env));
  ok(D.DEPOT_CAP === 20000 && /^const DEPOT_CAP = 20000;/m.test(HOST), 'the cap is 20,000 units');
  ok(D.deposit('water', 200) === 200 && wallet.water === 300 && Profile.depot.water === 200, 'a deposit moves units out of the wallet into the depot');
  ok(D.deposit('metal', 25000) === 19800 && D.total() === 20000 && D.free() === 0, 'a big deposit is clipped at the cap (19,800 more metal, total 20,000)');
  ok(D.deposit('water', 10) === 0, 'a full depot takes nothing');
  ok(D.deposit('gold', 5) === 0, 'you cannot deposit what you do not have');
  ok(D.withdraw('water', 50) === 50 && wallet.water === 350 && Profile.depot.water === 150, 'a withdrawal comes back to the wallet');
  cap = capUnits() + 20;                                   // the wallet is nearly full
  ok(D.withdraw('metal', 500) === 20 && Profile.depot.metal === 19780, 'a withdrawal is clipped to what the wallet can hold, and only that much leaves the depot');
  cap = capUnits();
  ok(D.withdraw('metal', 5) === 0, 'a full wallet takes nothing');
  cap = 1e9;                                              // room again
  ok(D.withdraw('water', 999) === 150 && !('water' in Profile.depot), 'over-withdrawing empties the row and drops it');
  ok(saves.length >= 5, 'every move saves the profile');
  ok(/__depot__:/.test(HOST) && /if \(f\.__depot__ && typeof f\.__depot__ === 'object'\) Profile\.depot = f\.__depot__;/.test(HOST) && /Profile\.depot           = p\.depot;/.test(HOST), 'the depot rides all three cloud-sync seams');
  ok(/else if \(d\.type === 'dw:depot'\) \{ try \{ openResourceDepot\(\); \}/.test(HOST), 'the dwelling opens it through dw:depot');
  const DW = readFileSync('./public/dwelling/index.html', 'utf8');
  ok(/<option value="depot">📦 Resource Depot \(20,000 units · any wallet resource\)<\/option>/.test(DW), 'the Admin Model Studio offers the function');
  ok(/else if\(_ud\.func==='depot'\)\{ dwBridge\('dw:depot'/.test(DW), 'pressing E on a depot piece asks the host for the door');
}

console.log('\n=== 5. the city builder loading screen ===');
{
  const NC = readFileSync('./public/node-city/index.html', 'utf8');
  ok(/#boot\{[^}]*url\('boot-rebuild\.png'\) center\/cover no-repeat/.test(NC), 'the splash is the rebuild artwork at node-city/boot-rebuild.png');
  ok(/#boot::before\{content:'';position:absolute;inset:0;background:linear-gradient/.test(NC), 'with a dark band so the line stays legible');
}

console.log('\n=== empty bay owes nothing ===');
{
  const code = HOST.slice(HOST.indexOf('function _whBayHasGoods('), HOST.indexOf('function _whOwedHere(')) + '\nreturn _whBayHasGoods;';
  const has = new Function(code)();
  ok(has({ used_kg: 120 }) && has({ used_kg: 0, contents: { metal: 3 } }) && !has({ used_kg: 0, contents: {} }) && !has({ used_kg: 0 }) && !has(null), 'a bay has goods when it weighs something or its contents list a quantity');
  ok(/r && r\.expired && _whBayHasGoods\(r\) && !_whLapsedSeen\.has/.test(HOST), 'the lapsed-rent modal never opens for an emptied bay');
  ok(/if \(r && r\.expired && !_whBayHasGoods\(r\)\) _whPayLaterClear\(r\.unit_id\);/.test(HOST), 'and its Later flag is dropped on every rentals refresh');
  ok(/r && r\.expired && _whBayHasGoods\(r\) && String\(r\.warehouse_id\)/.test(HOST), 'the yard is only told about bays that still hold goods');
  ok(/r && r\.expired && _whBayHasGoods\(r\) && _whPayLater\(\)\[String\(r\.unit_id\)\]/.test(HOST), 'paying at the bay is refused once it is empty');
  ok(/_whPayLaterClear\(b\.dataset\.uid\); _whLapsedSeen\.add\(String\(b\.dataset\.uid\)\);/.test(HOST), 'Withdraw all silences the prompt for that bay at once');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
