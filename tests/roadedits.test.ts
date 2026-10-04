import { describe, it, expect } from 'vitest';
import { mergeRoadSession, connectivityShare, type ManualRoad } from '@/data/roadEdits';
import type { CampusRoad } from '@/data/loaders';

const rd = (id: string, line: [number, number][]): CampusRoad => ({
  id,
  cls: 'footway',
  name: id,
  width_m: 1.5,
  surface: 'paved',
  stairs: false,
  accessible: true,
  bridge: false,
  tunnel: false,
  line,
});

const A = rd('r-a', [
  [76.9865, 31.7755],
  [76.9867, 31.7755],
]);
const B = rd('r-b', [
  [76.9867, 31.7755],
  [76.9867, 31.7757],
]);

describe('route editor data layer', () => {
  it('replaces a road line on fix and reports unknown ids', () => {
    const issues: string[] = [];
    const fixed: [number, number][] = [
      [76.9865, 31.7755],
      [76.9866, 31.77552],
      [76.9867, 31.7755],
    ];
    const out = mergeRoadSession([A, B], { 'r-a': fixed, 'r-ghost': fixed }, [], issues);
    expect(out.find((r) => r.id === 'r-a')?.line).toEqual(fixed);
    expect(out.find((r) => r.id === 'r-b')?.line).toEqual(B.line);
    expect(issues.some((m) => m.includes('r-ghost'))).toBe(true);
  });

  it('snaps hand-drawn routes onto the network so they connect', () => {
    const manual: ManualRoad = {
      id: 'mroad-1',
      name: null,
      cls: 'footway',
      width_m: 1.5,
      surface: 'unpaved',
      line: [
        [76.986701, 31.775701], // ~1 m from r-b's end
        [76.98755, 31.7758], // ~75 m from any network vertex: must be left alone
      ],
    };
    const out = mergeRoadSession([A, B], {}, [manual]);
    const added = out.find((r) => r.id === 'mroad-1')!;
    // near endpoint snapped exactly onto the existing network vertex
    expect(added.line[0]).toEqual([76.9867, 31.7757]);
    expect(added.line[1]).toEqual([76.98755, 31.7758]);
    expect(added.stairs).toBe(false);
    expect(added.accessible).toBe(true);
  });

  it('leaves far-away manual roads untouched (audit downstream decides)', () => {
    const manual: ManualRoad = {
      id: 'mroad-2',
      name: null,
      cls: 'path',
      width_m: 1.5,
      surface: 'unpaved',
      line: [
        [76.999, 31.789], // nowhere near campus roads
        [77.0, 31.79],
      ],
    };
    const out = mergeRoadSession([A], {}, [manual]);
    expect(out.find((r) => r.id === 'mroad-2')?.line).toEqual(manual.line);
  });

  it('connectivityShare: fully meshed network reads 1, an island below', () => {
    type G = { nodes: Map<string, unknown>; adj: Map<string, { b: string }[]> };
    const full: G = {
      nodes: new Map([['a', {}], ['b', {}], ['c', {}]]),
      adj: new Map([
        ['a', [{ b: 'b' }]],
        ['b', [{ b: 'a' }, { b: 'c' }]],
        ['c', [{ b: 'b' }]],
      ]),
    };
    const island: G = {
      nodes: new Map([['a', {}], ['b', {}], ['c', {}], ['d', {}]]),
      adj: new Map([
        ['a', [{ b: 'b' }]],
        ['b', [{ b: 'a' }]],
        ['c', [{ b: 'd' }]],
        ['d', [{ b: 'c' }]],
      ]),
    };
    expect(connectivityShare(full)).toBe(1);
    expect(connectivityShare(island)).toBeLessThan(1);
  });
});
