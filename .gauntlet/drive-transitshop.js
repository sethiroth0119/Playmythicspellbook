/* The two surfaces a player reads BEFORE spending: the build shop's transit
   cards (⏱ derived duration, 🔒 when the free crew will not take it) and the
   Transit Authority licence cards. Shot with the licence held. */
(async () => {
  const nc = window.__nc, ops = window.__ncOps;
  ops.mockBuy('bus'); ops.mockBuy('rail'); await ops.refresh(true);
  document.querySelector('[data-mode="build"], #buildbtn, .bbtn[data-type=""]');
  const btn = [...document.querySelectorAll('button')].find(b => /BUILD/i.test(b.textContent) && b.offsetParent);
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 900));
  const dump = [...document.querySelectorAll('#shopbody [data-build]')]
    .filter(c => /busstop|trainstation|railtrack/.test(c.getAttribute('data-build')))
    .map(c => c.getAttribute('data-build') + ' :: ' + c.innerText.replace(/\n+/g, ' / ') +
              (c.classList.contains('opslock') ? '  [LOCKED]' : ''));
  console.log('SHOP ' + JSON.stringify(dump));
  /* scroll the transit cards into view for the shot */
  const tgt = document.querySelector('#shopbody [data-build="trainstation"]');
  if (tgt) tgt.scrollIntoView({ block: 'center' });
})();
