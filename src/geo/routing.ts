/**
 * routing.ts — routing engine, shared by the outdoor and (future) indoor graphs.
 *
 * Design notes
 *  * The graph is generic: nodes carry WGS84 coordinates outdoors and local floor
 *    coordinates indoors. The same A* core serves both.
 *  * Cost is time-based by default (Naismith-style: 1.25 m/s flat + 1 min per 10 m of
 *    ascent), which matters on a Himalayan campus where the flat-line distance is a
 *    poor predictor of effort.
 *  * `accessible` hard-forbids stairs edges — it is a constraint, not a penalty.
 *  * Nothing here invents geometry: entrances that are not mapped produce an explicitly
 *    labelled "approximate last leg" step.
 */
import { bearingDeg, haversine, latLngToLocal, localToLatLng, compass, formatDistance } from './wgs84';
import { pointInRing, segmentsIntersect } from './polyOps';
import type { TerrainGrid } from './terrain';

export type EdgeKind = 'road' | 'footpath' | 'stairs' | 'ramp' | 'entrance' | 'walk' | 'lift';
export type Profile = 'fastest' | 'accessible' | 'shortest';

export interface RouteNode {
  id: string;
  lat: number;
  lng: number;
  elev: number;
  kind: EdgeKind;
  label?: string;
}
export interface RouteEdge {
  a: string;
  b: string;
  lengthM: number;
  ascentM: number;
  descentM: number;
  kind: EdgeKind;
  accessible: boolean;
  approximate?: boolean;
  label?: string;
}
export interface RouteGraph {
  nodes: Map<string, RouteNode>;
  adj: Map<string, RouteEdge[]>;
  /** Nodes snapped on a coarse spatial hash for nearest-neighbour queries. */
  index: Map<string, string[]>;
  /** §2.2: edges dropped for passing through campus massing (surfaced, never hidden) */
  droppedCrossings: string[];
}

export interface Step {
  instruction: string;
  distanceM: number;
  bearing: number;
  kind: EdgeKind;
  approximate?: boolean;
}
export interface RouteResult {
  ok: boolean;
  reason?: string;
  profile: Profile;
  nodeIds: string[];
  coords: [number, number][];
  distanceM: number;
  ascentM: number;
  descentM: number;
  seconds: number;
  steps: Step[];
}

const WALK_MPS = 1.25;
const ASCENT_SECONDS_PER_M = 6; // 1 min per 10 m vertical
const SNAP_CELL = 0.00025; // ≈ 27 m grid key for nearest-node lookup

export function makeGraph(): RouteGraph {
  return { nodes: new Map(), adj: new Map(), index: new Map(), droppedCrossings: [] };
}

const cellKey = (lat: number, lng: number) => `${Math.round(lng / SNAP_CELL)}:${Math.round(lat / SNAP_CELL)}`;

export function addNode(g: RouteGraph, node: RouteNode): void {
  g.nodes.set(node.id, node);
  const k = cellKey(node.lat, node.lng);
  const list = g.index.get(k);
  if (list) list.push(node.id);
  else g.index.set(k, [node.id]);
}

export function addEdge(g: RouteGraph, e: RouteEdge): void {
  for (const [x, y] of [
    [e.a, e.b],
    [e.b, e.a],
  ] as const) {
    const list = g.adj.get(x);
    const reversed: RouteEdge = { ...e, a: x, b: y, ascentM: y === e.a ? e.descentM : e.ascentM, descentM: y === e.a ? e.ascentM : e.descentM };
    if (list) list.push(reversed);
    else g.adj.set(x, [reversed]);
  }
}

