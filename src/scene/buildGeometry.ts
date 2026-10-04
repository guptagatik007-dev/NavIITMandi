/**
 * buildGeometry.ts — procedural city geometry, built once per data revision.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE WAS REWRITTEN (defect report from the live site)
 *
 *   "buildings are transparent in 3D ... roof are transparent"
 *
 * Measured before the fix (tests/geometry-audit.test.ts):
 *     4,304 / 8,522 wall triangles (50.5%) faced INWARD
 *     2,419 / 2,419 roof-cap triangles (100%) faced DOWN
 *
 *   With the default material side = FrontSide, every one of those faces is culled by
 *   the GPU, so you see straight through the shell to the sky and the roof is invisible
 *   from above. The cause was trusting the winding order of the source footprints, which
 *   is not consistent between OpenStreetMap and Overture ML polygons.
 *
 *   The fix is structural: EVERY triangle is emitted through triOutward/quadOutward,
 *   which compute the face normal and flip the winding if it points into the building.
 *   cap() checks normal.y per triangle. Orientation is therefore guaranteed by
 *   construction instead of assumed, and the audit test locks it in.
 *
 *   "buildings look sludged in the hills" — buildings were seated on the 30th
 *   percentile of terrain and buried on the uphill side. They now sit on a cut platform
 *   at the HIGHEST ground under the footprint (how these buildings are really built on
 *   a Himalayan slope), with a visible retaining plinth down to the lowest corner and a
 *   graded apron around the base.
 *
 * PERFORMANCE MODEL
 *   Walls, roofs, details, aprons, roads and trees merge into a handful of static
 *   BufferGeometries with per-vertex colour. Windows are two InstancedMeshes total.
 *   Transparent buildings go into their own small batch so opacity never forces the
 *   whole campus to sort per-frame.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { latLngToLocal } from '@/geo/wgs84';
import type { TerrainGrid } from '@/geo/terrain';
import type { CampusBuilding, CampusTree } from '@/data/loaders';
import type { BuildingOverride } from '@/data/overrides';

type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export const WALL_COLORS: Record<string, RGB> = {
  plaster_paint_cream: [0.886, 0.859, 0.788],
  plaster_paint_white: [0.937, 0.933, 0.91],
  stone_clad: [0.706, 0.647, 0.573],
  stone_clad_glazing: [0.737, 0.686, 0.612],
  stone_rough: [0.545, 0.514, 0.447],
  metal_sheet_industrial: [0.596, 0.635, 0.647],
};
export const ROOF_COLORS: Record<string, RGB> = {
  flat: [0.694, 0.682, 0.647],
  sloped: [0.478, 0.529, 0.518],
  'mono-pitch': [0.478, 0.529, 0.518],
  'multi-bay': [0.518, 0.565, 0.573],
  shed: [0.494, 0.545, 0.573],
  hipped: [0.463, 0.455, 0.416],
};
export const WALL_COLOR_NAMES = Object.keys(WALL_COLORS);

const PLINTH_COLOR: RGB = [0.435, 0.412, 0.376];
const APRON_COLOR: RGB = [0.549, 0.522, 0.467];
const PARAPET_COLOR: RGB = [0.816, 0.796, 0.749];
const CANOPY_COLOR: RGB = [0.878, 0.867, 0.827];
const DOOR_COLOR: RGB = [0.29, 0.325, 0.322];

const STAIR_COLOR: RGB = [0.706, 0.686, 0.627];
const FOOTWAY_COLOR: RGB = [0.478, 0.459, 0.427];
const ROAD_COLOR: RGB = [0.278, 0.29, 0.298];
const TRACK_COLOR: RGB = [0.4, 0.365, 0.318];

const CONIFER_COLOR: RGB = [0.129, 0.235, 0.18];
const BROADLEAF_COLOR: RGB = [0.243, 0.361, 0.216];
const TRUNK_COLOR: RGB = [0.286, 0.239, 0.196];

const WINDOW_BAY_M = 3.3;
const WINDOW_W = 1.5;
const WINDOW_H = 1.5;
const WINDOW_SILL_M = 0.9;
const DOOR_W = 1.2;
const DOOR_H = 2.15;
const APRON_OUT_M = 1.2;
const APRON_DROP_M = 0.45;
const PLINTH_EXTRA_M = 2.5;

/* ────────────────────────────────────────────────────────── mesh builder ───── */

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private uvs: number[] = [];
  /**
   * Active per-vertex alpha (translucent batch only). Set it before pushing a
   * building's triangles — every vertex then carries that building's exact
   * opacity. This is the fix for the "opacity stuck" bug: the old path rendered
   * every translucent building at one hardcoded material opacity (0.55), so the
   * editor's 0.2–0.95 slider had no visible effect.
   */
  currentAlpha = 1;

  constructor(private readonly withAlpha = false) {}

  get triangles(): number {
    return this.pos.length / 9;
  }

  private emit(a: Vec3, b: Vec3, c: Vec3, color: RGB, shadeTop: number, shadeBottom: number): void {
    const n = normalOf(a, b, c);
    const ys = [a[1], b[1], c[1]];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(0.001, maxY - minY);
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(n[0], n[1], n[2]);
      const t = (v[1] - minY) / span;
      const s = shadeBottom + (shadeTop - shadeBottom) * t;
      if (this.withAlpha) this.col.push(color[0] * s, color[1] * s, color[2] * s, this.currentAlpha);
      else this.col.push(color[0] * s, color[1] * s, color[2] * s);
      this.uvs.push(v[0] * 0.05, v[2] * 0.05);
    }
  }

  tri(a: Vec3, b: Vec3, c: Vec3, color: RGB, shadeTop = 1, shadeBottom = 1): void {
    this.emit(a, b, c, color, shadeTop, shadeBottom);
  }

  /**
   * Triangle whose normal is guaranteed to point AWAY from `inside`.
   * This is the anti-transparency primitive: it cannot emit a culled face.
   */
  triOutward(a: Vec3, b: Vec3, c: Vec3, inside: Vec3, color: RGB, shadeTop = 1, shadeBottom = 1): void {
    const n = normalOf(a, b, c);
    const cx = (a[0] + b[0] + c[0]) / 3 - inside[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - inside[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) this.emit(a, c, b, color, shadeTop, shadeBottom);
    else this.emit(a, b, c, color, shadeTop, shadeBottom);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, shadeTop = 1, shadeBottom = 1): void {
    this.emit(a, b, c, color, shadeTop, shadeBottom);
    this.emit(a, c, d, color, shadeTop, shadeBottom);
  }

  /** Quad with a guaranteed outward normal (see triOutward). */
  quadOutward(a: Vec3, b: Vec3, c: Vec3, d: Vec3, inside: Vec3, color: RGB, shadeTop = 1, shadeBottom = 1): void {
    const n = normalOf(a, b, c);
    const cx = (a[0] + b[0] + c[0]) / 3 - inside[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - inside[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    const flip = n[0] * cx + n[1] * cy + n[2] * cz < 0;
    if (flip) {
      this.emit(a, d, c, color, shadeTop, shadeBottom);
      this.emit(a, c, b, color, shadeTop, shadeBottom);
    } else {
      this.emit(a, b, c, color, shadeTop, shadeBottom);
      this.emit(a, c, d, color, shadeTop, shadeBottom);
    }
  }

  /**
   * Horizontal slab from a ring at its own y values.
   * Each triangle's normal is checked individually, so no triangulator winding
   * convention can ever produce a downward-facing roof again.
   */
  cap(ring: Vec3[], color: RGB, upward = true): void {
    if (ring.length < 3) return;
    const pts2 = ring.map((p) => new THREE.Vector2(p[0], p[2]));
    const faces = THREE.ShapeUtils.triangulateShape(pts2, []);
    for (const f of faces) {
      const a = ring[f[0]];
      const b = ring[f[1]];
      const c = ring[f[2]];
      if (!a || !b || !c) continue;
      const n = normalOf(a, b, c);
      const want = upward ? 1 : -1;
      if (n[1] * want < 0) this.emit(a, c, b, color, 1, 1);
      else this.emit(a, b, c, color, 1, 1);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.withAlpha ? 4 : 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    return g;
  }
}

function normalOf(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/* ────────────────────────────────────────────────────────────── buildings ───── */

export interface WindowInstance {
  m: THREE.Matrix4;
}

export interface SeatRecord {
  id: string;
  name: string;
  scope: string;
  /** cut-platform height used for seating (MSL) */
  padMSL: number;
  /** lowest ground under the footprint (MSL) */
  minMSL: number;
  /** height range across the footprint — the survey-priority signal */
  reliefM: number;
  /** vertical distance from pad to lowest ground: the visible retaining face */
  retainingM: number;
  floors: number;
  heightM: number;
}

export interface BuildingBatch {
  walls: MeshBuilder;
  roofs: MeshBuilder;
  details: MeshBuilder;
  /** buildings with per-building opacity < 1, kept separate for correct sorting */
  translucentWalls: MeshBuilder;
  translucentRoofs: MeshBuilder;
  glass: WindowInstance[];
  reveal: WindowInstance[];
  seats: SeatRecord[];
  /** footprints that could not produce geometry — surfaced, never silently dropped */
  skipped: { id: string; reason: string }[];
  windowCount: number;
}

export interface BuildOptions {
  overrides?: Map<string, BuildingOverride>;
  /** 'full' = everything; 'campus-first' = context buildings are massing only */
  detailMode?: 'full' | 'campus-first';
}

export function buildBuildings(
  buildings: CampusBuilding[],
  terrain: TerrainGrid,
  opts: BuildOptions = {},
): BuildingBatch {
  const overrides = opts.overrides ?? new Map<string, BuildingOverride>();
  const detailMode = opts.detailMode ?? 'campus-first';

  const batch: BuildingBatch = {
    walls: new MeshBuilder(),
    roofs: new MeshBuilder(),
    details: new MeshBuilder(),
    translucentWalls: new MeshBuilder(true),
    translucentRoofs: new MeshBuilder(true),
    glass: [],
    reveal: [],
    seats: [],
    skipped: [],
    windowCount: 0,
  };

  for (const raw of buildings) {
    const ov = overrides.get(raw.id);
    if (raw.hidden || ov?.hidden) continue;

    const b = {
      ...raw,
      ...(ov
        ? {
            ...(ov.name !== undefined ? { name: ov.name } : {}),
            ...(ov.cat !== undefined ? { cat: ov.cat } : {}),
            ...(ov.floors !== undefined ? { floors: ov.floors } : {}),
            ...(ov.height_m !== undefined ? { height_m: ov.height_m } : {}),
            ...(ov.roof !== undefined ? { roof: ov.roof } : {}),
            ...(ov.pitch !== undefined ? { pitch: ov.pitch } : {}),
            ...(ov.wall !== undefined ? { wall: ov.wall } : {}),
          }
        : {}),
    };

    // ── footprints in local metres (x east, z south-negative) ────────────────
    let local = b.ring.map(([lng, lat]) => {
      const p = latLngToLocal(lat, lng);
      return [p.x, p.z] as [number, number];
    });
    if (local.length > 3 && samePoint(local[0], local[local.length - 1])) local.pop();
    if (local.length < 3) {
      batch.skipped.push({ id: b.id, reason: `ring has ${local.length} usable vertices` });
      continue;
    }
    // drop duplicate consecutive vertices (common in ML footprints) without changing shape
    local = local.filter((p, i) => i === 0 || !samePoint(p, local[i - 1], 0.05));
    if (local.length < 3) {
      batch.skipped.push({ id: b.id, reason: 'degenerate ring after duplicate removal' });
      continue;
    }

    const centroidLocal = meanPoint(local);
    const centroidVec: Vec3 = [centroidLocal[0], 0, centroidLocal[1]];
    const wallColor = WALL_COLORS[b.wall] ?? WALL_COLORS.plaster_paint_white;
    const roofColor = ROOF_COLORS[b.roof] ?? ROOF_COLORS.flat;

    // ── seating: cut platform at the HIGHEST ground under the footprint ──────
    const stats = terrain.footprintStats(b.ring);
    const padMSL = stats.max + (ov?.seatOffsetM ?? 0);
    const minMSL = stats.min;
    const baseY = padMSL - terrain.datum;
    const topY = baseY + b.height_m;
    const plinthBottomY = minMSL - terrain.datum - PLINTH_EXTRA_M;

    batch.seats.push({
      id: b.id,
      name: b.name,
      scope: b.scope,
      padMSL,
      minMSL,
      reliefM: stats.reliefM,
      retainingM: padMSL - minMSL,
      floors: b.floors,
      heightM: b.height_m,
    });

    const isCampus = b.scope === 'campus';
    const detailed = isCampus || detailMode === 'full';
    const opacity = ov?.opacity ?? 1;
    // every translucent triangle carries THIS building's exact opacity as vertex
    // alpha, so 0.2 and 0.9 render visibly differently (was one hardcoded value)
    // P4 regression floor: opacity 0 renders an INVISIBLE mass that still picks —
    // hand-traced B19 spent half a session invisible because a draft guard left
    // the slider at 0. 0.15 keeps deliberate "ghost" traces legible instead.
    batch.translucentWalls.currentAlpha = Math.max(0.15, Math.min(1, opacity));
    batch.translucentRoofs.currentAlpha = Math.max(0.15, Math.min(1, opacity));
    const wallTarget = opacity < 1 ? batch.translucentWalls : batch.walls;
    const roofTarget = opacity < 1 ? batch.translucentRoofs : batch.roofs;

    // inside reference for orientation tests: building centre at mid height
    const inside: Vec3 = [centroidLocal[0], baseY + b.height_m * 0.5, centroidLocal[1]];

    // ── per-edge frames (shared by walls, windows, plinth, apron, doors) ─────
    const edges = local.map((p0, i) => {
      const p1 = local[(i + 1) % local.length];
      const dx = p1[0] - p0[0];
      const dz = p1[1] - p0[1];
      const len = Math.hypot(dx, dz);
      let nx = 0;
      let nz = 0;
      if (len > 1e-6) {
        nx = dz / len;
        nz = -dx / len;
        const mx = (p0[0] + p1[0]) / 2 - centroidLocal[0];
        const mz = (p0[1] + p1[1]) / 2 - centroidLocal[1];
        if (nx * mx + nz * mz < 0) {
          nx = -nx;
          nz = -nz;
        }
      }
      return { p0, p1, dx, dz, len, nx, nz, ux: len > 0 ? dx / len : 1, uz: len > 0 ? dz / len : 0 };
    });

    // ── walls + plinth + apron ──────────────────────────────────────────────
    for (const e of edges) {
      if (e.len < 0.5) continue;
      const a: Vec3 = [e.p0[0], topY, e.p0[1]];
      const b2: Vec3 = [e.p1[0], topY, e.p1[1]];
      const c: Vec3 = [e.p1[0], baseY, e.p1[1]];
      const d: Vec3 = [e.p0[0], baseY, e.p0[1]];
      wallTarget.quadOutward(a, b2, c, d, inside, wallColor, 1.0, 0.72);

      // retaining plinth: visible on the downhill side of every cut platform
      const ox = e.nx * 0.3;
      const oz = e.nz * 0.3;
      batch.details.quadOutward(
        [e.p0[0] + ox, baseY + 0.4, e.p0[1] + oz],
        [e.p1[0] + ox, baseY + 0.4, e.p1[1] + oz],
        [e.p1[0] + ox, plinthBottomY, e.p1[1] + oz],
        [e.p0[0] + ox, plinthBottomY, e.p0[1] + oz],
        inside,
        PLINTH_COLOR,
        0.95,
        0.6,
      );

      // graded apron so the platform reads as cut ground, not a floating slab
      if (isCampus) {
        batch.details.quadOutward(
          [e.p0[0] + e.nx * APRON_OUT_M, baseY - APRON_DROP_M, e.p0[1] + e.nz * APRON_OUT_M],
          [e.p1[0] + e.nx * APRON_OUT_M, baseY - APRON_DROP_M, e.p1[1] + e.nz * APRON_OUT_M],
          [e.p1[0], baseY + 0.05, e.p1[1]],
          [e.p0[0], baseY + 0.05, e.p0[1]],
          inside,
          APRON_COLOR,
          1.0,
          0.9,
        );
      }
    }

    // ── entrance: real door position where the data provides one ────────────
    let doorEdge = -1;
    let doorT = 0;
    if (isCampus && b.entrance_lat != null && b.entrance_lng != null) {
      const ep = latLngToLocal(b.entrance_lat, b.entrance_lng);
      let bestD = Infinity;
      edges.forEach((e, i) => {
        if (e.len < 2) return;
        const t = ((ep.x - e.p0[0]) * e.ux + (ep.z - e.p0[1]) * e.uz) / e.len;
        const tc = Math.min(1, Math.max(0, t));
        const px = e.p0[0] + e.ux * tc * e.len;
        const pz = e.p0[1] + e.uz * tc * e.len;
        const dist = Math.hypot(px - ep.x, pz - ep.z);
        if (dist < bestD) {
          bestD = dist;
          doorEdge = i;
          doorT = tc;
        }
      });
      if (bestD > 12) doorEdge = -1; // entrance data too far from the ring: ignore it
    }

    // ── windows (campus buildings only) ────────────────────────────────────
    if (detailed && isCampus && b.floors >= 1) {
      const winW = Math.min(WINDOW_W, WINDOW_BAY_M * 0.52);
      const winH = Math.min(WINDOW_H, b.f2f * 0.42);
      edges.forEach((e, ei) => {
        if (e.len < 2.6) return;
        const bays = Math.max(1, Math.floor((e.len - 1.6) / WINDOW_BAY_M));
        const usable = bays * WINDOW_BAY_M;
        const start = (e.len - usable) / 2;
        const yaw = Math.atan2(e.nx, e.nz);
        const doorBay = ei === doorEdge ? Math.round(doorT * bays - 0.5) : -1;
        for (let floor = 0; floor < b.floors; floor++) {
          for (let bay = 0; bay < bays; bay++) {
            if (floor === 0 && bay === doorBay) continue; // leave room for the entrance
            const t = start + WINDOW_BAY_M * (bay + 0.5);
            const cx = e.p0[0] + e.ux * t;
            const cz = e.p0[1] + e.uz * t;
            const sillY = baseY + floor * b.f2f + WINDOW_SILL_M;
            if (sillY + winH > topY - 0.3) continue;
            pushWindow(batch, cx, cz, e.nx, e.nz, yaw, winW, winH, sillY);
          }
        }
      });
    }

    // ── door + canopy at the mapped entrance ───────────────────────────────
    if (doorEdge >= 0) {
      const e = edges[doorEdge];
      const t = doorT * e.len;
      const cx = e.p0[0] + e.ux * t;
      const cz = e.p0[1] + e.uz * t;
      const yaw = Math.atan2(e.nx, e.nz);
      const dh = Math.min(DOOR_H, b.f2f - 0.9);
      pushPanel(batch.details, cx, cz, e.nx, e.nz, yaw, DOOR_W, dh, baseY, DOOR_COLOR, -0.06);
      const cw = DOOR_W + 1.5;
      const depth = 1.6;
      const cY = baseY + dh + 0.35;
      batch.details.quadOutward(
        [cx + e.nx * depth - e.ux * cw, cY, cz + e.nz * depth - e.uz * cw],
        [cx + e.nx * depth + e.ux * cw, cY, cz + e.nz * depth + e.uz * cw],
        [cx + e.ux * cw, cY, cz + e.uz * cw],
        [cx - e.ux * cw, cY, cz - e.uz * cw],
        [cx, baseY, cz],
        CANOPY_COLOR,
        1.05,
        1.0,
      );
    }

    // ── roof ───────────────────────────────────────────────────────────────
    if (b.roof === 'flat') {
      const capRing = local.map(([x, z]) => [x, topY + 0.12, z] as Vec3);
      roofTarget.cap(capRing, roofColor, true);
      if (isCampus) {
        for (const e of edges) {
          if (e.len < 0.4) continue;
          const h = 0.45;
          const inset = 0.12;
          batch.details.quadOutward(
            [e.p0[0], topY + h, e.p0[1]],
            [e.p1[0], topY + h, e.p1[1]],
            [e.p1[0], topY + 0.12, e.p1[1]],
            [e.p0[0], topY + 0.12, e.p0[1]],
            [centroidLocal[0], topY, centroidLocal[1]],
            PARAPET_COLOR,
            1.02,
            0.93,
          );
          batch.details.quadOutward(
            [e.p1[0] - e.nx * inset, topY + h, e.p1[1] - e.nz * inset],
            [e.p0[0] - e.nx * inset, topY + h, e.p0[1] - e.nz * inset],
            [e.p0[0] - e.nx * inset, topY + 0.12, e.p0[1] - e.nz * inset],
            [e.p1[0] - e.nx * inset, topY + 0.12, e.p1[1] - e.nz * inset],
            [centroidLocal[0], topY, centroidLocal[1]],
            PARAPET_COLOR,
            0.95,
            0.8,
          );
        }
      }
    } else {
      buildSlopedRoof(roofTarget, batch.details, local, centroidLocal, topY, b.pitch || 15, roofColor, b.roof);
    }

    void centroidVec;
  }

  return batch;
}

/* ─────────────────────────────────────────────────────── roofs / helpers ───── */

function buildSlopedRoof(
  roofs: MeshBuilder,
  details: MeshBuilder,
  local: [number, number][],
  centroid: [number, number],
  topY: number,
  pitchDeg: number,
  color: RGB,
  kind: string,
): void {
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const [x, z] of local) {
    const dx = x - centroid[0];
    const dz = z - centroid[1];
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz || 1e-9);
  const ux = Math.cos(theta);
  const uz = Math.sin(theta);
  const vx = -uz;
  const vz = ux;

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const [x, z] of local) {
    const dx = x - centroid[0];
    const dz = z - centroid[1];
    const u = dx * ux + dz * uz;
    const v = dx * vx + dz * vz;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  const span = Math.max(1, vMax - vMin);
  const overhang = 0.55;
  const mini = kind === 'shed' || kind === 'mono-pitch';
  const rise = Math.tan((pitchDeg * Math.PI) / 180) * (mini ? span + overhang * 2 : (span + overhang * 2) / 2);

  const P = (u: number, v: number, y: number): Vec3 => [
    centroid[0] + ux * u + vx * v,
    y,
    centroid[1] + uz * u + vz * v,
  ];
  const inside: Vec3 = [centroid[0], topY, centroid[1]];
  const u0 = uMin - overhang;
  const u1 = uMax + overhang;
  const v0 = vMin - overhang;
  const v1 = vMax + overhang;
  const eaveY = topY + 0.05;

  if (mini) {
    const highY = eaveY + rise;
    roofs.quadOutward(P(u0, v0, highY), P(u1, v0, highY), P(u1, v1, eaveY), P(u0, v1, eaveY), inside, color, 1.06, 0.9);
    details.triOutward(P(u0, v0, highY), P(u0, v1, eaveY), P(u0, v0, eaveY), inside, color, 0.94, 0.8);
    details.triOutward(P(u1, v0, highY), P(u1, v0, eaveY), P(u1, v1, eaveY), inside, color, 0.94, 0.8);
    // close the low gable end so the roof is not a hollow shell
    details.triOutward(P(u0, v1, eaveY), P(u1, v1, eaveY), P(u1, v0, highY), inside, color, 0.92, 0.78);
    details.triOutward(P(u0, v1, eaveY), P(u1, v0, highY), P(u0, v0, highY), inside, color, 0.92, 0.78);
  } else {
    const midV = (v0 + v1) / 2;
    const ridgeY = eaveY + rise;
    roofs.quadOutward(P(u0, v0, eaveY), P(u1, v0, eaveY), P(u1, midV, ridgeY), P(u0, midV, ridgeY), inside, color, 1.06, 0.88);
    roofs.quadOutward(P(u0, midV, ridgeY), P(u1, midV, ridgeY), P(u1, v1, eaveY), P(u0, v1, eaveY), inside, color, 1.06, 0.88);
    // gable ends (single triangles — the previous version doubled a vertex)
    details.triOutward(P(u0, v0, eaveY), P(u0, midV, ridgeY), P(u0, v1, eaveY), inside, color, 0.96, 0.82);
    details.triOutward(P(u1, v1, eaveY), P(u1, midV, ridgeY), P(u1, v0, eaveY), inside, color, 0.96, 0.82);
    // fascia boards under the eaves give the roof visible thickness
    details.quadOutward(
      P(u0, v0, eaveY), P(u0, v1, eaveY), P(u0, v1, eaveY - 0.18), P(u0, v0, eaveY - 0.18), inside, color, 0.9, 0.72,
    );
    details.quadOutward(
      P(u1, v1, eaveY), P(u1, v0, eaveY), P(u1, v0, eaveY - 0.18), P(u1, v1, eaveY - 0.18), inside, color, 0.9, 0.72,
    );
  }
}

function pushWindow(
  batch: BuildingBatch,
  cx: number,
  cz: number,
  nx: number,
  nz: number,
  yaw: number,
  w: number,
  h: number,
  sillY: number,
): void {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const cy = sillY + h / 2;
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(cx - nx * 0.12, cy, cz - nz * 0.12), q, new THREE.Vector3(w, h, 1));
  batch.glass.push({ m: m.clone() });
  m.compose(new THREE.Vector3(cx - nx * 0.04, cy, cz - nz * 0.04), q, new THREE.Vector3(w * 1.16, h * 1.16, 1));
  batch.reveal.push({ m: m.clone() });
  batch.windowCount += 1;
}

function pushPanel(
  mb: MeshBuilder,
  cx: number,
  cz: number,
  nx: number,
  nz: number,
  yaw: number,
  w: number,
  h: number,
  baseY: number,
  color: RGB,
  inset = 0,
): void {
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const px = cx + nx * inset;
  const pz = cz + nz * inset;
  mb.quadOutward(
    [px - ux * w, baseY + h, pz - uz * w],
    [px + ux * w, baseY + h, pz + uz * w],
    [px + ux * w, baseY, pz + uz * w],
    [px - ux * w, baseY, pz - uz * w],
    [px - nx * 2, baseY + h / 2, pz - nz * 2],
    color,
    1,
    0.85,
  );
}

function samePoint(a: [number, number], b: [number, number], tol = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
}
function meanPoint(pts: [number, number][]): [number, number] {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/* ───────────────────────────────────────────────────────────────── roads ───── */

export function buildRoads(
  roads: { line: [number, number][]; width_m: number; stairs: boolean; cls: string }[],
  terrain: TerrainGrid,
): MeshBuilder {
  const mb = new MeshBuilder();
  for (const r of roads) {
    const color: RGB = r.stairs
      ? STAIR_COLOR
      : r.cls === 'footway' || r.cls === 'path'
        ? FOOTWAY_COLOR
        : r.cls === 'track'
          ? TRACK_COLOR
          : ROAD_COLOR;
    const half = Math.max(0.6, r.width_m / 2);
    let prev: { l: Vec3; r: Vec3 } | null = null;
    for (let i = 0; i < r.line.length; i++) {
      const [lng, lat] = r.line[i];
      const p = latLngToLocal(lat, lng);
      const y = terrain.heightAtLatLng(lat, lng) - terrain.datum + 0.08;
      const nxt = r.line[Math.min(i + 1, r.line.length - 1)];
      const prv = r.line[Math.max(i - 1, 0)];
      const a = latLngToLocal(nxt[1], nxt[0]);
      const b = latLngToLocal(prv[1], prv[0]);
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const side = {
        l: [p.x - dz * half, y, p.z + dx * half] as Vec3,
        r: [p.x + dz * half, y, p.z - dx * half] as Vec3,
      };
      if (prev) {
        // a road ribbon is viewed from above, so an upward normal is the correct target
        const mid: Vec3 = [(prev.l[0] + side.r[0]) / 2, y - 5, (prev.l[2] + side.r[2]) / 2];
        mb.quadOutward(prev.l, prev.r, side.r, side.l, mid, color, 1, 0.94);
      }
      prev = side;
    }
  }
  return mb;
}

/* ───────────────────────────────────────────────────────────── vegetation ───── */

export function buildTreeInstances(
  trees: CampusTree[],
  terrain: TerrainGrid,
  limit: number,
): { conifer: THREE.Matrix4[]; broadleaf: THREE.Matrix4[] } {
  const conifer: THREE.Matrix4[] = [];
  const broadleaf: THREE.Matrix4[] = [];
  const step = trees.length > limit ? trees.length / limit : 1;
  for (let i = 0; i < trees.length; i += step) {
    const t = trees[Math.floor(i)];
    if (!t) continue;
    const p = latLngToLocal(t.lat, t.lon);
    const y = terrain.heightAtLatLng(t.lat, t.lon) - terrain.datum;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, y, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.399) % (Math.PI * 2)),
      new THREE.Vector3(Math.max(0.6, t.r / 0.35), t.h, Math.max(0.6, t.r / 0.35)),
    );
    (t.species === 'conifer' ? conifer : broadleaf).push(m);
  }
  return { conifer, broadleaf };
}

