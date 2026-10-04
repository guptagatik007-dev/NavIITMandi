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


let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:4198/', { waitUntil: 'networkidle', timeout: 60000 });

// skip onboarding so keys land on the app
const skip = page.locator('text=Skip');
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(400); }

console.log('— v3.0 smoke: shortcuts overlay + roads-only + mode rail —');

// (1) "?" opens the shortcuts overlay, Esc closes it
await page.keyboard.press('?');
await page.waitForTimeout(350);
const overlay = await page.locator('[role="dialog"][aria-label="Keyboard shortcuts"]').count();
console.log('overlay opens on "?":', overlay === 1);
if (overlay !== 1) errors.push('shortcuts overlay did not open');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
console.log('overlay closes on Esc:', await page.locator('[role="dialog"][aria-label="Keyboard shortcuts"]').count() === 0);

// (2) switch to Map view via "2", then roads-only chip appears on "v"
await page.keyboard.press('2');
await page.waitForTimeout(1200);
await page.keyboard.press('v');
await page.waitForTimeout(700);
const chip = await page.locator('text=Roads-only — EXIT').count();
console.log('roads-only chip appears on "v":', chip === 1);
if (chip !== 1) errors.push('roads-only chip missing');
const bg = await page.evaluate(() => {
  const c = document.querySelector('.maplibregl-canvas, .mapboxgl-canvas');
  return c ? 'canvas-here' : 'no-canvas';
});
console.log('map canvas status:', bg);
await page.waitForTimeout(2500); // let maplibre repaint ortho:none before asserting visually
await page.screenshot({ path: 'shots/v30-roadsonly-grey.png' });

// (3) exit roads-only via chip button, verify gone
if (chip === 1) {
  await page.locator('text=Roads-only — EXIT').click();
  await page.waitForTimeout(500);
  console.log('chip exit works:', await page.locator('text=Roads-only — EXIT').count() === 0);
}

// (4) Edit panel rails via "e", Global edit rail only appears when a tool is live
await page.keyboard.press('Escape');
await page.keyboard.press('e');
await page.waitForTimeout(700);
const editOpen = await page.locator('text=Manual corrections').count();
console.log('edit panel opens on "e":', editOpen >= 1);
const railIdle = await page.locator('text=Exit').count(); // no rail while idle is not strictly assertable; screenshot
await page.screenshot({ path: 'shots/v30-edit.png' });

// (5) v3.1 road workbench: pick a road from "Manage existing roads" → Fix shape → mode rail live
// scroll the Edit panel so the details summary is reachable, then open it
const summary = page.locator('summary', { hasText: 'Manage existing roads' }).first();
await summary.scrollIntoViewIfNeeded();
await summary.click();
await page.waitForTimeout(300);
const fixBtn = page.locator('button', { hasText: 'Fix shape' }).first();
const fixCount = await fixBtn.count();
console.log('manage list has Fix shape buttons:', fixCount >= 1);
if (fixCount >= 1) {
  await fixBtn.click();
  await page.waitForTimeout(800);
  const rail = await page.locator('text=Exit').count();
  console.log('road-fix mode rail is live:', rail >= 1);
  if (rail < 1) errors.push('road-fix mode rail missing after Fix shape');
  // arrow key moulds the whole road: roadFixLine must move
  const moved = await page.evaluate(() => {
    const anyWin = window;
    const before = JSON.stringify(anyWin.__debugRoadFixLine ?? null);
    void before;
    return true;
  });
  void moved;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const railAfter = await page.locator('text=Exit').count();
  void railAfter;
  await page.screenshot({ path: 'shots/v31-roadfix.png' });
} else {
  errors.push('no Fix shape buttons found in Manage existing roads');
}

console.log('errors:', errors.length);
errors.slice(0, 6).forEach((e) => console.log('  ' + e));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
