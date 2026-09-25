/* Extract every inline <script> from an HTML file and compile it, so a patch
   that broke the page's JS is caught before a deploy rather than by a player. */
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');
const tmp = path.join(require('os').tmpdir(), 'mythic-htmlsyntax');
fs.mkdirSync(tmp, { recursive: true });
let bad = 0;
for (const file of process.argv.slice(2)) {
  const s = fs.readFileSync(file, 'utf8');
  const re = /<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(s))) {
    const attrs = m[1] || '', body = m[2];
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["'](?!module|text\/javascript|application\/javascript)/i.test(attrs)) continue;
    i++;
    const isModule = /type\s*=\s*["']module["']/i.test(attrs);
    const line0 = s.slice(0, m.index).split('\n').length;
    if (isModule) {
      const f = path.join(tmp, path.basename(file) + '.' + i + '.mjs');
      fs.writeFileSync(f, body);
      const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      if (r.status !== 0) { bad++; console.log('✗ ' + file + ' script #' + i + ' (module, from line ' + line0 + '):\n' + r.stderr.split('\n').slice(0, 6).join('\n')); }
      else console.log('✓ ' + file + ' script #' + i + ' module ' + (body.length / 1024 | 0) + ' KB');
    } else {
      try { new vm.Script(body, { filename: file + '#' + i }); console.log('✓ ' + file + ' script #' + i + ' classic ' + (body.length / 1024 | 0) + ' KB'); }
      catch (e) { bad++; console.log('✗ ' + file + ' script #' + i + ' (classic, from line ' + line0 + '): ' + e.message + ' @ ' + (e.stack.split('\n')[0])); }
    }
  }
}
console.log(bad ? '❌ ' + bad + ' script(s) failed to compile' : '✅ every inline script compiles');
process.exit(bad ? 1 : 0);
