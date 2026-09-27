// node stills.mjs t1,t2,... outDir  — renders the frames at those times
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path';
const [,, list, outDir] = process.argv;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('file://' + path.resolve('film.html'));
await page.evaluate(() => window.ready);
fs.mkdirSync(outDir, { recursive: true });
for (const s of list.split(',')) {
  const f = Math.round(parseFloat(s) * 24);
  await page.evaluate(f => window.renderFrame(f), f);
  await page.screenshot({ path: `${outDir}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
}
await browser.close();
