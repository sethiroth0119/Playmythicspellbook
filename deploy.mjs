// deploy.mjs — production deploy with first-load minification.
//
// Flow:
//   1. minify() — back up public/index.html, write minified version.
//   2. wrangler deploy — upload to Cloudflare Workers.
//   3. restore() — put the original (un-minified) back in public/index.html.
//
// Restore ALWAYS runs (even if wrangler fails) so the local editable source is
// never left in a minified state.
//
// Use:   npm run deploy

import { execSync } from 'node:child_process';
import fs from 'node:fs';   // version.txt is written from BUILD_VERSION below
import { minify, restore } from './build.mjs';

/* 🔴 RESTORE MUST SURVIVE THE PROCESS DYING, NOT JUST WRANGLER FAILING.
   The try/catch below has always covered "wrangler exited non-zero". It does
   NOT cover the case that actually bit this repo twice: the deploy being
   interrupted. `wrangler deploy` streams for ~2 minutes, which is a long window
   for a Ctrl+C, a closed terminal, or a killed shell — and any of those ended
   the process between minify() and restore(), leaving the editable source as
   the minified build.

   ⚠ SYNCHRONOUS ONLY. A signal handler gets one tick; an async restore would
     not finish before the process is gone. restore() is all sync fs calls, so
     calling it here works — but nothing async may be added to this path.
   ⚠ IDEMPOTENT AND ONCE-ONLY. `_restored` guards against the normal path and a
     signal both firing, and restore() itself no-ops when the backup is absent.
     Re-entering it would be harmless today, which is precisely why it is worth
     pinning now rather than relying on that staying true. */
let _restored = false;
let _restoreFailed = false;
function restoreOnce(why) {
  if (_restored) return;
  _restored = true;
  try {
    console.log('\n═══════════ RESTORE ═════════' + (why ? '  (' + why + ')' : ''));
    /* restore() is SYNC (see its header). It used to be async, which meant a
       failure here became an unhandled rejection instead of something this
       catch could see — so a failed restore printed nothing useful and the
       deploy still announced success while the working tree sat minified. */
    if (restore() !== true) _restoreFailed = true;
  } catch (e) {
    _restoreFailed = true;
    console.error('❌ restore failed:', e && e.message);
    console.error('   Recover with:  git checkout -- public/index.html');
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  // SIGBREAK is Windows-only; registering an unknown signal is a no-op, not an
  // error, so listing them together is safe cross-platform.
  try {
    process.on(sig, () => {
      restoreOnce('interrupted by ' + sig);
      // 128 + signal number is the shell convention for "died by signal".
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  } catch (e) {}
}
process.on('uncaughtException', (e) => {
  console.error('\n❌ uncaught error during deploy:', e && e.message);
  restoreOnce('uncaught error');
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('\n❌ unhandled rejection during deploy:', (e && e.message) || e);
  restoreOnce('unhandled rejection');
  process.exit(1);
});

/* 🔄 version.txt IS THE UPDATE SIGNAL, AND IT WENT STALE FOR 70 BUILDS.
   index.html fetches it uncached every few minutes and compares it to
   window.BUILD_VERSION; when they differ it reloads ONCE to pick up the new
   bundle. It was last hand-edited at v121q15 while BUILD_VERSION marched on to
   v121q85, so `latest` never changed, every player's __forcedReloadFor was
   already stamped with it, and the whole auto-update path was dead — fixes
   shipped and simply did not reach anybody until they cleared their cache.
   ⚠ WRITTEN FROM BUILD_VERSION RATHER THAN MAINTAINED BY HAND, because a
     number two humans have to remember to change together is a number that
     drifts. This reads the one in index.html and makes the file agree with it,
     every deploy, before anything is uploaded.
   ⚠ It writes the SOURCE file, which minify() then copies — so it must run
     before the build, and the restore afterwards leaves the corrected value in
     place because version.txt is not one of the files minify rewrites. */
function syncVersionTxt() {
  const idx = fs.readFileSync('public/index.html', 'utf8');
  const m = idx.match(/window\.BUILD_VERSION\s*=\s*'([^']+)'/);
  if (!m) { console.error('⚠ could not read BUILD_VERSION — version.txt left alone'); return null; }
  const v = m[1];
  let was = '';
  try { was = fs.readFileSync('public/version.txt', 'utf8').trim(); } catch (e) {}
  if (was === v) { console.log('   version.txt already ' + v); return v; }
  fs.writeFileSync('public/version.txt', v);
  console.log('   version.txt ' + (was || '(empty)') + '  ->  ' + v);
  return v;
}

console.log('═══════════ BUILD ═══════════');
syncVersionTxt();
await minify();

console.log('\n═══════════ DEPLOY ══════════');
let deployErr = null;
try {
  execSync('npx wrangler deploy', { stdio: 'inherit', shell: true });
} catch (e) {
  deployErr = e;
  console.error('\n❌ wrangler deploy failed');
}

restoreOnce();

if (deployErr) {
  console.error('\nDeploy aborted. Local source is restored — you can re-run `npm run deploy`.');
  process.exit(1);
}
/* 🔴 A FAILED RESTORE IS NOT A SUCCESSFUL DEPLOY, even though the upload
   worked. Announcing "✅ deploy complete" over a minified working tree is how
   this went unnoticed twice: the next edit would have been made against
   minified source. The upload IS live — say so — but exit non-zero so the
   shell, and anything scripting this, treats it as needing attention. */
if (_restoreFailed) {
  console.error('\n⚠  THE UPLOAD SUCCEEDED, BUT YOUR LOCAL SOURCE WAS NOT RESTORED.');
  console.error('   public/index.html is still the MINIFIED build. Do not edit it.');
  console.error('   Recover with:  git checkout -- public/index.html');
  process.exit(1);
}
console.log('\n✅ deploy complete');
