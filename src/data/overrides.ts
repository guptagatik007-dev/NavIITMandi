/**
 * overrides.ts — MANUAL CORRECTION LAYER.
 *
 * Everything the automatic pipeline gets wrong must be fixable by hand, permanently,
 * without touching the generator. Three files, all optional, all hand-editable:
 *
 *   public/data/manual/overrides.json          per-building fixes (name, category,
 *                                              floors, height, roof, wall, opacity …)
 *   public/data/manual/buildings.geojson       whole buildings the ML data missed
 *   public/data/manual/labels.json             labels for things that are not buildings
 *                                              (gates, viewpoints, statues, ATMs)
 *
 * The in-app editor (right rail → Edit, opened with ?edit=1) writes exactly these
 * shapes, so a correction made on site can be exported and committed as-is.
 *
 * Confidence handling: anything that comes from these files is tagged "manual" and is
 * shown in the UI as human-verified, which is a stronger claim than the derived
 * defaults — so the file records WHO and WHEN.
 */
import { z } from 'zod';

export const RoofShape = z.enum(['flat', 'sloped', 'mono-pitch', 'multi-bay', 'shed', 'hipped']);
export const CatEnum = z.enum([
  'academic', 'hostel', 'dining', 'sports', 'admin', 'residential', 'medical',
  'utility', 'gate', 'guesthouse', 'library', 'lab', 'auditorium', 'school',
  'worship', 'parking', 'commerce', 'context', 'unknown',
]);

export const BuildingOverrideSchema = z.object({
  name: z.string().min(1).optional(),
  cat: CatEnum.optional(),
  floors: z.number().int().min(1).max(14).optional(),
  height_m: z.number().min(2).max(90).optional(),
  roof: RoofShape.optional(),
  pitch: z.number().min(0).max(60).optional(),
  wall: z.string().optional(),
  /** 0.05–1. A building at < 1 is rendered in its own transparent batch. */
  opacity: z.number().min(0.05).max(1).optional(),
  /** raise/lower the cut platform relative to the terrain maximum under the footprint */
  seatOffsetM: z.number().min(-12).max(12).optional(),
  /** hide entirely (e.g. a footprint that is actually a ruin or a tank) */
  hidden: z.boolean().optional(),
  /** draw a hand-authored .glb instead of the procedural massing */
  modelPath: z.string().optional(),
  /** replaces the automatic label text on the map */
  labelText: z.string().optional(),
  /** vertical offset for that label, metres */
  labelOffsetM: z.number().min(-20).max(60).optional(),
  /** never show a label for this building */
  labelHidden: z.boolean().optional(),
  /** v3.6: move the building's map NODE — 2D/3D label anchor + search-result point +
   * default route destination when no door is set. Freely placed (no road snap),
   * because its job is where the building's identity lives, not where you walk to. */
  labelAt: z.tuple([z.number(), z.number()]).optional(),
  /** reshaped footprint ([lng, lat], closed ring) — replaces the outline entirely */
  ring: z.array(z.tuple([z.number(), z.number()])).min(4).optional(),
  /** v3.1: the building's DOOR — the point where navigation terminates. Setting it via
   * Edit → Set entrance snaps a real-door point ONTO a road so the network genuinely
   * has a node-end-node to route to (routes end at the door, not the centroid). */
  entrance_lat: z.number().optional(),
  entrance_lng: z.number().optional(),
  /** free text: who checked this and against what */
  note: z.string().optional(),
  verifiedBy: z.string().optional(),
  verifiedOn: z.string().optional(),
});
export type BuildingOverride = z.infer<typeof BuildingOverrideSchema>;

export const OverridesFileSchema = z.object({
  note: z.string().optional(),
  /** buildingId → override */
  buildings: z.record(BuildingOverrideSchema).default({}),
});
export type OverridesFile = z.infer<typeof OverridesFileSchema>;

/** Extra footprint drawn by hand; same property set as the generated buildings. */
export const ManualBuildingProps = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cat: CatEnum.default('unknown'),
  floors: z.number().int().min(1).max(14).default(2),
  f2f: z.number().min(2.4).max(8).default(3.6),
  roof: RoofShape.default('flat'),
  pitch: z.number().min(0).max(60).default(0),
  wall: z.string().default('plaster_paint_white'),
  entrance_lat: z.number().optional(),
  entrance_lng: z.number().optional(),
  note: z.string().optional(),
  verifiedBy: z.string().optional(),
  verifiedOn: z.string().optional(),
});

export const ManualBuildingsSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: z.string().optional(),
      properties: ManualBuildingProps,
      geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }),
    }),
  ).default([]),
});
export type ManualBuildings = z.infer<typeof ManualBuildingsSchema>;
export type ManualBuildingPropsT = z.infer<typeof ManualBuildingProps>;

export const ManualLabelsSchema = z.object({
  note: z.string().optional(),
  labels: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1),
        lat: z.number(),
        lng: z.number(),
        /** visual weight: 'primary' | 'secondary' */
        tier: z.enum(['primary', 'secondary']).default('primary'),
        /** optional elevation of the ground at that point (MSL); sampled if omitted */
        elevM: z.number().optional(),
        offsetM: z.number().min(-10).max(60).default(6),
        note: z.string().optional(),
      }),
    )
    .default([]),
});
export type ManualLabels = z.infer<typeof ManualLabelsSchema>;
export type ManualLabel = ManualLabels['labels'][number];

export const EMPTY_OVERRIDES: OverridesFile = { buildings: {} };

/** Merge an override into a building record, recomputing derived values coherently. */
export function applyOverride<T extends { floors: number; f2f: number; height_m: number }>(
  building: T,
  ov: BuildingOverride | undefined,
): T {
  if (!ov) return building;
  const next: T = { ...building };
  if (ov.floors !== undefined) next.floors = ov.floors;
  if (ov.height_m !== undefined) next.height_m = ov.height_m;
  else if (ov.floors !== undefined) next.height_m = Math.round((ov.floors * next.f2f + 1.0) * 100) / 100;
  return next;
}

/** Serialise the two editable structures back into file text for commit. */
export function serialiseOverrides(map: Map<string, BuildingOverride>): string {
  const buildings: Record<string, BuildingOverride> = {};
  for (const [id, ov] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    buildings[id] = ov;
  }
  return (
    JSON.stringify(
      {
        note: 'Manual corrections to the generated campus model. Exported from the in-app editor. Anything listed here overrides the derived defaults and is treated as human-verified.',
        buildings,
      },
      null,
      2,
    ) + '\n'
  );
}

export function serialiseManualBuildings(
  features: ManualBuildings['features'],
): string {
  return (
    JSON.stringify(
      {
        type: 'FeatureCollection',
        note: 'Footprints added by hand where the OSM/Overture data had nothing. Coordinates are WGS84 lon/lat. Draw them in the in-app editor (?edit=1) and paste the export here.',
        features,
      },
      null,
      2,
    ) + '\n'
  );
}

export function serialiseLabels(labels: ManualLabel[]): string {
  return (
    JSON.stringify(
      {
        note: 'Labels for things that are not buildings (gates, viewpoints, water points, ATM, statue…). Rendered with the same style, font and size as building labels.',
        labels,
      },
      null,
      2,
    ) + '\n'
  );
}
