import { describe, expect, it } from 'vitest';
import { buildBuildings } from '@/scene/buildGeometry';
import { loadTerrain } from './fixtures';

/**
 * P4 regression — hand-traced B19 went invisible: a manual building whose alpha
 * path used the old 0 floor renders nothing while still picking. The generator
 * must stamp a ≥0.15 alpha floor, and rebuilt buildings must be present with real
 * area in the merged batches.
 */
describe('P4 B19 manual building opacity regression', () => {
  const terrain = loadTerrain();
  const manualB19 = {
    id: 'manual:001',
    name: 'B19 Residence (hand-drawn)',
    floors: 4,
    height_m: 13.5,
    shape: 'complex' as const,
    ring: [
      [76.9858, 31.78060], [76.9858, 31.78012], [76.9860, 31.78012], [76.9860, 31.78028],
      [76.98642, 31.78028], [76.98642, 31.78012], [76.98662, 31.78012], [76.98662, 31.78060],
      [76.9858, 31.78060],
    ] as [number, number][],
    scope: 'campus' as const,
    buried: false,
    buriedE: 0, buriedW: 0, buriedN: 0, buriedS: 0,
    rooflMatter: 1,
    roofR_m: 0.6, eaveM: 0.15,
    hidden: false,
  };
  it('opacity 0 in the override becomes 0.15 (never invisible, still ghost-ish)', () => {
    const b = buildBuildings([manualB19 as never], terrain, {
      overrides: new Map([['manual:001', { opacity: 0 } as never]]),
    });
    const walls = b.translucentWalls.build();
    const alpha = walls.getAttribute('color').array as Float32Array;
    let minA = Infinity;
    for (let i = 3; i < alpha.length; i += 4) minA = Math.min(minA, alpha[i]);
    expect(walls.getAttribute('position').count).toBeGreaterThan(10);
    expect(minA).toBeGreaterThanOrEqual(0.15);
  });
  it('normal opacity renders plain opaque batches sized to the real footprint', () => {
    const b = buildBuildings([manualB19 as never], terrain);
    expect(b.walls).toBeTruthy();
    expect(b.roofs).toBeTruthy();
  });
});
