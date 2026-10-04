import { describe, it, expect } from 'vitest';
import {
  haversineM,
  pointInRing,
  ringAreaM2,
  ringSelfIntersects,
  polylineIntersectsRing,
  insertPosition,
  snapEndpointsToNetwork,
  toLocal,
} from '@/geo/polyOps';

// A ~10 m square building around 31.7755, 76.9865
const SQ: [number, number][] = [
  [76.9865, 31.7755],
  [76.98662, 31.7755],
  [76.98662, 31.77559],
  [76.9865, 31.77559],
];

const BOWTIE: [number, number][] = [
  [76.9865, 31.7755],
  [76.98662, 31.77559],
  [76.98662, 31.7755],
  [76.9865, 31.77559],
];

describe('polyOps — editing geometry guards', () => {
  it('measures distances sanely', () => {
    const d = haversineM([76.9865, 31.7755], [76.9865, 31.77559]);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(12);
  });

  it('point in ring works', () => {
    const local = SQ.map((p) => toLocal(p, SQ[0][1])) as [number, number][];
    const mid = toLocal([76.98656, 31.775545], SQ[0][1]);
    const out = toLocal([76.9, 31.77], SQ[0][1]);
    expect(pointInRing(mid, local)).toBe(true);
    expect(pointInRing(out, local)).toBe(false);
  });

  it('ring area is positive and about 100 m² for the 10 m square', () => {
    const a = Math.abs(ringAreaM2(SQ));
    expect(a).toBeGreaterThan(70);
    expect(a).toBeLessThan(160);
  });

  it('detects self-intersecting (bowtie) rings and accepts clean ones', () => {
    expect(ringSelfIntersects(BOWTIE)).toBe(true);
    expect(ringSelfIntersects(SQ)).toBe(false);
  });

  it('route crossing guard: line through a building is flagged, line around it is not', () => {
    const through: [number, number][] = [
      [76.98654, 31.775545],
      [76.98658, 31.775545],
    ];
    const around: [number, number][] = [
      [76.9864, 31.77568],
      [76.9867, 31.77568],
    ];
    expect(polylineIntersectsRing(through, SQ)).toBe(true);
    expect(polylineIntersectsRing(around, SQ)).toBe(false);
  });

  it('insertPosition picks the closest segment with a snapped point', () => {
    const line: [number, number][] = [
      [76.9865, 31.7755],
      [76.9867, 31.7755],
      [76.9867, 31.7757],
    ];
    const hit = insertPosition(line, [76.9866, 31.775502]);
    expect(hit).not.toBeNull();
    expect(hit!.segIndex).toBe(0);
    expect(Math.abs(hit!.point[1] - 31.7755)).toBeLessThan(1e-6);
  });

  it('snaps only nearby endpoints to the network', () => {
    const network: [number, number][] = [
      [76.9865, 31.7755],
      [76.9875, 31.7755],
    ];
    const near: [number, number][] = [
      [76.986501, 31.775501],
      [76.989, 31.7755],
    ];
    const snapped = snapEndpointsToNetwork(near, network, 25);
    expect(snapped[0]).toEqual(network[0]);
    expect(snapped[1]).toEqual(near[1]); // too far: untouched
  });
});
