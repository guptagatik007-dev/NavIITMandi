import { describe, expect, it } from 'vitest';
import { CAMERA_DEFAULTS, DEFAULT_SUN_PRESET, SUN_PRESETS } from '@/config/map.config';

/**
 * Regression guard for the "everything is a grey wash / buildings look transparent"
 * report. The scene uses exponential-squared fog, so the fraction of the scene still
 * visible at distance d is exp(-(density * d)^2). These bounds are tied to the actual
 * framing distances of the app: ~400 m close reading and the default view distance.
 */
const fogVisibility = (density: number, distanceM: number) => Math.exp(-Math.pow(density * distanceM, 2));

// the same mapping the 3D rig uses to turn a zoom level into a camera distance
const zoomToDistance = (zoom: number) => Math.min(3200, Math.max(70, 400 * Math.pow(2, 17 - zoom)));

describe('fog / visibility budget', () => {
  const defaultDistance = zoomToDistance(CAMERA_DEFAULTS.zoom);

  it('frames the campus at the expected distance', () => {
    expect(defaultDistance).toBeGreaterThan(700);
    expect(defaultDistance).toBeLessThan(2200);
  });

  it('the default preset keeps the default view clearly readable', () => {
    const v = fogVisibility(SUN_PRESETS[DEFAULT_SUN_PRESET].fog, defaultDistance);
    expect(v, `default view visibility was ${(v * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.8);
  });

  it('every preset keeps buildings readable at campus range (400 m)', () => {
    for (const [id, p] of Object.entries(SUN_PRESETS)) {
      const v = fogVisibility(p.fog, 400);
      expect(v, `${id} at 400 m: ${(v * 100).toFixed(1)}% visible`).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('no preset whites out the default view', () => {
    for (const [id, p] of Object.entries(SUN_PRESETS)) {
      const v = fogVisibility(p.fog, defaultDistance);
      expect(v, `${id} at the default view: ${(v * 100).toFixed(1)}% visible`).toBeGreaterThanOrEqual(0.5);
    }
  });
});
