/**
 * map.config.ts — georeferencing anchors, projection constants, tile providers.
 *
 * Every number here is traceable to a source. Changing an anchor moves the whole
 * scene, so anchors are documented inline and validated by tools/verify_accuracy.py.
 */
import { BASEMAP_META } from './basemap.generated';

/** Bounding box of the baked campus basemap (source of truth for terrain + ortho). */
export const BBOX = BASEMAP_META.bbox;

/** Scene origin: centre of the baked basemap. Local (0,0,0) sits here, at mean campus height. */
export const ORIGIN = {
  lat: (BBOX.north + BBOX.south) / 2,
  lon: (BBOX.west + BBOX.east) / 2,
};

/**
 * Named anchors used for verification and for "fly to" shortcuts.
 * Sources:
 *  - south_core  : OSM node "IIT Mandi South Campus" (amenity=college), 31.77555, 76.98654
 *  - north_core  : OSM way 761379545 "IIT Mandi - North Campus" (amenity=university), 31.78130, 76.99750
 *  - transit     : OSM node "IIT Mandi - Transit Campus" (Mandi city, NOT modelled in this scene)
 * These are dataset-derived coordinates, i.e. confidence "osm", not a GNSS survey.
 */
export const ANCHORS = {
  south_core: { lat: 31.77555, lng: 76.98654, label: 'South Campus (Kamand)' },
  north_core: { lat: 31.7813, lng: 76.9975, label: 'North Campus (Salgi)' },
  transit_campus: { lat: 31.70629, lng: 76.93867, label: 'Transit Campus (Mandi city)' },
} as const;

export const CRS = {
  geographic: 'EPSG:4326',
  utm: 'EPSG:32643', // UTM zone 43N — use for survey/CAD imports
  ellipsoid: 'WGS84',
} as const;

/** Hard performance budgets from the project spec. Surfaced in the dev HUD. */
export const BUDGETS = {
  drawCallsVisible: 150,
  trianglesVisible: 400_000,
  frameMsDesktop: 16.7,
  frameMsMobile: 33.3,
  glbPayloadMb: 25,
  mainBundleKbGzip: 350,
} as const;

export const TIERS = {
  high: { terrainSegW: 256, terrainSegH: 205, shadows: false, dpr: 1.75, trees: 2800, labels: true },
  mid: { terrainSegW: 192, terrainSegH: 154, shadows: false, dpr: 1.5, trees: 1600, labels: true },
  low: { terrainSegW: 128, terrainSegH: 102, shadows: false, dpr: 1.25, trees: 700, labels: false },
} as const;
export type Tier = keyof typeof TIERS;

/** Sun presets — the misty morning is the authentic Kamand look. */
/**
 * Sky/light/fog presets.
 *
 * `fog` is the density of an exponential-squared fog, so effective visibility falls off
 * as exp(−(d·distance)²). The campus is read from ~400 m (close) to ~1400 m (the default
 * framing) and the whole valley from up to 4200 m, so these densities are all tuned for
 * that range. The previous `misty-morning` default (0.0013) left **2% visibility** at the
 * default framing — a total whiteout that erased the terrain and reduced every building to
 * a sliver, which is exactly the "everything is a grey wash / buildings look transparent"
 * report. tests/fog.test.ts now fails if any preset fogs the default view out again.
 */
export const SUN_PRESETS = {
  'clear-noon': { label: 'Clear noon', hour: 12.5, turbidity: 6, rayleigh: 1.2, fog: 0.00018, fogColor: '#cfe0e6', exposure: 1.05, emissive: 0 },
  'misty-morning': { label: 'Misty morning', hour: 7.4, turbidity: 9, rayleigh: 3.0, fog: 0.0005, fogColor: '#c6d3d2', exposure: 0.98, emissive: 0.15 },
  'clear-afternoon': { label: 'Clear afternoon', hour: 15.6, turbidity: 5, rayleigh: 1.6, fog: 0.00022, fogColor: '#dbe7e6', exposure: 1.06, emissive: 0 },
  evening: { label: 'Evening', hour: 18.3, turbidity: 8, rayleigh: 2.4, fog: 0.00032, fogColor: '#e5cdb6', exposure: 1.0, emissive: 0.5 },
  night: { label: 'Night', hour: 21.5, turbidity: 4, rayleigh: 1.0, fog: 0.0004, fogColor: '#0d1a20', exposure: 1.15, emissive: 1.0 },
} as const;

/** The preset the app opens with — a clear, readable Himalayan afternoon. */
export const DEFAULT_SUN_PRESET: SunPresetId = 'clear-afternoon';
export type SunPresetId = keyof typeof SUN_PRESETS;

/**
 * Basemap sources. OFFLINE FIRST: the baked campus image/tileship is used by default so
 * the app works with no network at all (required for the sandboxed preview and the
 * campus-offline tier). Live providers are opt-in and clearly labelled.
 */
export const BASEMAP = {
  offlineImage: { url: 'data/ortho/campus.jpg', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  liveSatellite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics (live)',
  },
} as const;

/**
 * POI kinds that never earn a permanent on-map label.
 *
 * `alcohol` is an OSM shop tag (a liquor vendor), not a wayfinding destination; it was
 * ranking top and labelling a hilltop in the north campus. These places stay in the data
 * and remain **searchable** — they are simply not pushed onto the map unasked.
 */
export const UNLABELLED_POI_KINDS: ReadonlySet<string> = new Set(['alcohol', 'tobacco', 'beverages']);

/** Commercial POI kinds: searchable, but ranked last so they never displace campus places. */
export const SHOP_POI_KINDS: ReadonlySet<string> = new Set([
  'cafe', 'restaurant', 'fast_food', 'convenience', 'supermarket', 'kiosk', 'shop', 'bar', 'pub', 'fuel',
]);

export const ATTRIBUTIONS = [
  'Footprints: OpenStreetMap contributors (ODbL) + Overture Maps 2026-08-19.0',
  'Terrain: AWS Open Data Terrain Tiles / Mapzen',
  'Imagery: Esri World Imagery, Maxar, Earthstar Geographics',
  'Institute facility figures: infra.iitmandi.ac.in, students.iitmandi.ac.in',
] as const;

/** Default camera framing for the campus. */
export const CAMERA_DEFAULTS = {
  lat: 31.77725,
  lng: 76.9915,
  zoom: 15.2,
  bearing: -18,
  pitch: 62,
  maxPitch: 85,
  minDistance: 12,
  maxDistance: 2600,
  walkEyeHeightM: 1.65,
} as const;
