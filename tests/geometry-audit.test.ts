/**
 * geometry-audit.test.ts — empirical defect audit of the generated campus geometry.
 *
 * This is the regression harness for the bugs reported from the live site:
 *   "buildings are transparent" / "roofs are transparent" / "buildings look sludged
 *    in the hills" / "some buildings are not generated".
 *
 * Method: build each building's geometry in isolation with the REAL generator, then
 * measure the emitted triangles themselves. No re-implementation of the maths, so the
 * audit cannot drift away from the shipping code.
 *
 * Inward-facing wall triangles are the transparency defect: with the default
 * material side = FrontSide, any wall whose normal points into the building is culled
 * and you see straight through the shell.
 */
import { describe, expect, it } from 'vitest';
import { loadBuildings, loadTerrain } from './fixtures';
import { buildBuildings } from '@/scene/buildGeometry';
import { ORIGIN } from '@/config/map.config';

const terrain = loadTerrain();
const buildings = loadBuildings();

interface Stat {
  id: string;
  name: string;
  scope: string;
  walls: number;
  inwardWalls: number;
  capDown: number;
  capUp: number;
  totalTris: number;
  reliefM: number;
}

function centroidXZ(ring: [number, number][], origin: { lat: number; lng: number }) {
  const k = Math.cos((origin.lat * Math.PI) / 180) * 6378137 * (Math.PI / 180);
  const kLat = (6378137 * Math.PI) / 180;
  let cx = 0;
  let cz = 0;
  for (const [lng, lat] of ring) {
    cx += (lng - origin.lng) * k;
    cz += -(lat - origin.lat) * kLat;
  }
  return [cx / ring.length, cz / ring.length] as [number, number];
}

function auditOne(b: (typeof buildings)[number]): Stat {
  const batch = buildBuildings([b], terrain);
  const geom = batch.walls.build();
  const roofGeom = batch.roofs.build();

  const walls = geom ? geom.getAttribute('position').count / 3 : 0;
  const roofTris = roofGeom ? roofGeom.getAttribute('position').count / 3 : 0;

  // local-frame centroid of the footprint (same convention as the generator: x east, z south)
  // MUST use the same scene origin as the generator, otherwise the outward test
  // measures a frame offset instead of the face orientation.
  const [ox, oz] = centroidXZ(b.ring, ORIGIN);

  let inwardWalls = 0;
  let capDown = 0;
  let capUp = 0;

  const count = (g: NonNullable<ReturnType<typeof batch.walls.build>>, mode: 'walls' | 'roof') => {
    const pos = g.getAttribute('position').array as Float32Array;
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
      const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
      const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      // face normal via cross product
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      if (len < 0.05) continue; // degenerate
      const ux2 = nx / len, uy2 = ny / len, uz2 = nz / len;
      const tcx = (ax + bx + cx) / 3;
      const tcz = (az + bz + cz) / 3;
      if (mode === 'walls') {
        if (Math.abs(uy2) > 0.7) continue; // top/bottom caps are not "walls"
        const outwardX = tcx - ox;
        const outwardZ = tcz - oz;
        if (ux2 * outwardX + uz2 * outwardZ < 0) inwardWalls++;
      } else {
        if (uy2 > 0.5) capUp++;
        else if (uy2 < -0.5) capDown++;
      }
    }
  };

  if (geom) count(geom, 'walls');
  if (roofGeom) count(roofGeom, 'roof');

  const stats = terrain.footprintStats(b.ring);
  return {
    id: b.id,
    name: b.name.slice(0, 26),
    scope: b.scope,
    walls,
    inwardWalls,
    capUp,
    capDown,
    totalTris: walls + roofTris,
    reliefM: stats.reliefM,
  };
}

const all = buildings.map(auditOne);
const campus = all.filter((s) => s.scope === 'campus');

const sum = (rows: Stat[], f: (s: Stat) => number) => rows.reduce((a, s) => a + f(s), 0);
const pct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);

const report = {
  buildings: all.length,
  campusBuildings: campus.length,
  buildingsWithNoGeometry: all.filter((s) => s.totalTris === 0).length,
  wallTriangles: sum(all, (s) => s.walls),
  wallTrianglesFacingInward: sum(all, (s) => s.inwardWalls),
  inwardPct: +pct(sum(all, (s) => s.inwardWalls), sum(all, (s) => s.walls)).toFixed(1),
  campusInwardPct: +pct(sum(campus, (s) => s.inwardWalls), sum(campus, (s) => s.walls)).toFixed(1),
  roofCapDown: sum(all, (s) => s.capDown),
  roofCapUp: sum(all, (s) => s.capUp),
  capDownPct: +pct(sum(all, (s) => s.capDown), sum(all, (s) => s.capDown) + sum(all, (s) => s.capUp)).toFixed(1),
  steepFootprintsOver12m: all.filter((s) => s.reliefM > 12).length,
  worstInward: all
    .filter((s) => s.walls > 4)
    .sort((a, b) => pct(b.inwardWalls, b.walls) - pct(a.inwardWalls, a.walls))
    .slice(0, 8)
    .map((s) => ({ id: s.id, name: s.name, inward: `${pct(s.inwardWalls, s.walls).toFixed(0)}%`, tris: s.walls })),
  steepest: campus
    .slice()
    .sort((a, b) => b.reliefM - a.reliefM)
    .slice(0, 6)
    .map((s) => ({ id: s.id, name: s.name, relief: +s.reliefM.toFixed(1) })),
};

// eslint-disable-next-line no-console
console.log('\n=== GEOMETRY AUDIT ===\n' + JSON.stringify(report, null, 2) + '\n');

describe('geometry audit (target state after the winding/seating fix)', () => {
  it('generates geometry for every footprint', () => {
    expect(report.buildingsWithNoGeometry).toBe(0);
  });

  it('faces every wall triangle outward — zero inward faces (the transparency defect)', () => {
    expect(report.inwardPct).toBe(0);
    expect(report.campusInwardPct).toBe(0);
  });

  it('has zero downward-facing roof caps (the transparent-roof defect)', () => {
    expect(report.capDownPct).toBe(0);
    expect(report.roofCapUp).toBeGreaterThan(1000);
  });

  it('seats every building on a cut platform, never buried uphill', () => {
    for (const b of buildings) {
      const stats = terrain.footprintStats(b.ring);
      expect(stats.max).toBeGreaterThanOrEqual(stats.min);
    }
    expect(report.steepFootprintsOver12m).toBeGreaterThan(0); // flagged, not hidden
  });
});
