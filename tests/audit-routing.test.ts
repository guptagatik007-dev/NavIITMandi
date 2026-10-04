/**
 * audit-routing.test.ts — diagnostic: why does navigation fail in the field?
 * Tries a real route from the South Campus core to every named campus building and
 * reports graph connectivity. Not a pass/fail gate yet — it prints the evidence.
 */
import { describe, expect, it } from 'vitest';
import { loadGraph, loadBuildings } from './fixtures';
import { nearestNode, route } from '@/geo/routing';
import { ANCHOR_SOUTH } from './fixtures';

const { graph, terrain } = loadGraph();
const buildings = loadBuildings();

function componentMap() {
  const comp = new Map<string, number>();
  const sizes: number[] = [];
  for (const id of graph.nodes.keys()) {
    if (comp.has(id)) continue;
    const label = sizes.length;
    let size = 0;
    const stack = [id];
    comp.set(id, label);
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      for (const e of graph.adj.get(cur) ?? []) {
        if (!comp.has(e.b)) {
          comp.set(e.b, label);
          stack.push(e.b);
        }
      }
    }
    sizes.push(size);
  }
  return { comp, sizes, largest: Math.max(...sizes), components: sizes.length };
}

const named = buildings.filter((b) => b.scope === 'campus' && b.named);
const centroid = (ring: [number, number][]) => {
  const c = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return { lng: c[0] / ring.length, lat: c[1] / ring.length };
};

const results = named.map((b) => {
  const c = centroid(b.ring);
  const snap = nearestNode(graph, c.lat, c.lng, 400);
  const r = route(graph, ANCHOR_SOUTH, c, { profile: 'fastest' }, terrain);
  return {
    name: b.name.slice(0, 30),
    snappedM: snap ? Math.round(((snap.lat - c.lat) ** 2 + (snap.lng - c.lng) ** 2) ** 0.5 * 111000) : null,
    ok: r.ok,
    dist: r.ok ? Math.round(r.distanceM) : null,
    reason: r.ok ? '' : (r.reason ?? '').slice(0, 60),
  };
});

const failed = results.filter((r) => !r.ok);
const snapDistances = results.filter((r) => r.snappedM !== null).map((r) => r.snappedM!) as number[];

// eslint-disable-next-line no-console
console.log(
  '\n=== ROUTING AUDIT ===\n' +
    JSON.stringify(
      {
        graphNodes: graph.nodes.size,
        components: componentMap().sizes.slice().sort((a, b) => b - a).slice(0, 4),
        namedCampusBuildings: named.length,
        routesOk: results.length - failed.length,
        routesFailed: failed.length,
        noNetworkNodeWithin400m: results.filter((r) => r.snappedM === null).length,
        medianSnapDistanceM: snapDistances.length ? snapDistances.sort((a, b) => a - b)[Math.floor(snapDistances.length / 2)] : null,
        maxSnapDistanceM: snapDistances.length ? Math.max(...snapDistances) : null,
        failures: failed.slice(0, 12),
      },
      null,
      2,
    ) +
    '\n',
);

describe('routing coverage — the navigation defect gate', () => {
  it('routes from the South Campus core to EVERY campus building', () => {
    const all = buildings.filter((b) => b.scope === 'campus');
    expect(all.length).toBeGreaterThan(200); // not just the 15 OSM-named ones
    const failures: string[] = [];
    for (const b of all) {
      const c = centroid(b.ring);
      const r = route(graph, ANCHOR_SOUTH, c, { profile: 'fastest' }, terrain);
      if (!r.ok) failures.push(`${b.name}: ${r.reason ?? 'no path'}`);
    }
    expect(failures.slice(0, 8)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  it('gives every campus building a mapped entrance point', () => {
    const missing = buildings.filter((b) => b.scope === 'campus' && (b.entrance_lat == null || b.entrance_lng == null));
    expect(missing.map((b) => b.id)).toEqual([]);
  });

  it('gives every building a usable, non-junk name', () => {
    const junk = buildings.filter((b) => /^Building \d+$/.test(b.name));
    expect(junk.map((b) => b.name)).toEqual([]);
    const campusNoName = buildings.filter((b) => b.scope === 'campus' && !b.name.trim());
    expect(campusNoName.length).toBe(0);
  });

  it('keeps the whole campus network in ONE connected component', () => {
    const { comp } = componentMap();
    const labels = new Map<number, string[]>();
    for (const b of buildings.filter((x) => x.scope === 'campus')) {
      const c = centroid(b.ring);
      const n = nearestNode(graph, c.lat, c.lng, 500);
      if (!n) {
        labels.set(-1, [...(labels.get(-1) ?? []), b.name]);
        continue;
      }
      const l = comp.get(n.id) ?? -1;
      labels.set(l, [...(labels.get(l) ?? []), b.name]);
    }
    // every campus building must sit in the same component as the majority of the campus
    const groups = [...labels.entries()].sort((a, b) => b[1].length - a[1].length);
    expect(groups.length).toBe(1);
    expect(groups[0][1].length).toBeGreaterThan(300);
  });

  it('does not leave campus buildings in a detached trail cluster', () => {
    // (the 250-node detached component in this dataset is a village trail network in the
    //  hills; it must never contain a campus building, or navigation would silently fail)
    const { comp, sizes } = componentMap();
    const stray = buildings
      .filter((b) => b.scope === 'campus')
      .filter((b) => {
        const c = centroid(b.ring);
        const n = nearestNode(graph, c.lat, c.lng, 500);
        if (!n) return true;
        const l = comp.get(n.id);
        return l === undefined || sizes[l] < sizes.reduce((a, b2) => Math.max(a, b2), 0);
      });
    expect(stray.map((b) => `${b.name} (${b.id})`)).toEqual([]);
  });
});
