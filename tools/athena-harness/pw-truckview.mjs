import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG)('playwright');
const H = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 900, height: 600 } });
for (const file of (process.argv[2] || 'freight_semi').split(',')) for (const view of (process.argv[3] || 'minusx,plusx,top').split(',')) {
  await pg.goto('http://127.0.0.1:8765/truck-view.html?view=' + view + '&url=/models/trucks/' + file + '.glb');
  await pg.waitForFunction(() => window.__done || window.__err, null, { timeout: 60000 });
  const err = await pg.evaluate(() => window.__err); if (err) console.log(file, view, err);
  await pg.screenshot({ path: H + '/shots/tv-' + file + '-' + view + '.png' });
}
console.log('done'); await b.close();
