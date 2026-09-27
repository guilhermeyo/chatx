// node render.mjs frames <start> <end> <outDir>     render frames [start,end) of film.html as JPEGs
// node render.mjs stills <t1,t2,...> <outDir>        render the frames at those times (seconds)
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
const [,, mode, a, b, c] = process.argv;
const browser = await pw.chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
await page.goto(pathToFileURL(path.resolve('film.html')).href);
await page.evaluate(() => window.ready);
const fps = await page.evaluate(() => window.TL.fps);
const frames = mode === 'stills' ? a.split(',').map(s => Math.round(parseFloat(s) * fps)) : Array.from({ length: +b - +a }, (_, i) => +a + i);
const outDir = mode === 'stills' ? b : c;
fs.mkdirSync(outDir, { recursive: true });
for (const f of frames) {
  await page.evaluate(f => window.renderFrame(f), f);
  await page.screenshot({ path: path.join(outDir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 });
}
await browser.close();
