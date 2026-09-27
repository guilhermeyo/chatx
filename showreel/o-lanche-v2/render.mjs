// node render.mjs <start> <end> <outDir>   — renders frames [start,end) of film.html as JPEGs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path';
const [,, a, b, outDir] = process.argv;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => { console.log('ERR', e.message); process.exitCode = 1; });
await page.goto('file://' + path.resolve('film.html'));
await page.evaluate(() => window.ready);
fs.mkdirSync(outDir, { recursive: true });
for (let f = +a; f < +b; f++) {
  await page.evaluate(f => window.renderFrame(f), f);
  await page.screenshot({ path: `${outDir}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 });
}
await browser.close();
