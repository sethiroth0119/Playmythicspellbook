/* 🚦 THE LICENCE MUST SAY WHAT IT BUYS — before and after the purchase — and
   the sentence it prints when a crew will not take the job must be the SAME
   STRING the click produces. Both halves proved here. */
(async () => {
  const nc = window.__nc, ops = window.__ncOps, T = window.MythicTransit;
  const out = {};
  const txt = () => { const p = document.getElementById('tr-panel');
    return p ? p.querySelector('.tr-lic').innerText.replace(/\n+/g, ' | ') : null; };

  /* 1. UNOWNED — what a player reads before spending 10,000,000 🔥 */
  T.open(); out.beforeBuying = txt();

  /* 2. OWNED */
  ops.mockBuy('bus'); ops.mockBuy('rail'); await ops.refresh(true);
  T.open(); out.afterBuying = txt();

  /* 3. ONE STRING, TWO SURFACES. gasstation (1:53:11) is over the ceiling on a
     city with no Co., so the licence-card sentence and the placement refusal
     must be byte-identical — that is the whole point of bldCeilingMsg. */
  const said = [];
  window.__ncToastSink = (m) => { said.push(String(m)); };
  let x = 2, z = 2; while (nc.game.tiles[x + ',' + z]) z++;
  await nc.place('gasstation', x, z);
  window.__ncToastSink = null;
  out.gateRefusal = said[0] || null;
  out.cardSentence = (nc.build.crewNote ? nc.build.crewNote('gasstation') : null);
  window.__LIC = out;
  console.log('LIC_BEFORE ' + out.beforeBuying);
  console.log('LIC_AFTER ' + out.afterBuying);
  console.log('LIC_GATE ' + out.gateRefusal);
  console.log('LIC_NOTE ' + JSON.stringify(out.cardSentence));
  console.log('LIC_SAME ' + (out.cardSentence && out.cardSentence.sentence === out.gateRefusal));
  T.open();
})();
/* 4. THE RED BRANCH, exercised through the REAL render rather than described.
   Nothing in the transit set is over the ceiling any more (that is the fix), so
   the ceiling is squeezed instead of the cost — same branch, and it also proves
   the card tracks a RETUNE rather than a hard-coded number. */
(async () => {
  const nc = window.__nc, T = window.MythicTransit;
  const C = nc.build.cfg(); const saved = C.municipal.maxSec;
  C.municipal.maxSec = 600;
  T.open();
  const p = document.getElementById('tr-panel');
  console.log('LIC_SQUEEZED ' + p.querySelector('.tr-lic').innerText.replace(/\n+/g, ' | '));
  C.municipal.maxSec = saved;
  T.open();
})();
