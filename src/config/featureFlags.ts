/**
 * featureFlags.ts — deliberate feature switches.
 *
 * indoor: shows the Indoor section and its local floor-plan upload/label/routing
 *         workspace. It still refuses to invent rooms or corridors when no real plan exists.
 */
export const featureFlags = {
  indoor: true,
  indoorRouteEngine: true, // manual floor graph routing; disconnected graphs fail honestly
  contours: false, // contour bake not produced yet — toggle is disabled, not faked
  liveTiles: true, // live Esri satellite fetch is allowed but OFF by default
  measure: false, // measure tool not implemented in this phase
  walkMode: true,
  qrPrint: true,
} as const;

export type FeatureFlags = typeof featureFlags;
