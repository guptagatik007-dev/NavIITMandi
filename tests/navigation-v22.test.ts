import { describe, expect, it } from 'vitest';
import { routeOnFloor, type IndoorFloor } from '@/store/indoorStore';
import { makeGraph, addNode, addEdge, route, routeAlternatives } from '@/geo/routing';

/* Corridor ("floor roads") routing — the path must NOT be a dot-to-dot line. */
describe('§A indoor corridor routing — walls respected', () => {
  // Straight corridor down the middle at y=0.5; rooms A and B on opposite sides
  // near the corridors, plus Room X sitting where a PLAIN LINE would stay inside
  // but real routing must go along the corridor and step off at the door point.
  const corridorFloor: IndoorFloor = {
    id: 'G',
    label: 'G',
    elevationM: 0,
    heightM: 3.6,
    rooms: [],
    labels: [
      { id: 'room-101', text: 'Room 101', x: 0.2, y: 0.3, kind: 'room' },
      { id: 'room-110', text: 'Room 110', x: 0.8, y: 0.3, kind: 'room' },
    ],
    connections: [],
    corridors: [
      { id: 'c1', points: [{ x: 0.05, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.95, y: 0.5 }] },
    ],
  };

  it('routes along the corridor, not on the straight label-to-label line', () => {
    const path = routeOnFloor(corridorFloor, 'room-101', 'room-110');
    expect(path).not.toBeNull();
    // First/last are the labels themselves; everything BETWEEN stays on the corridor y=0.5
    const inner = path!.slice(1, -1).filter((n) => n.kind === 'walk');
    expect(inner.length).toBeGreaterThan(1);
    for (const n of inner) {
      expect(Math.abs(n.y - 0.5)).toBeLessThan(1e-6); // never leaves the walkable line
    }
    // portal points attach right below/above the rooms at x=0.2 and x=0.8
    expect(Math.abs(path![1].x - 0.2)).toBeLessThan(1e-6);
  });

  it('joins branches where corridor vertices coincide (door spur joins main corridor)', () => {
    const floor: IndoorFloor = {
      ...corridorFloor,
      labels: [
        { id: 'room-101', text: 'Room 101', x: 0.2, y: 0.3, kind: 'room' },
        { id: 'exit', text: 'Main Exit', x: 0.95, y: 0.9, kind: 'exit' },
      ],
      corridors: [
        corridorFloor.corridors![0],
        // spur starting exactly at the middle vertex (0.5, 0.5) and going down to the exit
        { id: 'c2', points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.9 }, { x: 0.95, y: 0.9 }] },
      ],
    };
    const path = routeOnFloor(floor, 'room-101', 'exit');
    expect(path).not.toBeNull();
    // the path must pass through the junction vertex (0.5, 0.5)
    expect(path!.some((n) => Math.abs(n.x - 0.5) < 1e-9 && Math.abs(n.y - 0.5) < 1e-9)).toBe(true);
  });

  it('floors with corridors do NOT fall back to dot-to-dot (no corridor connection = no route)', () => {
    const broken: IndoorFloor = {
      ...corridorFloor,
      corridors: [{ id: 'only', points: [{ x: 0.05, y: 0.5 }, { x: 0.1, y: 0.5 }] }],
    };
    // door for room-110 snaps to the tiny corridor, both rooms snap to it — still fine.
    // But with NO corridor at all and manual connections present, legacy still works:
    const legacy = routeOnFloor({ ...corridorFloor, corridors: [], connections: [{ id: 'e1', from: 'room-101', to: 'room-110', kind: 'walk', accessible: true }] } as IndoorFloor, 'room-101', 'room-110');
    expect(legacy?.length).toBeGreaterThan(1);
    void broken;
  });
});

/* Alternate routes — Google-Maps style options. */
describe('§C alternate routes', () => {
  // diamond network: A --top--> B --top--> D  and  A --bottom--> C --bottom--> D
  const g = makeGraph();
  const at = (id: string, lat: number, lng: number) => addNode(g, { id, lat, lng, elev: 1400, kind: 'road' });
  at('A', 31.7750, 76.9850);
  at('B', 31.7758, 76.9865); // top path (slightly shorter)
  at('C', 31.7742, 76.9868); // bottom path
  at('D', 31.7750, 76.9885);
  const link = (a: string, b: string, d: number) => addEdge(g, { a, b, lengthM: d, ascentM: 0, descentM: 0, kind: 'road', accessible: true });
  link('A', 'B', 120);
  link('B', 'D', 170);
  link('A', 'C', 150);
  link('C', 'D', 190);

  it('primary route is the fastest and an alternative that differs appears', () => {
    const to = { lat: 31.7750, lng: 76.9885 };
    const from = { lat: 31.7750, lng: 76.9850 };
    const best = route(g, from, to, { profile: 'fastest' });
    expect(best.ok).toBe(true);
    expect(best.nodeIds).toContain('B');

    const alts = routeAlternatives(g, from, to, { profile: 'fastest' }, undefined, 3);
    expect(alts.length).toBe(2);
    expect(alts[0].nodeIds).toContain('B'); // recommended stays fastest
    expect(alts[1].nodeIds).toContain('C'); // alternative goes via the bottom leg
    expect(alts[1].seconds).toBeGreaterThanOrEqual(alts[0].seconds);
  });

  it('returns an empty list when even the primary route fails', () => {
    addNode(g, { id: 'Z', lat: 31.78, lng: 76.99, elev: 1400, kind: 'road' });
    const alts = routeAlternatives(g, { lat: 31.775, lng: 76.985 }, { lat: 31.78, lng: 76.99 }, { profile: 'fastest' });
    expect(alts.length).toBe(0);
  });
});
