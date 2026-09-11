/* 💱 AZAPEG — is Aza still worth what the vault has to pay for it?
   ----------------------------------------------------------------------------
   Run:  node tools/economy-tests/azapeg.mjs
   Exits non-zero on any failure.

   WHY THIS FILE EXISTS.
   The Supply Depot in the Black River extraction field carried a button reading
   "Exchange ₵220 → ◈1". Aza is not a soft currency: `spendSovereigns` charges a
   SERVER rpc (`sov_charge`), and `AZA_TO_CINDER` is the same rate the cashout
   vault settles at (`CASHOUT_RATE_PER_DOLLAR`), so ◈ is withdrawable value —
   1 ◈ = $1 USD = 5,000 ₵. That button therefore sold real money at 4.4% of face,
   and `nodeDeliver` ran the same mint through fuel (1 ◈ per 20 fuel).

   A NOTE IN index.html HAD ALREADY WORKED THIS OUT AND NOTHING HAPPENED.
   It said, in the file, above OSIM_BLUEPRINTS: "the number to change is the 220
   in `exchangeAza`, not these." It sat there through an entire ×10 repricing
   round because a comment is not a gate. That is the whole reason this is an
   executable file and not a third paragraph of the same comment.

   WHAT IT ASSERTS.
   §1  The peg is internally consistent: AZA_TO_CINDER === CASHOUT_RATE_PER_DOLLAR.
       If someone moves one and not the other, Aza bought on one side of the game
       cashes out at a different rate on the other, which is arbitrage by
       construction.
   §2  There is NO Cinder→Aza mint in the extraction field. Checked structurally
       — the `exchangeAza` handler must not exist — rather than by looking for
       the number 220, because the exploit is the CONVERSION, not the price.
   §3  There is no fuel→Aza mint either (the second door, and the one the
       original note named). `OSIM_FUEL_PER_AZA` must be gone.
   §4  Any surviving `_osimState.aza +=` is a CONTRACT REWARD and nothing else.
       That is the source the panel itself advertises ("Aza Coin comes from PRN
       contracts & events"); a reward is designed issuance, a conversion is a
       faucet the player can run at will.
   §5  Blueprint PRICES are untouched. A cost paid through `spendSovereigns` is
       not a mint, and this test must not be read as an argument for making the
       field cheaper.

   ⚠ IF YOU ARE HERE BECAUSE THIS FAILED: do not "fix" it by repricing a mint to
   5,000. A Cinder→Aza conversion inside a client-authoritative sim is a mint of
   real money whatever rate it carries — the rate only sets how fast. If an
   exchange is genuinely wanted it belongs server-side, next to the vault that
   has to honour it. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', '..', 'public', 'index.html'), 'utf8');

let fails = 0;
const ok = (cond, label, detail) => {
  if (cond) { console.log('   ✅ ' + label); return true; }
  fails++;
  console.log('   ❌ ' + label + (detail ? '\n      ' + detail : ''));
  return false;
};
const num = (name) => {
  const m = SRC.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)'));
  return m ? Number(m[1]) : null;
};

console.log('\n💱 AZA PEG\n');

/* ── §1 the peg agrees with the vault ─────────────────────────────────────── */
console.log('§1 canonical peg');
const peg = num('AZA_TO_CINDER');
const vault = num('CASHOUT_RATE_PER_DOLLAR');
ok(peg === 5000, 'AZA_TO_CINDER is 5000 (1 ◈ = $1 = 5,000 ₵)', 'found: ' + peg);
ok(vault === 5000, 'CASHOUT_RATE_PER_DOLLAR is 5000', 'found: ' + vault);
ok(peg !== null && peg === vault,
   'the buy rate and the cashout rate are the SAME number',
   'AZA_TO_CINDER=' + peg + ' vs CASHOUT_RATE_PER_DOLLAR=' + vault +
   ' — a gap here is arbitrage between the two sides of the game');

/* ── §2 no Cinder→Aza mint in the field ───────────────────────────────────── */
console.log('\n§2 no Cinder→Aza conversion in the extraction field');
ok(!/exchangeAza\s*:\s*\(/.test(SRC),
   'the `exchangeAza` handler does not exist',
   'a Cinder→Aza exchange is back in _OSIM — see the header of this file');
ok(!/_OSIM\.exchangeAza\s*\(/.test(SRC),
   'nothing calls _OSIM.exchangeAza()',
   'the button was re-added, or removal left a dangling onclick');

/* ── §3 no fuel→Aza mint (the second door) ────────────────────────────────── */
console.log('\n§3 no fuel→Aza conversion');
ok(!/const\s+OSIM_FUEL_PER_AZA\s*=\s*\d/.test(SRC),
   'OSIM_FUEL_PER_AZA is gone',
   'nodeDeliver is minting ◈ from fuel again — the rate the original note called '
   + '"the same rate" as the 220₵ button');

/* ── §4 every surviving mint is a contract reward ─────────────────────────── */
console.log('\n§4 surviving ◈ issuance is contract rewards only');
const mints = [...SRC.matchAll(/_osimState\.aza\s*\+=\s*([^;]+);/g)].map(m => m[1].trim());
const rewardOnly = mints.every(x => /rewardAza/.test(x));
ok(rewardOnly,
   'all ' + mints.length + ' ◈ issuance sites are PRN/emergency rewards',
   'non-reward mint(s): ' + mints.filter(x => !/rewardAza/.test(x)).join(' | '));
console.log('      sites: ' + (mints.length ? mints.join(' | ') : '(none)'));

/* ── §5 blueprint prices are a COST, not a mint, and are unchanged ────────── */
console.log('\n§5 blueprint prices untouched (a cost is not a mint)');
const bp = SRC.match(/const OSIM_BLUEPRINTS = \{[\s\S]{0,400}?\};/);
const prices = bp ? [...bp[0].matchAll(/aza:\s*(\d+)/g)].map(m => Number(m[1])) : [];
ok(prices.length >= 3 && prices.includes(80) && prices.includes(180) && prices.includes(250),
   'tier2/tier3/deepcore still cost ◈80 / ◈180 / ◈250',
   'found: ' + JSON.stringify(prices));
ok(/spendSovereigns\(b\.aza\)/.test(SRC),
   'blueprints are still paid from the real wallet via spendSovereigns',
   'buyBP stopped charging the server — that would make the field free');

console.log('');
if (fails) { console.log('❌ AZA PEG: ' + fails + ' failure(s)\n'); process.exit(1); }
console.log('✅ AZA PEG: all checks green\n');
