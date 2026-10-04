import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
const DIST = '/home/user/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]; const f = join(DIST, p); const d = await readFile(f); res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(4200, r));
const b = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await b.newPage({ viewport: { width: 1200, height: 760 } });
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle', timeout: 60000 });
const skip = page.locator('text=Skip');
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(300); }
await page.keyboard.press('2');
await page.waitForFunction(() => window.__map2d, null, { timeout: 30000 });
await page.evaluate(([lng, lat]) => window.__map2d.jumpTo({ center: [lng, lat], zoom: 17.2 }), [76.994084, 31.781059]);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/v33-auditorium.png' });
// academic block view
await page.evaluate(() => window.__map2d.jumpTo({ center: [76.996464, 31.780346], zoom: 16.8 }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/v33-academic.png' });
await b.close(); server.close(); process.exit(0);
