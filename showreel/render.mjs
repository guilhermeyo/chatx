import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
let [,, mode, a, b, outDir] = process.argv; if (mode === "stills") outDir = b;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', m => console.log('console:', m.text()));
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('file://' + process.cwd() + '/reel.html');
await page.evaluate(() => window.ready);
fs.mkdirSync(outDir, { recursive: true });
const frames = mode === 'stills' ? a.split(',').map(x => Math.round(parseFloat(x) * 60)) : Array.from({ length: +b - +a }, (_, i) => +a + i);
const t0 = Date.now();
for (const f of frames) {
  await page.evaluate(f => window.renderFrame(f), f);
  await page.screenshot({ path: `${outDir}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 94 });
}
console.log('done', frames.length, 'frames in', (Date.now() - t0) / 1000, 's');
await browser.close();
