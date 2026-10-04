/* Visual smoke test for the v1.9 build: boots the production bundle headless,
 * opens Outdoor (3D), switches to Map (2D), arms edit mode, and screenshots both.
 * Any console error fails the run. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const DIST = new URL('../dist', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    const file = join(DIST, path);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((r) => server.listen(4199, r));

const errors = [];
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4199/?edit=1', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(9000); // scene build + idle graph build
await page.screenshot({ path: '/home/user/shots/v19-3d.png' });

// switch to Map (2D) view
const mapButton = page.getByRole('button', { name: /^Map$/i }).first();
if (await mapButton.count()) {
  await mapButton.click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: '/home/user/shots/v19-2d.png' });
} else {
  errors.push('Map view button not found');
}

// open the Edit rail tab
const editTab = page.getByRole('button', { name: /^Edit$/i }).first();
if (await editTab.count()) {
  await editTab.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/home/user/shots/v19-edit.png' });
}

console.log(JSON.stringify({ errors: errors.slice(0, 10), count: errors.length }, null, 2));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