export function nearestNode(g: RouteGraph, lat: number, lng: number, maxM = 400): RouteNode | null {
  const cx = Math.round(lng / SNAP_CELL);
  const cy = Math.round(lat / SNAP_CELL);
  let best: RouteNode | null = null;
  let bestD = Infinity;
  for (let ring = 0; ring <= Math.ceil(maxM / (SNAP_CELL * 111320)) + 1; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const ids = g.index.get(`${cx + dx}:${cy + dy}`);
        if (!ids) continue;
        for (const id of ids) {
          const n = g.nodes.get(id)!;
          const d = haversine({ lat, lng }, { lat: n.lat, lng: n.lng });
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    if (best && ring >= 1) break; // one extra ring past the first hit is enough for our graph density
  }
  if (best && bestD > maxM) return null;
  return best;
}

/** Edge traversal cost for a profile, in "seconds" (fastest/accessible) or metres (shortest). */
export function edgeCost(e: RouteEdge, profile: Profile): number {
  if (profile === 'shortest') return e.lengthM;
  const slope = e.lengthM > 0 ? e.ascentM / e.lengthM : 0;
  let seconds = e.lengthM / WALK_MPS + e.ascentM * ASCENT_SECONDS_PER_M;
  if (e.kind === 'stairs') seconds *= 1.35; // stairs are slower than their rise suggests
  if (profile === 'accessible') {
    if (e.kind === 'stairs') return Infinity;
    if (slope > 0.08) seconds *= 1 + (slope - 0.08) * 6; // steep ramps are fatiguing
  }
  return seconds;
}

function heuristic(g: RouteGraph, a: string, b: string, profile: Profile): number {
  const na = g.nodes.get(a);
  const nb = g.nodes.get(b);
  if (!na || !nb) return 0;
  const la = latLngToLocal(na.lat, na.lng);
  const lb = latLngToLocal(nb.lat, nb.lng);
  const d = Math.hypot(la.x - lb.x, la.z - lb.z);
  return profile === 'shortest' ? d : d / WALK_MPS;
}

class MinHeap {
  private a: { k: string; f: number }[] = [];
  push(k: string, f: number) {
    this.a.push({ k, f });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= this.a[i].f) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop(): { k: string; f: number } | undefined {
    if (this.a.length === 0) return undefined;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l].f < this.a[m].f) m = l;
        if (r < this.a.length && this.a[r].f < this.a[m].f) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export const emptyRoute = (profile: Profile, reason: string): RouteResult => ({
  ok: false,
  reason,
  profile,
  nodeIds: [],
  coords: [],
  distanceM: 0,
  ascentM: 0,
  descentM: 0,
  seconds: 0,
  steps: [],
});

/** A* over any RouteGraph. Returns null when no path exists. */
export function astar(
  g: RouteGraph,
  startId: string,
  goalId: string,
  profile: Profile,
  /** unordered node-pair key → cost multiplier (used to pull alternatives off the best route) */
  penalty?: Map<string, number>,
): string[] | null {
  if (!g.nodes.has(startId) || !g.nodes.has(goalId)) return null;
  const open = new MinHeap();
  const gScore = new Map<string, number>([[startId, 0]]);
  const cameFrom = new Map<string, string>();
  open.push(startId, heuristic(g, startId, goalId, profile));
  const closed = new Set<string>();

  while (open.size) {
    const cur = open.pop()!;
    if (cur.k === goalId) {
      const path = [goalId];
      let p = goalId;
      while (cameFrom.has(p)) {
        p = cameFrom.get(p)!;
        path.unshift(p);
      }
      return path;
    }
    if (closed.has(cur.k)) continue;
    closed.add(cur.k);
    for (const e of g.adj.get(cur.k) ?? []) {
      let c = edgeCost(e, profile);
      if (!isFinite(c)) continue;
      if (penalty) c *= penalty.get(pairKey(cur.k, e.b)) ?? 1;
      const tentative = (gScore.get(cur.k) ?? Infinity) + c;
      if (tentative < (gScore.get(e.b) ?? Infinity)) {
        gScore.set(e.b, tentative);
        cameFrom.set(e.b, cur.k);
        open.push(e.b, tentative + heuristic(g, e.b, goalId, profile));
      }
    }
  }
  return null;
}

/** Turn-by-turn steps by grouping consecutive edges until the bearing changes. */
function buildSteps(g: RouteGraph, ids: string[]): Step[] {
  const steps: Step[] = [];
  if (ids.length < 2) return steps;

  const seg = (i: number) => {
    const a = g.nodes.get(ids[i]);
    const b = g.nodes.get(ids[i + 1]);
    const edge = (g.adj.get(ids[i]) ?? []).find((e) => e.b === ids[i + 1]);
    return a && b ? { a, b, edge } : null;
  };
  // bearing of the leg that starts at index i (i must be <= ids.length - 2)
  const bearingOf = (i: number) => {
    const s = seg(Math.min(i, ids.length - 2));
    return s ? bearingDeg(s.a, s.b) : 0;
  };
  const signedDelta = (i: number) => ((bearingOf(i) - bearingOf(i - 1) + 540) % 360) - 180;

  let runStart = 0;
  for (let i = 1; i <= ids.length - 1; i++) {
    const isLast = i === ids.length - 1;
    const turn = isLast ? 180 : Math.abs(signedDelta(i));
    const kindChange = !isLast && seg(i)?.edge?.kind !== seg(i - 1)?.edge?.kind;
    const ambiguous = Boolean(seg(i)?.edge?.approximate);

    if (isLast || turn > 22 || kindChange || ambiguous) {
      let dist = 0;
      let ascent = 0;
      let approx = false;
      let kind: EdgeKind = 'footpath';
      let label: string | undefined;
      for (let j = runStart; j < i; j++) {
        const s = seg(j);
        dist += s?.edge?.lengthM ?? 0;
        ascent += s?.edge?.ascentM ?? 0;
        approx = approx || Boolean(s?.edge?.approximate);
        kind = s?.edge?.kind ?? kind;
        label = s?.edge?.label ?? label;
      }
      if (dist < 3 && !isLast) {
        runStart = i;
        continue;
      }
      const bearing = bearingOf(runStart);
      let instruction: string;
      if (runStart === 0) {
        instruction = `${kind === 'stairs' ? 'Take the stairs' : 'Head'} ${compass(bearing)}${label ? ` along ${label}` : ''}`;
      } else {
        const d = signedDelta(i);
        const dir = d > 0 ? 'right' : 'left';
        instruction = Math.abs(d) > 120 ? `Sharp ${dir}` : Math.abs(d) > 40 ? `Turn ${dir}` : `Bear ${dir}`;
      }
      const kindNote = kind === 'stairs' ? ' (steps)' : kind === 'ramp' ? ' (ramp)' : '';
      steps.push({
        instruction: `${instruction}${kindNote}${approx ? ' — approximate, entrance not mapped' : ''}`,
        distanceM: dist,
        bearing,
        kind,
        approximate: approx,
      });
      runStart = i;
    }
  }

  if (steps.length === 0) {
    let dist = 0;
    for (let j = 0; j < ids.length - 1; j++) dist += seg(j)?.edge?.lengthM ?? 0;
    steps.push({ instruction: 'Walk to the destination', distanceM: dist, bearing: bearingOf(0), kind: 'footpath' });
  }
  return steps;
}

export function reconstruct(g: RouteGraph, ids: string[], profile: Profile): RouteResult {
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  let seconds = 0;
  const coords: [number, number][] = [];
  for (let i = 0; i < ids.length; i++) {
    const n = g.nodes.get(ids[i])!;
    coords.push([n.lng, n.lat]);
    if (i === 0) continue;
    const e = (g.adj.get(ids[i - 1]) ?? []).find((x) => x.b === ids[i]);
    if (!e) continue;
    distanceM += e.lengthM;
    ascentM += e.ascentM;
    descentM += e.descentM;
    seconds += isFinite(edgeCost(e, profile)) ? edgeCost(e, profile) : 0;
  }
  return {
    ok: true,
    profile,
    nodeIds: ids,
    coords,
    distanceM,
    ascentM,
    descentM,
    seconds: profile === 'shortest' ? distanceM / WALK_MPS + ascentM * ASCENT_SECONDS_PER_M : seconds,
    steps: buildSteps(g, ids),
  };
}

export interface RouteOptions {
  profile: Profile;
  /** Straight-line "last leg" from the snapped network node to the true destination. */
  connectEnds?: boolean;
  /** internal: alternative-routing edge penalties (unordered node pairs → multiplier) */
  penalty?: Map<string, number>;
}

/** unordered node-pair key shared by edge penalties and similarity checks */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Edge (node-pair) set of a node-id path. */
function edgeSet(ids: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + 1 < ids.length; i++) s.add(pairKey(ids[i], ids[i + 1]));
  return s;
}

