/**
 * polyOps.ts — pure planar geometry helpers for the manual editing tools.
 *
 * Everything here works in a local tangent plane (meters, x=east, y=north)
 * converted from lng/lat around a given origin latitude. No three.js, no maplibre:
 * pure functions so the route-crossing guard, ring validation and snapping are
 * unit-testable and identical in 2D, 3D and the graph merge.
 */

export type LngLat = [number, number];

const R = 6371000;

/** Meters between two lng/lat points. */
export function haversineM(a: LngLat, b: LngLat): number {
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const dLa = la2 - la1;
  const dLo = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Convert lng/lat to local meters around an origin latitude (near = y, east = x). */
export function toLocal(p: LngLat, originLat: number): [number, number] {
  const k = Math.cos((originLat * Math.PI) / 180);
  return [(p[0] * Math.PI * R * k) / 180, (p[1] * Math.PI * R) / 180];
}

const orient = (a: [number, number], b: [number, number], c: [number, number]) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Proper intersection test for two segments (inclusive of touching). */
export function segmentsIntersect(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Point-in-polygon (ray cast). Ring may be closed (first==last) or open. */
export function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed ring area in m² (positive = CCW). Ring converted with one origin. */
export function ringAreaM2(ringLngLat: LngLat[]): number {
  if (ringLngLat.length < 3) return 0;
  const lat0 = ringLngLat[0][1];
  const pts = ringLngLat.map((p) => toLocal(p, lat0));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** True if any non-adjacent edge pair of the ring crosses (self-intersection). */
export function ringSelfIntersects(ringLngLat: LngLat[]): boolean {
  if (ringLngLat.length < 4) return false;
  const lat0 = ringLngLat[0][1];
  const pts = ringLngLat.map((p) => toLocal(p, lat0));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges (they share a vertex)
      if (j === i || (j + 1) % n === i) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Does a polyline (route) cross or enter a polygon ring (building footprint)?
 * True if any segment crosses a ring edge OR any line vertex lies inside the ring.
 */
export function polylineIntersectsRing(line: LngLat[], ringLngLat: LngLat[]): boolean {
  if (line.length < 2 || ringLngLat.length < 3) return false;
  const lat0 = line[0][1];
  const l = line.map((p) => toLocal(p, lat0));
  const r = ringLngLat.map((p) => toLocal(p, lat0));
  const rn = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
  for (const p of l) if (pointInRing(p, rn)) return true;
  for (let i = 0; i < l.length - 1; i++) {
    for (let j = 0; j < rn.length; j++) {
      if (segmentsIntersect(l[i], l[i + 1], rn[j], rn[(j + 1) % rn.length])) return true;
    }
  }
  return false;
}

/**
 * Closest point on a segment to a given point, all in local meters.
 * Returns [point, t, distM].
 */
export function closestOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; t: number; distM: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const q: [number, number] = [a[0] + dx * t, a[1] + dy * t];
  return { point: q, t, distM: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/**
 * Where (segment index + position) a click should INSERT a vertex into a polyline.
 * Returns segment start index i (insert after i) and the snapped point in lng/lat.
 */
export function insertPosition(line: LngLat[], click: LngLat): { segIndex: number; point: LngLat; distM: number } | null {
  if (line.length < 2) return null;
  const lat0 = click[1];
  const p = toLocal(click, lat0);
  let best: { segIndex: number; point: [number, number]; distM: number } | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = closestOnSegment(p, toLocal(line[i], lat0), toLocal(line[i + 1], lat0));
    if (!best || c.distM < best.distM) best = { segIndex: i, point: c.point, distM: c.distM };
  }
  if (!best) return null;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const lngLat: LngLat = [(best.point[0] * 180) / (Math.PI * R * k), (best.point[1] * 180) / (Math.PI * R)];
  return { segIndex: best.segIndex, point: lngLat, distM: best.distM };
}

/**
 * Snap a polyline's endpoints to the nearest vertex of a reference network
 * (all vertices of the existing road line strings). Only snaps within maxM so a
 * drawn road cannot accidentally teleport to a far junction. Returns a new line;
 * unmoved when nothing is close — the connectivity audit downstream catches that.
 */
export function snapEndpointsToNetwork(line: LngLat[], networkVertices: LngLat[], maxM = 25): LngLat[] {
  if (line.length < 2 || networkVertices.length === 0) return line;
  const out = line.slice();
  const trySnap = (idx: number) => {
    const p = line[idx];
    let bestV: LngLat | null = null;
    let bestD = maxM;
    for (const v of networkVertices) {
      const d = haversineM(p, v);
      if (d < bestD) {
        bestD = d;
        bestV = v;
      }
    }
    if (bestV) out[idx] = bestV;
  };
  trySnap(0);
  trySnap(out.length - 1);
  return out;
}
