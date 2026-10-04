// tools/probe-capabilities.mjs — end-to-end observation of the two capabilities the spec
// demands and that unit tests cannot prove: turn-by-turn navigation, and the manual
// building / manual label system round-tripping through the UI.
//
//   node tools/probe-capabilities.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push('[console] ' + m.text());
});

const settle = (ms = 1500) => page.waitForTimeout(ms);
const dismissTour = () => page.locator('button:has-text("Skip")').first().click({ timeout: 4000 }).catch(() => {});

// ─────────────────────────────────────────────────────────── 1. NAVIGATION
console.log('\n── navigation ──');
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(9000);
await dismissTour();
await settle(1200);

// open the Route panel
await page.locator('button[title="Route"]').first().click();
await settle(1500);

// pick a start and a destination through the real <select> controls
const fromSel = page.locator('select[aria-label="Start point"]');
const toSel = page.locator('select[aria-label="Destination"]');
check('route panel exposes start + destination selectors', (await fromSel.count()) === 1 && (await toSel.count()) === 1, '');

if ((await fromSel.count()) && (await toSel.count())) {
  const opts = await toSel.evaluate((el) =>
    [...el.options].map((o) => ({ value: o.value, label: o.textContent ?? '' })).filter((o) => o.value && o.value !== '__loc'),
  );
  check('destination list is populated with campus buildings', opts.length > 100, `${opts.length} destinations`);

  const startId = opts[0].value;
  const destId = opts[Math.min(3, opts.length - 1)].value;
  await fromSel.selectOption(startId);
  await settle(1500);
  await toSel.selectOption(destId);
  await settle(3000);

  const route = await page.evaluate(() => {
    const m = window.__map2d;
    const rail = [...document.querySelectorAll('.rail *')];
    const txt = rail.map((e) => e.children.length === 0 ? e.textContent : '').join(' ');
    const line = m?.getLayer('route-line');
    return {
      state: window.__routeDebug ? window.__routeDebug() : null,
      distance: /(\d+(\.\d+)?\s?(km|m))/i.test(txt),
      minutes: /\d+\s?min/i.test(txt),
      steps: /Turn by turn/i.test(txt),
      layerVisible: line?.visibility !== 'none',
      sample: txt.replace(/\s+/g, ' ').slice(0, 200),
    };
  });
  console.log('   store state:', JSON.stringify(route.state));
  console.log('   rail sample:', route.sample);
  check('the routing engine resolved the request', route.state?.status === 'ready' && route.state?.ok === true, `status=${route.state?.status} ok=${route.state?.ok} reason=${route.state?.reason ?? '-'}`);
  check('a route computed a distance', route.distance, '');
  check('walking time shown', route.minutes, '');
  check('turn-by-turn section rendered', route.steps, '');
  check('the engine returned real steps', (route.state?.steps ?? 0) > 0, `${route.state?.distanceM} m, ${route.state?.seconds} s, ${route.state?.steps} steps`);

  // the route must survive switching to the 2D map and actually be drawn there
  await page.locator('button[title*="plan" i], button[title*="satellite" i]').first().click().catch(() => {});
  await page.waitForFunction(() => window.__map2d?.loaded?.() === true, { timeout: 30000 }).catch(() => {});
  await settle(5000);
  const drawn = await page.evaluate(() => {
    const m = window.__map2d;
    if (!m) return { map: false };
    const src = m.getSource('route');
    const data = src?._data ?? src?.serialize?.()?.data ?? null;
    const n = data?.features?.length ?? 0;
    const coords = data?.features?.[0]?.geometry?.coordinates?.length ?? 0;
    return { map: true, features: n, coords, visibility: m.getLayoutProperty('route-line', 'visibility') ?? 'visible' };
  });
  check('route is drawn as a line on the 2D map', drawn.map === true && drawn.features > 0 && drawn.coords > 1, JSON.stringify(drawn));
  check('route layer is visible', drawn.visibility !== 'none', `visibility ${drawn.visibility}`);
  const routePaint = await page.evaluate(() => {
    const m = window.__map2d;
    return { core: m?.getPaintProperty('route-line', 'line-color'), casing: m?.getPaintProperty('route-casing', 'line-color') };
  });
  check('navigation path is red in the 2D view', routePaint.core === '#ff304f' && routePaint.casing === '#650d12', JSON.stringify(routePaint));
  await page.screenshot({ path: '/home/user/shots/route-2d.png' });

  // and back to 3D, where the same route must still be summarised
  await page.locator('button[title="Outdoor 3D campus scene"]').first().click().catch(() => {});
  await settle(5000);
  const in3d = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll('.rail *')].filter((e) => e.children.length === 0).map((e) => e.textContent).join(' ');
    return { text: leaves.replace(/\s+/g, ' '), state: window.__routeDebug ? window.__routeDebug() : null };
  });
  check('the same route survives the switch to 3D', /(\d+(\.\d+)?\s?(km|m))/i.test(in3d.text), `${in3d.state?.distanceM} m · ${in3d.text.slice(0, 100)}`);
  await page.screenshot({ path: '/home/user/shots/route-3d.png' });
}

