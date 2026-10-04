// tools/shots.mjs — browser-level render observation for the campus map.
//
// The master prompt (v1.1 §17, §18) requires that the map actually opens, orbits,
// zooms and pans — which HTTP/module smoke tests cannot show. This launches a real
// Chromium with WebGL (SwiftShader), drives real pointer and keyboard input, and
// measures the camera before/after each gesture so every claim is a number, not an
// impression. Screenshots land in the output directory for visual inspection.
//
//   node tools/shots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const OUT = process.argv[3] ?? '/home/user/shots';
await mkdir(OUT, { recursive: true });

const log = [];
const record = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  log.push(line);
  console.log(line);
};
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  record(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
};

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => consoleErrors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name, note) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  record(`shot ${name}.png  ${note ?? ''}`);
};
const settle = (ms = 1800) => page.waitForTimeout(ms);
const cam = () => page.evaluate(() => window.__camDebug?.() ?? null);
/** count overlapping label rectangles among *visible* labels */
const labelOverlaps = () =>
  page.evaluate(() => {
    const vis = [...document.querySelectorAll('.poi-marker-label, .poi-label')]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    let n = 0;
    for (let i = 0; i < vis.length; i++) {
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i];
        const c = vis[j];
        if (a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top) n++;
      }
    }
    return { visible: vis.length, overlaps: n };
  });
/** how many distinct colours are in the map viewport — a blank canvas has almost none */
const viewportVariety = async (clip) => {
  const buf = await page.screenshot({ clip });
  return buf.length;
};

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const ctx = c.getContext('webgl2') || c.getContext('webgl');
  if (!ctx) return { ok: false };
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
  return { ok: true, renderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown' };
});
record('webgl:', gl);
check('webgl context available', gl.ok === true, gl.renderer ?? '');
await settle(6000);
const defaultCam = await cam();
await shot('01-initial', 'default 3D view on load (tour card must NOT dim or block the map)');

const l3d = await labelOverlaps();
check('3D labels do not overlap', l3d.overlaps === 0, `${l3d.visible} labels, ${l3d.overlaps} overlapping pairs`);

// ---------- the tour must not block the map (the "zoom and movement not working" defect)
const tourBlocking = await page.evaluate(() => {
  const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return el ? el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') : null;
});
check('map centre is the top-most element (tour is non-blocking)', tourBlocking === 'CANVAS', `elementFromPoint -> ${tourBlocking}`);

// ---------- ZOOM
let a = await cam();
await page.mouse.move(720, 450);
await page.mouse.wheel(0, -1200);
await settle(1500);
let b = await cam();
await shot('02-after-zoom-in', 'after wheel zoom in');
check('wheel zoom changes camera distance', !!a && !!b && Math.abs(a.distance - b.distance) > 5, `distance ${a?.distance} -> ${b?.distance}`);

await page.mouse.wheel(0, 1800);
await settle(1500);
let c2 = await cam();
check('wheel zoom out changes camera distance', !!b && !!c2 && Math.abs(b.distance - c2.distance) > 5, `distance ${b?.distance} -> ${c2?.distance}`);

// ---------- ORBIT
const beforeOrbit = await cam();
await page.mouse.move(720, 450);
await page.mouse.down();
for (let i = 0; i < 14; i++) await page.mouse.move(720 + i * 20, 450 + i * 3);
await page.mouse.up();
await settle(1500);
const afterOrbit = await cam();
await shot('03-after-drag-orbit', 'after left-drag orbit');
const orbitMoved = beforeOrbit && afterOrbit && beforeOrbit.camera.join() !== afterOrbit.camera.join();
check('left-drag orbits the camera', !!orbitMoved, `camera ${beforeOrbit?.camera} -> ${afterOrbit?.camera}`);

// ---------- PAN
const beforePan = await cam();
await page.mouse.move(720, 450);
await page.mouse.down({ button: 'right' });
for (let i = 0; i < 12; i++) await page.mouse.move(720 - i * 16, 450 - i * 5);
await page.mouse.up({ button: 'right' });
await settle(1500);
const afterPan = await cam();
await shot('04-after-pan', 'after right-drag pan');
check('right-drag pans the target', !!beforePan && !!afterPan && beforePan.target.join() !== afterPan.target.join(), `target ${beforePan?.target} -> ${afterPan?.target}`);

// ---------- KEYBOARD (spec §10.5 — pointer-only interaction is a bug)
const beforeKey = await cam();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Equal');
await settle(1200);
const afterKey = await cam();
await shot('05-keyboard-controls', 'after arrow keys + zoom key');
check('keyboard moves the camera', !!beforeKey && !!afterKey && JSON.stringify(beforeKey) !== JSON.stringify(afterKey), `${beforeKey?.target} -> ${afterKey?.target}`);

// a user dismisses the tour with Skip (or by simply touching the map)
await page.locator('button:has-text("Skip")').first().click({ timeout: 4000 }).catch(() => {});
await settle(1200);