/**
 * Google-Maps-style alternates: the fastest route plus up to k−1 meaningfully
 * different paths. We re-run A* with multiplicative penalties on edges the
 * accepted routes already used — cheap, robust, and guaranteed different
 * (candidates sharing ≥ 85% of their edges with an accepted route are rejected).
 */
export function routeAlternatives(
  g: RouteGraph,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  opts: RouteOptions,
  terrain?: TerrainGrid,
  k = 3,
): RouteResult[] {
  const first = route(g, from, to, opts, terrain);
  if (!first.ok) return [];
  const accepted: RouteResult[] = [first];
  const used = edgeSet(first.nodeIds);
  const counts = new Map<string, number>();
  for (const e of used) counts.set(e, (counts.get(e) ?? 0) + 1);
  let tries = 0;
  while (accepted.length < k && tries < k * 4) {
    tries++;
    const penalty = new Map<string, number>();
    for (const [e, c] of counts) penalty.set(e, 1 + 3 * c);
    const cand = route(g, from, to, { ...opts, penalty }, terrain);
    if (!cand.ok) break;
    const shared = edgeSet(cand.nodeIds);
    const similar = accepted.some((a) => {
      const es = edgeSet(a.nodeIds);
      let common = 0;
      for (const e of shared) if (es.has(e)) common++;
      return common / Math.max(1, Math.min(es.size, shared.size)) > 0.85;
    });
    for (const e of shared) counts.set(e, (counts.get(e) ?? 0) + 1);
    if (cand.nodeIds.join(',') === first.nodeIds.join(',')) continue;
    if (similar) continue;
    accepted.push(cand);
  }
  return accepted;
}

