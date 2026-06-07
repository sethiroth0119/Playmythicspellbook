// 🧪 deploy-test.mjs — same flow as deploy.mjs, but pushes to the TEST
// worker (wrangler.test.jsonc) instead of the live one. Same minify +
// restore safety. Lets us iterate on visual experiments without ever
// touching the live URL.
//
// Flow:
//   1. minify() — back up public/index.html, write minified version.
//   2. wrangler deploy --config wrangler.test.jsonc — upload to test worker.
//   3. restore() — put the original (un-minified) back in public/index.html.
//
// Restore ALWAYS runs (even if wrangler fails) so the local editable source
// is never left in a minified state.
//
// Use:  npm run deploy:test
import { execSync } from 'node:child_process';
import { minify, restore } from './build.mjs';

console.log('═══════════ BUILD (test) ═══════════');
await minify();

console.log('\n═══════════ DEPLOY (test) ══════════');
let deployErr = null;
try {
  execSync('npx wrangler deploy --config wrangler.test.jsonc', { stdio: 'inherit', shell: true });
} catch (e) {
  deployErr = e;
  console.error('\n❌ wrangler test-deploy failed');
}

console.log('\n═══════════ RESTORE ═════════════════');
await restore();

if (deployErr) {
  console.error('\nTest deploy aborted. Local source is restored — you can re-run `npm run deploy:test`.');
  process.exit(1);
}
console.log('\n✅ test deploy complete');