// ---------- rail panels must actually open, with their own content on screen
const railText = () => page.evaluate(() => (document.querySelector('.rail')?.textContent ?? '').trim());
for (const [label, file, signature] of [
  ['Explore', 'panel-explore', 'What is on campus'],
  ['Layers', 'panel-layers', 'Terrain'],
  ['Route', 'panel-route', 'Plan a walk'],
  ['About', 'panel-about', 'accuracy'],
]) {
  const btn = page.locator(`button[title="${label}"]`).first();
  if (!(await btn.count())) {
    check(`panel "${label}" reachable`, false, 'no button[title]');
    continue;
  }
  // tabs toggle, so click once and once more if the panel did not come up
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await railText()).includes(signature)) break;
    await btn.click({ timeout: 5000 }).catch(() => {});
    await settle(1400);
  }
  await shot(file, `rail panel: ${label}`);
  const txt = await railText();
  check(`panel "${label}" opens with its content`, txt.includes(signature), `rail text: ${txt.slice(0, 60).replace(/\s+/g, ' ')}`);
}

// ---------- indoor shell (spec §2.5 — ships empty, but must be wired and honest)
const indoorBtn = page.locator('button[title*="Indoor" i]').first();
if (await indoorBtn.count()) {
  await indoorBtn.click({ timeout: 5000 }).catch(() => {});
  await settle(2500);
  await shot('panel-indoor', 'indoor shell (must state that no indoor data exists yet)');
  const indoorTxt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const honest = /not started|coming soon|no indoor|empty|not yet/i.test(indoorTxt);
  check('indoor shell is wired and states its empty status', honest, indoorTxt.slice(0, 90));
  await page.locator('button[title*="3D" i]').first().click().catch(() => {});
  await settle(2500);
}

// ---------- 2D map view (spec §8 — 2D/3D parity)
const map2d = page.locator('button[title*="plan" i], button[title*="satellite" i]').first();
if (await map2d.count()) {
  await map2d.click({ timeout: 5000 }).catch(() => {});
  // MapLibre inside a software rasteriser needs real time to paint its first frame.
  await page.waitForFunction(() => window.__map2d?.loaded?.() === true, { timeout: 30000 }).catch(() => {});
  await settle(6000);
  await shot('06-2d-map', '2D map view');
  const info = await page.evaluate(() => {
    const m = window.__map2d;
    const canvas = document.querySelector('canvas');
    return {
      loaded: m?.loaded?.() ?? null,
      pitch: m?.getPitch?.() ?? null,
      zoom: m?.getZoom?.() ?? null,
      layers: m ? m.getStyle().layers.length : 0,
      w: canvas?.width ?? 0,
      h: canvas?.height ?? 0,
    };
  });
  check('2D map style + layers load', info.loaded === true && info.layers >= 8, JSON.stringify(info));
  check('2D map is a plan view (pitch 0)', info.pitch === 0, `pitch ${info.pitch}, zoom ${info.zoom}`);

  // a blank canvas compresses to almost nothing; real imagery does not
  const bytes = await viewportVariety({ x: 40, y: 120, width: 700, height: 560 });
  check('2D map viewport actually drew imagery (not blank)', bytes > 20000, `screenshot region ${bytes} bytes`);

  const l2d = await labelOverlaps();
  check('2D labels do not overlap', l2d.overlaps === 0, `${l2d.visible} labels, ${l2d.overlaps} overlapping pairs`);
}

// ---------- deep links
await page.goto(BASE + '/?b=A1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(8000);
const focusCam = await cam();
await shot('07-deep-link-b-A1', 'deep link ?b=A1 must fly to that building');
check(
  '?b=<name> flies to the building',
  !!focusCam && !!defaultCam && focusCam.target.join() !== defaultCam.target.join(),
  `default target ${defaultCam?.target} -> focus target ${focusCam?.target}`,
);

await page.goto(BASE + '/?print=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(4000);
await shot('08-print-sheet', 'deep link ?print=1');
const printText = await page.evaluate(() => document.body.innerText.slice(0, 200));
check('?print=1 renders the print sheet', printText.length > 20, printText.replace(/\s+/g, ' ').slice(0, 80));

await page.goto(BASE + '/?edit=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(6000);
await shot('09-edit-mode', 'deep link ?edit=1');
check('?edit=1 exposes the Edit tab', (await page.locator('button[title="Edit"]').count()) > 0, '');

// ---------- responsive: phone viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(6000);
await shot('10-phone-390', 'phone viewport 390x844');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 390px', overflow <= 1, `overflow ${overflow}px`);

// ---------- summary
record('');
record('=== interaction + UI summary ===');
for (const r of results) record(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
record(`console errors/warnings: ${consoleErrors.length}`);
for (const c of consoleErrors.slice(0, 30)) record('  ' + c);

await writeFile(
  `${OUT}/report.md`,
  `# browser observation report\n\n` +
    `webgl: \`${gl.renderer}\`\n\n` +
    results.map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} — **${r.name}** ${r.detail ? `\n  - \`${r.detail}\`` : ''}`).join('\n') +
    `\n\n## console output (${consoleErrors.length})\n\n` +
    (consoleErrors.length ? '```\n' + consoleErrors.slice(0, 60).join('\n') + '\n```\n' : '_none_ — no errors, no warnings\n'),
);
record('wrote report.md');

await browser.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
