/* Bundle /src/mapforge into ONE inline module for the hosted preview page.
   Each module becomes an IIFE returning its exports; imports become
   destructuring from those objects. Regex-based, tuned to this codebase. */
import { readFileSync } from 'fs';
const dir = new URL('../../public/src/mapforge/', import.meta.url).pathname;
const order = ['mapforge.format.js', 'mapforge.bridge.js', 'mapforge.three.js', 'mapforge.props.js', 'mapforge.terrain.js', 'mapforge.water.js', 'mapforge.vfx.js', 'mapforge.world.js', 'mapforge.api.js', 'mapforge.player.js', 'mapforge.engine.js', 'mapforge.editor.js', 'index.js'];
const modName = f => '__mod_' + f.replace(/^mapforge\./, '').replace(/\.js$/, '').replace(/[^a-z0-9]/gi, '_');
let out = '';
for (const f of order) {
  let src = readFileSync(dir + f, 'utf8');
  const exportsList = [];
  // imports
  src = src.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+'\.\/([\w.]+)';\s*$/gm, (_, name, file) => `const ${name} = ${modName(file)};`);
  src = src.replace(/^import\s+\{([^}]+)\}\s+from\s+'\.\/([\w.]+)';\s*$/gm, (_, names, file) => `const {${names.replace(/\s+as\s+/g, ': ')}} = ${modName(file)};`);
  src = src.replace(/^import\s+(\w+)\s+from\s+'\.\/([\w.]+)';\s*$/gm, (_, name, file) => `const ${name} = ${modName(file)}.default;`);
  // exports
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+(\w+)/gm, (_, kw, name) => { exportsList.push(name); return `${kw} ${name}`; });
  src = src.replace(/^export\s+default\s+(\w+);\s*$/gm, (_, name) => { exportsList.push('default: ' + name); return ''; });
  if (/^export\b/m.test(src)) throw new Error('unhandled export in ' + f + ': ' + src.match(/^export\b.*$/m)[0]);
  if (/^import\b/m.test(src)) throw new Error('unhandled import in ' + f + ': ' + src.match(/^import\b.*$/m)[0]);
  src = src.replace(/new URL\('\.\/mapforge\.css', import\.meta\.url\)\.href/g, "'data:text/css,'");
  out += `\n/* ═══ ${f} ═══ */\nconst ${modName(f)} = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}
process.stdout.write(out);
