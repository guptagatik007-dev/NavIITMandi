import { useMemo } from 'react';
import { latLngToLocal } from '@/geo/wgs84';
import type { TerrainGrid } from '@/geo/terrain';
import type { PoiT } from '@/data/schemas';
import { useOutdoor } from '@/store/outdoorStore';
import { useMap } from '@/store/mapStore';

/** Small clickable markers for every surveyed POI. */
export function PoiMarkers({
  pois,
  terrain,
}: {
  pois: PoiT[];
  terrain: TerrainGrid;
}) {
  const visible = useOutdoor((s) => s.layers.poi && !s.roadsOnly);
  const focusPoi = useOutdoor((s) => s.focusPoi);
  const selected = useOutdoor((s) => s.focusPoiId);
  const flyTo = useMap((s) => s.requestFlyTo);

  const items = useMemo(
    () =>
      pois.map((p) => {
        const loc = latLngToLocal(p.lat, p.lng);
        const y = terrain.heightAtLatLng(p.lat, p.lng) - terrain.datum;
        return { poi: p, x: loc.x, y, z: loc.z };
      }),
    [pois, terrain],
  );

  if (!visible) return null;

  return (
    <group>
      {items.map(({ poi, x, y, z }) => {
        const isSel = selected === poi.id;
        return (
          <mesh
            key={poi.id}
            position={[x, y + 2.4, z]}
            onClick={(e) => {
              e.stopPropagation();
              focusPoi(poi.id);
              flyTo({ lat: poi.lat, lng: poi.lng, zoom: 17.2, pitch: 52 });
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'default';
            }}
          >
            <cylinderGeometry args={[1.1, 1.1, 5.0, 10]} />
            <meshStandardMaterial
              color={isSel ? '#5eead4' : '#e8efec'}
              emissive={isSel ? '#2dd4bf' : '#0f766e'}
              emissiveIntensity={isSel ? 0.9 : 0.25}
              roughness={0.5}
            />
          </mesh>
        );
      })}
    </group>
  );
}
