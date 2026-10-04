import { describe, expect, it } from 'vitest';
import { loadBuildings, loadTerrain } from './fixtures';
import { buildBuildings, buildRoads, buildTreeInstances, treeUnitGeometry } from '@/scene/buildGeometry';
import { loadRoads } from './fixtures';

const terrain = loadTerrain();
const buildings = loadBuildings();
const campus = buildings.filter((b) => b.scope === 'campus');

describe('procedural building generation', () => {
  const batch = buildBuildings(buildings, terrain);

  const geom = batch.walls.build()!;
  const positions = geom.getAttribute('position').array as Float32Array;

  it('produces real geometry for every footprint (no empty or NaN output)', () => {
    expect(batch.walls.triangles).toBeGreaterThan(1000);
    expect(batch.roofs.triangles).toBeGreaterThan(100);
    expect(batch.details.triangles).toBeGreaterThan(100);
    for (let i = 0; i < positions.length; i++) {
      if (!Number.isFinite(positions[i])) throw new Error(`non-finite vertex at index ${i}`);
    }
    expect(batch.seats.length).toBeGreaterThanOrEqual(campus.length);
  });

  it('gives detailed campus buildings windows, and never over-budgets them', () => {
    expect(batch.glass.length).toBeGreaterThan(200);
    expect(batch.reveal.length).toBe(batch.glass.length);
    // sanity: roughly a few windows per campus building, not thousands
    expect(batch.glass.length / campus.length).toBeLessThan(400);
  });

  it('seats every building on a cut platform inside the terrain envelope', () => {
    for (const s of batch.seats) {
      // the pad can never be below the highest ground under the footprint, or the
      // building would be buried uphill (the "sludged into the hill" defect)
      expect(s.padMSL, `${s.id} pad below the footprint high point`).toBeGreaterThanOrEqual(s.minMSL - 0.001);
      expect(s.padMSL).toBeLessThanOrEqual(terrain.maxM + 0.5);
      expect(s.minMSL).toBeGreaterThanOrEqual(terrain.minM - 0.5);
      expect(s.reliefM).toBeGreaterThanOrEqual(0);
      // pad - min is the visible retaining face; it must be a finite, sane number
      expect(Number.isFinite(s.retainingM)).toBe(true);
      expect(s.retainingM).toBeGreaterThanOrEqual(0);
      expect(s.retainingM).toBeLessThan(120);
    }
  });

  it('reports skipped footprints instead of dropping them silently', () => {
    // every building either produced geometry or appears in the skipped list
    const produced = new Set(batch.seats.map((s) => s.id));
    const skipped = new Set(batch.skipped.map((s) => s.id));
    for (const b of buildings) {
      expect(produced.has(b.id) || skipped.has(b.id), `${b.id} neither built nor reported`).toBe(true);
    }
    expect(batch.skipped.length).toBe(0);
  });

  it('is deterministic: identical input produces identical vertices', () => {
    const again = buildBuildings(buildings.slice(0, 25), terrain);
    const first = buildBuildings(buildings.slice(0, 25), terrain);
    const a = again.walls.build()!.getAttribute('position').array;
    const b = first.walls.build()!.getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(again.glass.length).toEqual(first.glass.length);
  });

  it('flags steep cut benches so they can be surveyed (documented honesty signal)', () => {
    const steep = batch.seats.filter((s) => s.reliefM > 12);
    // the campus is on a Himalayan slope: steep footprints must exist and be countable
    expect(steep.length).toBeGreaterThan(0);
    expect(steep.length).toBeLessThan(batch.seats.length);
  });
});

describe('roads and vegetation', () => {
  it('drapes road ribbons over the terrain with no NaN', () => {
    const mb = buildRoads(loadRoads(), terrain);
    const g = mb.build()!;
    const pos = g.getAttribute('position').array as Float32Array;
    expect(mb.triangles).toBeGreaterThan(100);
    for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
  });

  it('instances trees within the requested budget and builds valid unit geometry', () => {
    const trees = buildTreeInstances(
      Array.from({ length: 500 }, (_, i) => ({
        lat: 31.7755 + i * 1e-5,
        lon: 76.9865 + i * 1e-5,
        h: 8 + (i % 6),
        r: 1.5,
        species: i % 2 ? ('conifer' as const) : ('broadleaf' as const),
      })),
      terrain,
      100,
    );
    expect(trees.conifer.length + trees.broadleaf.length).toBeLessThanOrEqual(101);
    expect(trees.conifer.length).toBeGreaterThan(0);
    expect(treeUnitGeometry('conifer').getAttribute('position').count).toBeGreaterThan(30);
  });

  it('translucent batch carries each building\'s exact per-vertex opacity (editor slider is never "stuck")', () => {
    const b = buildings[0];
    const overrides = new Map([[b.id, { opacity: 0.2 } as import('@/data/loaders').BuildingOverride]]);
    const withTranslucent = buildBuildings([b], terrain, { overrides, detailMode: 'campus-first' });
    const geo = withTranslucent.translucentWalls.build();
    expect(geo).not.toBeNull();
    const color = geo!.getAttribute('color');
    expect(color.itemSize).toBe(4);
    const alphas = new Set<number>();
    for (let i = 0; i < color.count; i++) alphas.add(Math.round(color.getW(i) * 100) / 100);
    expect([...alphas]).toEqual([0.2]);

    // a different slider value must produce a DIFFERENT alpha — the old bug rendered both as 0.55
    const other = buildBuildings([b], terrain, { overrides: new Map([[b.id, { opacity: 0.9 } as import('@/data/loaders').BuildingOverride]]), detailMode: 'campus-first' });
    expect(other.translucentWalls.build()!.getAttribute('color').getW(0)).toBeCloseTo(0.9, 2);
  });
});
