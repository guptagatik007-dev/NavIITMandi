/**
 * Test fixtures read the REAL baked campus data from public/data.
 * These tests are the guard rail for accuracy: if a bake changes the data shape or the
 * projection drifts, they fail here rather than silently in the browser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { TerrainGrid } from '@/geo/terrain';
import { buildOutdoorGraph, type RouteGraph } from '@/geo/routing';
import type { CampusBuilding, CampusRoad } from '@/data/loaders';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = path.join(root, 'public', 'data');

const readJson = (rel: string) => JSON.parse(readFileSync(path.join(dataDir, rel), 'utf8'));

export function loadTerrain(): TerrainGrid {
  const meta = readJson('basemap.meta.json') as {
    terrain: { grid: [number, number]; minM: number; maxM: number };
  };
  const buf = readFileSync(path.join(dataDir, 'terrain', 'height.f32'));
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const [w, h] = meta.terrain.grid;
  return new TerrainGrid(f32, w, h, meta.terrain.minM, meta.terrain.maxM);
}

export function loadBuildings(): CampusBuilding[] {
  const fc = readJson('buildings.geojson') as {
    features: { properties: Record<string, unknown>; geometry: { coordinates: [number, number][][] } }[];
  };
  return fc.features.map((f) => ({
    ...(f.properties as unknown as CampusBuilding),
    ring: f.geometry.coordinates[0],
  }));
}

export function loadRoads(): CampusRoad[] {
  const fc = readJson('roads.geojson') as {
    features: { properties: Record<string, unknown>; geometry: { coordinates: [number, number][] } }[];
  };
  return fc.features.map((f) => ({
    id: String(f.properties.id),
    cls: String(f.properties.cls),
    name: (f.properties.name as string | null) ?? null,
    width_m: Number(f.properties.width_m),
    surface: String(f.properties.surface),
    stairs: Boolean(f.properties.stairs),
    accessible: Boolean(f.properties.accessible),
    bridge: Boolean(f.properties.bridge),
    tunnel: Boolean(f.properties.tunnel),
    line: f.geometry.coordinates,
  }));
}

export function loadGraph(): { graph: RouteGraph; terrain: TerrainGrid; buildings: CampusBuilding[] } {
  const terrain = loadTerrain();
  const buildings = loadBuildings();
  const graph = buildOutdoorGraph(loadRoads(), terrain, { buildings });
  return { graph, terrain, buildings };
}

export const ANCHOR_SOUTH = { lat: 31.77555, lng: 76.98654 };
export const ANCHOR_NORTH = { lat: 31.7813, lng: 76.9975 };
