/**
 * Map2D.tsx — the plan / satellite view (MapLibre GL).
 *
 * Offline-first: the base imagery is the locally baked orthomosaic, so this view works
 * with zero network. The live Esri XYZ source is registered but hidden by default and
 * only fetches tiles when the user switches it on (clearly labelled as live).
 * Labels are DOM markers, not symbol layers, because a glyph endpoint would be a
 * network dependency and would silently vanish offline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { BBOX, BASEMAP, SHOP_POI_KINDS, UNLABELLED_POI_KINDS } from '@/config/map.config';
import { BASEMAP_META } from '@/config/basemap.generated';
import { featureFlags } from '@/config/featureFlags';
import type { CampusData } from '@/data/loaders';
import type { PoiT } from '@/data/schemas';
import { useMap } from '@/store/mapStore';
import { useOutdoor } from '@/store/outdoorStore';
import { projectOntoNetwork, ROAD_JOIN_M } from '@/data/roadEdits';
import { haversineM } from '@/geo/polyOps';
import { useUi } from '@/store/uiStore';
import { useEdit } from '@/store/editStore';
import { insertPosition, polylineIntersectsRing } from '@/geo/polyOps';

const CAT_COLOR: Record<string, string> = {
  academic: '#7cc7b8', hostel: '#f0b866', dining: '#ef8f7a', sports: '#8fb8f0', admin: '#c9a7e8',
  residential: '#e8c98a', medical: '#f28d8d', library: '#8ed3c0', auditorium: '#b9a7e0', lab: '#9fb9c4',
  school: '#e0c07a', worship: '#d9b3a0', gate: '#c8d6d1', parking: '#a9b0b3', commerce: '#f0c98a',
  context: '#8d9a97', unknown: '#9aa3a6', utility: '#9fafb0',
};

const zoomToDistance = (zoom: number) => Math.min(3200, Math.max(70, 400 * Math.pow(2, 17 - zoom)));

/**
 * Label rank (lower wins). Rank 0 labels are never dropped by the de-collision pass:
 *  - places that are actually named in the survey data (conf `osm`) and are not mere
 *    building records — messes, the hospital, the workshop, gates, banks
 *  - the currently selected building
 * Then campus buildings, then everything else (context / village).
 */
function rank(p: PoiT, zoom: number): number {
  const selected = useOutdoor.getState().selectedBuildingId;
  if (selected && (p.id === selected || p.building_id === selected)) return 0;
  if (UNLABELLED_POI_KINDS.has(p.kind)) return 99;
  if (SHOP_POI_KINDS.has(p.kind)) return 5;
  if (p.conf === 'osm' && p.kind !== 'building') return 0;
  if (p.zone === 'north' || p.zone === 'south') return p.named ? 1 : zoom >= 16.8 ? 2 : 3;
  return 4;
}

