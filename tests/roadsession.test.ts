import { describe, expect, it } from 'vitest';
import { mergeRoadSessionChecked, projectOntoNetwork, ROAD_JOIN_M, connectivityShare, type ManualRoad } from '@/data/roadEdits';
import type { CampusRoad } from '@/data/loaders';

void connectivityShare;

/** tiny synthetic campus: one horizontal road A-B-C, plus one branch C→D. */
const baseRoads: CampusRoad[] = [
  { id: 'r-main', cls: 'road', name: 'main', width_m: 6, surface: 'paved', stairs: false, accessible: true, bridge: false, tunnel: false, line: [[76.99, 31.7750], [76.991, 31.7750], [76.992, 31.7750]] as [number, number][] },
  { id: 'r-branch', cls: 'footway', name: 'branch', width_m: 2, surface: 'paved', stairs: false, accessible: true, bridge: false, tunnel: false, line: [[76.992, 31.7750], [76.992, 31.7762]] as [number, number][] },
];
const road = (id: string, line: [number, number][]): ManualRoad => ({ id, name: null, cls: 'footway', width_m: 1.5, surface: 'paved', line });

describe('§1 mergeRoadSessionChecked — per-road admission (the killer-bug fix)', () => {
  it('24 m away from the network → joins by projection AND the base road gets split at the join point', () => {
    // spur starting ~24 m south of the main road's middle segment
    const spur = road('spur-24m', [[76.9905, 31.77478], [76.9905, 31.77430]]);
    const res = mergeRoadSessionChecked(baseRoads, {}, [spur]);
    expect(res.issues).toHaveLength(0);
    expect(res.adoptedIds).toEqual(['spur-24m']);
    expect(res.joined['spur-24m']).toContain('start');
    // the end lands ON the main road, not just near it
    const adopted = res.roads.find((r) => r.id === 'spur-24m')!;
    expect(adopted.line[0][1]).toBeCloseTo(31.7750, 5);
    // main road was SPLIT: it now contains the join point as a vertex
    const main = res.roads.find((r) => r.id === 'r-main')!;
    expect(main.line.some((p) => Math.abs(p[0] - 76.9905) < 1e-6)).toBe(true);
  });

  it('beyond the join radius (120 m) → rejected with a measured gap, never silently dropped', () => {
    const far = road('far-away', [[76.9905, 31.7740], [76.9906, 31.7735]]);
    expect(120).toBeGreaterThan(ROAD_JOIN_M);
    const res = mergeRoadSessionChecked(baseRoads, {}, [far]);
    expect(res.adoptedIds).toHaveLength(0);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].id).toBe('far-away');
    expect(res.issues[0].gapM).toBeGreaterThan(ROAD_JOIN_M);
    // rejected road is NOT in the network
    expect(res.roads.some((r) => r.id === 'far-away')).toBe(false);
  });

  it('dead-end spur (one end on network, other attached to nothing) is routable — real campus topology', () => {
    const spur = road('hostel-dead-end', [[76.9915, 31.7750], [76.9915, 31.7738]]);
    void spur;
    const honest = road('one-end-join', [[76.9915, 31.7760], [76.9915, 31.7750]]);
    const res = mergeRoadSessionChecked(baseRoads, {}, [honest]);
    expect(res.issues).toHaveLength(0); // no scarlet letter for dead ends
    expect(res.adoptedIds).toEqual(['one-end-join']);
    expect(res.joined['one-end-join']).toContain('end');
  });

  it('chaining: a road that only touches a PREVIOUSLY adopted manual road still joins', () => {
    const a = road('m1', [[76.9905, 31.7750], [76.9905, 31.7740]]);
    const b = road('m2', [[76.9905, 31.7740], [76.9905, 31.7732]]); // b rides on a's free end (0 m)
    const res = mergeRoadSessionChecked(baseRoads, {}, [a, b]);
    expect(res.issues).toHaveLength(0);
    expect(res.adoptedIds).toEqual(['m1', 'm2']);
  });

  it('projection lands on a segment mid-span (not only vertices)', () => {
    const p = projectOntoNetwork([76.9905, 31.7749], baseRoads);
    expect(p).not.toBeNull();
    expect(p!.distM).toBeLessThan(12);
    expect(p!.roadIdx).toBe(0);
    expect(p!.segIdx).toBe(0); // between the first two vertices of r-main
  });

  it('full-graph sanity: spurs keep connectivity ≥ base share (gate invariant)', () => {
    const spur = road('spur', [[76.9905, 31.7750], [76.9905, 31.7738]]);
    const res = mergeRoadSessionChecked(baseRoads, {}, [spur]);
    void connectivityShare;
    expect(res.roads.length).toBe(3);
  });
});
