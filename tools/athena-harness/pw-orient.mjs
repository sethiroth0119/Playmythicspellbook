import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG)('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage();
await pg.goto('http://127.0.0.1:8765/orient-test.html');
await pg.waitForFunction(() => window.__res, null, { timeout: 120000 });
const r = await pg.evaluate(() => window.__res);
if (typeof r === 'string') console.log(r); else { r.forEach((x) => console.log((x.cabToPlusZ && x.knownOk ? 'PASS ' : 'FAIL ') + JSON.stringify(x))); console.log(r.every((x) => x.cabToPlusZ && x.knownOk) ? 'ALL PASS' : 'SOME FAILED'); }
await b.close();
