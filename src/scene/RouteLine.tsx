import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { latLngToLocal } from '@/geo/wgs84';
import type { TerrainGrid } from '@/geo/terrain';
import { useOutdoor } from '@/store/outdoorStore';

/** Walking route drawn on the terrain: Google-Maps style white casing + #1a73e8 blue core, light-blue dashed for stairs. */
export function RouteLine({ terrain }: { terrain: TerrainGrid }) {
  const route = useOutdoor((s) => s.route.result);
  const alternatives = useOutdoor((s) => s.route.alternatives);
  const showRoute = useOutdoor((s) => s.layers.route);

  // dull grey-blue alternative lines under the active blue route (Google-Maps style)
  const altLines = useMemo(() => {
    return alternatives
      .filter((a) => a.ok && a !== route && a.coords.length > 1)
      .map((a) =>
        a.coords.map(([lng, lat]) => {
          const p = latLngToLocal(lat, lng);
          return [p.x, terrain.heightAtLatLng(lat, lng) - terrain.datum + 0.55, p.z] as [number, number, number];
        }),
      );
  }, [alternatives, route, terrain]);

  const { casing, core, stairSegments } = useMemo(() => {
    if (!route?.ok || route.coords.length < 2) return { casing: [], core: [], stairSegments: [] as [number, number, number][][] };
    const pts = route.coords.map(([lng, lat]) => {
      const p = latLngToLocal(lat, lng);
      const y = terrain.heightAtLatLng(lat, lng) - terrain.datum;
      return [p.x, y + 0.75, p.z] as [number, number, number];
    });
    const stairs: [number, number, number][][] = [];
    let run: [number, number, number][] = [];
    route.steps.forEach((step, i) => {
      const isStair = step.kind === 'stairs';
      const i0 = Math.min(i, pts.length - 1);
      const i1 = Math.min(i + 1, pts.length - 1);
      if (isStair) {
        if (run.length === 0) run.push(pts[i0]);
        run.push(pts[i1]);
      } else if (run.length) {
        stairs.push(run);
        run = [];
      }
    });
    if (run.length) stairs.push(run);
    return { casing: pts, core: pts, stairSegments: stairs };
  }, [route, terrain]);

  if (!showRoute || !route?.ok || core.length < 2) return null;

  return (
    <group>
      {altLines.map(
        (pts, i) =>
          pts.length > 1 ? (
            <Line key={`alt-${i}`} points={pts} color="#7d8a99" lineWidth={3.5} transparent opacity={0.7} dashed dashSize={2.4} gapSize={2} raycast={() => null} />
          ) : null,
      )}
      <Line points={casing} color="#ffffff" lineWidth={10} transparent opacity={0.92} raycast={() => null} />
      <Line points={core} color="#1a73e8" lineWidth={5.5} raycast={() => null} />
      {stairSegments.map((seg, i) =>
        seg.length > 1 ? (
          <Line key={i} points={seg} color="#8ab4f8" lineWidth={6.5} dashed dashSize={2.2} gapSize={1.6} raycast={() => null} />
        ) : null,
      )}
    </group>
  );
}
