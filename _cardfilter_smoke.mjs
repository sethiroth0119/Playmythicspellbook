/* 🔍 THE SEARCH RULE IS OBEYED — "I have this set at units, cost ≤ 5, and it
   is still showing me any card in my deck, and cards with cost higher."

   Root cause: the editor always writes `costMode: 'exact'` into the shared
   Card Filter block even when untouched, so _effCardFilter saw a "set" filter
   that constrained nothing and let it beat the rule saved on the Search
   picker's own bar. This file lifts the shipped _effCardFilter and
   _cardMatchesFilter and proves the rule now applies — and that an explicit
   shared filter, or a named-card list, still wins as designed.

   Run: node _cardfilter_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const env = { _cardMentionText: () => '', _treatAsOf: () => null };
const F = new Function(...Object.keys(env), fnText('_effCardFilter') + '\n' + fnText('_cardMatchesFilter') + '\nreturn { eff: _effCardFilter, match: _cardMatchesFilter };')(...Object.values(env));

const deck = [
  { id: 'u2', name: 'Dire Wolf', type: 'unit', cost: 2 },
  { id: 'u5', name: 'Death Dragon Bear', type: 'unit', cost: 5 },
  { id: 'u8', name: 'Bahamut', type: 'unit', cost: 8 },
  { id: 's3', name: 'Fire Blast', type: 'spell', cost: 3 },
];
const pick = (flt) => deck.filter((c) => F.match(c, flt)).map((c) => c.id).join(',');

console.log('\n=== 1. the untouched shared filter no longer beats the rule ===');
{
  const eff = { type: 'searchDeck', searchDeckType: 'any',
    filter: { element: 'any', cardType: 'any', faction: 'any', costMode: 'exact' },     // what the editor always writes
    searchDeckCardRule: { cardType: 'unit', costMode: 'max', cost: 5 } };
  const flt = F.eff(eff, 'searchDeckCardRule');
  ok(flt === eff.searchDeckCardRule, 'the picker-bar rule is the effective filter');
  ok(pick(flt) === 'u2,u5', 'the search offers only units costing ≤ 5 (Dire Wolf, Death Dragon Bear) — not Bahamut (8), not the spell');
  const eff2 = { type: 'searchDeck', filter: { element: 'any', cardType: 'any', faction: 'any', costMode: 'exact', costKind: 'card' }, searchDeckCardRule: { cardType: 'unit', costMode: 'max', cost: 5 } };
  ok(F.eff(eff2, 'searchDeckCardRule') === eff2.searchDeckCardRule, 'costKind alone does not count as a constraint either');
}

console.log('\n=== 2. what still wins, by design ===');
{
  const eff = { filter: { element: 'fire', cardType: 'any', faction: 'any', costMode: 'exact' }, searchDeckCardRule: { cardType: 'unit', costMode: 'max', cost: 5 } };
  ok(F.eff(eff, 'searchDeckCardRule') === eff.filter, 'an explicit shared filter (element fire) beats the rule');
  const eff2 = { filter: { element: 'any', cardType: 'any', faction: 'any', costMode: 'max', cost: 3 }, searchDeckCardRule: { cardType: 'unit', costMode: 'max', cost: 5 } };
  ok(F.eff(eff2, 'searchDeckCardRule') === eff2.filter && pick(eff2.filter) === 'u2,s3', 'a shared filter with a COST set is a real constraint and wins (cost ≤ 3)');
  const eff3 = { filter: { element: 'any', cardType: 'any', faction: 'any', costMode: 'exact' }, searchDeckCardIds: ['u8'], searchDeckCardRule: { cardType: 'unit', costMode: 'max', cost: 5 } };
  ok(F.eff(eff3, 'searchDeckCardRule') === null, 'a named-card list suppresses the rule (the list is the answer)');
  const eff4 = { filter: { element: 'any', cardType: 'any', faction: 'any', costMode: 'exact' } };
  ok(F.eff(eff4, 'searchDeckCardRule') === null, 'no rule and an untouched filter ⇒ no filter (any card), as before');
}

console.log('\n=== 3. the matcher itself ===');
{
  ok(pick({ cardType: 'unit', costMode: 'min', cost: 5 }) === 'u5,u8', 'cost ≥ 5 → the 5 and the 8');
  ok(pick({ cardType: 'unit', costMode: 'exact', cost: 5 }) === 'u5', 'cost = 5 → just the 5');
  ok(pick({ cardType: 'spell' }) === 's3', 'type spell → the spell');
  ok(pick(null) === 'u2,u5,u8,s3', 'no filter → everything');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
