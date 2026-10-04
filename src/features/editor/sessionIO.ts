/**
 * sessionIO.ts — TEAMWORK: one file carries a whole editing session.
 *
 * The app stores edits in the browser (localStorage) by design — no silent writes
 * to shared data. For group work that means each member's edits live on their own
 * machine. A *session file* solves hand-off: export yours, send it (WhatsApp /
 * Drive / email), the integrator imports every member's file and the sessions
 * merge with explicit conflict rules:
 *
 *   - disjoint work (different buildings/roads/labels) merges cleanly — always
 *   - same building edited by two people: fields you already set are kept
 *     (first import wins), only untouched fields are filled — never silently
 *     overwritten; conflicts are listed
 *   - every import is one undo step (Ctrl+Z), so a bad merge is always reversible
 *
 * The merged result exports to the same public/data/manual/ files as before.
 */
import { z } from 'zod';
import { BuildingOverrideSchema, ManualBuildingProps, ManualLabelsSchema, type BuildingOverride, type ManualLabel } from '@/data/overrides';
import { ManualRoadSchema, RoadFixesSchema, type ManualRoad, type RoadFixes } from '@/data/roadEdits';
import type { PendingBuilding } from '@/store/editStore';

export const SESSION_VERSION = 1;

export const SessionFileSchema = z.object({
  app: z.literal('iitmandi-nav-edits'),
  version: z.number().int().min(1).max(SESSION_VERSION),
  author: z.string().default('unknown teammate'),
  exportedAt: z.string().optional(),
  zone: z.string().optional(),
  saved: z.record(BuildingOverrideSchema),
  addedBuildings: z.array(
    z.object({
      properties: ManualBuildingProps,
      ring: z.array(z.tuple([z.number(), z.number()])).min(4),
    }),
  ),
  addedLabels: ManualLabelsSchema.shape.labels,
  roadEdits: RoadFixesSchema,
  addedRoads: z.array(ManualRoadSchema),
  // v3.1 road workbench — optional so v2.x session files still import cleanly
  hiddenRoads: z.array(z.string()).default([]),
  // v3.2: global datum slide applied to generated content (metres east/north)
  datum: z.object({ dxM: z.number(), dyM: z.number() }).default({ dxM: 0, dyM: 0 }),
});

export interface SessionSnapshot {
  saved: Record<string, BuildingOverride>;
  addedBuildings: PendingBuilding[];
  addedLabels: ManualLabel[];
  roadEdits: RoadFixes;
  addedRoads: ManualRoad[];
  /** v3.1+ — absent in older session fixtures/files; treated as empty */
  hiddenRoads?: string[];
  /** v3.2+ — absent in older files; treated as no slide */
  datum?: { dxM: number; dyM: number };
}

export type SessionFile = z.infer<typeof SessionFileSchema>;

export function serialiseSession(snap: SessionSnapshot, author: string, zone?: string): string {
  const payload: SessionFile = {
    app: 'iitmandi-nav-edits',
    version: SESSION_VERSION,
    author: author.trim() || 'unknown teammate',
    exportedAt: new Date().toISOString(),
    ...(zone?.trim() ? { zone: zone.trim() } : {}),
    saved: Object.fromEntries(Object.entries(snap.saved).sort((a, b) => a[0].localeCompare(b[0]))),
    addedBuildings: snap.addedBuildings,
    addedLabels: snap.addedLabels,
    roadEdits: Object.fromEntries(Object.entries(snap.roadEdits).sort((a, b) => a[0].localeCompare(b[0]))),
    addedRoads: [...snap.addedRoads].sort((a, b) => a.id.localeCompare(b.id)),
    hiddenRoads: [...(snap.hiddenRoads ?? [])].sort(),
    datum: snap.datum ?? { dxM: 0, dyM: 0 },
  };
  return JSON.stringify(payload, null, 2);
}

export interface StoreSnapshot extends SessionSnapshot { hiddenRoads: string[]; datum: { dxM: number; dyM: number } }

export interface MergeResult {
  merged: StoreSnapshot;
  applied: { buildings: number; addedBuildings: number; labels: number; roadFixes: number; roads: number };
  conflicts: string[];
}

/**
 * First-wins merge of an incoming session into the current one.
 * Field-granular for building overrides (incoming only fills fields you have not
 * touched), id-granular elsewhere (duplicate ids = conflict, incoming skipped).
 */
export function mergeSession(current: SessionSnapshot, incoming: SessionSnapshot): MergeResult {
  const conflicts: string[] = [];
  const applied = { buildings: 0, addedBuildings: 0, labels: 0, roadFixes: 0, roads: 0 };

  const saved = { ...current.saved };
  for (const [id, ov] of Object.entries(incoming.saved)) {
    const mine = saved[id];
    if (!mine) {
      saved[id] = ov;
      applied.buildings++;
      continue;
    }
    const mergedOv: BuildingOverride = { ...mine };
    let grown = false;
    for (const [k, v] of Object.entries(ov)) {
      if (v === undefined) continue;
      const key = k as keyof BuildingOverride;
      if (mergedOv[key] === undefined) {
        (mergedOv as Record<string, unknown>)[key] = v;
        grown = true;
      } else if (JSON.stringify(mergedOv[key]) !== JSON.stringify(v)) {
        conflicts.push(`${id} · field "${k}": kept yours, skipped teammate's value`);
      }
    }
    if (grown) {
      saved[id] = mergedOv;
      applied.buildings++;
    }
  }

  const myBuildingIds = new Set(current.addedBuildings.map((b) => b.properties.id));
  const addedBuildings = [...current.addedBuildings];
  for (const b of incoming.addedBuildings) {
    if (myBuildingIds.has(b.properties.id)) {
      conflicts.push(`added building ${b.properties.id}: kept yours`);
      continue;
    }
    addedBuildings.push(b);
    applied.addedBuildings++;
  }

  const myLabelIds = new Set(current.addedLabels.map((l) => l.id));
  const addedLabels = [...current.addedLabels];
  for (const l of incoming.addedLabels) {
    if (myLabelIds.has(l.id)) {
      conflicts.push(`label ${l.id}: kept yours`);
      continue;
    }
    addedLabels.push(l);
    applied.labels++;
  }

  const roadEdits = { ...current.roadEdits };
  for (const [id, line] of Object.entries(incoming.roadEdits)) {
    if (roadEdits[id] !== undefined) {
      if (JSON.stringify(roadEdits[id]) !== JSON.stringify(line)) conflicts.push(`road fix ${id}: kept yours`);
      continue;
    }
    roadEdits[id] = line;
    applied.roadFixes++;
  }

  const myRoadIds = new Set(current.addedRoads.map((r) => r.id));
  const addedRoads = [...current.addedRoads];
  for (const r of incoming.addedRoads) {
    if (myRoadIds.has(r.id)) {
      conflicts.push(`manual road ${r.id}: kept yours`);
      continue;
    }
    addedRoads.push(r);
    applied.roads++;
  }

  // v3.1: hidden roads merge by set-union
  const hiddenRoads = [...new Set([...(current.hiddenRoads ?? []), ...(incoming.hiddenRoads ?? [])])];
  // v3.2: datum — nonzero wins; if both nonzero and different, keep yours (first-writer)
  const datum = current.datum && (current.datum.dxM !== 0 || current.datum.dyM !== 0) ? current.datum : (incoming.datum ?? { dxM: 0, dyM: 0 });

  return {
    merged: { saved, addedBuildings, addedLabels, roadEdits, addedRoads, hiddenRoads, datum },
    applied,
    conflicts,
  };
}