export function treeUnitGeometry(species: 'conifer' | 'broadleaf'): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  if (species === 'conifer') {
    cylinder(mb, 0.05, 0.05, 0.0, 0.22, TRUNK_COLOR, 6);
    cone(mb, 0.35, 0.22, 0.62, CONIFER_COLOR, 7);
    cone(mb, 0.26, 0.55, 0.85, CONIFER_COLOR, 7);
    cone(mb, 0.16, 0.78, 1.0, CONIFER_COLOR, 7);
  } else {
    cylinder(mb, 0.06, 0.06, 0.0, 0.35, TRUNK_COLOR, 6);
    icosa(mb, 0.35, 0.55, BROADLEAF_COLOR);
    icosa(mb, 0.26, 0.78, BROADLEAF_COLOR);
  }
  return mb.build()!;
}

function cylinder(mb: MeshBuilder, r0: number, r1: number, y0: number, y1: number, color: RGB, seg: number): void {
  const axis: Vec3 = [0, (y0 + y1) / 2, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (r: number, a: number, y: number): Vec3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    mb.quadOutward(p(r0, a0, y1), p(r1, a1, y1), p(r1, a1, y0), p(r0, a0, y0), axis, color, 1, 0.7);
  }
}
function cone(mb: MeshBuilder, r: number, y0: number, y1: number, color: RGB, seg: number): void {
  const axis: Vec3 = [0, (y0 + y1) / 2, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    mb.triOutward(
      [Math.cos(a0) * r, y0, Math.sin(a0) * r],
      [0, y1, 0],
      [Math.cos(a1) * r, y0, Math.sin(a1) * r],
      axis,
      color,
      1.05,
      0.75,
    );
  }
}
function icosa(mb: MeshBuilder, r: number, y: number, color: RGB): void {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const pos = g.attributes.position;
  const axis: Vec3 = [0, y, 0];
  for (let i = 0; i < pos.count; i += 3) {
    const v = (k: number): Vec3 => [pos.getX(i + k), pos.getY(i + k) + y, pos.getZ(i + k)];
    mb.triOutward(v(0), v(1), v(2), axis, color, 1.05, 0.8);
  }
  g.dispose();
}
