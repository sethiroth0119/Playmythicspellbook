/* ══════════════════════════════════════════════════════════════════════════
   🍽 DRIVE-FOOD-FALLBACK — a kitchen may not eat the whole larder.

   THE REPORT: "When it comes to food and water it seems that what is being
   produced always gets consumed at the same time, so players are never
   producing the correct amount."

   THE EVIDENCE, from the player's own away report:
       Food   +3,303 produced   −3,303 consumed     ← identical to the unit
       Water  +1,609 produced   −1,307 consumed     ← a healthy surplus

   Food and water differ by exactly one code path. STOCK_RAW_FALLBACK maps
   rations→food, remedies→medicine, goods→supplies — and has NO water row. So
   water has only the population draw, and it is fine. Food additionally has the
   kitchen's raw-ingredient fallback, and it was not fine.

   THE CAUSE: the fallback's two sides disagreed.
     · CREDIT  computeCoverage adds at most `dem.food * RAW_FOOD_SUBSISTENCE`
               (45%) — deliberately, so raw crops alone can never feed a city.
     · CHARGE  svcDraw took `short * RAW_FALLBACK_MULT` against `avail = the
               entire ledger`, with no cap whatsoever.
   A kitchen short by more than the larder held therefore took ALL of it, every
   tick, in exchange for at most 45% of the benefit. Production went in and came
   straight back out.

   THE FIX charges for no more than can be credited: the fallback may satisfy at
   most RAW_FOOD_SUBSISTENCE of what was wanted. The 2× penalty still stands on
   what it does draw, so the Cannery is still worth building.

   Pinned, with controls, because "food goes up now" could equally mean the
   fallback stopped working:
     · a big shortfall no longer drains the whole larder
     · CONTROL: it still draws — subsistence is not zero
     · CONTROL: it still pays the 2× penalty on what it takes
     · CONTROL: a SMALL shortfall is unaffected (the cap only bites past 45%)
     · CONTROL: an empty larder still yields nothing, so starvation is real
     · the charge can no longer exceed what computeCoverage will credit

   Run:  node .gauntlet/drive-food-fallback.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs'; import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'public', 'node-city', 'index.html'), 'utf8');

/* The constants, read out of the shipped file rather than retyped — a copy here
   would pass while the real numbers drifted. */
const num = (name) => {
  const m = new RegExp('const ' + name + '\\s*=\\s*([0-9.]+)').exec(SRC);
  return m ? Number(m[1]) : null;
};
const RAW_FALLBACK_MULT   = num('RAW_FALLBACK_MULT');
const RAW_FOOD_SUBSISTENCE = num('RAW_FOOD_SUBSISTENCE');

/* svcDraw's fallback arm, lifted out and run for real. Everything that decides
   how much is drawn is reproduced from the source below; `capped` is the
   shipped behaviour, `uncapped` is what it did before, so the two can be
   compared on the same inputs. */
const draw = (want, fromStock, larder, capped) => {
  let got = Math.min(fromStock, want);
  const short = want - got;
  let used = 0;
  if (short > 1e-9) {
    const need = capped ? Math.min(short, want * RAW_FOOD_SUBSISTENCE) : short;
    const cost = need * RAW_FALLBACK_MULT;
    const avail = Math.max(0, larder);
    used = Math.min(avail, cost);
    if (used > 0) got += used / RAW_FALLBACK_MULT;
  }
  return { drawnFromLarder: used, satisfied: Math.min(1, got / want) };
};

/* The shipped code must contain the cap — running a local copy proves the
   ARITHMETIC, not that the game uses it. */
const shipped = {
  hasCap: /const maxFromRaw = want \* RAW_FOOD_SUBSISTENCE;/.test(SRC),
  usesIt: /const need = Math\.min\(short, maxFromRaw\);/.test(SRC),
  chargesNeed: /const cost = need \* RAW_FALLBACK_MULT;/.test(SRC),
  oldUncapped: /const cost = short \* RAW_FALLBACK_MULT;/.test(SRC),
};

/* A kitchen wanting 100 rations with an empty stock and a 3,000-unit larder —
   the shape of the reported city: production banked, kitchens unstocked. */
const big   = { want: 100, stock: 0, larder: 3000 };
const small = { want: 100, stock: 80, larder: 3000 };   // only 20 short
const empty = { want: 100, stock: 0,  larder: 0 };

const bigOld = draw(big.want, big.stock, big.larder, false);
const bigNew = draw(big.want, big.stock, big.larder, true);
const smallOld = draw(small.want, small.stock, small.larder, false);
const smallNew = draw(small.want, small.stock, small.larder, true);
const emptyNew = draw(empty.want, empty.stock, empty.larder, true);

/* What computeCoverage will ever credit for the same want, so the charge can be
   held against the benefit. */
const creditCeiling = big.want * RAW_FOOD_SUBSISTENCE;

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
need('the constants were read from the file', RAW_FALLBACK_MULT === 2 && RAW_FOOD_SUBSISTENCE > 0,
     { RAW_FALLBACK_MULT, RAW_FOOD_SUBSISTENCE });
need('the shipped file carries the cap', shipped.hasCap && shipped.usesIt && shipped.chargesNeed, shipped);
need('CONTROL: the old uncapped charge is gone', shipped.oldUncapped === false, shipped);

need('THE REPORT: a big shortfall no longer drains the larder',
     bigNew.drawnFromLarder < bigOld.drawnFromLarder, { old: bigOld.drawnFromLarder, now: bigNew.drawnFromLarder });
need('…and takes only what it can be credited for',
     bigNew.drawnFromLarder === creditCeiling * RAW_FALLBACK_MULT,
     { drawn: bigNew.drawnFromLarder, ceiling: creditCeiling, mult: RAW_FALLBACK_MULT });
need('CONTROL: it still draws — subsistence is not zero', bigNew.drawnFromLarder > 0, bigNew);
need('CONTROL: it still satisfies at most the subsistence share',
     Math.abs(bigNew.satisfied - RAW_FOOD_SUBSISTENCE) < 1e-9, bigNew.satisfied);
need('CONTROL: the 2x penalty still applies',
     bigNew.drawnFromLarder === bigNew.satisfied * big.want * RAW_FALLBACK_MULT, bigNew);

need('CONTROL: a small shortfall is unchanged by the cap',
     smallNew.drawnFromLarder === smallOld.drawnFromLarder, { old: smallOld, now: smallNew });
need('CONTROL: an empty larder still yields nothing', emptyNew.drawnFromLarder === 0 && emptyNew.satisfied === 0, emptyNew);

console.log(JSON.stringify({
  RAW_FALLBACK_MULT, RAW_FOOD_SUBSISTENCE, shipped,
  bigShortfall:   { before: bigOld, after: bigNew, creditCeiling },
  smallShortfall: { before: smallOld, after: smallNew },
  emptyLarder: emptyNew,
}, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the kitchen is charged for no more than it can be credited for.');
process.exit(bad.length ? 1 : 0);