export function Map2D({ data }: { data: CampusData }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<{ mk: maplibregl.Marker; el: HTMLDivElement; poi: PoiT; w: number; h: number }[]>([]);
  const manualMarkers = useRef<maplibregl.Marker[]>([]);
  const layout = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const layers = useOutdoor((s) => s.layers);
  const roadsOnly = useOutdoor((s) => s.roadsOnly);
  const selectBuilding = useOutdoor((s) => s.selectBuilding);
  const route = useOutdoor((s) => s.route.result);
  const routeAltOptions = useOutdoor((s) => s.route.alternatives);
  const flyTo = useMap((s) => s.flyTo);
  const clearFlyTo = useMap((s) => s.clearFlyTo);
  const setCamera = useMap((s) => s.setCamera);
  const debugAlign = useUi((s) => s.debug.align);
  const tracing = useEdit((s) => s.tracing);
  const traceRing = useEdit((s) => s.traceRing);
  const addTraceVertex = useEdit((s) => s.addTraceVertex);
  const editEnabled = useEdit((s) => s.enabled);
  const tracingRoad = useEdit((s) => s.tracingRoad);
  const roadTrace = useEdit((s) => s.roadTrace);
  const reshaping = useEdit((s) => s.reshaping);
  const shapeRing = useEdit((s) => s.shapeRing);
  const roadFixId = useEdit((s) => s.roadFixId);
  const roadFixLine = useEdit((s) => s.roadFixLine);
  const [traceForm, setTraceForm] = useState(false);
  const [traceName, setTraceName] = useState('');
  const [traceCat, setTraceCat] = useState('academic');
  const [traceFloors, setTraceFloors] = useState(3);
  const [cursorReadout, setCursorReadout] = useState<string | null>(null);
  const tracingRef = useRef(tracing);
  tracingRef.current = tracing;
  // Fresh data for map event handlers (they attach once, data changes per edit)
  const roadsRef = useRef(data.roads);
  roadsRef.current = data.roads;
  /** hand-set building doors — road drawing snaps ENDS onto these (door beats road when closer) */
  const doorsRef = useRef<{ name: string; pt: [number, number] }[]>([]);
  doorsRef.current = data.buildings
    .filter((b) => b.entrance_lat != null && b.entrance_lng != null && (b as { entrance_conf?: string }).entrance_conf === 'manual')
    .map((b) => ({ name: b.name ?? b.id, pt: [b.entrance_lng as number, b.entrance_lat as number] }));
  const buildingsRef = useRef(data.buildings);
  buildingsRef.current = data.buildings;

  const buildingsGeo = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: data.buildings.filter((b) => !b.hidden && !data.overrides.get(b.id)?.hidden).map((b) => ({
        type: 'Feature' as const,
        id: b.id,
        properties: {
          id: b.id, name: b.name, cat: b.cat, height: b.height_m, floors: b.floors,
          conf: b.conf, color: CAT_COLOR[b.cat] ?? CAT_COLOR.unknown, scope: b.scope,
        },
        geometry: { type: 'Polygon' as const, coordinates: [b.ring] },
      })),
    }),
    [data.buildings, data.overrides],
  );

  const roadsGeo = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: data.roads.map((r) => ({
        type: 'Feature' as const,
        properties: { id: r.id, cls: r.cls, width: r.width_m, stairs: r.stairs, name: r.name ?? '' },
        geometry: { type: 'LineString' as const, coordinates: r.line },
      })),
    }),
    [data.roads],
  );

  // v3.1 building DOOR nodes: any hand-set entrance shows as a teal dot snapped onto
  // its road, dashed back to the footprint — this is where navigation terminates.
  const entrancesGeo = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: data.buildings
        .filter((b) => b.entrance_lat != null && b.entrance_lng != null && (b as { entrance_conf?: string }).entrance_conf === 'manual')
        .flatMap((b) => {
          const c = b.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
          const centroid: [number, number] = [c[0] / b.ring.length, c[1] / b.ring.length];
          const door: [number, number] = [b.entrance_lng as number, b.entrance_lat as number];
          return [
            { type: 'Feature' as const, properties: { t: 'door', name: b.name ?? b.id }, geometry: { type: 'Point' as const, coordinates: door } },
            { type: 'Feature' as const, properties: { t: 'link' }, geometry: { type: 'LineString' as const, coordinates: [door, centroid] } },
          ];
        }),
    }),
    [data.buildings],
  );

  const routeGeo = useMemo(
    () =>
      route?.ok
        ? {
            type: 'FeatureCollection' as const,
            features: [
              { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route.coords } },
            ],
          }
        : { type: 'FeatureCollection' as const, features: [] },
    [route],
  );

  /** Google-Maps style: dull alternative lines UNDER the red active route. */
  const routeAltGeo = useMemo(() => {
    const alts = routeAltOptions ?? [];
    const features = alts
      .filter((a) => a.ok && a !== route)
      .map((a) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: a.coords } }));
    return { type: 'FeatureCollection' as const, features };
  }, [routeAltOptions, route]);

  // ── create the map once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const cam = useMap.getState().camera;
    const map = new maplibregl.Map({
      container: container.current,
      center: [cam.lng, cam.lat],
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.pitch,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          ortho: {
            type: 'image',
            url: BASEMAP.offlineImage.url,
            coordinates: [
              [BBOX.west, BBOX.north],
              [BBOX.east, BBOX.north],
              [BBOX.east, BBOX.south],
              [BBOX.west, BBOX.south],
            ],
          },
          liveSat: featureFlags.liveTiles
            ? { type: 'raster', tiles: [...BASEMAP.liveSatellite.tiles], tileSize: 256, maxzoom: BASEMAP.liveSatellite.maxzoom, attribution: BASEMAP.liveSatellite.attribution }
            : { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#0d1512' } },
          { id: 'ortho', type: 'raster', source: 'ortho', paint: { 'raster-opacity': 0.92 } },
          // HD live imagery sits ABOVE the baked ortho when toggled on (it used to be
          // underneath, which is why the map looked blurry even in Live mode).
          // Offline it simply never draws and the baked ortho remains.
          ...(featureFlags.liveTiles
            ? [{ id: 'live-sat', type: 'raster' as const, source: 'liveSat', layout: { visibility: 'none' as const } }]
            : []),
        ],
      },
    });
    mapRef.current = map;

    // dev-only probe, so tools/shots.mjs can assert the 2D view actually drew something
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map2d = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');

    map.on('load', () => {
      map.addSource('buildings', { type: 'geojson', data: buildingsGeo as never, promoteId: 'id' });
      map.addSource('roads', { type: 'geojson', data: roadsGeo as never });
      map.addSource('route', { type: 'geojson', data: routeGeo as never });
      map.addSource('route-alt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });

      map.addLayer({
        id: 'b-fill', type: 'fill', source: 'buildings',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'scope'], 'campus'], 0.72, 0.4] },
      });
      map.addLayer({
        id: 'b-outline', type: 'line', source: 'buildings',
        paint: { 'line-color': 'rgba(10,20,18,0.75)', 'line-width': 0.8 },
      });
      map.addLayer({
        id: 'b-3d', type: 'fill-extrusion', source: 'buildings', minzoom: 14.2,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['*', ['get', 'height'], 1],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.82,
        },
      });
      map.addLayer({
        id: 'roads-casing', type: 'line', source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'rgba(6,12,10,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 6] },
      });
      // NOTE: MapLibre rejects a data-driven `line-dasharray` ("data expressions not
      // supported") and aborts the whole addLayer call, which silently removed the 2D
      // roads entirely. Stairs therefore get their own static-dash layer.
      map.addLayer({
        id: 'roads-line', type: 'line', source: 'roads',
        filter: ['!=', ['get', 'stairs'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'cls'], 'footway'], '#b8ada0', ['==', ['get', 'cls'], 'path'], '#b8ada0', '#6b7378'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, ['*', ['get', 'width'], 1.5]],
        },
      });
      map.addLayer({
        id: 'roads-stairs', type: 'line', source: 'roads',
        filter: ['==', ['get', 'stairs'], true],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#c084fc',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 17, ['*', ['get', 'width'], 1.5]],
          'line-dasharray': [2, 1.6],
        },
      });
      map.addSource('trace', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({
        id: 'trace-fill', type: 'fill', source: 'trace',
        paint: { 'fill-color': '#5eead4', 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: 'trace-line', type: 'line', source: 'trace',
        paint: { 'line-color': '#5eead4', 'line-width': 2.4, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: 'trace-points', type: 'circle', source: 'trace',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#5eead4', 'circle-stroke-color': '#04120f', 'circle-stroke-width': 1.5 },
      });

      // ── route drawing preview (§4.2): start green → waypoints white → end red ──
      map.addSource('roadtrace', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({
        id: 'roadtrace-line', type: 'line', source: 'roadtrace',
        paint: { 'line-color': '#1a73e8', 'line-width': 3, 'line-dasharray': [2, 1.4] },
      });
      map.addLayer({
        id: 'roadtrace-mid', type: 'circle', source: 'roadtrace',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'mid']],
        paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#185abc', 'circle-stroke-width': 1.4 },
      });
      // §1: live snap preview — dashed amber hint from the cursor to the nearest road join
      map.addSource('entrances', { type: 'geojson', data: entrancesGeo as never });
      map.addLayer({
        id: 'entrances-link', type: 'line', source: 'entrances',
        filter: ['==', ['get', 't'], 'link'],
        paint: { 'line-color': '#35d0c9', 'line-width': 1.6, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'entrances-dot', type: 'circle', source: 'entrances',
        filter: ['==', ['get', 't'], 'door'],
        paint: { 'circle-radius': 5.5, 'circle-color': '#35d0c9', 'circle-stroke-color': '#012a2a', 'circle-stroke-width': 1.6 },
      });
      map.addSource('roadsnap', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({
        id: 'roadsnap-line', type: 'line', source: 'roadsnap',
        paint: { 'line-color': '#ffb454', 'line-width': 2.2, 'line-dasharray': [1.4, 1.6], 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'roadsnap-dot', type: 'circle', source: 'roadsnap',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 6, 'circle-color': '#ffb454', 'circle-stroke-color': '#5b3200', 'circle-stroke-width': 1.6 },
      });
      map.addLayer({
        id: 'roadtrace-cap', type: 'circle', source: 'roadtrace',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'role'], ['literal', ['start', 'end']]]],
        paint: {
          'circle-radius': 6.5,
          'circle-color': ['case', ['==', ['get', 'role'], 'start'], '#2ecc71', '#1a73e8'],
          'circle-stroke-color': '#04120f',
          'circle-stroke-width': 1.6,
        },
      });

      // ── vertex handles: footprint reshape + fix-an-existing-road ────────────
      map.addSource('shape', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({
        id: 'shape-line', type: 'line', source: 'shape',
        paint: { 'line-color': '#fbbf24', 'line-width': 2.6, 'line-dasharray': [3, 1.6] },
      });
      map.addLayer({
        id: 'shape-points', type: 'circle', source: 'shape',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 6, 'circle-color': '#fbbf24', 'circle-stroke-color': '#1c1207', 'circle-stroke-width': 1.7 },
      });

      map.addLayer({
        id: 'route-alt-line', type: 'line', source: 'route-alt',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#7d8a99', 'line-width': 4.5, 'line-opacity': 0.75, 'line-dasharray': [2, 1.6] },
      });
      map.addLayer({
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#1a73e8', 'line-width': 5.5, 'line-opacity': 0.98 },
      });

      // ── manual footprint tracing (?edit=1) ──────────────────────────────
      // §1.3: draw-assist — as the cursor moves in route-draw mode, show a dashed
      // preview to the nearest join point (≤ join radius) so users SEE the connection
      const onMove = (e: maplibregl.MapMouseEvent) => {
        const st = useEdit.getState();
        const src = map.getSource('roadsnap') as maplibregl.GeoJSONSource | undefined;
        if (!src) return;
        if (!st.tracingRoad) {
          src.setData({ type: 'FeatureCollection', features: [] } as never);
          return;
        }
        const pt: [number, number] = [Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))];
        const anchor = st.roadTrace.length ? st.roadTrace[st.roadTrace.length - 1] : pt;
        const proj = projectOntoNetwork(pt, roadsRef.current as never);
        const feats: never[] = [];
        if (proj && proj.distM <= ROAD_JOIN_M) {
          feats.push(
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [anchor, proj.point] } } as never,
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: proj.point } } as never,
          );
        }
        src.setData({ type: 'FeatureCollection', features: feats } as never);
      };
      map.on('mousemove', onMove);
      (window as unknown as Record<string, unknown>).__map2d = map; // smoke/debug probe
      map.on('click', (e) => {
        const es = useEdit.getState();
        // Route drawing mode: every click lays the next waypoint (§4.2)
        if (es.tracingRoad) {
          // §1.3: ONLY the START click seals onto the existing line you touched
          // (60 m radius). Mid-waypoints are NEVER snapped — v3.1: clicking near an
          // old road used to collapse your new road onto it. v3.2: a hand-set DOOR
          // within 35 m wins over a generic road join when it's the closer join.
          if (es.roadTrace.length === 0) {
            const pt0: [number, number] = [e.lngLat.lng, e.lngLat.lat];
            const proj = projectOntoNetwork(pt0, roadsRef.current as never);
            let bestPt: [number, number] | null = proj && proj.distM <= ROAD_JOIN_M ? (proj.point as [number, number]) : null;
            let bestD = proj?.distM ?? Infinity;
            for (const d of doorsRef.current) {
              const dist = haversineM(pt0, d.pt);
              if (dist < bestD && dist <= 35) { bestD = dist; bestPt = d.pt; }
            }
            if (bestPt) {
              es.addRoadVertex([...bestPt] as [number, number]);
              return;
            }
          }

          es.addRoadVertex([Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))]);
          return;
        }
        // "Set entrance" latch armed from the building editor: the door must sit ON
        // a road — click the road where navigation should terminate for this building.
        if (es.entranceArmed) {
          const proj = projectOntoNetwork([e.lngLat.lng, e.lngLat.lat], roadsRef.current as never);
          if (proj && proj.distM <= ROAD_JOIN_M) {
            es.setEntrance(proj.point as [number, number]);
            useUi.getState().notify(`Door set — routes to this building now end at the road ${proj.distM.toFixed(1)} m from your click. Export to keep it.`, 'info');
          } else {
            useUi.getState().notify('No road within 60 m of that click — click a road line that should lead to this building.', 'warn');
          }
          return;
        }
        // v3.6: "Move map pin" latch — the node is the building's label / search point /
        // default route end, NOT a door, so it is placed freely (no road snap).
        if (es.labelArmed) {
          const pt: [number, number] = [Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))];
          es.setLabelAt(pt);
          useUi.getState().notify(`Map pin set at ${pt[1].toFixed(6)}, ${pt[0].toFixed(6)} — labels, search results and routes (no-door) now point here. Export to keep it.`, 'info');
          return;
        }
        // "Pick a road to fix" latch armed from the Edit panel
        if (es.roadPickArmed) {
          // 2-3 px lines are unclickable in practice (the reported "fix button does
          // nothing"); query a ±9 px box and take the closest rendered road feature.
          const candIds = new Set(
            map
              .queryRenderedFeatures(
                [[e.point.x - 9, e.point.y - 9], [e.point.x + 9, e.point.y + 9]],
                { layers: ['roads-line', 'roads-stairs', 'roads-casing'] },
              )
              .map((f) => f.properties?.id as string | undefined)
              .filter(Boolean) as string[],
          );
          let road: (typeof roadsRef.current)[number] | undefined;
          let bestD = Infinity;
          for (const r of roadsRef.current) {
            if (!candIds.has(r.id)) continue;
            const proj = projectOntoNetwork([e.lngLat.lng, e.lngLat.lat], [r] as never);
            if (proj && proj.distM < bestD) { bestD = proj.distM; road = r; }
          }
          if (road) {
            es.startRoadFix(road.id, road.line);
            useUi.getState().notify(`Editing road “${road.name ?? road.id}” — drag the amber handles, right-click a handle to delete it, click the dashed line to insert one.`, 'info');
          } else {
            useUi.getState().notify('No road under the cursor — click directly on a road line.', 'warn');
          }
          es.armRoadPick(false);
          return;
        }
        if (!tracingRef.current) return;
        const currentRing = useEdit.getState().traceRing;
        const clickPt: [number, number] = [Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))];
        // Snap to first point to close the shape if we have >=3 points and click within ~5m radius
        if (currentRing.length >= 3) {
          const first = currentRing[0];
          // Convert approximate meters to degrees (rough: 1deg ~111km at this latitude)
          const snapThresholdDeg = 0.00005; // ~5.5m
          if (Math.abs(clickPt[0] - first[0]) < snapThresholdDeg && Math.abs(clickPt[1] - first[1]) < snapThresholdDeg) {
            setTraceForm(true);
            return;
          }
        }
        addTraceVertex(clickPt);
      });

      // Right-click: delete a vertex handle in shape-editing modes, otherwise
      // capture coordinates for a free manual label (edit mode only)
      map.on('contextmenu', (e) => {
        e.preventDefault();
        const es = useEdit.getState();
        if (es.reshaping || es.roadFixId) {
          const hits = map.queryRenderedFeatures(e.point, { layers: ['shape-points'] });
          const idx = hits[0]?.properties?.idx as number | undefined;
          if (idx !== undefined) {
            if (es.reshaping) es.deleteShapeVertex(idx);
            else es.deleteRoadFixVertex(idx);
          }
          return;
        }
        if (!es.enabled) return;
        // right-click a road line = one-step "fix this road" (no panel round-trip)
        const rcHits = map.queryRenderedFeatures(
          [[e.point.x - 9, e.point.y - 9], [e.point.x + 9, e.point.y + 9]],
          { layers: ['roads-line', 'roads-stairs', 'roads-casing'] },
        );
        const rcId = rcHits[0]?.properties?.id as string | undefined;
        const rcRoad = rcId ? roadsRef.current.find((r) => r.id === rcId) : undefined;
        if (rcRoad) {
          es.startRoadFix(rcRoad.id, rcRoad.line);
          useUi.getState().notify(`Fixing road “${rcRoad.name ?? rcRoad.id}” — drag the amber handles; arrows move the whole line; Enter saves; right-click a handle deletes it.`, 'info');
          return;
        }
        // Find the label lat/lng inputs in the edit panel and fill them
        const labelLatLngInput = document.querySelector('input[aria-label="Label coordinates"]') as HTMLInputElement | null;
        const labelTextInput = document.querySelector('input[aria-label="Label text to place"]') as HTMLInputElement | null;
        if (labelLatLngInput) {
          labelLatLngInput.value = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
          labelLatLngInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (labelTextInput) labelTextInput.focus();
          useUi.getState().notify(`Coordinates captured: ${labelLatLngInput.value} — enter label text to add`, 'info');
        }
      });

      map.doubleClickZoom.disable();
      map.on('dblclick', (e) => {
        e.preventDefault();
        const es = useEdit.getState();
        // double-click ENDS a route drawing: last point placed = end marker (§4.2)
        if (es.tracingRoad) {
          const notify = useUi.getState().notify;
          // §1.3: seal the END onto the line you double-clicked near (full join radius);
          // v3.2: a hand-set DOOR is an even better end — closer AND semantically exact
          {
            const ptE: [number, number] = [e.lngLat.lng, e.lngLat.lat];
            const endProj = projectOntoNetwork(ptE, roadsRef.current as never);
            let bestPtE: [number, number] | null = endProj && endProj.distM <= ROAD_JOIN_M ? (endProj.point as [number, number]) : null;
            let bestDE = endProj?.distM ?? Infinity;
            let doorName: string | null = null;
            for (const d of doorsRef.current) {
              const dist = haversineM(ptE, d.pt);
              if (dist < bestDE && dist <= 35) { bestDE = dist; bestPtE = d.pt; doorName = d.name; }
            }
            if (bestPtE) {
              useEdit.getState().addRoadVertex([...bestPtE] as [number, number]);
              if (doorName) setTimeout(() => useUi.getState().notify(`Route END snapped onto the door of ${doorName} — navigation will terminate here.`, 'info'), 50);
            }
          }
          if (useEdit.getState().roadTrace.length < 2) {
            notify('A route needs a start and an end point at minimum.', 'warn');
            return;
          }
          const id = es.closeRoadTrace({ name: null, cls: 'footway', width_m: 1.5, surface: 'unpaved' });
          if (!id) return;
          // Building-crossing guard (§4.3): warn loudly, keep the road (user judges stairs/tunnels)
          const road = useEdit.getState().addedRoads.find((r) => r.id === id);
          if (road) {
            const blockedBy = buildingsRef.current
              .filter((b) => !b.hidden)
              .filter((b) => polylineIntersectsRing(road.line, b.ring));
            if (blockedBy.length > 0) {
              notify(
                `Route crosses ${blockedBy.length} building${blockedBy.length === 1 ? '' : 's'} (${blockedBy
                  .slice(0, 3)
                  .map((b) => b.name)
                  .join(', ')}${blockedBy.length > 3 ? '…' : ''}). If it is not a real shortcut through, redraw it or fix its shape.`,
                'warn',
              );
            } else {
              notify('Route saved locally. Name it in the Edit panel; export to keep it permanently.', 'info');
            }
          }
          return;
        }
        // shape-editing: double-click is reserved, ignore so users cannot mis-deselect
        if (es.reshaping || es.roadFixId) return;
        // Double click building in 2D: select it and open edit panel
        const features = map.queryRenderedFeatures(e.point, { layers: ['b-fill', 'b-outline'] });
        if (features.length > 0) {
          const f = features[0];
          const id = f.properties?.id ?? (f.id as string | undefined);
          if (id) {
            selectBuilding(String(id));
            useEdit.getState().setTarget(String(id));
            if (useEdit.getState().enabled) {
              useUi.getState().setPanel('edit');
              useUi.getState().notify('Opened editor for selected building. Double-click outside to deselect.', 'info');
            }
            return;
          }
        }
        // Double click empty area: deselect
        selectBuilding(null);
        useEdit.getState().setTarget(null);
      });

      map.on('click', 'b-fill', (e) => {
        const es = useEdit.getState();
        if (es.tracing || es.tracingRoad || es.roadPickArmed || es.reshaping || es.roadFixId) return;
        const f = e.features?.[0];
        const id = f?.properties?.id ?? (f?.id as string | undefined);
        if (id) selectBuilding(String(id));
      });
      map.on('mouseenter', 'b-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'b-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      // ── vertex handle interactions (reshape + road fix) ─────────────────────
      // click the dashed line → insert a vertex on the nearest segment
      map.on('click', 'shape-line', (e) => {
        e.preventDefault();
        const es = useEdit.getState();
        const line = es.reshaping ? [...es.shapeRing, ...(es.shapeRing.length ? [es.shapeRing[0]] : [])] : es.roadFixLine;
        if (line.length < 2) return;
        const hit = insertPosition(line, [e.lngLat.lng, e.lngLat.lat]);
        if (!hit) return;
        const at = hit.segIndex + 1;
        const pt: [number, number] = [Number(hit.point[0].toFixed(7)), Number(hit.point[1].toFixed(7))];
        if (es.reshaping) es.insertShapeVertex(at === line.length ? es.shapeRing.length : at, pt);
        else es.insertRoadFixVertex(at, pt);
      });

      // drag a handle
      map.on('mousedown', 'shape-points', (e) => {
        e.preventDefault();
        const idx = e.features?.[0]?.properties?.idx as number | undefined;
        if (idx === undefined) return;
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
        const onMove = (ev: maplibregl.MapMouseEvent) => {
          const pt: [number, number] = [Number(ev.lngLat.lng.toFixed(7)), Number(ev.lngLat.lat.toFixed(7))];
          const s = useEdit.getState();
          if (s.reshaping) s.moveShapeVertex(idx, pt);
          else if (s.roadFixId) s.moveRoadFixVertex(idx, pt);
        };
        const onUp = () => {
          map.off('mousemove', onMove);
          map.off('mouseup', onUp);
          map.dragPan.enable();
          map.getCanvas().style.cursor = '';
        };
        map.on('mousemove', onMove);
        map.on('mouseup', onUp);
      });
      map.on('mouseenter', 'shape-points', () => {
        map.getCanvas().style.cursor = 'grab';
      });
      map.on('mouseleave', 'shape-points', () => {
        map.getCanvas().style.cursor = '';
      });

      // edit-mode cursor readout (lat/lng + zoom) for verifiable tracing (§5.4)
      map.on('mousemove', (e) => {
        if (!useEdit.getState().enabled) {
          setCursorReadout(null);
          return;
        }
        setCursorReadout(`${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)} · z${map.getZoom().toFixed(1)}`);
      });
      map.getCanvas().addEventListener('mouseleave', () => setCursorReadout(null));

      // A plan view must actually be a plan: the shared camera carries the 3D view's
      // 60 degree pitch, which made this look oblique. Flatten it once on entry.
      map.easeTo({ pitch: 0, bearing: 0, duration: 0 });

      map.on('moveend', () => {
        const c = map.getCenter();
        // pitch/bearing are deliberately NOT written back: the 3D rig reads them when it
        // mounts, and a flattened 2D plan view must not leave the 3D view stuck top-down.
        setCamera({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      });

      // label placement is recomputed as the map moves (throttled)
      const relayout = () => {
        if (layout.current) window.clearTimeout(layout.current);
        layout.current = window.setTimeout(() => placeLabelsRef.current(), 90);
      };
      map.on('move', relayout);
      map.on('zoom', relayout);
      map.on('resize', relayout);

      setReady(true);
    });

    return () => {
      markers.current.forEach((m) => m.mk.remove());
      markers.current = [];
      manualMarkers.current.forEach((m) => m.remove());
      manualMarkers.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── keep sources in sync with data ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('buildings') as maplibregl.GeoJSONSource | undefined)?.setData(buildingsGeo as never);
    (map.getSource('roads') as maplibregl.GeoJSONSource | undefined)?.setData(roadsGeo as never);
    (map.getSource('entrances') as maplibregl.GeoJSONSource | undefined)?.setData(entrancesGeo as never);
  }, [ready, buildingsGeo, roadsGeo, entrancesGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(routeGeo as never);
    (map.getSource('route-alt') as maplibregl.GeoJSONSource | undefined)?.setData(routeAltGeo as never);
    const vis = layers.route && routeGeo.features.length > 0 ? 'visible' : 'none';
    if (map.getLayer('route-line')) map.setLayoutProperty('route-line', 'visibility', vis);
    if (map.getLayer('route-casing')) map.setLayoutProperty('route-casing', 'visibility', vis);
    const visAlt = layers.route && routeAltGeo.features.length > 0 ? 'visible' : 'none';
    if (map.getLayer('route-alt-line')) map.setLayoutProperty('route-alt-line', 'visibility', visAlt);
  }, [ready, routeGeo, routeAltGeo, layers.route]);

  // ── layer toggles ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    // Roads-only inspection view (§B): everything but the road network fades out
    set('b-fill', layers.buildings && !roadsOnly);
    set('b-outline', layers.buildings && !roadsOnly);
    set('b-3d', layers.buildings && !roadsOnly);
    set('roads-casing', layers.roads || roadsOnly);
    set('roads-line', layers.roads || roadsOnly);
    set('roads-stairs', layers.roads || roadsOnly);
    set('ortho', layers.ortho && !roadsOnly);
    if (map.getLayer('live-sat')) set('live-sat', layers.ortho && live && !roadsOnly);
    // highlight the network when inspecting it
    if (map.getLayer('roads-line')) map.setPaintProperty('roads-line', 'line-color', roadsOnly ? '#ff2d49' : '#7d8a99');
    if (map.getLayer('roads-line')) map.setPaintProperty('roads-line', 'line-width', roadsOnly ? 3.2 : 2.2);
    if (map.getLayer('roads-casing')) map.setPaintProperty('roads-casing', 'line-opacity', roadsOnly ? 1 : 0.85);
    // §7.3 roads-only workspace is a neutral grey drawing table, not "the map died":
    // the black backdrop read as a loss of imagery; a mid-grey keeps red roads crisp
    if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', roadsOnly ? '#6d7d77' : '#0d1512');
  }, [ready, layers, live, roadsOnly]);

  const placeLabelsRef = useRef<() => void>(() => {});

  /**
   * Screen-space de-collision for the 2D labels.
   *
   * 332 POI labels all drawn at once produced an unreadable stack in the campus cores.
   * Markers stay owned by MapLibre (so they track the map), but visibility is decided here:
   * a zoom-scaled budget, items ranked (real named facilities before derived building
   * locators, campus before context, selection always wins), then a greedy pass that hides
   * anything whose label box would overlap one already placed.
   */
  const placeLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    const limit = zoom < 15.5 ? 22 : zoom < 16.5 ? 48 : zoom < 17.5 ? 90 : 160;

    const ranked = [...markers.current].sort((a, b) => rank(a.poi, zoom) - rank(b.poi, zoom));
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const shown = new Set<maplibregl.Marker>();

    // Two passes. Everything competes for space — even the most important labels cannot
    // all win in a dense core — but pass 1 gives the ranked items first refusal, so a
    // derived locator never displaces the mess or the health centre.
    const passes: (0 | 1)[] = [0, 1];
    for (const pass of passes) {
      for (const m of ranked) {
        if (shown.size >= limit) break;
        if (shown.has(m.mk)) continue;
        const isTop = rank(m.poi, zoom) <= 1;
        if (pass === 0 ? !isTop : isTop) continue;

        const pt = map.project([m.poi.lng, m.poi.lat]);
        const box = { x0: pt.x - 8, y0: pt.y - m.h / 2, x1: pt.x + m.w + 4, y1: pt.y + m.h / 2 };

        let clash = false;
        for (const q of placed) {
          if (box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
        placed.push(box);
        shown.add(m.mk);
      }
    }
    for (const m of markers.current) {
      m.el.style.display = shown.has(m.mk) ? 'flex' : 'none';
    }
  }, []);
  placeLabelsRef.current = placeLabels;

  // ── POI markers (DOM, so no glyph server is needed) ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markers.current.forEach((m) => m.mk.remove());
    markers.current = [];
    if (!layers.poi || roadsOnly) return;
    for (const p of data.pois) {
      const el = document.createElement('div');
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.innerHTML = `<span class="poi-marker"></span><span class="poi-marker-label">${escapeHtml(p.name)}</span>`;
      const mk = new maplibregl.Marker({ element: el, anchor: 'left' })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      // The pill never changes size, so measure it ONCE. Measuring inside the placement
      // pass forced a synchronous layout per marker per relayout and locked the main
      // thread up (332 markers x 2 passes on every throttled map move).
      const w = el.offsetWidth || 26 + p.name.length * 6.2;
      const hh = el.offsetHeight || 20;
      markers.current.push({ mk, el, poi: p, w, h: hh });
    }
    placeLabelsRef.current();
  }, [ready, data.pois, layers.poi, roadsOnly]);

  // Manual labels use the same DOM label treatment as generated POI labels. They are
  // deliberately separate from the ranked POI list so a user-added label is never
  // silently discarded as a low-priority shop/context marker.
  useEffect(() => {
    manualMarkers.current.forEach((m) => m.remove());
    manualMarkers.current = [];
    const map = mapRef.current;
    if (!ready || !map || !layers.labels || roadsOnly) return;
    for (const label of data.manualLabels) {
      const el = document.createElement('div');
      el.className = 'manual-map-label';
      const dot = document.createElement('span');
      dot.className = 'manual-map-label-dot';
      const text = document.createElement('span');
      text.textContent = label.text;
      el.append(dot, text);
      const marker = new maplibregl.Marker({ element: el, anchor: 'left' })
        .setLngLat([label.lng, label.lat])
        .addTo(map);
      manualMarkers.current.push(marker);
    }
  }, [ready, data.manualLabels, layers.labels, roadsOnly]);

  // ── route-drawing preview ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('roadtrace') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const feats: unknown[] = [];
    if (tracingRoad) {
      if (roadTrace.length >= 2) {
        feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: roadTrace } });
      }
      roadTrace.forEach(([lng, lat], i) => {
        const role = i === 0 ? 'start' : i === roadTrace.length - 1 ? 'end' : 'mid';
        feats.push({ type: 'Feature', properties: { role }, geometry: { type: 'Point', coordinates: [lng, lat] } });
      });
    }
    src.setData({ type: 'FeatureCollection', features: feats } as never);
  }, [ready, tracingRoad, roadTrace]);

  // ── vertex handles (footprint reshape / fix-road) ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('shape') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const feats: unknown[] = [];
    const line: [number, number][] | null = reshaping ? shapeRing : roadFixId ? roadFixLine : null;
    if (line && line.length >= 2) {
      const display = reshaping ? [...line, line[0]] : line;
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: display } });
      line.forEach(([lng, lat], idx) => {
        feats.push({ type: 'Feature', properties: { idx }, geometry: { type: 'Point', coordinates: [lng, lat] } });
      });
    }
    src.setData({ type: 'FeatureCollection', features: feats } as never);
  }, [ready, reshaping, shapeRing, roadFixId, roadFixLine]);

  // ── edit mode = HD: switching to the editor turns on live high-res imagery
  // with graceful offline fallback to the baked ortho underneath
  useEffect(() => {
    if (editEnabled) setLive(true);
  }, [editEnabled]);

  // ── live trace geometry ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('trace') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features: unknown[] = [];
    // Filled polygon preview when 3+ points exist
    if (traceRing.length >= 3) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...traceRing, traceRing[0]]] },
      });
    } else if (traceRing.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: traceRing },
      });
    }
    for (const [lng, lat] of traceRing) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } });
    }
    src.setData({ type: 'FeatureCollection', features } as never);
  }, [ready, traceRing]);

  // ── fly-to requests from search / route ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !flyTo) return;
    map.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? Math.max(map.getZoom() + 1, 16.5),
      pitch: flyTo.pitch ?? map.getPitch(),
      duration: 1400,
      essential: true,
    });
    clearFlyTo();
  }, [flyTo, ready, clearFlyTo]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {roadsOnly && (
        <button
          className="glass"
          style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 58, zIndex: 5, padding: '6px 14px', borderRadius: 'var(--r-pill)', cursor: 'pointer', fontSize: 11.5, color: 'var(--accent)', fontWeight: 600, letterSpacing: 0.4 }}
          onClick={() => useOutdoor.getState().setRoadsOnly(false)}
          title="Everything but the route network is hidden (V toggles)"
        >
          Roads-only — EXIT [V]
        </button>
      )}
      {featureFlags.liveTiles && (
        <button
          className="glass"
          style={{ position: 'absolute', right: 12, top: 72, zIndex: 5, padding: '7px 12px', borderRadius: 'var(--r-pill)', cursor: 'pointer', fontSize: 11.5 }}
          onClick={() => setLive((v) => !v)}
          title="Fetch live Esri World Imagery tiles instead of the locally baked orthomosaic"
        >
          {live ? '◉ Live imagery' : '○ Live imagery'}
        </button>
      )}
      {debugAlign && (
        <div className="glass" style={{ position: 'absolute', left: 12, bottom: 96, zIndex: 5, padding: 10, borderRadius: 'var(--r-md)', maxWidth: 280, fontSize: 11 }}>
          Algorithmic alignment aid: switch to the <strong>3D</strong> view for the 50 % ortho overlay, and use
          the accuracy HUD to read per-building cut-bench relief. Map-mode alignment here is visual only —
          footprints come from OSM/Overture, so any offset you see is an imagery georeferencing artefact.
        </div>
      )}
      <div
        className="glass"
        style={{ position: 'absolute', left: 12, top: 72, zIndex: 5, padding: '8px 11px', borderRadius: 'var(--r-md)', maxWidth: 300, fontSize: 11, lineHeight: 1.6 }}
      >
        <strong style={{ fontSize: 11.5 }}>{data.manifest.counts.buildings} buildings</strong> · {data.manifest.counts.roads} roads ·{' '}
        {data.pois.length} POIs
        <div style={{ color: 'var(--text-3)', marginTop: 3 }}>
          Click a building for details. Imagery drape is the locally baked orthomosaic
          ({BASEMAP_META.imagery.width.toLocaleString()}×{BASEMAP_META.imagery.height.toLocaleString()} px @ ~{BASEMAP_META.imagery.mpp.toFixed(2)} m/px).
        </div>
      </div>
      {cursorReadout && (
        <div className="glass mono" style={{ position: 'absolute', right: 12, bottom: 52, zIndex: 6, padding: '5px 9px', borderRadius: 'var(--r-pill)', fontSize: 10.5 }}>
          {cursorReadout}
        </div>
      )}
      {tracingRoad && (
        <div className="glass" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 20, zIndex: 12, padding: 12, borderRadius: 'var(--r-md)', width: 'min(480px, 92vw)' }}>
          <div className="label-h">Drawing a route</div>
          <p style={{ fontSize: 11.5, margin: '6px 0 8px', color: 'var(--text-2)' }}>
            {roadTrace.length} point{roadTrace.length === 1 ? '' : 's'} placed — click the first point for the <strong style={{ color: '#2ecc71' }}>start</strong>,
            waypoints in between, then <strong>double-click / Enter / Finish</strong> for the <strong style={{ color: '#1a73e8' }}>end</strong>. Esc cancels.
            Endpoints snap to the existing network automatically.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={roadTrace.length < 2}
              onClick={() => {
                const es = useEdit.getState();
                const id = es.closeRoadTrace({ name: null, cls: 'footway', width_m: 1.5, surface: 'unpaved' });
                if (!id) return;
                const road = es.addedRoads.find((r) => r.id === id);
                if (road) {
                  const blockedBy = buildingsRef.current.filter((b) => !b.hidden && polylineIntersectsRing(road.line, b.ring));
                  useUi.getState().notify(
                    blockedBy.length > 0
                      ? `Route crosses ${blockedBy.slice(0, 3).map((b) => b.name).join(', ')}${blockedBy.length > 3 ? '…' : ''} — redraw or fix it unless it is a genuine shortcut.`
                      : 'Route saved locally. Name it in the Edit panel; export to keep it.',
                    blockedBy.length > 0 ? 'warn' : 'info',
                  );
                }
              }}
            >
              Finish route
            </button>
            <button className="btn" onClick={() => useEdit.getState().undoRoadVertex()} disabled={!roadTrace.length}>Undo point</button>
            <button className="btn" onClick={() => useEdit.getState().cancelRoadTrace()}>Cancel</button>
          </div>
        </div>
      )}
      {(reshaping || roadFixId) && (
        <div className="glass" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 20, zIndex: 12, padding: 12, borderRadius: 'var(--r-md)', width: 'min(480px, 92vw)' }}>
          <div className="label-h">{reshaping ? 'Reshaping the footprint' : `Fixing road ${roadFixId}`}</div>
          <p style={{ fontSize: 11.5, margin: '6px 0 8px', color: 'var(--text-2)' }}>
            Drag the <strong style={{ color: '#fbbf24' }}>amber handles</strong> · click the dashed line to insert one · right-click a handle to delete it
            {reshaping ? ' · the outline must stay uncrossed and ≥ 4 m²' : ''} · Esc cancels.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                const es = useEdit.getState();
                const notify = useUi.getState().notify;
                if (es.reshaping) {
                  const res = es.saveReshape();
                  if (!res.ok) notify(res.reason ?? 'Shape rejected.', 'warn');
                  else notify('Footprint reshaped — the building rebuilt in 2D and 3D.', 'info');
                } else {
                  const ok = es.saveRoadFix();
                  if (!ok) notify('Road line needs at least 2 points.', 'warn');
                  else {
                    const road = roadsRef.current.find((r) => r.id === es.roadFixId) ?? null;
                    void road; // geometry already stored in roadEdits before this read
                    notify('Road geometry corrected. The route graph rebuilt; routes now follow your line.', 'info');
                  }
                }
              }}
            >
              {reshaping ? 'Save new footprint' : 'Save road fix'}
            </button>
            <button
              className="btn"
              onClick={() => {
                const es = useEdit.getState();
                if (es.reshaping) es.cancelReshape();
                else es.cancelRoadFix();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {tracing && (
        <div className="glass" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 20, zIndex: 12, padding: 12, borderRadius: 'var(--r-md)', width: 'min(460px, 92vw)' }}>
          <div className="label-h">Tracing a footprint</div>
          <p style={{ fontSize: 11.5, margin: '6px 0 8px', color: 'var(--text-2)' }}>
            {traceRing.length} point{traceRing.length === 1 ? '' : 's'} placed — click each corner on the imagery.
            {traceRing.length >= 3 && ' Close the shape when you have all corners.'}
          </p>
          {traceForm ? (
            <div>
              <input value={traceName} onChange={(e) => setTraceName(e.target.value)} placeholder="Building name" aria-label="New building name"
                style={{ width: '100%', minHeight: 34, background: 'var(--surface-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-sm)', padding: '0 8px', marginBottom: 6 }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <select value={traceCat} onChange={(e) => setTraceCat(e.target.value)} aria-label="New building category"
                  style={{ flex: 2, minHeight: 34, background: 'var(--surface-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-sm)', padding: '0 8px' }}>
                  {['academic','hostel','dining','sports','admin','residential','medical','utility','gate','library','lab','auditorium'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input type="number" min={1} max={10} value={traceFloors} onChange={(e) => setTraceFloors(parseInt(e.target.value, 10) || 1)} aria-label="New building floors"
                  style={{ flex: 1, minHeight: 34, background: 'var(--surface-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-sm)', padding: '0 8px' }} />
              </div>
              <button
                className="btn btn-primary"
                disabled={!traceName.trim()}
                onClick={() => {
                  useEdit.getState().closeTrace({
                    id: `manual-${Date.now().toString(36)}`,
                    name: traceName.trim(),
                    cat: traceCat as never,
                    floors: traceFloors,
                    f2f: 3.6,
                    roof: 'flat',
                    pitch: 0,
                    wall: 'plaster_paint_white',
                  });
                  setTraceForm(false);
                  setTraceName('');
                }}
              >
                Save footprint
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={traceRing.length < 3} onClick={() => setTraceForm(true)}>Close shape</button>
              <button className="btn" onClick={() => useEdit.getState().undoVertices()} disabled={!traceRing.length}>Undo point</button>
              <button className="btn" onClick={() => useEdit.getState().cancelTrace()}>Cancel</button>
            </div>
          )}
        </div>
      )}

      <div className="mono" style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 5, fontSize: 10, color: 'var(--text-3)', textAlign: 'right', pointerEvents: 'none' }}>
        zoom→camera distance ≈ {zoomToDistance(useMap.getState().camera.zoom).toFixed(0)} m (shared with the 3D view)
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
