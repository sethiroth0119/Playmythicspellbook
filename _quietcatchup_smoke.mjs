/* 🔕 LOADING A CITY DOES NOT REPLAY HOURS OF TOASTS.
   Run: node _quietcatchup_smoke.mjs
   Tracker bug-mu2oevqf: "When loading cities (my own, or client cities),
   numerous out of date notifications are displayed. This leads to confusion."
   offlineCatchUp() replays the absence through economyTick / vitalsTick /
   moraleTick / decayTick / bldSweep, and those paths toast: construction done,
   city level, population milestones, decay, auto-stash, road links (§1 measures
   that from the source). The catch-up now installs the existing toast() sink for
   the length of the loop and puts back whatever was there before.
   §2 runs the real toast() with the real sink; §4 is the negative control. */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
function fnText(name) {
  const i = NC.search(new RegExp('(async )?function ' + name + '[(]'));
  if (i < 0) return '';
  let d = 0;
  for (let k = NC.indexOf('{', NC.indexOf(')', i)); k < NC.length; k++) {
    if (NC[k] === '{') d++; else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); }
  }
  return '';
}
const CU = fnText('offlineCatchUp');

console.log('\n=== 1. the catch-up\'s tick paths do toast — this is what reached the player ===');
{
  const toasting = ['decayTick', 'bldSweep', 'cityXpAdd', 'popMilestoneCheck', 'autoStashTick'].filter(n => /\btoast\(/.test(fnText(n)));
  ok(toasting.length >= 4, 'tick-path functions that call toast(): ' + toasting.join(', '), toasting.join(','));
  ok(/await economyTick\(/.test(CU) && /decayTick\(dt, true\)/.test(CU) && /bldSweep\(vnow\)/.test(CU), 'and offlineCatchUp drives them');
}

console.log('\n=== 2. the sink swallows them, counts them, and is removed afterwards ===');
{
  const a = CU.indexOf('const _prevToastSink = window.__ncToastSink;');
  const loop = CU.indexOf('while (done < simSec - 1e-9)');
  const fin = CU.indexOf('} finally {');
  const restore = CU.indexOf('window.__ncToastSink = _prevToastSink || null;');
  ok(a > 0 && a < loop, 'the sink is installed before the replay loop');
  ok(fin > loop && restore > fin && restore < CU.indexOf('const costMs', fin), 'and restored in the finally, so a throw cannot leave toasts muted');
  ok(/quiet: \{ count: _quiet\.n, msgs: _quiet\.msgs\.slice\(\) \}/.test(CU), 'the report carries what was muted');
  ok(/logEvent\('city', '🔕 While you were away: '/.test(CU), 'and the City Log gets ONE line for it');

  // Run the real toast() against a DOM stub with the real sink installed.
  const box = { children: [], get lastElementChild() { return this.children[this.children.length - 1] || null; },
                get firstElementChild() { return this.children[0] || null; }, appendChild(c) { this.children.push(c); } };
  const ctx = { window: {}, document: { createElement: () => ({ dataset: {}, style: {}, remove() {} }) },
                $: () => box, TOAST_MAX: 3, _toastArm: () => {}, setTimeout: () => 0, clearTimeout: () => {}, console };
  vm.createContext(ctx);
  vm.runInContext(fnText('toast'), ctx);
  const sinkSrc = CU.slice(a, CU.indexOf('try {', a));
  vm.runInContext('var __run = function () {' + sinkSrc + '\n'
    + 'toast("🏗 Farm finished"); toast("🏗 Farm finished"); toast("⭐ City level 4");\n'
    + 'window.__ncToastSink = _prevToastSink || null; return _quiet; };', ctx);
  ctx.window.__ncToastSink = null;
  const q = ctx.__run();
  ok(box.children.length === 0, 'nothing reached the toast rail during the replay', String(box.children.length));
  ok(q.n === 3 && q.msgs.length === 2, 'three toasts counted, two distinct kept', JSON.stringify(q));
  ok(ctx.window.__ncToastSink === null, 'the sink is gone afterwards');
  vm.runInContext('toast("live again")', ctx);
  ok(box.children.length === 1, 'and the next toast shows normally');

  const prev = () => {};
  ctx.window.__ncToastSink = prev;
  ctx.__run();
  ok(ctx.window.__ncToastSink === prev, 'a sink already installed (the zoning bulk run) is put back, not cleared');
}

console.log('\n=== 3. a refusal dialog is muted with it ===');
ok(/if \(window\.__ncToastSink\) return;/.test(fnText('refuse')), 'refuse() skips its dialog while a sink is installed');

console.log('\n=== 4. NEGATIVE CONTROL — no sink ===');
{
  const box = { children: [], get lastElementChild() { return this.children[this.children.length - 1] || null; },
                get firstElementChild() { return this.children[0] || null; }, appendChild(c) { this.children.push(c); } };
  const ctx = { window: {}, document: { createElement: () => ({ dataset: {}, style: {}, remove() {} }) },
                $: () => box, TOAST_MAX: 3, _toastArm: () => {}, setTimeout: () => 0, clearTimeout: () => {}, console };
  vm.createContext(ctx);
  vm.runInContext(fnText('toast'), ctx);
  vm.runInContext('toast("🏗 Farm finished"); toast("⭐ City level 4"); toast("🏚 Wall worn")', ctx);
  ok(box.children.length === 3, 'without the sink the same replay puts three stale toasts on screen', String(box.children.length));
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ a city loads quietly and logs its absence once\n');
process.exit(fails ? 1 : 0);
