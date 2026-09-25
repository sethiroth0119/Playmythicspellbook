/* ➕ A FOUNDATION RESERVE DEPOSIT KEEPS YOU ON THE CONTRIBUTE TAB.
   Run: node _frtab_smoke.mjs
   Tracker bug-mty7q9yy / bug-mu1ajhmf: after each deposit the modal jumped to
   the Reserve tab, so contributing several resources cost extra clicks. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('function openFoundationReserve()');
const give = SRC.slice(SRC.indexOf("const give = document.getElementById('fr-give');", a), SRC.indexOf("const give = document.getElementById('fr-give');", a) + 1600);

ok(a > 0 && give.length > 100, 'found the Contribute button handler');
ok(/frDeposit\(id, q\)\.then\(ok => \{ if \(ok\) \{ tab = 'deposit'; render\(\); \} \}\);/.test(give), 'a successful deposit re-renders the Contribute tab');
ok(!/frDeposit\(id, q\)\.then\(ok => \{ if \(ok\) \{ tab = 'reserve';/.test(give), 'it no longer switches to the Reserve tab');
ok(/tBtn\('deposit', '➕ Contribute'\)/.test(SRC.slice(a, a + 60000)), "'deposit' is the Contribute tab's id");

// NEGATIVE CONTROL — the old line, put back, fails the check above.
const old = give.replace("tab = 'deposit'; render();", "tab = 'reserve'; render();");
ok(!/frDeposit\(id, q\)\.then\(ok => \{ if \(ok\) \{ tab = 'deposit'/.test(old), 'with the old line restored the check fails');

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ contributing stays on Contribute\n');
process.exit(fails ? 1 : 0);
