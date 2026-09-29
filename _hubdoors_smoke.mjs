/* 📡🏛📦 TWO OWNER ASKS, 2026-09-17.
   Run: node _hubdoors_smoke.mjs
   1. "Move the EMERGENCY BROADCAST button from Forge Sanctum to Ruin Exchange."
   2. "In the homestead add a Bank of Ethos button. Add a My storage button so
      players can access their storage and deposit and withdraw resources like
      the city builder."
   §1 reads the hub tile lists. §2 mounts nothing: it lifts the farm's
   renderDoors and runs it against hosts that do and do not offer the doors,
   and runs the click dispatcher's three cases against a recording host.
   §3 checks the bridge hands over the same routes the city builder uses.
   §4 is the negative control. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const FARM = readFileSync('./public/src/farm/index.js', 'utf8').replace(/\r\n/g, '\n');

// The hub map: `forge: (() => {` … and `exchange: [` … `codex: [`.
const hubStart = IDX.indexOf('    forge: (() => {');
const exStart = IDX.indexOf('    exchange: [', hubStart);
const exEnd = IDX.indexOf('\n    codex: [', exStart);
const forgeBlock = IDX.slice(hubStart, exStart);
const exchangeBlock = IDX.slice(exStart, exEnd);

console.log('\n=== 1. Emergency Broadcast lives in the Ruin Exchange ===');
{
  ok(hubStart > 0 && exStart > hubStart && exEnd > exStart, 'found the Forge and Ruin Exchange tile lists');
  ok(/id: 'btn-broadcast'/.test(exchangeBlock), 'the Emergency Broadcast tile is in the Ruin Exchange list');
  ok(!/id: 'btn-broadcast'/.test(forgeBlock), 'and no longer in the Forge Sanctum list');
  ok((IDX.match(/id: 'btn-broadcast'/g) || []).length === 1, 'there is exactly one Emergency Broadcast tile');
  const tile = exchangeBlock.slice(exchangeBlock.indexOf("id: 'btn-broadcast'"));
  ok(/window\.open\(url, '_blank', 'noopener'\)/.test(tile) && /u=' \+ encodeURIComponent\(uid\) : 'feed=1'/.test(tile),
    'it still opens the player\'s own profile (or the feed when signed out) in a new tab');
  ok(/'btn-broadcast':\s+'assets\/hubtiles\//.test(IDX), 'its tile art mapping is unchanged');
}

console.log('\n=== 2. the Homestead header has the three doors ===');
{
  const i = FARM.indexOf('function renderDoors(host) {');
  let d = 0, j = FARM.indexOf('{', i), body = '';
  for (let k = j; k < FARM.length; k++) { if (FARM[k] === '{') d++; else if (FARM[k] === '}') { d--; if (!d) { body = FARM.slice(i, k + 1); break; } } }
  ok(i > 0 && body.length > 100, 'found renderDoors');
  const renderDoors = new Function(body + '\nreturn renderDoors;')();
  const host = (have, renting) => ({ canOpen: (k) => have.includes(k), isRentingStorage: () => renting });
  const all = renderDoors(host(['openBank', 'openMyStorage', 'openSendStorage'], true));
  ok(/data-fact="bank"[^>]*>🏛 Bank of Ethos</.test(all), 'a Bank of Ethos button');
  ok(/data-fact="mystorage"[^>]*>📦 My storage</.test(all), 'a My storage button (see and withdraw)');
  ok(/data-fact="sendstorage"[^>]*>📦 Send to your storage</.test(all), 'a deposit button when the player rents a bay');
  const noBay = renderDoors(host(['openBank', 'openMyStorage', 'openSendStorage'], false));
  ok(/data-fact="sendstorage"[^>]*>🛒 Buy storage from player</.test(noBay), 'with no bay it offers to buy storage, as the city builder does');
  ok(renderDoors(host([], false)) === '', 'an older host without the routes draws no doors');
  ok(/<div class="farm-doors" data-farm="doors"><\/div>/.test(FARM) && /const doors = rootEl\.querySelector\('\[data-farm="doors"\]'\); if \(doors\) setHtml\(doors, renderDoors\(h\)\);/.test(FARM),
    'the header has a doors slot and every paint fills it');

  // The dispatcher's three cases, run against a recording host.
  const cases = FARM.slice(FARM.indexOf("        case 'bank':"), FARM.indexOf("        case 'tab':", FARM.indexOf("        case 'bank':")));
  const calls = [], toasts = [];
  const run = (act, result) => {
    const h = { openBank: () => { calls.push('bank'); return result; }, openMyStorage: () => { calls.push('mine'); return result; },
                openSendStorage: () => { calls.push('send'); return result; }, toast: (m) => toasts.push(m) };
    new Function('act', 'h', 'switch (act) {\n' + cases + '\n}')(act, h);
  };
  run('bank', true); run('mystorage', true); run('sendstorage', true);
  ok(calls.join(',') === 'bank,mine,send' && toasts.length === 0, 'each button opens its own route', calls.join(','));
  run('bank', false);
  ok(toasts.length === 1 && /not available/.test(toasts[0]), 'a route that fails says so instead of doing nothing');
}

console.log('\n=== 3. the bridge hands over the city builder\'s routes ===');
{
  const b = IDX.slice(IDX.indexOf('window.MythicFarmBridge = {'), IDX.indexOf('window.MythicFarmBridge = {') + 6000);
  ok(/openBank: \(\) => \{ try \{ openBankOfEthos\(\);/.test(b), 'openBank → openBankOfEthos (the city builder\'s bank door)');
  ok(/openMyStorage: \(\) => \{ try \{ _whOpenMyStorage\(\);/.test(b), 'openMyStorage → _whOpenMyStorage (list bays, withdraw)');
  ok(/if \(_whIsRenting\(\)\) _whOpenSendModal\('camp', null, 'Homestead'\);\s+else _whOpenDirectory\('camp', null, 'Homestead'\);/.test(b),
    'openSendStorage ships from the CAMP stash (where farm goods live), or opens the directory with no bay');
  const host = FARM.slice(FARM.indexOf("    back: () => { try { B.back(); } catch (e) {} },"), FARM.indexOf("    back: () => { try { B.back(); } catch (e) {} },") + 1200);
  ok(/canOpen: \(k\) =>/.test(host) && /openSendStorage: \(\) => \{ try \{ return typeof B\.openSendStorage === 'function'/.test(host),
    'the farm reaches them only through the bridge, and tolerates their absence');
  ok(/src\/farm\/index\.js\?v=v121v118farm6/.test(IDX), 'the farm module cache-buster moved');
}

console.log('\n=== 4. NEGATIVE CONTROLS ===');
{
  const back = IDX.replace("    exchange: [", "    exchange: [\n      { id: 'btn-broadcast-dup' },").replace("      const everyoneTiles = [", "      const everyoneTiles = [\n        { id: 'btn-broadcast', name: 'Emergency Broadcast' },");
  const fb = back.slice(back.indexOf('    forge: (() => {'), back.indexOf('    exchange: [', back.indexOf('    forge: (() => {')));
  ok(/id: 'btn-broadcast'/.test(fb), 'a Broadcast tile put back in the Forge list is seen by §1');
  const noDoors = FARM.replace(/  if \(host\.canOpen\('openBank'\)\)[^\n]*\n/, '');
  const i = noDoors.indexOf('function renderDoors(host) {');
  let d = 0, body = '';
  for (let k = noDoors.indexOf('{', i); k < noDoors.length; k++) { if (noDoors[k] === '{') d++; else if (noDoors[k] === '}') { d--; if (!d) { body = noDoors.slice(i, k + 1); break; } } }
  const out = new Function(body + '\nreturn renderDoors;')()({ canOpen: () => true, isRentingStorage: () => true });
  ok(!/data-fact="bank"/.test(out), 'with the bank line removed, §2\'s bank check would fail');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ Broadcast is in the Ruin Exchange; the Homestead has its doors\n');
process.exit(fails ? 1 : 0);
