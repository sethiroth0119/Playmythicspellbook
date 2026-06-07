import { readFileSync } from 'fs';
import { minify } from 'terser';

const html = readFileSync('public/index.html', 'utf8');
// Extract inline <script> blocks (no src=)
const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, idx = 0, fails = 0;
while ((m = re.exec(html)) !== null) {
  idx++;
  const code = m[1];
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
