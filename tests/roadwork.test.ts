import { beforeEach, describe, expect, it } from 'vitest';
import { useEdit } from '@/store/editStore';
import { mergeRoadSessionChecked, projectOntoNetwork, type ManualRoad } from '@/data/roadEdits';
import type { CampusRoad } from '@/data/loaders';

/**
 * v3.1 Road Workbench — the user's four complaints as executable contracts:
 * 1. deleted roads leave the network for good (baseline measures against what you kept)
 * 2. roads deleted THEN redrawn by hand adopt onto the remaining network again
 * 3. "Fix an existing road" machinery works (drag/insert/delete/translate of the fix line)
 * 4. building door nodes come from the standard override pipeline (entrance_lat/lng)
 */

const base: CampusRoad[] = [
  { id: 'r-main', cls: 'road', name: 'Main', width_m: 6, surface: 'paved', stairs: false, accessible: true, bridge: false, tunnel: false, line: [[76.990, 31.7750], [76.994, 31.7750]] as [number, number][] },
  { id: 'r-side', cls: 'footway', name: 'Side', width_m: 2, surface: 'paved', stairs: false, accessible: true, bridge: false, tunnel: false, line: [[76.992, 31.7750], [76.992, 31.7770]] as [number, number][] },
];
const road = (id: string, line: [number, number][]): ManualRoad => ({ id, name: null, cls: 'footway', width_m: 1.5, surface: 'paved', line });

describe('v3.1 deleting roads from the network', () => {
  it('hidden roads are gone from every projection — spurs touching ONLY the hidden road are honest issues', () => {
    const kept = base.filter((r) => r.id !== 'r-side'); // the App filters BEFORE admission
    // spur only reaches the hidden side road's area (mid ~44 m off the main line)
    const spur = road('spur', [[76.992, 31.7760], [76.9920, 31.7765]]);
    const onAll = mergeRoadSessionChecked(base, {}, [spur]);
    expect(onAll.issues).toHaveLength(0); // joins r-side when it's present
    const onKept = mergeRoadSessionChecked(kept, {}, [spur]);
    expect(onKept.issues).toHaveLength(1); // but with the road deleted, the gap is real
    expect(onKept.issues[0].id).toBe('spur');
  });

  it('deleted road + drawn replacement: the new line bridges the gap and adopts', () => {
    const kept = base.filter((r) => r.id !== 'r-side');
    // user hides r-side, then draws an equivalent way starting ON the main road
    const redrawn = road('side-v2', [[76.992, 31.7750], [76.992, 31.7770]]);
    const res = mergeRoadSessionChecked(kept, {}, [redrawn]);
    expect(res.issues).toHaveLength(0);
    expect(res.adoptedIds).toEqual(['side-v2']);
    const mainAdopted = res.roads.find((r) => r.id === 'side-v2')!;
    expect(mainAdopted.line[0][1]).toBeCloseTo(31.775, 5);
  });
});

describe('v3.1 road-fix moulding (drag/insert/delete/whole-line move)', () => {
  it('shiftRoadFix translates every vertex by the same metres — the line keeps its shape', () => {
    const es = useEdit.getState();
    es.startRoadFix('r-main', [[76.990, 31.7750] as [number, number], [76.994, 31.7750] as [number, number]]);
    es.shiftRoadFix(10, 0); // +10 m east
    const line = useEdit.getState().roadFixLine;
    expect(line).toHaveLength(2);
    expect(line[0][0] - 76.99).toBeCloseTo(10 / (111320 * Math.cos(0.555)), 5);
    expect(line[0][1]).toBeCloseTo(31.775, 9);
    expect(line[1][0] - line[0][0]).toBeCloseTo(76.994 - 76.99, 9);
    es.cancelRoadFix();
  });

  it('vertices can be inserted and deleted while moulding', () => {
    const es = useEdit.getState();
    es.startRoadFix('r-main', [[76.990, 31.7750] as [number, number], [76.994, 31.7750] as [number, number]]);
    es.insertRoadFixVertex(1, [76.992, 31.7752] as [number, number]);
    expect(useEdit.getState().roadFixLine).toHaveLength(3);
    es.deleteRoadFixVertex(1);
    expect(useEdit.getState().roadFixLine).toHaveLength(2);
    es.deleteRoadFixVertex(0); // must refuse to leave a 1-point road
    expect(useEdit.getState().roadFixLine).toHaveLength(2);
    const ok = es.saveRoadFix();
    expect(ok).toBe(true);
    expect(useEdit.getState().roadEdits['r-main']).toHaveLength(2);
    es.removeRoadFix('r-main'); // clean up for other suites
  });
});

describe('v3.1 building door nodes (termi­nating roads)', () => {
  beforeEach(() => {
    // deterministic baseline for each case
    useEdit.getState().resetAll();
  });
  it('setEntrance writes entrance_lat/lng into the standard building override', () => {
    const es = useEdit.getState();
    es.setTarget('b-x');
    es.setEntrance([76.992, 31.7750]);
    const ov = useEdit.getState().saved['b-x'];
    expect(ov.entrance_lat).toBeCloseTo(31.775, 7);
    expect(ov.entrance_lng).toBeCloseTo(76.992, 7);
    es.setEntrance(null);
    expect(useEdit.getState().saved['b-x'].entrance_lat).toBeUndefined();
  });

  it('the door point a user picks literally sits on the road (projection contract)', () => {
    const p = projectOntoNetwork([76.9921, 31.7751], base);
    expect(p).not.toBeNull();
    expect(p!.distM).toBeLessThan(12);
    // nearest join here is the vertical r-side road at the same latitude (~9 m east)
    expect(p!.point[0]).toBeCloseTo(76.992, 5);
    expect(p!.point[1]).toBeCloseTo(31.7751, 5);
    expect(p!.roadIdx).toBe(1);
  });
});
