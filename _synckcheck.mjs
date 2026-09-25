import { readFileSync } from 'fs';
import { minify } from 'terser';

/* Usage: node _synckcheck.mjs [file.html ...]
   Defaults to public/index.html so every existing caller keeps working.

   ⚠ It used to take NO arguments and open public/index.html and nothing else.
   That silently made it a no-op gate for work anywhere else under public/ —
   a syntax error in public/main-menu/index.html printed ALL CLEAN and would
   have shipped green. Pass the files you touched. */
const files = process.argv.slice(2);
if (!files.length) files.push('public/index.html');

// Extract inline <script> blocks (no src=)
const re = /<script\b((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/gi;
let fails = 0;

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  console.log(`\n=== ${file} ===`);
  let m, idx = 0;
  re.lastIndex = 0;
  while ((m = re.exec(html)) !== null) {
    idx++;
    const attrs = m[1] || '';
    const code = m[2];
    // Skip non-JS script types — import maps and JSON blobs are data, not code
    // (Terser rightly rejects them, but browsers never parse them as JS).
    if (/type\s*=\s*["']?(importmap|speculationrules|application\/(ld\+)?json)/i.test(attrs)) {
      console.log(`script #${idx}: skipped (${(attrs.match(/type\s*=\s*["']?([\w/+-]+)/i) || [])[1] || 'data'})`);
      continue;
    }
    if (!code.trim()) continue;
    // `type="module"` must be parsed AS a module or top-level await and import
    // are syntax errors — valid code would have been reported as a failure.
    const isModule = /type\s*=\s*["']?module/i.test(attrs);
    try {
      const out = await minify(code, { compress: false, mangle: false, module: isModule });
      if (out.error) throw out.error;
      console.log(`script #${idx}: OK (${code.length} chars${isModule ? ', module' : ''})`);
    } catch (e) {
      fails++;
      console.error(`script #${idx}: FAIL (${code.length} chars${isModule ? ', module' : ''})`);
      console.error('  ' + (e && e.message ? e.message : e));
      if (e && e.line != null) console.error(`  at line ${e.line}, col ${e.col}`);
    }
  }
}
console.log(fails === 0 ? '\nALL CLEAN' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
