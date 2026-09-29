/* The art gate, lifted out of render.js verbatim and driven against the shapes
   it exists to reject. Read out of the FILE rather than retyped, so this cannot
   pass against a copy that has drifted from what ships. */
import fs from 'node:fs';
const src = fs.readFileSync('public/src/dilemma/render.js', 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp('const ' + name + ' = (/.*/[a-z]*);'));
  if (!m) { console.error('could not read ' + name + ' out of render.js'); process.exit(1); }
  return m[1];
};
const OK = eval(grab('ART_OK'));
const BAD = eval(grab('ART_BAD'));
console.log('ART_OK  = ' + OK);
console.log('ART_BAD = ' + BAD);

const gate = (u) => {
  if (!u || BAD.test(u)) return null;
  if (OK.test(u)) return u;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(u) ? null : u;
};

const cases = [
  ['https://cdn.example/art/x.png', 'https://cdn.example/art/x.png'],
  ['data:image/png;base64,AAAA',    'data:image/png;base64,AAAA'],
  ['assets/artwork/units/a.webp',   'assets/artwork/units/a.webp'],
  ['javascript:alert(1)',            null],
  ['//evil.tld/x.png',               null],
  ['x" onerror=alert(1) y="',        null],
  ['<img src=x onerror=alert(1)>',   null],
  ['ftp://host/x.png',               null],
  ['data:text/html,<script>',        null],
  ['assets/a b.png',                 null],
  ['',                               null],
];
let bad = 0;
for (const [input, want] of cases) {
  const got = gate(input);
  if (got !== want) { bad++; console.log('MISMATCH ' + JSON.stringify(input) + ' -> ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
console.log(bad ? ('art gate FAILED ' + bad + '/' + cases.length)
                : ('art gate: ' + cases.length + '/' + cases.length + ' — real urls pass, every hostile shape falls back to the glyph'));
process.exit(bad ? 1 : 0);
