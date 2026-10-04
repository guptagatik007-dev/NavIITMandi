/**
 * roadEdits.ts — MANUAL ROUTE LAYER.
 *
 * Two files live next to the building overrides:
 *
 *   public/data/manual/road_fixes.json     corrected geometry for generated roads
 *                                          { "road-id": [[lng,lat],…], … } — replaces
 *                                          the road's line before the graph builds
 *
 *   public/data/manual/roads_manual.json   brand-new paths drawn in the editor
 *
 * Both merge into the road list BEFORE buildOutdoorGraph(), then the connectivity
 * audit decides whether the merged graph is used (single component) or rejected.
 * Nothing auto-generated: a human drew or corrected every meter of these lines.
 */
import { z } from 'zod';

const R = 6371000;
import type { CampusRoad } from './loaders';
import { snapEndpointsToNetwork, closestOnSegment, toLocal } from '@/geo/polyOps';
import type { LngLat } from '@/geo/polyOps';

export const RoadFixesSchema = z.record(z.array(z.tuple([z.number(), z.number()])).min(2));
export type RoadFixes = z.infer<typeof RoadFixesSchema>;

export const ManualRoadSchema = z.object({
  id: z.string().regex(/^mroad-/),
  name: z.string().min(1).max(120).nullable().default(null),
  cls: z.enum(['footway', 'path', 'service', 'residential', 'track', 'steps']).default('footway'),
  width_m: z.number().min(0.6).max(14).default(1.5),
  surface: z.string().default('unpaved'),
  line: z.array(z.tuple([z.number(), z.number()])).min(2),
});
export type ManualRoad = z.infer<typeof ManualRoadSchema>;

export const ManualRoadsFileSchema = z.object({
  note: z.string().optional(),
  roads: z.array(ManualRoadSchema),
});

export const RoadFixesFileSchema = z.object({
  note: z.string().optional(),
  fixes: RoadFixesSchema,
  /** v3.1: generated roads deliberately removed from the network (user deletes, then redraws) */
  hidden: z.array(z.string()).optional(),
  /** v3.1: building entrance nodes — where a road terminates FOR a building (navigation end-node) */
  entrances: z.record(z.string(), z.tuple([z.number(), z.number()])).optional(),
});

export function serialiseRoadFixes(fixes: RoadFixes): string {
  const out: RoadFixes = {};
  Object.keys(fixes)
    .sort()
    .forEach((id) => (out[id] = fixes[id]));
  return JSON.stringify(
    {
      note: 'Corrected geometry for generated roads (exported from the in-app route editor). Values Replace the road line before the route graph builds.',
      fixes: out,
    },
    null,
    2,
  );
}

