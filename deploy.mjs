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

console.log('\n═══════════ RESTORE ═════════');
await restore();

if (deployErr) {
  console.error('\nDeploy aborted. Local source is restored — you can re-run `npm run deploy`.');
  process.exit(1);
}
console.log('\n✅ deploy complete');
