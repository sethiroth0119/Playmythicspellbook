import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module'; const { minify } = createRequire(new URL('../../package.json', import.meta.url))('terser');
const dir = new URL('../../public/src/mapforge/', import.meta.url).pathname;
let fails = 0;
for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
  const code = readFileSync(dir + f, 'utf8');
  try { const out = await minify(code, { compress: false, mangle: false, module: true }); if (out.error) throw out.error; console.log('OK  ' + f + ' (' + code.length + ' chars)'); }
  catch (e) { fails++; console.log('FAIL ' + f + ': ' + (e.message || e) + ' line ' + (e.line || '?') + ':' + (e.col || '?')); }
}
process.exit(fails ? 1 : 0);
