// Usage: node test/snap.mjs <page.html> <out.jpg> [arg]
// Loads the page, awaits window.ready, calls window.draw(arg), screenshots the 1920x1080 viewport.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'path';
const [,, page, out, arg] = process.argv;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('console.' + m.type() + ' ' + m.text()); });
await pg.goto('file://' + path.resolve(page));
await pg.evaluate(() => window.ready);
await pg.evaluate(a => window.draw(a), arg ?? null);
await pg.screenshot({ path: out, type: 'jpeg', quality: 92 });
if (errs.length) console.log(errs.join('\n')); else console.log('ok', out);
await browser.close();
