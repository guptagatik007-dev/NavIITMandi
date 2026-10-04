/* Visual smoke for v2.2: (1) per-building opacity now honoured (translucent 0.25 vs
 * solid), (2) roads-only switch hides everything but the network, (3) alternates render
 * requires a real route — covered by unit tests. Any console error fails. */
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
await new Promise((r) => server.listen(4198, r));

const errors = [];
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });

// ── (1) very translucent override on a named building ──
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('opacity: ' + m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  // a real campus building id baked into the data (Library block) → 0.25 opacity
  localStorage.setItem('iitm-nav-edits-v1', JSON.stringify({ saved: { 'osm-761451773': { opacity: 0.25 }, 'osm-762330814': { opacity: 0.4 } }, addedBuildings: [], addedLabels: [], roadEdits: {}, addedRoads: [] }));
});
await page.goto('http://localhost:4198/?mode=3d&lat=31.78035&lng=76.99646&zoom=17.6&pitch=55', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(9000);
// dismiss the welcome tour overlay so the model is unobstructed
const skip = page.getByRole('button', { name: /Skip|Close|Got it/i }).first();
if (await skip.count()) { await skip.click(); await page.waitForTimeout(600); }
await page.screenshot({ path: '/home/user/shots/v22-opacity.png' });
await page.close();

// ── (2) roads-only preset ──
page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('roadsonly: ' + m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4198/?mode=3d&lat=31.7773&lng=76.9908&zoom=16.2&pitch=52', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(9000);
const skip2 = page.getByRole('button', { name: /Skip|Close|Got it/i }).first();
if (await skip2.count()) { await skip2.click(); await page.waitForTimeout(500); }
const layersTab = page.getByRole('button', { name: /Layers/i }).first();
if (await layersTab.count()) { await layersTab.click(); await page.waitForTimeout(900); }
// click the roads-only toggle via its label
const t = page.getByText('Show ONLY the road network').first();
if (await t.count()) {
  await t.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/home/user/shots/v22-roadsonly-3d.png' });
} else errors.push('roads-only toggle not found (Layers tab may need opening)');
await page.close();

// ── (3) roads-only in 2D Map view ──
page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('2d: ' + m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4198/?mode=map&lat=31.7773&lng=76.9908&zoom=16', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(9000);
const skip3 = page.getByRole('button', { name: /Skip|Close|Got it/i }).first();
if (await skip3.count()) { await skip3.click(); await page.waitForTimeout(400); }
const layersTab3 = page.getByRole('button', { name: /Layers/i }).first();
if (await layersTab3.count()) { await layersTab3.click(); await page.waitForTimeout(800); }
const t3 = page.getByText('Show ONLY the road network').first();
if (await t3.count()) {
  await t3.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/user/shots/v22-roadsonly-2d.png' });
} else errors.push('roads-only toggle not found in 2D either');
await page.close();

console.log(JSON.stringify({ errors: errors.slice(0, 10), count: errors.length }, null, 2));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
