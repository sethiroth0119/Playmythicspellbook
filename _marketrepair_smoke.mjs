/* 🏪 MARKET REPAIR — the trigger no-op, the clawback ledger kind, the gate.

   Reported: "the player market is auto-delisting listings and refunding them
   while the item is still listed — massive duplication, vaults full."
   Root cause: sql/067's BEFORE UPDATE archive trigger on resource_listings
   returned OLD, which makes every UPDATE a no-op. Expiry, cancel and sale
   never stuck; every sweep wrote another refund row; sold listings kept
   selling. sql/113 fixes the trigger, repairs the listings from the ledger,
   voids uncollected duplicate refunds and writes 'clawback' rows for what was
   already collected in excess.

   What this defends, headless:
     · the client turns a clawback row into the right legs — seller 'res'
       takes the resource back; seller 'cash' takes want_units of currency;
       buyer 'res' takes the goods and gives want_units of currency back —
       and NEVER reads price_total as money (an old client does);
     · ordinary rows (sale / cancel / expire) produce the legs they always did;
     · _resSettleEntry caps a clawback at what the player still holds;
     · sql/113 and the corrected sql/067 return NEW on UPDATE, clawbacks are
       gated behind market_flags.clawback_live, and money rides in want_units
       with price_total 0.

   Run: node _marketrepair_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. clawback legs and labels ===');
{
  const ctx = { _meta: (id) => ({ id, name: id, icon: '🧱' }), frApplyTax: (g) => ({ net: g, tax: 0 }), console };
  vm.createContext(ctx);
  vm.runInContext(fnText('_resEntryLegs') + '\n' + fnText('_resEntryLabel'), ctx);
  const legs = (e) => vm.runInContext('_resEntryLegs(' + JSON.stringify(e) + ')', ctx);
  const label = (e) => vm.runInContext('_resEntryLabel(' + JSON.stringify(e) + ')', ctx);
  let l = legs({ party: 'seller', kind: 'clawback', want_kind: 'res', want_id: 'seller', resource: 'corn', units: 19000, price_total: 0, want_units: 0, currency: 'cinders' });
  ok(l.length === 1 && l[0].dir === 'take' && l[0].kind === 'res' && l[0].id === 'corn' && l[0].n === 19000, 'seller res clawback: take the duplicated units back', JSON.stringify(l));
  l = legs({ party: 'seller', kind: 'clawback', want_kind: 'cash', want_id: 'seller', resource: 'medicine', units: 700, price_total: 0, want_units: 28000, currency: 'cinders' });
  ok(l.length === 1 && l[0].dir === 'take' && l[0].kind === 'cinder' && l[0].n === 28000, 'seller cash clawback: take want_units of Cinder, nothing else', JSON.stringify(l));
  l = legs({ party: 'buyer', kind: 'clawback', want_kind: 'res', want_id: 'buyer', resource: 'medicine', units: 100, price_total: 0, want_units: 4000, currency: 'cinders' });
  ok(l.length === 2 && l[0].dir === 'take' && l[0].kind === 'res' && l[0].n === 100 && l[1].dir === 'give' && l[1].kind === 'cinder' && l[1].n === 4000, 'buyer res clawback: goods go back, the Cinder paid comes back', JSON.stringify(l));
  l = legs({ party: 'seller', kind: 'clawback', want_kind: 'cash', want_id: 'seller', resource: 'x', units: 1, price_total: 99999, want_units: 0, currency: 'cinders' });
  ok(l.length === 0, 'price_total on a clawback is never money (old-client safety)', JSON.stringify(l));
  l = legs({ party: 'buyer', kind: 'clawback', want_kind: 'res', want_id: 'buyer', resource: 'fuel', units: 40, price_total: 0, want_units: 40, currency: 'aza' });
  ok(l[1] && l[1].kind === 'aza' && l[1].n === 40, 'an Aza sale is refunded in Aza');
  /* the rows that always existed */
  l = legs({ party: 'seller', kind: 'expire', resource: 'wood', units: 300, currency: 'cinders' });
  ok(l.length === 1 && l[0].dir === 'give' && l[0].kind === 'res' && l[0].n === 300, 'expire still refunds the escrow');
  l = legs({ party: 'buyer', kind: 'sale', resource: 'wood', units: 300, price_total: 500, currency: 'cinders' });
  ok(l.length === 2 && l[0].dir === 'take' && l[0].kind === 'cinder' && l[0].n === 500 && l[1].dir === 'give' && l[1].n === 300, 'a buyer sale still pays and receives');
  l = legs({ party: 'seller', kind: 'sale', resource: 'wood', units: 300, price_total: 500, currency: 'cinders' });
  ok(l.length === 1 && l[0].dir === 'give' && l[0].kind === 'cinder' && l[0].n === 500, 'a seller sale still receives the ask');
  ok(/duplicate refund reversed/.test(label({ party: 'seller', kind: 'clawback', want_kind: 'res', resource: 'corn', units: 19000, want_units: 0 })) && /duplicate sale reversed/.test(label({ party: 'seller', kind: 'clawback', want_kind: 'cash', resource: 'x', units: 1, want_units: 28000 })), 'clawback labels say what happened');
  ok(/\+4,000 🔥 back/.test(label({ party: 'buyer', kind: 'clawback', want_kind: 'res', resource: 'medicine', units: 100, want_units: 4000, currency: 'cinders' })), 'a buyer sees the Cinder coming back');
}

