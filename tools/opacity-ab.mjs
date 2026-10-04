import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { createHash } from 'crypto';

const DIST = new URL('/home/user/dist', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    const file = join(DIST, path);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(4197, r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });

const grab = async (withOverrides, path) => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  if (withOverrides) {
    await page.addInitScript(() => {
      localStorage.setItem('iitm-nav-edits-v1', JSON.stringify({ saved: { 'osm-761451773': { opacity: 0.25 }, 'osm-762330814': { opacity: 0.4 } }, addedBuildings: [], addedLabels: [], roadEdits: {}, addedRoads: [] }));
    });
  }
  await page.goto('http://localhost:4197/?mode=3d&lat=31.78035&lng=76.99646&zoom=17.6&pitch=55', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(9000);
  const skip = page.getByRole('button', { name: /Skip/i }).first();
  if (await skip.count()) { await skip.click(); await page.waitForTimeout(400); }
  const buf = await page.screenshot({ path });
  await page.close();
  return createHash('md5').update(buf).digest('hex');
};
const a = await grab(false, '/home/user/shots/ab-off.png');
const b = await grab(true, '/home/user/shots/ab-on.png');
console.log(JSON.stringify({ hashSolid: a, hashOpacity25: b, differs: a !== b }));
await browser.close(); server.close(); process.exit(0);
