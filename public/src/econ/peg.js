/* ══════════════════════════════════════════════════════════════════════════
   💵 THE PEG — what a Cinder and an Aza Coin are worth in real money.
   ══════════════════════════════════════════════════════════════════════════
   THE TWO RATES THE OWNER GAVE:
     · 5,000 Cinder = $1
     · 1 Aza Coin  = $1   ← Aza is the STABLE · MARKET-PEGGED currency, which is
       why it is 1:1 and Cinder is not.

   🔴 WHY THIS FILE EXISTS AT ALL. These two numbers were declared inside
      public/ethos/app.jsx, where only the Bank of Ethos could see them. The
      Crash Exchange needed the same peg to price a portfolio, and it lives in
      index.html — a different document, with no way to read a `const` inside a
      Babel-compiled script. The available options were a second copy of the
      peg or one file both pages load, and a second copy of an exchange rate is
      the kind of thing that is only noticed once the two screens disagree in
      front of a player about how much money they have.

   ⚠ A CLASSIC SCRIPT, NOT AN ES MODULE, AND THAT IS DELIBERATE. The Bank of
     Ethos loads app.jsx as <script type="text/babel">, which cannot `import`.
     A module here would be readable by index.html and invisible to the very
     file the numbers came from — which is the whole problem restated. So it
     publishes on `window` and both sides read it the same way.

   ⚠ THIS IS A DISPLAY, NOT A TILL. Nothing here can be spent, cashed out or
     traded at these numbers. It converts balances the game already holds so a
     player can see what their pile is worth. Any real cash-out goes through
     the server, which owns the wallet. Nothing in this file writes anything.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var USD_PER_CINDER = 1 / 5000;
  var USD_PER_AZA    = 1;

  /* What a mixed pile is worth. Negatives are floored at zero rather than
     subtracting: a negative balance is a bug upstream, and letting it eat the
     other currency would report a smaller fortune than the player holds. */
  function usdOf(cinder, aza) {
    return (Math.max(0, Number(cinder) || 0) * USD_PER_CINDER) +
           (Math.max(0, Number(aza) || 0) * USD_PER_AZA);
  }

  /* Two decimals always. A balance worth $758.2 reads as an error next to one
     worth $1,596.00, and money with a ragged tail looks like a rounding bug. */
  function usd(n) {
    return '$' + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Math.max(0, Number(n) || 0));
  }

  /* 🔥 A PRICE IN CINDER, AS MONEY. The exchange quotes everything in CR, and
     CR *is* Cinder — the wallet it spends from is the same Cinder wallet the
     city banks into. That was nowhere on the screen, which is what made a
     339.93 price unreadable: a player could not tell whether it was expensive.
     ⚠ SUB-CENT PRICES STILL SAY SOMETHING. At 5,000 Cinder to the dollar a
       35 CR resource is $0.007, and usd() would print "$0.01" for anything
       from half a cent up and "$0.00" below it — i.e. cheap things would all
       read as free. Below a cent this switches to four decimals so the number
       stays a number. */
  function usdPrice(cinder) {
    var v = Math.max(0, Number(cinder) || 0) * USD_PER_CINDER;
    if (v > 0 && v < 0.01) {
      return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    }
    return usd(v);
  }

  root.MythicPeg = {
    USD_PER_CINDER: USD_PER_CINDER,
    USD_PER_AZA: USD_PER_AZA,
    CINDER_PER_USD: Math.round(1 / USD_PER_CINDER),
    AZA_PER_USD: Math.round(1 / USD_PER_AZA),
    usdOf: usdOf,
    usd: usd,
    usdPrice: usdPrice,
  };
})(typeof window !== 'undefined' ? window : this);