console.log('\n=== 2. the capped settle ===');
{
  const t = fnText('_resSettleEntry');
  ok(/if \(e\.kind === 'clawback'\)/.test(t) && /Math\.min\(l\.n \| 0, have\(l\)\)/.test(t), 'a clawback take is capped at what the player still holds');
  ok(/if \(!legs\.some\(l => l\.dir === 'take'\) && e\.party !== 'buyer'\) legs = \[\];/.test(t), 'nothing left to take: the row is claimed as empty, a buyer\'s refund still lands');
  ok(/if \(!legs\.length\) \{ await _resClaimIds\(\[e\.ledger_id\]\); return \{ ok: true, empty: true \}; \}/.test(t), 'an empty row is still claimed, so it never blocks the sweep');
  ok(/e\.want_kind === 'cash' \? e\.want_units : e\.units/.test(t), 'the console note reads want_units for cash');
}

console.log('\n=== 3. the SQL ===');
{
  const q = readFileSync('./sql/113_market_trigger_noop_repair.sql', 'utf8');
  ok(/if TG_OP = 'DELETE' then return OLD; end if;\s*return NEW;/.test(q), 'sql/113: the archive trigger returns NEW on UPDATE');
  ok(/check \(kind in \('sale', 'cancel', 'expire', 'clawback'\)\)/.test(q), 'sql/113: clawback is a ledger kind');
  ok(/create table if not exists public\.market_flags/.test(q) && /clawback_live boolean not null default false/.test(q), 'sql/113: the gate exists and starts OFF');
  ok((q.match(/select clawback_live from public\.market_flags/g) || []).length >= 3, 'sql/113: rl_claimable (both parties) and rl_claim honour the gate');
  ok(/'res', 'seller', 'sql\/113 duplicate refunds reversed'/.test(q) && /'cash', 'seller', 'sql\/113 paid for lots never escrowed/.test(q) && /'res', 'buyer', 'sql\/113 over-sold lots returned/.test(q), 'sql/113: the three clawback shapes');
  ok(/price_per_lot, 0, o\.price_per_lot \* o\.extra_lots,\s*'res', 'buyer'/.test(q) && /price_per_lot, 0, o\.price_per_lot \* sum\(o\.extra_lots\),\s*'cash', 'seller'/.test(q), 'sql/113: money rides in want_units, price_total is 0');
  ok(/voided_at = now\(\), void_reason = 'sql\/113 duplicate refund/.test(q), 'sql/113: uncollected duplicate refunds are voided, not deleted');
  ok(/update public\.user_resources u\s+set qty = greatest\(0, u\.qty - o\.over_units\)/.test(q), 'sql/113: the warehouse mirror is lowered too');
  ok(/Apply BY HAND/.test(q), 'sql/113: says it is applied by hand');
  const m = readFileSync('./sql/067_market_never_vanishes.sql', 'utf8');
  const i = m.indexOf('create or replace function public.reslisting_archive()');
  ok(i > 0 && /if TG_OP = 'DELETE' then return OLD; end if;\s*return NEW;/.test(m.slice(i, i + 900)), 'sql/067: the resource archive trigger is corrected at the source');
  const H = readFileSync('./public/index.html', 'utf8');
  ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(H), 'build version present');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
