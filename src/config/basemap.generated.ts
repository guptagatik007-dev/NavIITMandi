/**
 * basemap.generated.ts — WRITTEN BY tools/bake_tiles.py. Do not edit by hand.
 *
 * Baked basemap extents. The app imports these synchronously so the scene origin and the
 * imagery extents can never drift apart.
 * Generated: 2026-09-12T13:17:47Z
 */
export const BASEMAP_META = {
  bbox: { west: 76.975, south: 31.768, east: 77.006, north: 31.789 },
  imagery: {
    zoom: 18,
    width: 5778,
    height: 4605,
    mpp: 0.5076,
    attribution: "Imagery (c) Esri, Maxar, Earthstar Geographics",
  },
  terrain: {
    grid: [768, 614],
    minM: 954.19,
    maxM: 1660.84,
    source: "AWS Terrain Tiles (terrarium), z15",
    nodataPolicy: "terrarium invalid pixels masked + nearest-neighbour inpainted (470938/471552 cells valid before inpainting)",
  },
} as const;
