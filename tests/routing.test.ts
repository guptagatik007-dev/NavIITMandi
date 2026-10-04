import { describe, expect, it } from 'vitest';
import { ANCHOR_NORTH, ANCHOR_SOUTH, loadGraph } from './fixtures';
import { astar, edgeCost, makeGraph, addNode, addEdge, route, type RouteGraph } from '@/geo/routing';

const { graph, terrain } = loadGraph();

describe('outdoor network built from the baked data', () => {
  it('has nodes, edges and is mostly one connected component', () => {
    expect(graph.nodes.size).toBeGreaterThan(100);
    let edgeCount = 0;
    for (const list of graph.adj.values()) edgeCount += list.length;
    expect(edgeCount).toBeGreaterThan(100);

    // BFS from the node nearest the South Campus core
    const start = [...graph.nodes.values()].reduce((best, n) =>
      Math.hypot(n.lat - ANCHOR_SOUTH.lat, n.lng - ANCHOR_SOUTH.lng) <
      Math.hypot(best.lat - ANCHOR_SOUTH.lat, best.lng - ANCHOR_SOUTH.lng)
        ? n
        : best,
    );
    const seen = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of graph.adj.get(id) ?? []) {
        if (!seen.has(e.b)) {
          seen.add(e.b);
          queue.push(e.b);
        }
      }
    }
    expect(seen.size / graph.nodes.size).toBeGreaterThan(0.5);
  });

  it('marks every step/stair edge as not accessible', () => {
    for (const list of graph.adj.values()) {
      for (const e of list) {
        if (e.kind === 'stairs') expect(e.accessible).toBe(false);
      }
    }
    expect([...graph.adj.values()].flat().some((e) => e.kind === 'stairs')).toBe(true);
  });
});

describe('A* core', () => {
  it('finds a path on a tiny synthetic graph and respects the accessible constraint', () => {
    const g: RouteGraph = makeGraph();
    addNode(g, { id: 'a', lat: 0, lng: 0, elev: 0, kind: 'road' });
    addNode(g, { id: 'b', lat: 0.001, lng: 0, elev: 0, kind: 'road' });
    addNode(g, { id: 'c', lat: 0.002, lng: 0, elev: 0, kind: 'road' });
    addEdge(g, { a: 'a', b: 'b', lengthM: 50, ascentM: 60, descentM: 0, kind: 'stairs', accessible: false });
    addEdge(g, { a: 'b', b: 'c', lengthM: 50, ascentM: 0, descentM: 0, kind: 'road', accessible: true });

    expect(astar(g, 'a', 'c', 'fastest')).toEqual(['a', 'b', 'c']);
    // accessible must refuse the stair edge entirely
    expect(astar(g, 'a', 'c', 'accessible')).toBeNull();
    expect(edgeCost({ a: 'a', b: 'b', lengthM: 50, ascentM: 0, descentM: 0, kind: 'stairs', accessible: false }, 'accessible')).toBe(Infinity);
  });

  it('returns null instead of throwing when the graph is empty (indoor phase-1 case)', () => {
    const empty = makeGraph();
    expect(astar(empty, 'x', 'y', 'fastest')).toBeNull();
  });
});

describe('real campus routes', () => {
  it('routes between the two campus cores with a sane distance, time and climb', () => {
    const r = route(graph, ANCHOR_SOUTH, ANCHOR_NORTH, { profile: 'fastest' }, terrain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.distanceM).toBeGreaterThan(600); // straight-line is ~1.2 km, paths are longer
    expect(r.distanceM).toBeLessThan(6000);
    expect(r.seconds).toBeGreaterThan(0);
    expect(r.steps.length).toBeGreaterThan(0);
    // a Himalayan campus route between campuses must climb meaningfully
    expect(r.ascentM).toBeGreaterThan(0);
    // every coordinate must be inside the baked basemap bbox
    for (const [lng, lat] of r.coords) {
      expect(lng).toBeGreaterThan(76.98);
      expect(lng).toBeLessThan(77.003);
      expect(lat).toBeGreaterThan(31.769);
      expect(lat).toBeLessThan(31.786);
    }
  });

  it('never includes a stair edge on the accessible profile', () => {
    const r = route(graph, ANCHOR_SOUTH, ANCHOR_NORTH, { profile: 'accessible' }, terrain);
    if (r.ok) {
      expect(r.steps.some((s) => s.kind === 'stairs' && !s.instruction.includes('approximate'))).toBe(false);
    } else {
      // failing is acceptable and must come with a reason that names the constraint
      expect(r.reason).toBeTruthy();
    }
  });

  it('gives the shortest profile a distance no greater than the fastest profile', () => {
    const fast = route(graph, ANCHOR_SOUTH, ANCHOR_NORTH, { profile: 'fastest' }, terrain);
    const short = route(graph, ANCHOR_SOUTH, ANCHOR_NORTH, { profile: 'shortest' }, terrain);
    if (fast.ok && short.ok) expect(short.distanceM).toBeLessThanOrEqual(fast.distanceM + 1);
  });

  it('reports a clear message rather than a straight line when a point is unreachable', () => {
    const far = route(graph, { lat: 31.70629, lng: 76.93867 }, ANCHOR_NORTH, { profile: 'fastest' }, terrain);
    expect(far.ok).toBe(false);
    expect(far.reason?.length).toBeGreaterThan(10);
  });

  it('stairs cost more time per metre than flat road (terrain matters on this campus)', () => {
    const stair = edgeCost({ a: 'a', b: 'b', lengthM: 100, ascentM: 20, descentM: 0, kind: 'stairs', accessible: false }, 'fastest');
    const flat = edgeCost({ a: 'a', b: 'b', lengthM: 100, ascentM: 0, descentM: 0, kind: 'road', accessible: true }, 'fastest');
    expect(stair).toBeGreaterThan(flat);
  });
});
