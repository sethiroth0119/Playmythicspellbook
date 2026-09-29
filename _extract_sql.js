const fs = require('fs');
const h = fs.readFileSync('public/index.html', 'utf8');
const m = h.match(/const FOUNDATION_RESERVE_SQL = "([\s\S]*?)";\r?\n/);
if (!m) { console.error('NOT FOUND'); process.exit(1); }
// The captured text is the body of a JS double-quoted string (only \n escapes,
// no embedded double quotes) — JSON.parse decodes it exactly.
const sql = JSON.parse('"' + m[1] + '"');
fs.writeFileSync('foundation_reserve.sql', sql + '\n');
console.log(sql);
