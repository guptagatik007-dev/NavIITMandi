import { describe, expect, it } from 'vitest';
import { buildBuildings } from '@/scene/buildGeometry';
import { loadBuildings, loadTerrain } from './fixtures';

/**
 * v3.2 "some buildings don't occur as 3D structures": every visible campus
 * footprint MUST produce triangles. This suite detects silent zero-geometry
 * buildings instead of guessing at geometry-code changes.
 */
describe('3D completeness audit', () => {
  it('no visible campus building yields zero wall/roof triangles', () => {
    const terrain = loadTerrain();
    const all = loadBuildings().filter((b) => b.scope === 'campus' && !b.hidden);
    // generate in chunks so one bad geometry can't mask others; count per-building output
    const zero: string[] = [];
    for (const b of all) {
      const batch = buildBuildings([b as never], terrain);
      const walls = batch.walls.build();
      const roofs = batch.roofs.build();
      const tW = walls.getAttribute('position')?.count ?? 0;
      const tR = roofs.getAttribute('position')?.count ?? 0;
      if (tW + tR === 0) zero.push(b.id);
    }
    expect(zero, `zero-geometry campus buildings: ${zero.join(', ')}`).toHaveLength(0);
  });
});
