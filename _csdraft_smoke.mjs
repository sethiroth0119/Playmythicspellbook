/* 🃏 CARD SHOP DRAFT SMOKE — bug-mu0l80ou.
   "Can't edit the name or tagline section when creating / managing card shop.
   It keeps resetting and blanking out whilst editing."

   The Open-your-shop inputs were rebuilt from a hard-coded default on every
   re-render (theme click, 45/60 s shop refetch, wallet-check render(), and in
   the 3D store every "e" typed — the window keydown re-opened the station).
   Now the typed text is a draft on App, written on every keystroke and read
   back by the template; the 3D store's keys stand down while a text box has
   focus.

   The template lines, the draft listener and the keydown handler are cut out
   of public/index.html and RUN. Negative control: the HEAD template, rendered
   after the player typed, gives back the default name and an empty tagline.
   Run: node _csdraft_smoke.mjs */
import { readFileSync } from 'fs';
/* Negative controls read the commit BEFORE the fix (767bf27084), not HEAD: once
   the fix was committed (1f9779cdde) HEAD carries it and the controls went red
   for the wrong reason. PRE_FIX_REF=HEAD shows the pin matters. */
import { execSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function formLines(src) {
  const a = src.indexOf('<input class="cs-input" id="cs-f-name"');
  const b = src.indexOf('\n', src.indexOf('<input class="cs-input" id="cs-f-tag"', a));
  return src.slice(a, b);
}
function renderForm(src, App) {
  const tpl = formLines(src);
  return new Function('App', 'escapeHtml', '_csMyName', 'return `' + tpl + '`;')(App, escapeHtml, () => 'Seth');
}
const valOf = (html, id) => { const m = html.match(new RegExp('id="' + id + '"[^>]*?value="([^"]*)"')); return m ? m[1] : null; };

console.log('\n=== 1. the draft survives a re-render ===');
{
  // the real listener, registered on a fake document
  let handler = null;
  const document = { addEventListener: (ev, fn) => { if (ev === 'input') handler = fn; } };
  const a = SRC.indexOf('function _csTypingIn(el)');
  const b = SRC.indexOf('function _csRender()', a);
  const App = {};
  new Function('document', 'App', SRC.slice(a, b))(document, App);
  ok(typeof handler === 'function', 'the draft listener is installed');
  const input = (k, v) => handler({ target: { getAttribute: (n) => (n === 'data-cs-draft' ? k : null), value: v } });
  let html = renderForm(SRC, App);
  ok(valOf(html, 'cs-f-name') === "Seth&#39;s Outpost", 'first render: the default name', valOf(html, 'cs-f-name'));
  input('name', 'Rust & Relics'); input('tag', 'Cards salvaged from the ruins');
  html = renderForm(SRC, App);           // a theme click / refetch / wallet render
  ok(valOf(html, 'cs-f-name') === 'Rust &amp; Relics', 'after a re-render the typed NAME is still there', valOf(html, 'cs-f-name'));
  ok(valOf(html, 'cs-f-tag') === 'Cards salvaged from the ruins', 'after a re-render the typed TAGLINE is still there', valOf(html, 'cs-f-tag'));
  input('name', '');
  html = renderForm(SRC, App);
  ok(valOf(html, 'cs-f-name') === '', 'a name the player cleared stays cleared (not re-defaulted)', valOf(html, 'cs-f-name'));
  ok(/data-cs-draft="name"/.test(html) && /data-cs-draft="tag"/.test(html), 'both inputs are tagged for the listener');
}

console.log('\n=== 2. the 3D store does not eat keystrokes typed into the form ===');
{
  const line = SRC.split('\n').find((l) => /const kd = e => \{ if \(_csTypingIn\(e\.target\)/.test(l));
  ok(!!line, 'the keydown handler checks for a focused text box first');
  const a = SRC.indexOf('function _csTypingIn(el)');
  const typingSrc = SRC.slice(a, SRC.indexOf('\ntry {', a));
  let entered = 0;
  const St = { keys: new Set() };
  const mk = (activeTag) => new Function('St', 'nearView', '_csEnterStation', 'document',
    typingSrc + '\n' + line.trim() + '\nreturn kd;')(St, 'counter', () => { entered++; }, { body: {}, activeElement: activeTag ? { tagName: activeTag } : { tagName: 'BODY' } });
  const inBox = mk('INPUT');
  inBox({ key: 'e', target: { tagName: 'INPUT' } }); inBox({ key: 'w', target: { tagName: 'INPUT' } });
  ok(entered === 0 && St.keys.size === 0, '"e" and "w" typed in the name box: no station re-open, no walking', entered + '/' + St.keys.size);
  const onCanvas = mk(null);
  onCanvas({ key: 'e', target: { tagName: 'CANVAS' } });
  ok(entered === 1, '"e" on the 3D view still enters the station (the feature is intact)', entered);
}

console.log('\n=== 3. negative control: HEAD resets the text ===');
{
  let head = '';
  try { head = execSync('git -c core.eol=lf -c core.autocrlf=false show ' + (process.env.PRE_FIX_REF || '767bf27084') + ':public/index.html', { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) {}
  const App = { _csDraftName: 'Rust & Relics', _csDraftTag: 'Cards salvaged' };
  const html = renderForm(head, App);
  ok(/^Seth(&#39;|')s Outpost$/.test(valOf(html, 'cs-f-name') || '') && valOf(html, 'cs-f-tag') === null, 'HEAD re-render: default name back, tagline blank (the report)', valOf(html, 'cs-f-name') + ' / ' + valOf(html, 'cs-f-tag'));
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