// ─────────────────────────────────────────────── 2. MANUAL BUILDING SYSTEM
console.log('\n── manual building + labels ──');
await page.goto(BASE + '/?edit=1&mode=map', { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(10000);
await dismissTour();
await settle(1500);

check('Edit tab appears under ?edit=1', (await page.locator('button[title="Edit"]').count()) > 0, '');
await page.locator('button[title="Edit"]').first().click();
await settle(1500);

// start tracing and drop four vertices on the 2D canvas
const traceStart = page.locator('button:has-text("Trace a footprint")').first();
check('the editor offers "Trace a footprint"', (await traceStart.count()) > 0, '');
if (await traceStart.count()) {
  await traceStart.click();
}
// the button also switches to the 2D map, so wait for that view to be ready
await page.waitForFunction(() => window.__map2d?.loaded?.() === true, { timeout: 30000 }).catch(() => {});
await settle(3000);
const tracingNow = await page.evaluate(() => (document.querySelector('.rail')?.textContent ?? '').includes('Undo point'));
check('tracing mode is active (Undo point offered)', tracingNow, '');

const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();
if (box) {
  const cx = box.x + box.width * 0.45;
  const cy = box.y + box.height * 0.5;
  const pts = [
    [cx, cy],
    [cx + 90, cy + 10],
    [cx + 80, cy + 70],
    [cx - 10, cy + 60],
  ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await settle(600);
  }
}
await settle(1200);
const traced = await page.evaluate(() => ({
  text: [...document.querySelectorAll('.rail *')].filter((e) => e.children.length === 0).map((e) => e.textContent).join(' ').replace(/\s+/g, ' '),
}));
check('tracing captured vertices from real clicks', /\d+\s*(vert|point)/i.test(traced.text), traced.text.match(/\d+\s*(vert(ices)?|points?)/i)?.[0] ?? traced.text.slice(0, 90));

// fill the tracing form and save
// the flow is: place corners -> "Close shape" -> name it -> "Save footprint"
const closeBtn = page.locator('button:has-text("Close shape")').first();
check('"Close shape" is offered once 3+ corners exist', (await closeBtn.count()) > 0, '');
if (await closeBtn.count()) {
  await closeBtn.click();
  await settle(1000);
}
const nameInput = page.locator('input[aria-label="New building name"]').first();
check('name field present', (await nameInput.count()) > 0, '');
if (await nameInput.count()) {
  await nameInput.fill('Probe Test Block');
  await settle(400);
  const save = page.locator('button:has-text("Save footprint")').first();
  check('save button present', (await save.count()) > 0, '');
  if (await save.count()) {
    await save.click();
    await settle(2500);
  }
}
const afterSave = await page.evaluate(() => {
  const ls = localStorage.getItem('iitm-nav-edits-v1');
  const parsed = ls ? JSON.parse(ls) : null;
  const rail = (document.querySelector('.rail')?.textContent ?? '').replace(/\s+/g, ' ');
  const first = parsed?.addedBuildings?.[0];
  return {
    persisted: parsed ? (parsed.addedBuildings?.length ?? 0) : 0,
    addedName: first?.properties?.name ?? null,
    ringLen: first?.ring?.length ?? 0,
    railMentionsName: /Probe Test Block/.test(rail),
    exportEnabled: !document.querySelector('button:disabled')?.textContent?.includes('buildings.geojson'),
  };
});
check('drawn building saved to the session', afterSave.persisted > 0, `${afterSave.persisted} added`);
check('drawn building becomes a real feature (has a name + ring)', afterSave.addedName === 'Probe Test Block' && afterSave.ringLen >= 4, JSON.stringify({ name: afterSave.addedName, ringLen: afterSave.ringLen }));
check('drawn building listed in the editor', afterSave.railMentionsName, '');

// the drawn building must become a real, searchable, rendered feature
await page.screenshot({ path: '/home/user/shots/edit-drawn.png' });
await page.goto(BASE + '/?edit=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(9000);
const survives = await page.evaluate(() => {
  const ls = localStorage.getItem('iitm-nav-edits-v1');
  return ls ? JSON.parse(ls).addedBuildings?.length ?? 0 : 0;
});
check('the correction survives a reload (localStorage)', survives > 0, `${survives} added`);

// export produces parseable files
await page.locator('button[title="Edit"]').first().click().catch(() => {});
await settle(1500);
const exportState = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.rail button')].map((b) => (b.textContent ?? '').trim());
  return labels.filter((t) => /download|copy/i.test(t));
});
check('export controls are offered for the corrections', exportState.length > 0, exportState.slice(0, 4).join(' | '));

// ─────────────────────────────────────────────────────────────── summary
console.log('\n=== capability summary ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`console errors: ${consoleErrors.length}`);
for (const c of consoleErrors.slice(0, 10)) console.log('  ' + c);

await browser.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
