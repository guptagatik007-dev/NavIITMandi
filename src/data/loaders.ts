/**
 * loaders.ts — single place that fetches, validates and MERGES the campus dataset.
 *
 * Order of authority (lowest → highest):
 *   1. generated data        public/data/*.geojson|json          (OSM + Overture + DEM)
 *   2. manual additions      public/data/manual/buildings.geojson
 *   3. manual overrides      public/data/manual/overrides.json    ← always wins
 *
 * All URLs are relative, so the app works behind any proxy or sub-path with no config.
 * Every file except the core three is optional; a missing manual file is normal.
 */
import { z } from 'zod';
import { BuildingFeature, RoadFeature, Poi, Tree, Manifest, UnplacedItem, type ManifestT, type PoiT } from './schemas';
import type { BuildingPropsT } from './schemas';
import {
  ManualBuildingsSchema,
  ManualLabelsSchema,
  OverridesFileSchema,
  type BuildingOverride,
  type ManualBuildingPropsT,
  type ManualLabel,
} from './overrides';
import { RoadFixesFileSchema, ManualRoadsFileSchema, mergeRoadSession, type RoadFixes, type ManualRoad } from './roadEdits';

export interface CampusBuilding extends BuildingPropsT {
  ring: [number, number][];
  /** true when a hand-written override or manual footprint produced this record */
  manual?: boolean;
  /** kept in the runtime data so the editor can restore a hidden building */
  hidden?: boolean;
}
export interface CampusRoad {
  id: string;
  cls: string;
  name: string | null;
  width_m: number;
  surface: string;
  stairs: boolean;
  accessible: boolean;
  bridge: boolean;
  tunnel: boolean;
  line: [number, number][];
}
export interface CampusArea {
  id: string;
  kind: string;
  closed: boolean;
  name?: string | null;
  line: [number, number][];
}
export interface CampusTree {
  lat: number;
  lon: number;
  h: number;
  r: number;
  species: 'conifer' | 'broadleaf';
}
type UnplacedItemT = z.infer<typeof UnplacedItem>;

export interface CampusData {
  manifest: ManifestT;
  buildings: CampusBuilding[];
  roads: CampusRoad[];
  areas: CampusArea[];
  pois: PoiT[];
  trees: CampusTree[];
  unplaced: UnplacedItemT[];
  floorsUnverified: Set<string>;
  /** render-time overrides (opacity, seating, hidden, model path) keyed by building id */
  overrides: Map<string, BuildingOverride>;
  /** labels for non-building places, hand-authored */
  manualLabels: ManualLabel[];
  /** human-readable problems found while merging manual data — surfaced in the UI */
  manualIssues: string[];
}

const json = async (path: string) => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

/** Optional file: 404 and SPA-fallback HTML both mean "not provided". */
const jsonOptional = async (path: string): Promise<unknown | null> => {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) return null;
    const text = await r.text();
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
};

let promise: Promise<CampusData> | null = null;

export function loadCampusData(): Promise<CampusData> {
  if (!promise) promise = load();
  return promise;
}

const ANCHORS_FOR_ZONE = { south: { lat: 31.77555, lng: 76.98654 }, north: { lat: 31.7813, lng: 76.9975 } };

function zoneOf(lat: number, lng: number): 'north' | 'south' {
  const d = (a: { lat: number; lng: number }) => Math.hypot(a.lat - lat, (a.lng - lng) * Math.cos((lat * Math.PI) / 180));
  return d(ANCHORS_FOR_ZONE.south) <= d(ANCHORS_FOR_ZONE.north) ? 'south' : 'north';
}

