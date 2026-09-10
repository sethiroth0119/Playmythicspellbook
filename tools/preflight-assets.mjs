// tools/preflight-assets.mjs — fail a deploy BEFORE wrangler starts uploading
// if any file under public/ is over Cloudflare's 25 MiB per-asset cap and is
// not excluded by public/.assetsignore.
//
// WHY. wrangler discovers an oversized file only partway through a ~2 minute
// upload and then aborts the whole deploy with a one-line error that names the
// file but not the fix. Production sat frozen on a stale build more than once
// because of exactly that. This runs in under a second, names every offender,
// and says what to do (upload to R2 via tools/media-put.mjs, or add to
// .assetsignore if it is not needed at runtime).
//
// Pattern matching is a small gitignore-style subset — `*`, `**`, `!` negation,
// trailing `/` for directories — which covers every line .assetsignore has
// ever had. If a fancier pattern is ever added there, extend `toRegex` too.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('public');
const CAP = 25 * 1024 * 1024;

function toRegex(glob) {
  let g = glob.replace(/\\/g, '/');
  const dirOnly = g.endsWith('/');
  if (dirOnly) g = g.slice(0, -1);
  // A pattern with no slash (other than a trailing one) matches at any depth.
  const anchored = g.includes('/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  re = (anchored ? '^' : '(^|/)') + re + (dirOnly ? '(/|$)' : '$');
  return new RegExp(re);
}

function loadIgnore() {
  let lines = [];
  try { lines = readFileSync(path.join(ROOT, '.assetsignore'), 'utf8').split(/\r?\n/); } catch (e) {}
  return lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => (l.startsWith('!') ? { neg: true, re: toRegex(l.slice(1)) } : { neg: false, re: toRegex(l) }));
}

function isIgnored(rel, rules) {
  let ignored = false;
  for (const r of rules) if (r.re.test(rel)) ignored = !r.neg;
  return ignored;
}

function* walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile()) yield p;
  }
}

export function preflight() {
  const rules = loadIgnore();
  const offenders = [];
  for (const f of walk(ROOT)) {
    const size = statSync(f).size;
    if (size <= CAP) continue;
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (!isIgnored(rel, rules)) offenders.push({ rel, size });
  }
  return offenders;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('preflight-assets.mjs')) {
  const bad = preflight();
  if (!bad.length) { console.log('✅ preflight: no file over 25 MiB will be uploaded'); process.exit(0); }
  console.error(`❌ preflight: ${bad.length} file(s) over Cloudflare's 25 MiB cap would ABORT the deploy:\n`);
  for (const b of bad) console.error(`   ${(b.size / 1048576).toFixed(1).padStart(7)} MiB  public/${b.rel}`);
  console.error(`
Fix, per file — either:
  • it IS needed in-game  →  node tools/media-put.mjs "public/<path>"   (serves at /media/<key>)
                              then reference /media/<key> instead of /assets/<path>
  • it is NOT needed      →  add the path to public/.assetsignore
`);
  process.exit(1);
}
