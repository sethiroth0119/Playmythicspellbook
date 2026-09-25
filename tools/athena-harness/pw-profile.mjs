import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG)('playwright');
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage();
await pg.goto('http://127.0.0.1:8765/profile-test.html');
await pg.waitForFunction(() => window.__res, null, { timeout: 120000 });
const r = await pg.evaluate(() => window.__res);
if (typeof r === 'string') console.log(r);
else for (const [k, x] of Object.entries(r)) { console.log(k + ' size ' + x.size); console.log('  top    ' + x.top); console.log('  topAll ' + x.topAll); console.log('  width  ' + x.wid); }
await b.close();
