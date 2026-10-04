/**
 * terrain.ts — DEM sampler.
 *
 * The heightfield is baked as raw little-endian float32 (public/data/terrain/height.f32)
 * rather than a PNG: canvas decoding would quantise 16-bit PNGs to 8 bits (≈2.6 m steps
 * over this 669 m relief) and is subject to browser colour management. A binary float
 * grid is exact, fast, and browser-policy independent.
 *
 * Grid orientation: row 0 = NORTH edge, column 0 = WEST edge (matches the ortho image).
 */
import { BBOX } from '@/config/map.config';
import { latLngToLocal, localToLatLng } from './wgs84';

export interface TerrainMeta {
  width: number;
  height: number;
  minM: number;
  maxM: number;
  nodataPolicy?: string;
  source?: string;
}

export class TerrainGrid {
  readonly data: Float32Array;
  readonly w: number;
  readonly h: number;
  readonly minM: number;
  readonly maxM: number;
  private readonly originElevation: number;

  constructor(data: Float32Array, w: number, h: number, minM: number, maxM: number) {
    this.data = data;
    this.w = w;
    this.h = h;
    this.minM = minM;
    this.maxM = maxM;
    // Scene Y is relative to ORIGIN elevation; use the median-ish plateau height so
    // buildings and terrain share one datum.
    this.originElevation = (minM + maxM) / 2;
  }

  /** Bilinear sample at a WGS84 position, in metres above mean sea level. */
  heightAtLatLng(lat: number, lng: number): number {
    const fx = ((lng - BBOX.west) / (BBOX.east - BBOX.west)) * (this.w - 1);
    const fy = ((BBOX.north - lat) / (BBOX.north - BBOX.south)) * (this.h - 1);
    return this.bilinear(fx, fy);
  }

  /** Bilinear sample at a local scene position (metres, y ignored), returns MSL metres. */
  heightAtLocal(x: number, z: number): number {
    const { lat, lng } = localToLatLng(x, z);
    return this.heightAtLatLng(lat, lng);
  }

  /** Scene Y (metres above the shared datum) for a local position. */
  sceneY(localX: number, localZ: number): number {
    return this.heightAtLocal(localX, localZ) - this.originElevation;
  }

  get datum(): number {
    return this.originElevation;
  }

  private bilinear(fx: number, fy: number): number {
    const x = Math.min(this.w - 1, Math.max(0, fx));
    const y = Math.min(this.h - 1, Math.max(0, fy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(this.w - 1, x0 + 1);
    const y1 = Math.min(this.h - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const a = this.data[y0 * this.w + x0];
    const b = this.data[y0 * this.w + x1];
    const c = this.data[y1 * this.w + x0];
    const d = this.data[y1 * this.w + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /**
   * Local terrain statistics around a footprint — used to seat buildings on their cut
   * bench. Real campus buildings sit on a graded platform, so we seat at a low
   * percentile of the surrounding terrain and extend a plinth down to the lowest point;
   * that reproduces "cut bench" behaviour without inventing survey data.
   */
  footprintStats(ring: [number, number][]): { min: number; max: number; seat: number; reliefM: number } {
    const samples: number[] = [];
    for (const [lng, lat] of ring) {
      samples.push(this.heightAtLatLng(lat, lng));
    }
    const c = ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    const clng = c[0] / ring.length;
    const clat = c[1] / ring.length;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      samples.push(this.heightAtLatLng(clat + (lat0(ring) - clat) * 0, clng));
      samples.push(this.heightAtLatLng(clat, clng + (lngSpan(ring) * (t - 0.5)) / 2));
      samples.push(this.heightAtLatLng(clat + (latSpan(ring) * (t - 0.5)) / 2, clng));
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const sorted = [...samples].sort((a, b) => a - b);
    const seat = sorted[Math.floor(sorted.length * 0.3)] ?? min;
    return { min, max, seat, reliefM: max - min };
  }

  /** Slopes along a polyline, for routing gradients. degrees() */
  slopeDegreesLatLng(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const ha = this.heightAtLatLng(a.lat, a.lng);
    const hb = this.heightAtLatLng(b.lat, b.lng);
    const dx = Math.hypot(
      latLngToLocal(a.lat, a.lng).x - latLngToLocal(b.lat, b.lng).x,
      latLngToLocal(a.lat, a.lng).z - latLngToLocal(b.lat, b.lng).z,
    );
    if (dx < 0.01) return 0;
    return (Math.atan2(hb - ha, dx) * 180) / Math.PI;
  }
}

const lat0 = (ring: [number, number][]) => Math.max(...ring.map((p) => p[1]));
const latSpan = (ring: [number, number][]) => Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]));
const lngSpan = (ring: [number, number][]) => Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]));

let cache: TerrainGrid | null = null;

/** Load the baked DEM once per session. */
export async function loadTerrain(): Promise<TerrainGrid> {
  if (cache) return cache;
  const res = await fetch('data/terrain/height.f32');
  if (!res.ok) throw new Error(`terrain fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const data = new Float32Array(buf);
  const meta = (await fetch('data/basemap.meta.json').then((r) => r.json())) as {
    terrain: { grid: [number, number]; minM: number; maxM: number; nodata_policy?: string; source?: string };
  };
  const [w, h] = meta.terrain.grid;
  if (data.length !== w * h) {
    // tolerate a transposed write, then fail loudly rather than silently mis-sampling
    if (data.length === h * w) {
      const t = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) t[j * w + i] = data[i * h + j];
      cache = new TerrainGrid(t, w, h, meta.terrain.minM, meta.terrain.maxM);
      return cache;
    }
    throw new Error(`terrain grid mismatch: ${data.length} values for ${w}×${h}`);
  }
  cache = new TerrainGrid(data, w, h, meta.terrain.minM, meta.terrain.maxM);
  return cache;
}

export function terrainSync(): TerrainGrid | null {
  return cache;
}