/**
 * Route between two WGS84 points. Both ends are snapped to the nearest network node
 * (roads/paths/steps only); the final metres to an unmapped building entrance are added
 * as an explicitly approximate leg.
 */
export function route(
  g: RouteGraph,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  opts: RouteOptions,
  terrain?: TerrainGrid,
): RouteResult {
  const a = nearestNode(g, from.lat, from.lng);
  const b = nearestNode(g, to.lat, to.lng);
  if (!a || !b) {
    return emptyRoute(opts.profile, 'No mapped path close enough to start or finish. Nothing is drawn — this is a data gap, not a wall.');
  }
  const ids = astar(g, a.id, b.id, opts.profile, opts.penalty);
  if (!ids) {
    return emptyRoute(
      opts.profile,
      opts.profile === 'accessible'
        ? 'No step-free route: every connection between these points uses stairs. Switch to the fastest profile or request a survey of the ramps.'
        : 'No connected path in the mapped network between these points.',
    );
  }
  const res = reconstruct(g, ids, opts.profile);

  if (opts.connectEnds !== false) {
    const tail = { lat: b.lat, lng: b.lng };
    const tailD = haversine(tail, to);
    if (tailD > 2) {
      res.coords.push([to.lng, to.lat]);
      res.distanceM += tailD;
      const rise = terrain
        ? Math.max(0, terrain.heightAtLatLng(to.lat, to.lng) - terrain.heightAtLatLng(tail.lat, tail.lng))
        : 0;
      res.ascentM += rise;
      res.seconds += tailD / WALK_MPS + rise * ASCENT_SECONDS_PER_M;
      res.steps.push({
        instruction: `Continue the last ${formatDistance(tailD)} to the building — approximate, entrance not mapped`,
        distanceM: tailD,
        bearing: bearingDeg(tail, to),
        kind: 'entrance',
        approximate: true,
      });
    }
    const headD = haversine(from, { lat: g.nodes.get(ids[0])!.lat, lng: g.nodes.get(ids[0])!.lng });
    if (headD > 2) {
      res.distanceM += headD;
      res.seconds += headD / WALK_MPS;
      res.coords.unshift([from.lng, from.lat]);
      res.steps.unshift({
        instruction: `Walk ${formatDistance(headD)} from your location to the mapped path`,
        distanceM: headD,
        bearing: bearingDeg(from, { lat: g.nodes.get(ids[0])!.lat, lng: g.nodes.get(ids[0])!.lng }),
        kind: 'entrance',
        approximate: true,
      });
    }
  }
  return res;
}

/** Sample terrain elevation along a route for the profile chart. */
export function elevationProfile(
  coords: [number, number][],
  terrain: TerrainGrid,
  samples = 120,
): { distance_m: number; elevation_m: number }[] {
  if (coords.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] }));
  }
  const total = cum[cum.length - 1];
  const out: { distance_m: number; elevation_m: number }[] = [];
  for (let s = 0; s <= samples; s++) {
    const target = (total * s) / samples;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const t = cum[i] === cum[i - 1] ? 0 : (target - cum[i - 1]) / (cum[i] - cum[i - 1]);
    const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t;
    const lng = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t;
    out.push({ distance_m: Math.round(target), elevation_m: Math.round(terrain.heightAtLatLng(lat, lng)) });
  }
  return out;
}

