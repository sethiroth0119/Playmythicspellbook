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
function restoreOnce(why) {
  if (_restored) return;
  _restored = true;
  try {
    console.log('\n═══════════ RESTORE ═════════' + (why ? '  (' + why + ')' : ''));
    restore();
  } catch (e) {
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

console.log('═══════════ BUILD ═══════════');
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
console.log('\n✅ deploy complete');
