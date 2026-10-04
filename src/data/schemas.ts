/**
 * schemas.ts — runtime validation for every dataset the app consumes.
 * Bad data must fail loudly at load time, never silently render wrong geometry.
 */
import { z } from 'zod';

export const Confidence = z.enum(['surveyed', 'osm', 'derived', 'approximate', 'manual']);
export type ConfidenceT = z.infer<typeof Confidence>;

export const BuildingCategory = z.enum([
  'academic', 'hostel', 'dining', 'sports', 'admin', 'residential', 'medical',
  'utility', 'gate', 'guesthouse', 'library', 'lab', 'auditorium', 'school',
  'worship', 'parking', 'commerce', 'context', 'unknown',
]);
export type BuildingCategoryT = z.infer<typeof BuildingCategory>;

export const Ring = z.array(z.tuple([z.number(), z.number()])).min(3);

export const BuildingProps = z.object({
  id: z.string(),
  name: z.string(),
  named: z.boolean().optional(),
  zone: z.enum(['north', 'south', 'context', 'manual']).optional(),
  name_conf: z.string().optional(),
  cat_conf: z.string().optional(),
  entrance_lat: z.number().optional(),
  entrance_lng: z.number().optional(),
  entrance_dist_m: z.number().optional(),
  entrance_conf: z.string().optional(),
  /** v3.6: moved map NODE [lng, lat] — label anchor, search point, default route end */
  labelAt: z.tuple([z.number(), z.number()]).optional(),
  /** set when a manual override changed this building */
  overridden: z.boolean().optional(),
  manual_note: z.string().optional(),
  cat: BuildingCategory,
  area_m2: z.number().nonnegative(),
  scope: z.enum(['campus', 'context']),
  src: z.string(),
  conf: z.string(),
  floors: z.number().int().min(1).max(12),
  f2f: z.number().positive(),
  roof: z.enum(['flat', 'sloped', 'mono-pitch', 'multi-bay', 'shed', 'hipped']),
  pitch: z.number().min(0).max(60),
  roof_note: z.string().optional(),
  wall: z.string(),
  height_m: z.number().positive(),
  floor_note: z.string().optional(),
  dist_core_m: z.number().optional(),
});
export type BuildingPropsT = z.infer<typeof BuildingProps>;

export const BuildingFeature = z.object({
  type: z.literal('Feature'),
  id: z.string().optional(),
  properties: BuildingProps,
  geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring) }),
});

export const RoadFeature = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    id: z.string(),
    cls: z.string(),
    name: z.string().nullable().optional(),
    width_m: z.number().positive(),
    surface: z.string(),
    stairs: z.boolean(),
    accessible: z.boolean(),
    bridge: z.boolean(),
    tunnel: z.boolean(),
    src: z.string(),
  }),
  geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(z.tuple([z.number(), z.number()])).min(2) }),
});

export const Poi = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  cat: BuildingCategory.or(z.string()),
  lat: z.number(),
  lng: z.number(),
  aliases: z.array(z.string()).optional(),
  building_id: z.string().nullable().optional(),
  conf: z.string(),
  src: z.string(),
  note: z.string().nullable().optional(),
  zone: z.enum(['north', 'south', 'context', 'manual']).optional(),
  named: z.boolean().optional(),
  name_conf: z.string().optional(),
  cat_conf: z.string().optional(),
  entrance_conf: z.string().nullable().optional(),
});
export type PoiT = z.infer<typeof Poi>;

export const Tree = z.object({
  lat: z.number(),
  lon: z.number(),
  h: z.number(),
  r: z.number(),
  species: z.enum(['conifer', 'broadleaf']),
  conf: z.string(),
});

export const UnplacedItem = z.object({
  name: z.string(),
  cat: z.string(),
  why: z.string(),
  src: z.string(),
});

export const Manifest = z.object({
  generated: z.string(),
  generators: z.record(z.string()),
  counts: z.record(z.number()),
  confidence: z.record(z.number()),
  modelled_campus_floor_area_sqm: z.number(),
  published: z.object({
    north_campus_built_area_sqm: z.number(),
    academic_buildings_count: z.number(),
    academic_area_sqm: z.number(),
    hostel_blocks_total: z.number(),
    dining_blocks: z.number(),
    campus_area_acres: z.number(),
    sources: z.array(z.string()),
  }).passthrough(),
  coverage_note: z.string(),
  floors_unverified_count: z.number(),
});
export type ManifestT = z.infer<typeof Manifest>;
