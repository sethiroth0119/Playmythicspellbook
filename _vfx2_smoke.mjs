/* ══════════════════════════════════════════════════════════════════════════
   ⚔ ATTACK VFX VOLUME 02 · THE WHITE SHEET · THE CAMP HANDBOOK

   Owner: "Update the VFX and this has the transparent background with the VFX"
   and "the player handbook core guide is not showing up in camp it is supposed
   to be a button here".

   Measured before this file was written (real Chromium, see the .gauntlet
   probes named below); this pins what made those measurements true.
     · .gauntlet/vfx-shot.mjs — 8 effects through the real _playElementFx over a
       green board: every far pixel green (was rgb 255,255,255 on all), overlay
       removed in ~4.7s / ~5.9s, contact point on the target. Its control (a
       light frame) still paints white, so the check can see the bug.
     · .gauntlet/vfx-scheme-audit.mjs — every public/assets/vfx page mounted the
       way the game mounts it: 10 white sheets before, 0 after.
     · .gauntlet/camp-bar-shot.mjs — the real COMMAND bar: Handbook first, 215×36.

   Run: node _vfx2_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const root = new URL('./public/', import.meta.url);
const SRC = fs.readFileSync(new URL('index.html', root), 'utf8');
const VFX = new URL('assets/vfx/', root);
let fails = 0, passes = 0;
const has = (t) => SRC.indexOf(t) >= 0;
const count = (hay, t) => hay.split(t).length - 1;
function ok(label, cond, why) {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (why ? '\n         ' + why : '')); }
}

console.log('\n── 🩹 the white sheet ──');
/* The game page is dark by meta; every effect page it embeds must be dark too. */
ok('index.html declares the dark scheme (the premise of everything below)', has('<meta name="color-scheme" content="dark">'));
const pages = fs.readdirSync(VFX).filter(f => f.endsWith('.html'));
ok('there are effect pages to check', pages.length >= 20, 'found ' + pages.length);
const light = pages.filter(f => {
  const s = fs.readFileSync(new URL(f, VFX), 'utf8');
  return !/<meta name="color-scheme" content="dark">/i.test(s) && !/html\.mgembed,html\.mgembed body\{color-scheme:dark!important\}/.test(s);
});
ok('EVERY effect page declares dark', light.length === 0,
   'light (will paint a white sheet in-game): ' + light.join(', '));
ok('the impact frame is embedded dark', has("background:transparent;color-scheme:dark;pointer-events:none;opacity:0"),
   '`normal` is NOT equivalent: the meta tag resolves it to dark only on the parent side');
ok('…and is hidden until it paints', has("_revealVfxIframe(ifr, wrap, ifr.src)"));
{
  const el = fs.readFileSync(new URL('vfx-elements.html', VFX), 'utf8');
  ok('the elemental host tags <html> so the dark rule applies', el.indexOf("document.documentElement.classList.add('mgembed');") > 0);
  ok('…and drops the pack\'s overlay layout, which would override the anchoring', el.indexOf("classList.remove('vfx-overlay')") > 0);
}

console.log('\n── ⚔ Volume 02 is wired, not just copied ──');
for (const f of ['vfx-attacks.html', 'attacks-vfx.js', 'vfx-transparent.css', 'vfx-transparent.js',
                 'assets/attacks/boulder.png', 'assets/attacks/heavy-punch.png', 'assets/attacks/medusa-shield.png',
                 'assets/attacks/quake-boot.png', 'assets/attacks/stone-character.png']) {
  let size = 0; try { size = fs.statSync(new URL(f, VFX)).size; } catch (e) {}
  ok('ships ' + f, size > 0 && size < 25 * 1024 * 1024, size ? (size / 1048576).toFixed(1) + ' MiB' : 'missing');
}
{
  const at = fs.readFileSync(new URL('vfx-attacks.html', VFX), 'utf8');
  ok('the attack page has a host entry point', at.indexOf("if (!q.has('atk')) return;") > 0);
  ok('…that turns the preview LOOP off', at.indexOf("getElementById('loop'); if (lp) lp.checked = false;") > 0,
     'the pack ships with Loop ticked — an overlay that never ends');
  ok('…and reports completion', at.indexOf("type: 'attacks:complete'") > 0);
  ok('…with the pack\'s own contact points for the compact attacks', at.indexOf('var CONTACT = { 7: [625, 430], 8: [510, 410], 9: [710, 450] };') > 0);
  ok('the pack\'s sub-resources carry a cache-buster', /attacks-vfx\.js\?v=\w+/.test(at) && /vfx-transparent\.css\?v=\w+/.test(at),
     'sw.js serves sub-resources cache-first; without ?v= an update never reaches a returning player');
}
const ATK = ['atkBlizzard', 'atkFume', 'atkGhost', 'atkBlood', 'atkCosmic', 'atkSpace', 'atkMeteor', 'atkPunch', 'atkStomp', 'atkMedusa'];
for (let i = 0; i < ATK.length; i++) ok('_ELEMENT_FX has ' + ATK[i] + ' → attacks #' + i, has('  ' + ATK[i] + ':') && new RegExp(ATK[i] + ":\\s*\\{ page: 'attacks', ix: " + i + ',').test(SRC));
ok('the thirteen elemental ids are untouched', ['fxMissile', 'fxFire', 'fxLightning', 'fxSwordSlice'].every(k => has('  ' + k + ':')),
   'moves already authored reference these ids');
ok('_playElementFx routes by page', has("(_atk ? _ATTACK_FX_FILE + '?atk=' : _ELEMENT_FX_FILE + '?fx=')"));
ok('…and accepts both completion messages', has("ev.data.type === 'elements:complete' || ev.data.type === 'attacks:complete'"));
ok('the move editor groups the two packs', has('<optgroup label="⚔ Attacks — Volume 02">'));

console.log('\n── 📖 the Camp handbook ──');
{
  const i = SRC.indexOf('function _campCommandBarHtml()');
  const j = SRC.indexOf('\nfunction ', i + 10);
  const bar = SRC.slice(i, j);
  ok('the COMMAND bar carries the handbook link', bar.indexOf('href="/handbook/"') > 0);
  ok('…first, right after the bar label', bar.indexOf('href="/handbook/"') < bar.indexOf('id="btn-camp-resistance-ring"'));
  ok('…opening in a new tab, without an opener handle', bar.indexOf('href="/handbook/" target="_blank" rel="noopener"') > 0);
}
ok('exactly ONE handbook link in the page (moved, not duplicated)', count(SRC, 'href="/handbook/"') === 1,
   'found ' + count(SRC, 'href="/handbook/"'));
ok('the old storage-panel copy is gone', !has("THE PLAYER'S HANDBOOK. An <a>, not a button with a click handler:"));

console.log('\n── negative control ──');
ok('the "every page is dark" check really can fail', (() => {
  const fake = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  return !/<meta name="color-scheme" content="dark">/i.test(fake);
})());

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all ' + passes + ' passed') + ' (' + passes + '/' + (passes + fails) + ')');
process.exit(fails ? 1 : 0);