/** Build the outdoor network from the baked roads/paths GeoJSON. */
export interface BuildGraphOptions {
  /**
   * §2.2 (v3): campus buildings whose footprints strictly forbid routing. An edge
   * whose midpoint lies inside a campus ring, or whose segment crosses a ring's
   * boundary, is dropped instead of becoming a fake corridor through a building.
   * Honest dead-ends beat invented paths (same rule as everything else here).
   */
  buildings?: { id: string; scope?: string; ring: [number, number][] }[];
}

export function buildOutdoorGraph(
  roads: { cls: string; width_m: number; stairs: boolean; accessible: boolean; name?: string | null; line: [number, number][]; bridge?: boolean; tunnel?: boolean }[],
  terrain?: TerrainGrid,
  opts: BuildGraphOptions = {},
): RouteGraph {
  const g = makeGraph();
  const key = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const elev = (lat: number, lng: number) => (terrain ? terrain.heightAtLatLng(lat, lng) : 0);

  // ── §2.2 footprint clamp, bbox-pruned campus footprints only ──────────────
  const campusRings = (opts.buildings ?? [])
    .filter((b) => b.scope === 'campus')
    .map((b) => {
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const [x, y] of b.ring) {
        if (x < mnx) mnx = x;
        if (y < mny) mny = y;
        if (x > mxx) mxx = x;
        if (y > mxy) mxy = y;
      }
      return { id: b.id, ring: b.ring, mnx, mny, mxx, mxy };
    });
  const segInsideBuilding = (a: [number, number], b: [number, number]): string | null => {
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const amnx = Math.min(a[0], b[0]), amxx = Math.max(a[0], b[0]);
    const amny = Math.min(a[1], b[1]), amxy = Math.max(a[1], b[1]);
    for (const c of campusRings) {
      if (amxx < c.mnx - 2e-5 || amnx > c.mxx + 2e-5 || amxy < c.mny - 2e-5 || amny > c.mxy + 2e-5) continue;
      if (pointInRing(mid, c.ring)) return c.id;
      // one end in, one end out — catches collinear/corner-touch crossings strict
      // segment intersection misses (e.g. way-762330812 grazing the Oak Mess corner)
      const aIn = pointInRing(a, c.ring);
      const bIn = pointInRing(b, c.ring);
      if (aIn !== bIn) return c.id;
      for (let j = 0; j + 1 < c.ring.length; j++) {
        const e0 = c.ring[j];
        const e1 = c.ring[j + 1];
        if (segmentsIntersect(a, b, e0, e1)) return c.id;
      }
    }
    return null;
  };

  /** endpoints of each way, used by the network-stitching pass below */
  const endpoints: { id: string; way: number; lat: number; lng: number }[] = [];

  roads.forEach((r, wayIndex) => {
    const kind: EdgeKind = r.stairs ? 'stairs' : r.cls === 'ramp' ? 'ramp' : r.cls === 'footway' || r.cls === 'path' ? 'footpath' : 'road';
    let prev: string | null = null;
    let first: string | null = null;
    // §2.2: bridges/tunnels legitimately pass under/over massing — never clamp those
    const clampThisWay = campusRings.length > 0 && !r.bridge && !r.tunnel;
    for (const [lng, lat] of r.line) {
      const id = key(lat, lng);
      if (!g.nodes.has(id)) {
        addNode(g, { id, lat, lng, elev: elev(lat, lng), kind, label: r.name ?? undefined });
      }
      if (prev && prev !== id) {
        if (clampThisWay) {
          const pa0 = g.nodes.get(prev)!;
          const pb0 = g.nodes.get(id)!;
          const viol = segInsideBuilding([pa0.lng, pa0.lat], [pb0.lng, pb0.lat]);
          if (viol) {
            const node = g.nodes.get(id)!;
            (node as { dropped?: string }).dropped = `edge into ${viol}`;
            g.droppedCrossings.push(`road ${r.name ?? wayIndex} → inside ${viol} (segment dropped; ends stay dead-ends)`);
            prev = id;
            if (first === null) first = id;
            continue;
          }
        }
        const pa = g.nodes.get(prev)!;
        const pb = g.nodes.get(id)!;
        const lengthM = haversine({ lat: pa.lat, lng: pa.lng }, { lat: pb.lat, lng: pb.lng });
        const dy = pb.elev - pa.elev;
        addEdge(g, {
          a: prev,
          b: id,
          lengthM,
          ascentM: Math.max(0, dy),
          descentM: Math.max(0, -dy),
          kind,
          accessible: !r.stairs,
          label: r.name ?? undefined,
        });
      }
      if (first === null) first = id;
      prev = id;
    }
    if (first && prev) {
      const a = g.nodes.get(first)!;
      const b = g.nodes.get(prev)!;
      endpoints.push({ id: first, way: wayIndex, lat: a.lat, lng: a.lng });
      endpoints.push({ id: prev, way: wayIndex, lat: b.lat, lng: b.lng });
    }
  });

  // stitch near-coincident nodes (crossings, survey joins) within 4 m
  const ids = [...g.nodes.keys()];
  for (let i = 0; i < ids.length; i++) {
    const a = g.nodes.get(ids[i])!;
    for (let j = i + 1; j < ids.length; j++) {
      const b = g.nodes.get(ids[j])!;
      if (Math.abs(a.lat - b.lat) > 6e-5 || Math.abs(a.lng - b.lng) > 6e-5) continue;
      const d = haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      if (d > 0.001 && d < 8) {
        addEdge(g, {
          a: a.id,
          b: b.id,
          lengthM: d,
          ascentM: Math.max(0, b.elev - a.elev),
          descentM: Math.max(0, a.elev - b.elev),
          kind: 'walk',
          accessible: true,
        });
      }
    }
  }
  // ── network stitching: connect dangling way endpoints to the nearest other way ──
  // Real OSM extracts contain paths that stop a few metres short of the road they join
  // (survey joins, digitising gaps). Left alone these fragment the graph and make some
  // buildings unreachable, which reads to a user as "navigation is broken".
  const cell = 0.0006; // ~65 m buckets
  const bucket = new Map<string, string[]>();
  for (const n of g.nodes.values()) {
    const k = `${Math.round(n.lng / cell)}:${Math.round(n.lat / cell)}`;
    const list = bucket.get(k);
    if (list) list.push(n.id);
    else bucket.set(k, [n.id]);
  }

  let stitched = 0;
  for (const ep of endpoints) {
    const from = g.nodes.get(ep.id);
    if (!from) continue;
    const cx = Math.round(from.lng / cell);
    const cy = Math.round(from.lat / cell);
    let best: { id: string; d: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const ids = bucket.get(`${cx + dx}:${cy + dy}`);
        if (!ids) continue;
        for (const id of ids) {
          if (id === ep.id) continue;
          // never link two nodes of the same way: that would create a shortcut through terrain
          const isSameWay = (g.adj.get(ep.id) ?? []).some((e) => e.b === id);
          if (isSameWay) continue;
          const n = g.nodes.get(id)!;
          const d = haversine({ lat: from.lat, lng: from.lng }, { lat: n.lat, lng: n.lng });
          if (d < 1 || d > 30) continue;
          if (!best || d < best.d) best = { id, d };
        }
      }
    }
    if (best) {
      const target = g.nodes.get(best.id)!;
      const already = (g.adj.get(ep.id) ?? []).some((e) => e.b === best!.id);
      if (!already) {
        addEdge(g, {
          a: ep.id,
          b: best.id,
          lengthM: best.d,
          ascentM: Math.max(0, target.elev - from.elev),
          descentM: Math.max(0, from.elev - target.elev),
          kind: 'walk',
          accessible: true,
          approximate: true, // stitched, not surveyed: the UI labels the leg accordingly
          label: 'unsurveyed connector',
        });
        stitched += 1;
      }
    }
  }
  (g as RouteGraph & { stitched?: number }).stitched = stitched;
  return g;
}

export const PROFILES: { id: Profile; label: string; hint: string }[] = [
  { id: 'fastest', label: 'Fastest', hint: 'Shortest walking time, includes steps' },
  { id: 'accessible', label: 'Step-free', hint: 'Avoids stairs, penalises steep ramps' },
  { id: 'shortest', label: 'Shortest', hint: 'Minimum distance, ignores effort' },
];

export function snapToNetwork(g: RouteGraph, lat: number, lng: number) {
  const n = nearestNode(g, lat, lng, 300);
  if (!n) return null;
  const p = localToLatLng(n.id === '' ? 0 : latLngToLocal(n.lat, n.lng).x, latLngToLocal(n.lat, n.lng).z);
  return { node: n, snapped: p };
}
