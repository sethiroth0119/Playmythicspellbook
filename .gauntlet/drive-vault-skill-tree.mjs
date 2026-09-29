/* ══════════════════════════════════════════════════════════════════════════
   🌲 DRIVE-VAULT-SKILL-TREE — the loadout page is gone, its job is in the vault.

   Asked for: "This page shouldn't be a thing as it is now in the camp in base
   vault. Add the Skill tree button over to the Base Vault"

   WHAT THIS PINS:
     · the Base Vault draws a Skill Tree button, and it opens the tree
     · it opens the tree on the hero the VAULT is showing, not a stale one
     · the tree comes back to the vault, not to the retired screen
     · App.screen='heroLoadout' can no longer paint the old page — from any
       entry point, including a saved screen restored on reload
     · the hero the old entry points chose survives the redirect

   ⚠ RENDER PAINTS ON A DEFERRED FRAME. Reading the DOM in the same tick as
     render() finds the PREVIOUS screen and reports a working change as broken
     — which is exactly how this driver failed first time round. Every
     assertion here is made after the paint has actually landed.

   ⚠ STAGING: the screen is set directly, the way every other driver here
     reaches a screen past the boot auth gate. Nothing about the vault, the
     button, the hero or the redirect is faked or stubbed.

   Run:  node .gauntlet/drive-vault-skill-tree.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9870 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);

const heroes = await pg.evaluate(() => {
  const h = getAllHeroes(); return [h[0].id, (h[1] || h[0]).id];
});
const [h0, h1] = heroes;
const paint = async (fn) => { await pg.evaluate(fn); await pg.waitForTimeout(900); };
const out = {};

/* ── the vault shows the button ───────────────────────────────────────── */
await paint(`(() => { App.vaultHeroId = ${JSON.stringify(h0)}; App.vaultReturnScreen = 'camp'; App.screen = 'baseVault'; render(); })()`);
Object.assign(out, await pg.evaluate(() => {
  const btn = document.getElementById('vault-skill-tree');
  return {
    buttonInVault: !!btn,
    buttonLabel: btn ? btn.textContent.trim() : null,
    buttonHasHandler: !!(btn && btn.onclick),
    buttonVisible: !!(btn && btn.offsetParent !== null && btn.getBoundingClientRect().height > 8),
  };
}));
await pg.screenshot({ path: '.gauntlet/_vault-skill-tree.png' });

/* ── it opens the tree on the hero the vault is showing ───────────────── */
if (out.buttonInVault) await pg.click('#vault-skill-tree').catch(() => {});
await pg.waitForTimeout(900);
Object.assign(out, await pg.evaluate(() => ({
  opensTree: App.screen,
  treeHero: App.skillTreeHeroId,
  treeReturnsToVault: App.skillTreeReturnScreen,
})));
out.treeHeroIsVaultHero = out.treeHero === h0;

/* ── the retired page cannot paint, whatever sets the screen ──────────── */
await paint(`(() => {
  App.vaultHeroId = null; App.vaultReturnScreen = null;
  App.loadoutHeroId = ${JSON.stringify(h1)}; App.loadoutReturnScreen = 'deck';
  App.screen = 'heroLoadout'; render();
})()`);
Object.assign(out, await pg.evaluate(() => ({
  redirectedTo: App.screen,
  heroCarried: App.vaultHeroId,
  returnSurvived: App.vaultReturnScreen,
  vaultActuallyPainted: !!document.getElementById('vault-skill-tree'),
  loadoutMarkupGone: !document.querySelector('.hl-slot, #hl-skill-tree, #hl-vault'),
})));
out.heroSurvived = out.heroCarried === h1;

out.pageErrors = errs;
console.log(JSON.stringify(out, null, 2));

const fail = [];
if (!out.buttonInVault) fail.push('no Skill Tree button in the Base Vault');
if (!/Skill Tree/.test(out.buttonLabel || '')) fail.push('button is not labelled Skill Tree');
if (!out.buttonHasHandler) fail.push('button is not wired');
if (!out.buttonVisible) fail.push('button is in the markup but not visible');
if (out.opensTree !== 'heroSkillTree') fail.push('button did not open the tree (' + out.opensTree + ')');
if (!out.treeHeroIsVaultHero) fail.push('tree opened on the wrong hero');
if (out.treeReturnsToVault !== 'baseVault') fail.push('tree does not return to the vault');
if (out.redirectedTo !== 'baseVault') fail.push('heroLoadout still paints (' + out.redirectedTo + ')');
if (!out.heroSurvived) fail.push('the chosen hero was lost in the redirect');
if (out.returnSurvived !== 'deck') fail.push('the return screen was lost in the redirect');
if (!out.vaultActuallyPainted) fail.push('redirect set the screen but painted nothing');
if (!out.loadoutMarkupGone) fail.push('the old loadout markup is still on the page');
if (errs.length) fail.push('page errors: ' + errs.join(' | '));

console.log(fail.length ? ('FAIL\n  - ' + fail.join('\n  - ')) : 'PASS · the loadout page is retired and the vault carries the tree');
await b.close(); srv.close();
process.exit(fail.length ? 1 : 0);