export function serialiseManualRoads(roads: ManualRoad[]): string {
  return JSON.stringify(
    {
      note: 'Paths/roads drawn by hand in the editor (start → waypoints → end) where the generated network was missing a connection.',
      roads: [...roads].sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    2,
  );
}

/**
 * Merge manual route work into the runtime road list.
 *  - road fixes REPLACE the matching road's line (id must exist)
 *  - manual roads are appended with endpoints snapped to the nearest existing
 *    network vertex (≤ 25 m) so they land exactly on a graph node and connect
 *  - unknown fix ids are reported and skipped, never crash
 */
export function mergeRoadSession(
  roads: CampusRoad[],
  fixes: RoadFixes,
  manual: ManualRoad[],
  issues?: string[],
): CampusRoad[] {
  let out = roads;
  const fixIds = Object.keys(fixes);
  if (fixIds.length > 0) {
    out = out.map((r) => {
      const f = fixes[r.id];
      if (!f) return r;
      return { ...r, line: f };
    });
    const known = new Set(out.map((r) => r.id));
    for (const id of fixIds) {
      if (!known.has(id)) issues?.push(`road_fixes.json: no road with id "${id}" exists (data re-baked?) — fix ignored`);
    }
  }
  if (manual.length > 0) {
    const networkVertices = out.flatMap((r) => r.line);
    const additions: CampusRoad[] = manual.map((m) => ({
      id: m.id,
      cls: m.cls,
      name: m.name,
      width_m: m.width_m,
      surface: m.surface,
      stairs: m.cls === 'steps',
      accessible: m.cls !== 'steps',
      bridge: false,
      tunnel: false,
      line: snapEndpointsToNetwork(m.line, networkVertices, 25),
    }));
    out = [...out, ...additions];
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §1 of the v3 blueprint: per-road ADMISSION instead of whole-session rollback.
 *
 * Why this exists (measured): the §4-era gate demanded connectivityShare(mine) ≥ 0.999
 * while the base OSM network measures 0.8846 — every hand-drawn road session was
 * silently thrown away. Here each road is admitted on its own evidence:
 *   - endpoints join by PROJECTION onto the nearest road segment (≤ ROAD_JOIN_M)
 *   - the join point is SPLIT INTO the base road line, so the graph node key is
 *     exactly shared (the old vertex-only snap could land mid-segment and stay
 *     disconnected even after the 8 m stitch pass)
 *   - one-end spurs (dead-end drives to hostels — the campus is full of them) are
 *     routable and correct, never rejected
 *   - roads connecting NOTHING are listed as issues with the measured gap, never
 *     silently dropped
 */
export const ROAD_JOIN_M = 60;

export interface RoadJoinIssue {
  id: string;
  name: string | null;
  gapM: number;
  end: 'start' | 'end';
}

export interface CheckedRoadMerge {
  roads: CampusRoad[];
  issues: RoadJoinIssue[];
  adoptedIds: string[];
  /** joins actually performed: road id → which ends snapped on */
  joined: Record<string, ('start' | 'end')[]>;
}

interface Projection {
  point: LngLat;
  distM: number;
  roadIdx: number;
  segIdx: number;
}

/** nearest point of the cursor onto any segment of the road list — projection, not vertex */
export function projectOntoNetwork(p: LngLat, roads: CampusRoad[]): Projection | null {
  const lat0 = p[1];
  const pl = toLocal(p, lat0);
  let best: Projection | null = null;
  roads.forEach((r, roadIdx) => {
    for (let i = 0; i + 1 < r.line.length; i++) {
      const a = toLocal(r.line[i], lat0);
      const b = toLocal(r.line[i + 1], lat0);
      const hit = closestOnSegment(pl, a, b);
      if (hit && (!best || hit.distM < best.distM)) {
        const k = Math.cos((lat0 * Math.PI) / 180);
        const back: LngLat = [(hit.point[0] * 180) / (Math.PI * R * k), (hit.point[1] * 180) / (Math.PI * R)];
        best = { point: [Number(back[0].toFixed(7)), Number(back[1].toFixed(7))], distM: hit.distM, roadIdx, segIdx: i };
      }
    }
  });
  return best;
}

/** Split a join point into the target road line so the graph node keys coincide. */
function splitAtJoin(roads: CampusRoad[], proj: Projection): void {
  const r = roads[proj.roadIdx];
  const key = (p: LngLat) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`;
  // already an existing vertex → nothing to split
  for (const v of r.line) if (key(v) === key(proj.point)) return;
  roads[proj.roadIdx] = { ...r, line: [...r.line.slice(0, proj.segIdx + 1), proj.point, ...r.line.slice(proj.segIdx + 1)] };
}

/**
 * v3.1 contract: `roads` arriving here must already exclude user-hidden roads.
 * (Hiding is applied by the caller so the connectivity baseline is measured against
 * the network the user actually wants, not the generated one.)
 */
export function mergeRoadSessionChecked(
  roads: CampusRoad[],
  fixes: RoadFixes,
  manual: ManualRoad[],
  issues?: string[],
): CheckedRoadMerge {
  // 1. fixes — same replacement semantics as before
  let out = roads;
  const fixIds = Object.keys(fixes);
  if (fixIds.length > 0) {
    out = out.map((r) => {
      const f = fixes[r.id];
      return f ? { ...r, line: f } : r;
    });
    const known = new Set(out.map((r) => r.id));
    for (const id of fixIds) {
      if (!known.has(id)) issues?.push(`road_fixes.json: no road with id "${id}" exists (data re-baked?) — fix ignored`);
    }
  }

  const result: CheckedRoadMerge = { roads: out, issues: [], adoptedIds: [], joined: {} };
  for (const m of manual) {
    if (m.line.length < 2) continue;
    // work on a copy of the line so rejected roads never mutate anything
    const line: LngLat[] = m.line.map((p) => [...p] as LngLat);
    const joinedEnds: ('start' | 'end')[] = [];
    const misses: { gapM: number; end: 'start' | 'end' }[] = [];
    const tryEnd = (idx: 0 | 1) => {
      const p = line[idx === 0 ? 0 : line.length - 1];
      const proj = projectOntoNetwork(p, out);
      // don't split onto our own line (self-joins are a no-op anyway)
      if (proj && proj.distM <= ROAD_JOIN_M && out[proj.roadIdx]?.id !== m.id) {
        splitAtJoin(out, proj);
        line[idx === 0 ? 0 : line.length - 1] = proj.point;
        joinedEnds.push(idx === 0 ? 'start' : 'end');
      } else {
        misses.push({ gapM: proj ? proj.distM : Infinity, end: idx === 0 ? 'start' : 'end' });
      }
    };
    tryEnd(0);
    tryEnd(1);

    if (joinedEnds.length === 0 && m.line.length > 0) {
      // joins to NOTHING → keep out of the network, but report loudly (§1.3.4)
      const bestMiss = misses.sort((a, b) => a.gapM - b.gapM)[0] ?? { gapM: Infinity, end: 'start' as const };
      result.issues.push({ id: m.id, name: m.name, gapM: Math.min(99999, bestMiss.gapM), end: bestMiss.end });
      continue;
    }
    result.adoptedIds.push(m.id);
    result.joined[m.id] = joinedEnds;
    out = [...out, {
      id: m.id,
      cls: m.cls,
      name: m.name,
      width_m: m.width_m,
      surface: m.surface,
      stairs: m.cls === 'steps',
      accessible: m.cls !== 'steps',
      bridge: false,
      tunnel: false,
      line,
    }];
    result.roads = out;
  }
  return result;
}

/** BFS connectivity audit: fraction of graph nodes reachable from the first node. */
export function connectivityShare(graph: { nodes: Map<string, unknown>; adj: Map<string, { b: string }[]> }): number {
  const ids = [...graph.nodes.keys()];
  if (ids.length === 0) return 1;
  const seen = new Set<string>([ids[0]]);
  const queue = [ids[0]];
  while (queue.length) {
    const id = queue.pop()!;
    for (const e of graph.adj.get(id) ?? []) {
      if (!seen.has(e.b)) {
        seen.add(e.b);
        queue.push(e.b);
      }
    }
  }
  return seen.size / ids.length;
}
