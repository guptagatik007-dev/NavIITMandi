/**
 * wgs84.ts — geodesy. 1 world unit = 1 metre. Right-handed, Y-up.
 *   +X = East      +Y = Up      −Z = North
 *
 * Local frame is an ENU (east-north-up) plane tangent at ORIGIN, valid to well under
 * 1 cm over the ~2 km campus extent (verified in tests/geo.test.ts against haversine).
 */
import { ORIGIN } from '@/config/map.config';

export const R_EARTH = 6378137.0;
export const DEG = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}
export interface LocalPoint {
  x: number; // east, metres
  y: number; // up, metres above ORIGIN elevation
  z: number; // −north, metres
}

const cosLat0 = Math.cos(ORIGIN.lat * DEG);

/** Web-Mercator Y for a latitude (used for the imagery UV mapping). */
export const mercY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2));

export function latLngToLocal(lat: number, lng: number, elevation = 0, originElevation = 0): LocalPoint {
  return {
    x: R_EARTH * (lng - ORIGIN.lon) * DEG * cosLat0,
    y: elevation - originElevation,
    z: -R_EARTH * (lat - ORIGIN.lat) * DEG,
  };
}

export function localToLatLng(x: number, z: number): LatLng {
  return {
    lat: ORIGIN.lat + (-z / R_EARTH) / DEG,
    lng: ORIGIN.lon + (x / (R_EARTH * cosLat0)) / DEG,
  };
}

export function elevationAt(local: LocalPoint, originElevation = 0): number {
  return local.y + originElevation;
}

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from true north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export const compass = (deg: number): string => {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round(deg / 22.5) % 16];
};

export function formatDistance(m: number): string {
  if (!isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return '—';
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}

export function formatArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString('en-IN')} m²`;
}

/** Signed planar area (m²) of a lon/lat ring via local projection. */
export function ringAreaM2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const k = Math.cos(lat0 * DEG);
  const pts = ring.map(([lng, lat]) => [lng * 111320 * k, lat * 110574] as [number, number]);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

export function centroidOfRing(ring: [number, number][]): LatLng {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-12) {
    return {
      lng: ring.reduce((s, p) => s + p[0], 0) / ring.length,
      lat: ring.reduce((s, p) => s + p[1], 0) / ring.length,
    };
  }
  return { lng: cx / (3 * a), lat: cy / (3 * a) };
}
