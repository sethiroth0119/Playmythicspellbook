// build.mjs — minify the inline <script> block in public/index.html.
//
// The deployed file is ~4.7 MB unminified; that's a 2-3 second parse cost on
// every first load. Minifying with Terser drops it to ~1.5 MB → much snappier
// first paint and the whole game feels less "website" and more "game."
//
// Strategy: in-place minify with a backup so the user keeps editing
// public/index.html directly (no src/ split, no asset re-copying — the
// public/ dir holds 2.5 GB of game assets that we DON'T want to copy on
// every deploy). deploy.mjs wraps:  minify → wrangler deploy → restore.
//
// Usage:
//   node build.mjs minify    → backs up + writes minified to public/index.html
//   node build.mjs restore   → restores public/index.html from backup
//
// If anything goes wrong, run `node build.mjs restore` to recover the source.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { minify as terserMinify } from 'terser';

const PUBLIC = path.resolve('public');
const SRC = path.join(PUBLIC, 'index.html');
const BACKUP = path.join(PUBLIC, '.index.dev.html');
const SENTINEL = '<!--MIN-->';

// Match the FIRST big inline <script> block (no src=, no type="application/json").
const SCRIPT_RE = /(<script(?![^>]*\bsrc=)(?![^>]*\btype=["'][^"']*json[^"']*["'])[^>]*>)([\s\S]*?)(<\/script>)/i;

// Global variant so we can scan EVERY inline block and take the largest.
const SCRIPT_RE_G = new RegExp(SCRIPT_RE.source, 'gi');

// Conservative Terser options — string-keyed property access is heavy in this
// codebase (Profile['gems'], dynamic event-handler IDs, etc.), so:
//  • keep_fnames / keep_classnames preserve function references used by
//    inline onclick attributes and string-based dispatch tables.
//  • reserved keeps the top-level state singletons that the rest of the code
//    accesses by name from many places.
const TERSER_OPTS = {
  compress: {
    drop_debugger: true,
    passes: 1,
    // Don't drop console — useful in the field for diagnosing player reports.
    drop_console: false,
    // The codebase relies on left-to-right evaluation of side effects in
    // a few places (the gems setter, save scheduling) — disable risky
    // optimizations that could change order.
    sequences: false,
    join_vars: false,
  },
  // ⚠ Mangle is DISABLED. The codebase has inline onclick="someFn()" and
  // other string-based dispatch tables that depend on top-level function
  // names being unchanged. Mangling broke at least one network/auth path
  // ("failed to fetch" on Sign In) — turning it off keeps the ~30% win from
  // whitespace + comment + dead-code removal without the risk. Re-enabling
  // requires a full audit of every inline onclick and string-keyed handler.
  mangle: false,
  format: { comments: false, ecma: 2020 },
  ecma: 2020,
  sourceMap: false,
};

export async function minify() {
  console.log('🔨 reading', SRC);
  const html = fs.readFileSync(SRC, 'utf8');
  if (html.startsWith(SENTINEL)) {
    /* 🔴 ALREADY MINIFIED. This used to be `await restore(); return minify();`
       with no check that the restore actually did anything — and restore() is a
       no-op when the backup is gone. So in the one state that actually happens
       in practice (a previous deploy died, leaving a minified index.html and no
       backup) this recursed forever: read minified → restore nothing → minify →
       read minified → … until the stack blew.

       There is nothing to recover from on disk in that state, and minifying an
       already-minified file would write a MINIFIED BACKUP — destroying the only
       remaining copy of the source. So: refuse, loudly, and say exactly how to
       get the source back. git has it; this script does not. */
    if (!fs.existsSync(BACKUP)) {
      throw new Error(
        'public/index.html is already minified and there is NO backup to restore from.\n' +
        '   This means a previous deploy was interrupted. The source is not recoverable\n' +
        '   from disk — restore it from git and re-run:\n\n' +
        '       git checkout -- public/index.html\n');
    }
    console.log('✓ already minified — restoring source first so we re-minify fresh');
    await restore();
    const after = fs.readFileSync(SRC, 'utf8');
    if (after.startsWith(SENTINEL)) {
      throw new Error('restore ran but public/index.html is STILL minified — the backup was itself minified. Restore from git: git checkout -- public/index.html');
    }
    return minify();
  }
  console.log('💾 backing up source →', path.basename(BACKUP));
  fs.writeFileSync(BACKUP, html);
  // ⚠ Pick the BIGGEST inline script, not the first. index.html opens with a
  //   small ~29 KB bootstrap block, so the first-match regex was minifying THAT
  //   and shipping the 10 MB main script RAW on every deploy — the one thing
  //   this build step exists to compress.
  let m = null;
  for (const cand of html.matchAll(SCRIPT_RE_G)) {
    if (!m || cand[2].length > m[2].length) m = cand;
  }
  if (!m) throw new Error('Could not find inline <script> block in ' + SRC);
  const [whole, open, body, close] = m;
  const before = body.length;
  console.log('⚙️  minifying', before.toLocaleString(), 'chars of JS …');
  const t0 = Date.now();
  const result = await terserMinify(body, TERSER_OPTS);
  if (result.error) throw result.error;
  if (!result.code) throw new Error('Terser returned empty output.');
  const after = result.code.length;
  const dt = Date.now() - t0;
  const pct = (1 - after / before) * 100;
  console.log('✓ ' + after.toLocaleString() + ' chars (' + pct.toFixed(1) + '% smaller) in ' + (dt / 1000).toFixed(1) + 's');
  // ⚠ Don't use String.replace() — minified JS contains $&, $1 etc. that
  // String.replace interprets as backreferences, ballooning the file 3x.
  // Use indexOf + slice for a literal substitution.
  const idx = html.indexOf(whole);
  if (idx < 0) throw new Error('Could not locate matched script block for replacement.');
  const minHtml = SENTINEL + html.slice(0, idx) + open + result.code + close + html.slice(idx + whole.length);
  fs.writeFileSync(SRC, minHtml);
  console.log('✓ wrote minified', SRC, '(' + minHtml.length.toLocaleString() + ' chars total)');
}

export async function restore() {
  if (!fs.existsSync(BACKUP)) {
    console.log('⚠  no backup file at', BACKUP, '— nothing to restore');
    return false;
  }
  const src = fs.readFileSync(BACKUP, 'utf8');
  /* 🔴 NEVER RESTORE A POISONED BACKUP. If the backup itself starts with the
     sentinel then a previous run minified an already-minified file, and writing
     it back would overwrite the working copy with the minified build AND then
     delete the evidence — which is exactly how this repo twice ended up with a
     minified index.html and no backup, looking like a clean restore had run.
     Leave both files alone and say so; git still has the source. */
  if (src.startsWith(SENTINEL)) {
    console.error('❌ the backup at ' + BACKUP + ' is itself MINIFIED — refusing to restore it.');
    console.error('   Recover the source with:  git checkout -- public/index.html');
    console.error('   (leaving the backup in place; nothing has been overwritten)');
    return false;
  }
  fs.writeFileSync(SRC, src);
  /* Verify the write landed before dropping the only other copy. An unlink that
     runs after a failed/partial write is how a backup becomes the last casualty
     of an already-bad situation. */
  const check = fs.readFileSync(SRC, 'utf8');
  if (check.startsWith(SENTINEL) || check.length !== src.length) {
    console.error('❌ restore wrote ' + SRC + ' but it does not match the backup — KEEPING the backup.');
    return false;
  }
  fs.unlinkSync(BACKUP);
  console.log('✓ restored', SRC, 'from backup');
  return true;
}

const arg = (process.argv[2] || '').toLowerCase();
/* 🔴 THE ENTRYPOINT CHECK WAS WRONG ON WINDOWS, AND IT FAILED SILENTLY.
   It compared import.meta.url against 'file://' + argv[1]. On Windows
   import.meta.url is `file:///C:/…` (THREE slashes, drive letter) while that
   concatenation produces `file://C:/…` (two). The strings never matched, so
   `node build.mjs minify` and `node build.mjs restore` did nothing at all and
   exited 0 — including the exact recovery command this file's own header tells
   you to run when a deploy goes wrong. A recovery tool that silently no-ops is
   worse than one that is missing, because you believe you have run it.
   pathToFileURL is the supported way to build the comparison. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (arg === 'minify') {
    minify().catch(e => { console.error('❌', e.message); process.exit(1); });
  } else if (arg === 'restore') {
    restore().catch(e => { console.error('❌', e.message); process.exit(1); });
  } else {
    console.log('Usage: node build.mjs [minify|restore]');
  }
}
