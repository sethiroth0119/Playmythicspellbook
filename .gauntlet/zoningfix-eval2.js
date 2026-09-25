(async () => {
  const nc = window.__nc, Z = window.MythicZoning;
  const R = {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const toasts = () => Array.from(document.querySelectorAll('.toast, #toasts > *')).map(e => e.textContent.trim().slice(0, 160));
  try { nc.build.finishAll('driver'); } catch (e) {}
  Z.panel(true); Z.select('r_low'); Z.tool('marquee');
  // a block of open land south of the district
  Z.applyRect(3, 14, 20, 22, 'r_low');
  R.zoned = Z.stats().zoned;
  R.goIdle = document.querySelector('#nz-go').textContent;
  R.selIdle = document.querySelector('#nz-sel').textContent.slice(0, 200);
  await Z.develop();
  for (let i = 0; i < 4; i++) { await Z.step(); await sleep(80); }
  R.goRunning = document.querySelector('#nz-go').textContent;
  R.selRunning = document.querySelector('#nz-sel').textContent.slice(0, 240);
  R.crewsHud = (document.getElementById('bldcrews') || {}).textContent || null;
  R.stats = Z.stats();
  R.toastsAfterDevelop = toasts();
  // now pick a building — the panel must put itself away, visibly
  Z._ctx.setMode('place', 'housing');
  await sleep(200);
  R.panelOpenAfterPick = !!document.querySelector('#nz-panel.on');
  R.barBtnActive = !!document.querySelector('#nz-open.active');
  R.toastsAfterPick = toasts();
  R.developStillRunning = Z.developing();       // development is NOT a map tool: it keeps going
  Z.panel(true);
  return R;
})()
