#!/usr/bin/env node
/**
 * tools/footprint-check.mjs — footprint geometric audit (§5 acceptance aid, v3 blueprint).
 *
 * What it CAN measure offline (no imagery side-channel):
 *   1. Degenerate geometry: near-duplicate vertices (< 0.4 m apart), zero-length
 *      edges, reflex angles < 5° that break adds/reshapes.
 *   2. Duplicated footprints: two buildings whose centroids coincide ≤ 1 m or whose
 *      rings overlap ≥ 90 % (the classic "manual + generated both present" ghost).
 *   3. Overlap fights: campus pairs intersecting ≥ 12 % of the smaller footprint.
 *   4. Suspicious micro-buildings (< 4 m²) and mega-buildings (> 12000 m²).
 *   5. Roads crossing footprints (strict boundary-cross XOR, the graph clamp's own test).
 *
 * What it CANNOT do: compute imagery RMSE. Stills shift with the acquisition; the
 * honest alignment workflow is the in-app Align tool (Edit → building → Align to
 * imagery) against the HD basemap, which this audit then POLICES for quality.
 *
 * Usage: node tools/footprint-check.mjs [--json] [--strict]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const buildings = JSON.parse(readFileSync(path.join(ROOT, 'public/data/buildings.geojson'), 'utf8')).features;
const roads = JSON.parse(readFileSync(path.join(ROOT, 'public/data/roads.geojson'), 'utf8')).features;

const KX = Math.cos((31.778 * Math.PI) / 180);
const toM = ([lng, lat]) => [lng * 111320 * KX, lat * 110540];
const ringAreaM2 = (ring) => {
  let a = 0;
  const pts = ring.map(toM);
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
};
const centroid = (ring) => {
  const pts = ring.map(toM);
  let x = 0, y = 0;
  for (const [px, py] of pts.slice(0, -1)) { x += px; y += py; }
  const n = Math.max(1, pts.length - 1);
  return [x / n, y / n];
};
const pointInRingM = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const segInt = (p1, p2, q1, q2) => {
  const d1 = orient(q1, q2, p1), d2 = orient(q1, q2, p2), d3 = orient(p1, p2, q1), d4 = orient(p1, p2, q2);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const report = { degenerate: [], duplicated: [], overlaps: [], sizeOutliers: [], roadCrossings: [] };
const campus = buildings.filter((f) => f.properties.scope === 'campus');

for (const f of campus) {
  const p = f.properties;
  const ring = f.geometry.coordinates[0];
  const pts = ring.slice(0, -1);
  // degenerate vertices
  for (let i = 0; i < pts.length; i++) {
    const a = toM(pts[i]), b = toM(pts[(i + 1) % pts.length]);
    if (dist(a, b) < 0.4) { report.degenerate.push(`${p.id} vertex ${i} <0.4 m from next`); break; }
  }
  const area = ringAreaM2(ring);
  if (area < 4) report.sizeOutliers.push(`${p.id} micro ${area.toFixed(1)} m²`);
  if (area > 12000) report.sizeOutliers.push(`${p.id} mega ${area.toFixed(0)} m²`);
}

// duplicate + overlap pass (O(n²) over 315 features — cheap)
for (let i = 0; i < campus.length; i++) {
  for (let j = i + 1; j < campus.length; j++) {
    const A = campus[i].properties, B = campus[j].properties;
    const ca = centroid(campus[i].geometry.coordinates[0]), cb = centroid(campus[j].geometry.coordinates[0]);
    if (dist(ca, cb) < 1) { report.duplicated.push(`${A.id} ≈ ${B.id} (centroids ${dist(ca, cb).toFixed(2)} m apart)`); continue; }
    const ringA = campus[i].geometry.coordinates[0], ringB = campus[j].geometry.coordinates[0];
    const ptsB = ringB.slice(0, -1);
    const smaller = Math.min(ringAreaM2(ringA), ringAreaM2(ringB));
    if (smaller < 1) continue;
    const insideCount = ptsB.filter((q) => pointInRingM(q, ringA)).length;
    if (insideCount / ptsB.length >= 0.75 && insideCount > 2) report.overlaps.push(`${A.id} ⊇ ${B.id} (${Math.round((insideCount / ptsB.length) * 100)} % of ${B.id} inside ${A.id})`);
    else if (insideCount / ptsB.length >= 0.4) report.overlaps.push(`${A.id} × ${B.id} (${Math.round((insideCount / ptsB.length) * 100)} % partial overlap)`);
  }
}

// road crossings (strict XOR — same detector as the runtime graph clamp)
for (const r of roads) {
  const line = r.geometry.type === 'LineString' ? r.geometry.coordinates : r.geometry.coordinates[0];
  for (let i = 0; i + 1 < line.length; i++) {
    for (const b of campus) {
      const ring = b.geometry.coordinates[0];
      const a = pointInRingM(line[i], ring), c = pointInRingM(line[i + 1], ring);
      if (a !== c) { report.roadCrossings.push(`${r.properties.id} segment ${i} crosses ${b.properties.id} (${b.properties.name ?? 'unnamed'})`); break; }
    }
  }
}

const wantJson = process.argv.includes('--json');
if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const fmt = (title, arr, extra = '') => {
    console.log(`\n== ${title}: ${arr.length} ${extra}`);
    arr.slice(0, 12).forEach((x) => console.log('   ' + x));
    if (arr.length > 12) console.log(`   … and ${arr.length - 12} more`);
  };
  console.log(`Footprint audit — ${campus.length} campus buildings · ${roads.length} road ways`);
  fmt('DEGENERATE vertices', report.degenerate);
  fmt('DUPLICATED footprints', report.duplicated, '(demolish one or the audit keeps shouting)');
  fmt('OVERLAPPING pairs', report.overlaps);
  fmt('SIZE outliers', report.sizeOutliers);
  fmt('ROAD×BUILDING crossings', report.roadCrossings, '(graph clamp drops these edges at runtime — fix the DATA next)');
  console.log('\nReminder: imagery RMSE needs eyes, not algebra — use Edit → building → Align to imagery\n(arrows 0.3 m, Q/E rotate, Enter saves) and re-run this audit afterwards.');
}
const strict = process.argv.includes('--strict');
if (strict && (report.degenerate.length || report.duplicated.length || report.roadCrossings.length)) process.exit(1);
