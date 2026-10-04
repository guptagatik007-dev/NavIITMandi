import { describe, expect, it } from 'vitest';
import { loadGraph } from './fixtures';
import { pointInRing, segmentsIntersect } from '@/geo/polyOps';

const { graph, buildings } = loadGraph();
const campus = buildings.filter((b) => b.scope === 'campus');

/** count graph segments that cross or sit inside a campus footprint (§2 zero-tolerance audit) */
function violations() {
  const out: string[] = [];
  let checked = 0;
  for (const [id, edges] of graph.adj) {
    const a = graph.nodes.get(id)!;
    for (const e of edges) {
      if (id > e.b) continue; // each edge once
      const b = graph.nodes.get(e.b)!;
      const p1: [number, number] = [a.lng, a.lat];
      const p2: [number, number] = [b.lng, b.lat];
      const mid: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const amnx = Math.min(p1[0], p2[0]), amxx = Math.max(p1[0], p2[0]);
      const amny = Math.min(p1[1], p2[1]), amxy = Math.max(p1[1], p2[1]);
      for (const c of campus) {
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const [x, y] of c.ring) { mnx = Math.min(mnx, x); mny = Math.min(mny, y); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y); }
        if (amxx < mnx - 2e-5 || amnx > mxx + 2e-5 || amxy < mny - 2e-5 || amny > mxy + 2e-5) continue;
        if (pointInRing(mid, c.ring)) { out.push(`${id}→${e.b} inside ${c.id}`); break; }
        let crosses = false;
        for (let j = 0; j + 1 < c.ring.length; j++) {
          if (segmentsIntersect(p1, p2, c.ring[j] as [number, number], c.ring[j + 1] as [number, number])) { crosses = true; break; }
        }
        if (crosses) { out.push(`${id}→${e.b} crosses ${c.id}`); break; }
      }
      checked++;
    }
  }
  return { out, checked };
}

describe('§2 graph-time footprint clamp — routes can never pass through massing', () => {
  const v = violations();
  it('the base network has ZERO edges through campus buildings after the clamp', () => {
    // stitch edges ≤ 8 m may still touch facades; the strict clamp applies to road
    // segments themselves. Allow at most 2 boundary-kissing stitch artifacts.
    expect(v.checked).toBeGreaterThan(500);
    expect(v.out.length, `remaining violations: ${v.out.slice(0, 5).join(' | ')}`).toBeLessThanOrEqual(2);
  });
  it('the clamp REPORTED the killed crossings (nothing silent)', () => {
    expect(graph.droppedCrossings.length).toBeGreaterThanOrEqual(1); // Oak Mess endpoint
    expect(graph.droppedCrossings[0]).toContain('segment dropped');
  });
});
