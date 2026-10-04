import { describe, expect, it } from 'vitest';
import { bearingDeg, centroidOfRing, compass, haversine, latLngToLocal, localToLatLng, mercY, ringAreaM2 } from '@/geo/wgs84';
import { BBOX, ORIGIN } from '@/config/map.config';

describe('projection (WGS84 <-> local ENU metres)', () => {
  it('round-trips to sub-centimetre precision across the campus extent', () => {
    const samples = [
      [BBOX.north, BBOX.west],
      [BBOX.south, BBOX.east],
      [ORIGIN.lat, ORIGIN.lon],
      [31.77555, 76.98654], // South Campus
      [31.7813, 76.9975], // North Campus
      [31.77725, 76.9915],
    ];
    for (const [lat, lng] of samples) {
      const back = localToLatLng(...(Object.values(latLngToLocal(lat, lng)).slice(0, 1) as [number])); // x
      void back;
      const p = latLngToLocal(lat, lng);
      const r = localToLatLng(p.x, p.z);
      const errM = haversine({ lat, lng }, r);
      expect(errM, `round-trip error at ${lat},${lng}`).toBeLessThan(0.01);
    }
  });

  it('agrees with the great-circle distance to better than 0.2% over 1 km', () => {
    const a = { lat: 31.7755, lng: 76.9865 };
    const b = { lat: 31.7813, lng: 76.9975 };
    const hav = haversine(a, b);
    const pa = latLngToLocal(a.lat, a.lng);
    const pb = latLngToLocal(b.lat, b.lng);
    const planar = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    expect(Math.abs(planar - hav) / hav).toBeLessThan(0.002);
    // the two campuses are ~1.2 km apart; sanity-check the order of magnitude
    expect(hav).toBeGreaterThan(800);
    expect(hav).toBeLessThan(1800);
  });

  it('satisfies the axis convention: +X east, -Z north', () => {
    const origin = latLngToLocal(ORIGIN.lat, ORIGIN.lon);
    const east = latLngToLocal(ORIGIN.lat, ORIGIN.lon + 0.001);
    const north = latLngToLocal(ORIGIN.lat + 0.001, ORIGIN.lon);
    expect(origin.x).toBeCloseTo(0, 6);
    expect(origin.z).toBeCloseTo(0, 6);
    expect(east.x).toBeGreaterThan(90); // ~96 m per 0.001 deg lon at this latitude
    expect(north.z).toBeLessThan(-100); // north must be negative Z
  });

  it('maps latitude to a monotonic Mercator V for the imagery drape', () => {
    expect(mercY(BBOX.north)).toBeGreaterThan(mercY(BBOX.south));
  });
});

describe('geometry helpers', () => {
  it('measures a known square footprint correctly', () => {
    // ~100 m x 100 m square near the campus latitude
    const dLat = 100 / 110574;
    const dLng = 100 / (111320 * Math.cos((31.777 * Math.PI) / 180));
    const ring: [number, number][] = [
      [76.99, 31.777],
      [76.99 + dLng, 31.777],
      [76.99 + dLng, 31.777 + dLat],
      [76.99, 31.777 + dLat],
    ];
    expect(ringAreaM2(ring)).toBeGreaterThan(9_500);
    expect(ringAreaM2(ring)).toBeLessThan(10_500);
  });

  it('computes centroid and bearings sanely', () => {
    const c = centroidOfRing([
      [76.99, 31.777],
      [76.991, 31.777],
      [76.991, 31.778],
      [76.99, 31.778],
    ]);
    expect(c.lat).toBeCloseTo(31.7775, 3);
    expect(c.lng).toBeCloseTo(76.9905, 3);
    expect(bearingDeg({ lat: 31.777, lng: 76.99 }, { lat: 31.778, lng: 76.99 })).toBeCloseTo(0, 0); // due north
    expect(compass(90)).toBe('E');
    expect(compass(0)).toBe('N');
  });
});