async function load(): Promise<CampusData> {
  const [rawBuildings, rawRoads, rawAreas, rawPois, rawTrees, rawUnplaced, manifest, floorsUnverified, rawOverrides, rawManualBuildings, rawManualLabels, rawRoadFixes, rawManualRoads] =
    await Promise.all([
      json('data/buildings.geojson'),
      json('data/roads.geojson'),
      json('data/areas.geojson'),
      json('data/pois.json'),
      json('data/vegetation.json'),
      json('data/unplaced.json'),
      json('data/data.manifest.json'),
      json('data/floors-unverified.json'),
      jsonOptional('data/manual/overrides.json'),
      jsonOptional('data/manual/buildings.geojson'),
      jsonOptional('data/manual/labels.json'),
      jsonOptional('data/manual/road_fixes.json'),
      jsonOptional('data/manual/roads_manual.json'),
    ]);

  const manualIssues: string[] = [];

  // ── generated buildings ────────────────────────────────────────────────────
  const buildings: CampusBuilding[] = z
    .array(BuildingFeature)
    .parse(rawBuildings.features)
    .map((f) => ({ ...f.properties, ring: f.geometry.coordinates[0] as [number, number][] }));

  // ── manual footprint additions ─────────────────────────────────────────────
  if (rawManualBuildings) {
    const parsed = ManualBuildingsSchema.safeParse(rawManualBuildings);
    if (!parsed.success) {
      manualIssues.push(`manual/buildings.geojson did not validate: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    } else {
      parsed.data.features.forEach((f, i) => {
        const p: ManualBuildingPropsT = f.properties;
        const ring = f.geometry.coordinates[0] as [number, number][];
        if (ring.length < 3) {
          manualIssues.push(`manual building "${p.name}" (#${i}) has ${ring.length} vertices — needs at least 3`);
          return;
        }
        const cLat = ring.reduce((s, q) => s + q[1], 0) / ring.length;
        const cLng = ring.reduce((s, q) => s + q[0], 0) / ring.length;
        buildings.push({
          id: p.id,
          name: p.name,
          named: true,
          cat: p.cat,
          area_m2: 0,
          scope: 'campus',
          src: `Manual footprint${p.verifiedBy ? ` — verified by ${p.verifiedBy}` : ''}`,
          conf: 'manual',
          floors: p.floors,
          f2f: p.f2f,
          roof: p.roof,
          pitch: p.pitch,
          wall: p.wall,
          height_m: Math.round((p.floors * p.f2f + 1) * 100) / 100,
          zone: zoneOf(cLat, cLng),
          name_conf: 'manual',
          cat_conf: 'manual',
          entrance_lat: p.entrance_lat ?? cLat,
          entrance_lng: p.entrance_lng ?? cLng,
          entrance_conf: p.entrance_lat != null ? 'manual' : 'derived',
          manual_note: p.note,
          manual: true,
          ring,
        });
      });
    }
  }

  // ── manual overrides (highest authority) ───────────────────────────────────
  const overrides = new Map<string, BuildingOverride>();
  if (rawOverrides) {
    const parsed = OverridesFileSchema.safeParse(rawOverrides);
    if (!parsed.success) {
      manualIssues.push(`manual/overrides.json did not validate: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    } else {
      const byId = new Map(buildings.map((b) => [b.id, b]));
      for (const [id, ov] of Object.entries(parsed.data.buildings)) {
        overrides.set(id, ov);
        const target = byId.get(id);
        if (!target) {
          manualIssues.push(`override for "${id}" does not match any building id (typo, or the data was re-baked)`);
          continue;
        }
        if (ov.name !== undefined) target.name = ov.name;
        if (ov.cat !== undefined) target.cat = ov.cat;
        if (ov.floors !== undefined) target.floors = ov.floors;
        if (ov.height_m !== undefined) target.height_m = ov.height_m;
        else if (ov.floors !== undefined) target.height_m = Math.round((ov.floors * target.f2f + 1) * 100) / 100;
        if (ov.roof !== undefined) target.roof = ov.roof;
        if (ov.pitch !== undefined) target.pitch = ov.pitch;
        if (ov.wall !== undefined) target.wall = ov.wall;
        if (ov.ring !== undefined && ov.ring.length >= 4) target.ring = ov.ring;
        target.overridden = true;
        target.hidden = Boolean(ov.hidden);
        target.manual_note = ov.note;
        target.conf = 'manual';
        target.named = true;
        if (ov.labelHidden) target.name_conf = 'manual-hidden';
      }
    }
  }

  // ── roads / areas / trees ──────────────────────────────────────────────────
  let roads: CampusRoad[] = z
    .array(RoadFeature)
    .parse(rawRoads.features)
    .map((f) => ({
      id: f.properties.id,
      cls: f.properties.cls,
      name: f.properties.name ?? null,
      width_m: f.properties.width_m,
      surface: f.properties.surface,
      stairs: f.properties.stairs,
      accessible: f.properties.accessible,
      bridge: f.properties.bridge,
      tunnel: f.properties.tunnel,
      line: f.geometry.coordinates as [number, number][],
    }));

  // ── committed manual route layer (fixed geometry + hand-drawn paths) ───────
  {
    let fixes: RoadFixes = {};
    let manualRoads: ManualRoad[] = [];
    if (rawRoadFixes) {
      const parsed = RoadFixesFileSchema.safeParse(rawRoadFixes);
      if (!parsed.success) {
        manualIssues.push(`manual/road_fixes.json did not validate: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
      } else {
        fixes = parsed.data.fixes;
        // v3.1: user-deleted generated roads stay deleted permanently (they exist in
        // the file by deliberate action, never by accident)
        if (parsed.data.hidden && parsed.data.hidden.length > 0) {
          const hide = new Set(parsed.data.hidden);
          const before = roads.length;
          roads = roads.filter((r) => !hide.has(r.id));
          const dropped = before - roads.length;
          if (dropped > 0) manualIssues.push(`${dropped} generated road(s) hidden by manual/road_fixes.json — restore via Edit → Routes → Hidden roads`);
        }
      }
    }
    if (rawManualRoads) {
      const parsed = ManualRoadsFileSchema.safeParse(rawManualRoads);
      if (!parsed.success) {
        manualIssues.push(`manual/roads_manual.json did not validate: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
      } else {
        manualRoads = parsed.data.roads;
      }
    }
    if (Object.keys(fixes).length > 0 || manualRoads.length > 0) {
      roads = mergeRoadSession(roads, fixes, manualRoads, manualIssues);
    }
  }

  const areas: CampusArea[] = z
    .array(
      z.object({
        type: z.literal('Feature'),
        properties: z.object({
          id: z.string(),
          kind: z.string(),
          closed: z.boolean(),
          name: z.string().nullable().optional(),
        }),
        geometry: z.object({ type: z.enum(['Polygon', 'LineString']), coordinates: z.array(z.any()) }),
      }),
    )
    .parse(rawAreas.features)
    .map((f) => ({
      id: f.properties.id,
      kind: f.properties.kind,
      closed: f.properties.closed,
      name: f.properties.name ?? null,
      line: (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates) as [number, number][],
    }));

  const trees: CampusTree[] = z
    .array(Tree)
    .parse(rawTrees.trees)
    .map((t) => ({ lat: t.lat, lon: t.lon, h: t.h, r: t.r, species: t.species }));

  const unplaced = z.array(UnplacedItem).parse(rawUnplaced.items);
  const man = Manifest.parse(manifest);

  // ── POIs: merge generated POIs with overridden names, then add manual ones ──
  const pois: PoiT[] = z.array(Poi).parse(rawPois.pois);
  const poiById = new Map(pois.map((p) => [p.id, p]));
  for (const b of buildings) {
    const poi = poiById.get(`poi-${b.id}`);
    const ov = overrides.get(b.id);
    if (poi) {
      if (ov?.name) poi.name = ov.name;
      if (ov?.cat) poi.cat = ov.cat;
      if (b.entrance_lat != null && b.entrance_lng != null) {
        poi.lat = b.entrance_lat;
        poi.lng = b.entrance_lng;
      } else if (b.labelAt != null) {
        poi.lat = b.labelAt[1];
        poi.lng = b.labelAt[0];
      }
    } else if (b.manual || b.scope === 'campus') {
      pois.push({
        id: `poi-${b.id}`,
        name: b.name,
        kind: 'building',
        cat: b.cat,
        lat: b.entrance_lat ?? b.labelAt?.[1] ?? b.ring.reduce((s, q) => s + q[1], 0) / b.ring.length,
        lng: b.entrance_lng ?? b.labelAt?.[0] ?? b.ring.reduce((s, q) => s + q[0], 0) / b.ring.length,
        aliases: [b.name.toLowerCase()],
        building_id: b.id,
        conf: b.conf,
        src: b.src,
        zone: b.zone,
        named: b.named,
      });
    }
  }

  // ── manual labels (non-building places) ────────────────────────────────────
  let manualLabels: ManualLabel[] = [];
  if (rawManualLabels) {
    const parsed = ManualLabelsSchema.safeParse(rawManualLabels);
    if (!parsed.success) {
      manualIssues.push(`manual/labels.json did not validate: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    } else {
      manualLabels = parsed.data.labels;
    }
  }

  return {
    manifest: man,
    buildings,
    roads,
    areas,
    pois,
    trees,
    unplaced,
    floorsUnverified: new Set<string>(floorsUnverified.ids),
    overrides,
    manualLabels,
    manualIssues,
  };
}

export function manualStats(data: CampusData) {
  return {
    overridden: [...data.overrides.keys()].length,
    manualBuildings: data.buildings.filter((b) => b.manual).length,
    manualLabels: data.manualLabels.length,
    issues: data.manualIssues,
  };
}
