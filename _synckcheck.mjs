import { readFileSync } from 'fs';
import { minify } from 'terser';

const html = readFileSync('public/index.html', 'utf8');
// Extract inline <script> blocks (no src=)
const re = /<script\b((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/gi;
let m, idx = 0, fails = 0;
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
  try {
    const out = await minify(code, { compress: false, mangle: false });
    if (out.error) throw out.error;
    console.log(`script #${idx}: OK (${code.length} chars)`);
  } catch (e) {
    fails++;
    console.error(`script #${idx}: FAIL (${code.length} chars)`);
    console.error('  ' + (e && e.message ? e.message : e));
    if (e && e.line != null) console.error(`  at line ${e.line}, col ${e.col}`);
  }
}
console.log(fails === 0 ? '\nALL CLEAN' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
