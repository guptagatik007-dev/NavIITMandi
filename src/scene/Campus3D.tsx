/**
 * Campus3D.tsx — the outdoor 3D scene.
 *
 * One canvas, three merged static layers (terrain, buildings, roads/trees) plus two
 * instanced window meshes, so the whole 900-building campus stays inside the draw-call
 * budget. Everything is positioned from baked survey data — no runtime network access.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, PointerLockControls, Sky, useTexture } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';

import { ANCHORS, BBOX, CAMERA_DEFAULTS, SUN_PRESETS, TIERS, UNLABELLED_POI_KINDS } from '@/config/map.config';
import { latLngToLocal, localToLatLng } from '@/geo/wgs84';
import type { TerrainGrid } from '@/geo/terrain';
import type { CampusBuilding, CampusData, CampusRoad } from '@/data/loaders';
import { useMap } from '@/store/mapStore';
import { useOutdoor } from '@/store/outdoorStore';
import { useUi } from '@/store/uiStore';
import { useEdit } from '@/store/editStore';
import { buildBuildings, buildRoads, buildTreeInstances, treeUnitGeometry, ROOF_COLORS, WALL_COLORS } from './buildGeometry';
import { facadeTexture, contactShadowTexture } from './procTextures';
import { RouteLine } from './RouteLine';
import { PoiMarkers } from './PoiMarkers';
import { AccuracyHud } from './AccuracyHud';

/* ────────────────────────────────────────────────────────────── terrain ───── */

function TerrainMesh({ terrain, segW, segH }: { terrain: TerrainGrid; segW: number; segH: number }) {
  const ortho = useTexture('data/ortho/campus.jpg');
  const showOrthoRaw = useOutdoor((s) => s.layers.ortho);
  const roadsOnly = useOutdoor((s) => s.roadsOnly);
  const showOrtho = showOrthoRaw && !roadsOnly;

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const cols = segW + 1;
    const rows = segH + 1;
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const myNorth = (Math.log(Math.tan(Math.PI / 4 + (BBOX.north * Math.PI) / 180 / 2)) as number);
    const mySouth = Math.log(Math.tan(Math.PI / 4 + (BBOX.south * Math.PI) / 180 / 2));
    for (let j = 0; j < rows; j++) {
      const lat = BBOX.north + (BBOX.south - BBOX.north) * (j / segH);
      const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
      const v = (myNorth - my) / (myNorth - mySouth);
      for (let i = 0; i < cols; i++) {
        const lng = BBOX.west + (BBOX.east - BBOX.west) * (i / segW);
        const p = latLngToLocal(lat, lng);
        const y = terrain.heightAtLatLng(lat, lng) - terrain.datum;
        const o = (j * cols + i) * 3;
        positions[o] = p.x;
        positions[o + 1] = y;
        positions[o + 2] = p.z;
        const ou = (j * cols + i) * 2;
        uvs[ou] = i / segW;
        uvs[ou + 1] = v;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < segH; j++) {
      for (let i = 0; i < segW; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [terrain, segW, segH]);

  useEffect(() => {
    ortho.colorSpace = THREE.SRGBColorSpace;
    ortho.flipY = false; // our V axis already starts at the northern edge
    ortho.anisotropy = 8;
    ortho.needsUpdate = true;
  }, [ortho]);

  return (
    <mesh geometry={geometry} receiveShadow={false}>
      <meshStandardMaterial
        map={showOrtho ? ortho : null}
        color={showOrtho ? '#ffffff' : '#7d8f7a'}
        roughness={0.97}
        metalness={0}
      />
    </mesh>
  );
}

/* ──────────────────────────────────────────────────────────── buildings ───── */

function Buildings({ data, terrain }: { data: CampusData; terrain: TerrainGrid }) {
  const uiTier = useUi((s) => s.deviceTier);
  const layers = useOutdoor((s) => s.layers);
  const roadsOnly = useOutdoor((s) => s.roadsOnly);
  const selected = useOutdoor((s) => s.selectedBuildingId);
  const hovered = useOutdoor((s) => s.hoveredBuildingId);
  const selectBuilding = useOutdoor((s) => s.selectBuilding);
  const globalOpacity = useOutdoor((s) => s.globalOpacity);
  const sunEmissive = SUN_PRESETS[useOutdoor((s) => s.sunPreset)].emissive;

  // visible set: campus always, context only when the layer is on
  const visibleBuildings = useMemo(
    () => data.buildings.filter((b) => !b.hidden && !data.overrides.get(b.id)?.hidden && (b.scope === 'campus' || layers.contextBuildings)),

    [data.buildings, layers.contextBuildings],
  );

  // procedural generation is CPU work: run it once per data/override revision
  const batch = useMemo(
    () => buildBuildings(visibleBuildings, terrain, { overrides: data.overrides, detailMode: 'campus-first' }),
    [visibleBuildings, terrain, data.overrides],
  );

  const wallsGeo = useMemo(() => batch.walls.build(), [batch]);
  const roofsGeo = useMemo(() => batch.roofs.build(), [batch]);
  const detailsGeo = useMemo(() => batch.details.build(), [batch]);
  const transWallsGeo = useMemo(() => batch.translucentWalls.build(), [batch]);
  const transRoofsGeo = useMemo(() => batch.translucentRoofs.build(), [batch]);

  const glassMesh = useRef<THREE.InstancedMesh>(null);
  const revealMesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (glassMesh.current) {
      batch.glass.forEach((g, i) => glassMesh.current!.setMatrixAt(i, g.m));
      glassMesh.current.count = batch.glass.length;
      glassMesh.current.instanceMatrix.needsUpdate = true;
      glassMesh.current.computeBoundingSphere();
    }
    if (revealMesh.current) {
      batch.reveal.forEach((g, i) => revealMesh.current!.setMatrixAt(i, g.m));
      revealMesh.current.count = batch.reveal.length;
      revealMesh.current.instanceMatrix.needsUpdate = true;
      revealMesh.current.computeBoundingSphere();
    }
  }, [batch]);

  // surface geometry for picking: walls + context massing
  const pickTarget = wallsGeo ?? roofsGeo;

  const onPick = (e: { stopPropagation: () => void; point: THREE.Vector3 }) => {
    e.stopPropagation();
    const hit = nearestBuilding(visibleBuildings, e.point);
    selectBuilding(hit?.id ?? null);
  };

  // Double-click a building in 3D: same behaviour as the Map view — select it,
  // aim the editor at it, and open the Edit panel when edit mode is on.
  const onEditPick = (e: { stopPropagation: () => void; point: THREE.Vector3 }) => {
    e.stopPropagation();
    const hit = nearestBuilding(visibleBuildings, e.point);
    if (!hit) {
      selectBuilding(null);
      return;
    }
    selectBuilding(hit.id);
    const es = useEdit.getState();
    if (es.enabled) {
      es.setTarget(hit.id);
      useUi.getState().setPanel('edit');
      useUi.getState().notify(`Editing ${hit.name}. Esc deselects; sliders preview live.`, 'info');
    }
  };

  const highlight = useMemo(() => {
    const id = selected ?? hovered;
    if (!id) return null;
    const b = data.buildings.find((x) => x.id === id);
    if (!b) return null;
    const seat = batch.seats.find((x) => x.id === id);
    const baseY = (seat?.padMSL ?? terrain.footprintStats(b.ring).max) - terrain.datum;
    const h = b.height_m + (selected === id ? 2.5 : 0.4);
    const pts = b.ring.map(([lng, lat]) => {
      const p = latLngToLocal(lat, lng);
      return [p.x, p.z] as [number, number];
    });
    if (pts.length > 3 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9) pts.pop();
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [x, z] of pts) positions.push(x, baseY, z, x, baseY + h, z);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b2 = ((i + 1) % n) * 2;
      indices.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return { g, isSel: selected === id };
  }, [selected, hovered, data.buildings, terrain, batch.seats]);

  // §6 procedural finish: near-white grain texture multiplied over vertex colors
  // (adds surface grain, never re-paints) + soft contact shadows grounding every
  // building. Skipped on low-end tiers; textures live in shared module cache.
  const finishTex = useMemo(() => (uiTier === 'low' ? null : facadeTexture()), [uiTier]);

  const shadowTex = useMemo(() => (uiTier === 'low' ? null : contactShadowTexture()), [uiTier]);

  const contactShadows = useMemo(() => {
    if (!shadowTex) return null;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vi = 0;
    for (const b of visibleBuildings) {
      // axis-aligned bbox of the footprint, padded — cheap one-quad-per-building blob
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [lng, lat] of b.ring) {
        const p = latLngToLocal(lat, lng);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      if (!Number.isFinite(minX)) continue;
      const pad = 2.2;
      minX -= pad;
      maxX += pad;
      minZ -= pad;
      maxZ += pad;
      const seat = batch.seats.find((x) => x.id === b.id);
      const y = ((seat?.padMSL ?? terrain.footprintStats(b.ring).max) - terrain.datum) + 0.07;
      positions.push(minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    if (positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeBoundingSphere();
    return g;
  }, [visibleBuildings, batch.seats, terrain, shadowTex]);

  if (!layers.buildings || roadsOnly) return null; // §B: roads-only inspection hides massing

  const solidMat = {
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.03,
    transparent: globalOpacity < 1,
    opacity: globalOpacity,
    depthWrite: globalOpacity >= 1,
  } as const;
  const roofMat = { ...solidMat, roughness: 0.74, metalness: 0.16 } as const;

  return (
    <group>
      {contactShadows && shadowTex && (
        <mesh geometry={contactShadows} raycast={() => null} renderOrder={1}>
          <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
        </mesh>
      )}
      {wallsGeo && (
        <mesh geometry={wallsGeo} onClick={onPick} onDoubleClick={onEditPick}>
          <meshStandardMaterial {...solidMat} map={finishTex ?? undefined} />
        </mesh>
      )}
      {roofsGeo && (
        <mesh geometry={roofsGeo} onClick={onPick} onDoubleClick={onEditPick} raycast={undefined}>
          <meshStandardMaterial {...roofMat} map={finishTex ?? undefined} />
        </mesh>
      )}
      {detailsGeo && (
        <mesh geometry={detailsGeo} raycast={() => null}>
          <meshStandardMaterial {...solidMat} roughness={0.95} metalness={0.02} />
        </mesh>
      )}

      {/* buildings with a manual opacity < 1 render in their own batch so the rest of
          the campus keeps depth-writes and stays cheap to sort */}
      {/* translucent buildings: per-vertex alpha carries each building's exact
          editor opacity (fix for the "stuck at one opacity" bug) */}
      {transWallsGeo && (
        <mesh geometry={transWallsGeo} onClick={onPick} onDoubleClick={onEditPick}>
          <meshStandardMaterial vertexColors roughness={0.9} metalness={0.05} transparent depthWrite={false} />
        </mesh>
      )}
      {transRoofsGeo && (
        // §3.1: translucent roofs (louvred canopies, polycarb) are still the building —
        // they were raycast-dead, so a click on the canopy fell through and picked
        // nothing/the building behind. Give them the same pick handlers.
        <mesh geometry={transRoofsGeo} onClick={onPick} onDoubleClick={onEditPick}>
          <meshStandardMaterial vertexColors roughness={0.7} metalness={0.16} transparent depthWrite={false} />
        </mesh>
      )}

      <instancedMesh ref={glassMesh} args={[undefined, undefined, Math.max(1, batch.glass.length)]} frustumCulled={false} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#93a9b3"
          metalness={0.5}
          roughness={0.26}
          emissive="#ffcf8f"
          emissiveIntensity={sunEmissive * 1.4}
        />
      </instancedMesh>

      <instancedMesh ref={revealMesh} args={[undefined, undefined, Math.max(1, batch.reveal.length)]} frustumCulled={false} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color="#2f2f2b" roughness={0.96} metalness={0} />
      </instancedMesh>

      {highlight && (
        <mesh geometry={highlight.g} raycast={() => null}>
          <meshBasicMaterial
            color={highlight.isSel ? '#5eead4' : '#c8d6d1'}
            transparent
            opacity={highlight.isSel ? 0.22 : 0.12}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {void uiTier}
      {void pickTarget}
    </group>
  );
}

/**
 * Containment-first picking (§3, v3 blueprint): the pointer must be INSIDE the real
 * footprint, with a 2.5 m grace band on its ring. The old "nearest centroid within
 * 220 m" rule hijacked three out of four random clicks — hostel wings, pitched
 * roofs and dual-rectangle frames all sat 70-150 m from their centroid. Centroid
 * distance stays only as a last-resort fallback capped at 50 m (far taps that just
 * missed a facade), never as the primary decision.
 */
function nearestBuilding(buildings: CampusBuilding[], point: THREE.Vector3): CampusBuilding | null {
  const insideOrClose: { b: CampusBuilding; d: number }[] = [];
  let fallback: { b: CampusBuilding; d: number } | null = null;
  for (const b of buildings) {
    const ring = b.ring;
    // local-metre polygon (lat/lng rings converted via equirectangular local frame)
    const pts = ring.map(([lng, lat]) => {
      const p = latLngToLocal(lat, lng);
      return { x: p.x, z: p.z };
    });
    // strict containment
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const c = pts[j];
      if (a.z > point.z !== c.z > point.z && point.x < ((c.x - a.x) * (point.z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
    }
    if (inside) {
      insideOrClose.push({ b, d: 0 });
      continue;
    }
    // grace band: minimum distance to any ring edge
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const c = pts[j];
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2)) : 0;
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      best = Math.min(best, Math.hypot(point.x - px, point.z - pz));
    }
    if (best <= 2.5) insideOrClose.push({ b, d: best });
  }
  if (insideOrClose.length > 0) {
    insideOrClose.sort((a, b) => a.d - b.d);
    return insideOrClose[0].b;
  }
  // fallback: centroid proximity for far taps, hard-capped at 50 m (was 220 m)
  for (const b of buildings) {
    const c = ringCentroidLngLat(b.ring);
    const p = latLngToLocal(c[1], c[0]);
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d <= 50 && d < (fallback?.d ?? Infinity)) fallback = { b, d };
  }
  return fallback?.b ?? null;
}

function ringCentroidLngLat(ring: [number, number][]): [number, number] {
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
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/* ─────────────────────────────────────────────────────────────── roads ───── */

function RoadsAndTrees({ data, terrain }: { data: CampusData; terrain: TerrainGrid }) {
  const layers = useOutdoor((s) => s.layers);
  const roadsOnly = useOutdoor((s) => s.roadsOnly);
  const tier = useUi((s) => s.deviceTier);

  const roadsGeo = useMemo(() => buildRoads(data.roads as CampusRoad[], terrain).build(), [data.roads, terrain]);
  const trees = useMemo(
    () => buildTreeInstances(data.trees, terrain, TIERS[tier].trees),
    [data.trees, terrain, tier],
  );
  const coniferGeo = useMemo(() => treeUnitGeometry('conifer'), []);
  const broadleafGeo = useMemo(() => treeUnitGeometry('broadleaf'), []);

  const coniferRef = useRef<THREE.InstancedMesh>(null);
  const broadleafRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (coniferRef.current) {
      trees.conifer.forEach((m, i) => coniferRef.current!.setMatrixAt(i, m));
      coniferRef.current.count = trees.conifer.length;
      coniferRef.current.instanceMatrix.needsUpdate = true;
      coniferRef.current.computeBoundingSphere();
    }
    if (broadleafRef.current) {
      trees.broadleaf.forEach((m, i) => broadleafRef.current!.setMatrixAt(i, m));
      broadleafRef.current.count = trees.broadleaf.length;
      broadleafRef.current.instanceMatrix.needsUpdate = true;
      broadleafRef.current.computeBoundingSphere();
    }
  }, [trees]);

  return (
    <group>
      {/* §B roads-only view: network stays at full strength, everything else hidden */}
      {(layers.roads || roadsOnly) && roadsGeo && (
        <mesh geometry={roadsGeo} raycast={() => null}>
          <meshStandardMaterial vertexColors roughness={0.95} metalness={0.02} color={roadsOnly ? '#ffe08a' : undefined} />
        </mesh>
      )}
      {layers.trees && !roadsOnly && (
        <>
          <instancedMesh ref={coniferRef} args={[undefined, undefined, Math.max(1, trees.conifer.length)]} raycast={() => null}>
            <primitive object={coniferGeo} attach="geometry" />
            <meshStandardMaterial vertexColors roughness={0.9} metalness={0} />
          </instancedMesh>
          <instancedMesh ref={broadleafRef} args={[undefined, undefined, Math.max(1, trees.broadleaf.length)]} raycast={() => null}>
            <primitive object={broadleafGeo} attach="geometry" />
            <meshStandardMaterial vertexColors roughness={0.9} metalness={0} />
          </instancedMesh>
        </>
      )}
    </group>
  );
}

/* ─────────────────────────────────────────────────────── sun / lighting ───── */

/** Approximate solar position (no longitude/timezone correction; documented as such). */
function sunVector(latDeg: number, hour: number, dayOfYear = 255): [number, number, number] {
  const phi = (latDeg * Math.PI) / 180;
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const sinElev = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const elev = Math.asin(Math.max(-1, Math.min(1, sinElev)));
  const cosAz = (Math.sin(decl) - Math.sin(elev) * Math.sin(phi)) / (Math.cos(elev) * Math.cos(phi) || 1e-6);
  const az = Math.acos(Math.max(-1, Math.min(1, cosAz))); // from north, eastward
  const azimuth = H > 0 ? 2 * Math.PI - az : az;
  const e = Math.max(0.03, Math.sin(elev));
  return [Math.cos(elev) * Math.sin(azimuth), e, -Math.cos(elev) * Math.cos(azimuth)];
}

function SunAndSky({ terrain }: { terrain: TerrainGrid }) {
  const presetId = useOutdoor((s) => s.sunPreset);
  const hourOverride = useOutdoor((s) => s.hourOverride);
  const preset = SUN_PRESETS[presetId];
  const hour = hourOverride ?? preset.hour;
  const dir = useMemo(() => sunVector(ANCHORS.north_core.lat, hour), [hour]);
  const isNight = hour < 6.2 || hour > 19.2;
  const pos: [number, number, number] = [dir[0] * 2200, dir[1] * 2200, dir[2] * 2200];

  return (
    <>
      <Sky sunPosition={pos} turbidity={preset.turbidity} rayleigh={preset.rayleigh} mieCoefficient={0.006} mieDirectionalG={0.82} />
      <fogExp2 attach="fog" args={[preset.fogColor, preset.fog]} />
      <hemisphereLight args={[isNight ? '#26303a' : '#cfe4ec', '#4a4a42', isNight ? 0.22 : 0.85]} />
      <directionalLight
        position={pos}
        intensity={isNight ? 0.18 : 1.5}
        color={presetId === 'evening' ? '#ffd6a8' : '#fff6e8'}
      />
      <ambientLight intensity={isNight ? 0.16 : 0.28} />
      <mesh position={[0, terrain.datum + 0.4, 0]} visible={false} />
    </>
  );
}

/* ─────────────────────────────────────────────────────── camera controls ───── */

const zoomToDistance = (zoom: number) => Math.min(3200, Math.max(70, 400 * Math.pow(2, 17 - zoom)));

function CameraRig({ terrain }: { terrain: TerrainGrid }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const set = useThree((s) => s.set);
  const camera = useThree((s) => s.camera);

  // Dev-only probe used by tools/shots.mjs to *prove* that user input moves the
  // camera (zoom / orbit / pan) instead of eyeballing two screenshots.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const probe = () => {
      const c = controls.current;
      if (!c) return null;
      return {
        camera: camera.position.toArray().map((n) => +n.toFixed(2)),
        target: c.target.toArray().map((n) => +n.toFixed(2)),
        distance: +camera.position.distanceTo(c.target).toFixed(2),
        min: c.minDistance,
        max: c.maxDistance,
      };
    };
    (window as unknown as Record<string, unknown>).__camDebug = probe;
    return () => {
      delete (window as unknown as Record<string, unknown>).__camDebug;
    };
  }, [camera]);
  const flyTo = useMap((s) => s.flyTo);
  const clearFlyTo = useMap((s) => s.clearFlyTo);
  const setCamera = useMap((s) => s.setCamera);
  const [walk, setWalk] = useState(false);
  const flight = useRef<{
    from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; t: number;
  } | null>(null);

  // initial framing from the shared camera state
  useEffect(() => {
    const cam = useMap.getState().camera;
    const p = latLngToLocal(cam.lat, cam.lng);
    const y = terrain.heightAtLatLng(cam.lat, cam.lng) - terrain.datum;
    // honour the shared camera centre (this used to hard-code the world origin and
    // throw away `p`, so a restored or deep-linked centre was ignored on boot)
    const target = new THREE.Vector3(p.x, y, p.z);
    const dist = zoomToDistance(cam.zoom);
    const az = (cam.bearing * Math.PI) / 180;
    const el = (Math.max(0.16, cam.pitch) * Math.PI) / 180;
    camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    );
    camera.lookAt(target);
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.maxDistance = 4200;
      controls.current.minDistance = 6;
      controls.current.update();
    }
  }, [camera, terrain]);

  // fly-to animation
  useEffect(() => {
    if (!flyTo || !controls.current) return;
    const p = latLngToLocal(flyTo.lat, flyTo.lng);
    const y = terrain.heightAtLatLng(flyTo.lat, flyTo.lng) - terrain.datum;
    const targetTo = new THREE.Vector3(p.x, y + 8, p.z);
    const zoom = flyTo.zoom ?? Math.max(useMap.getState().camera.zoom + 1.2, 16);
    const dist = Math.min(900, zoomToDistance(zoom));
    const az = ((flyTo.bearing ?? useMap.getState().camera.bearing) * Math.PI) / 180;
    const el = ((flyTo.pitch ?? 45) * Math.PI) / 180;
    const camTo = new THREE.Vector3(
      targetTo.x + Math.sin(az) * Math.cos(el) * dist,
      targetTo.y + Math.sin(el) * dist,
      targetTo.z + Math.cos(az) * Math.cos(el) * dist,
    );
    flight.current = {
      from: camera.position.clone(),
      to: camTo,
      targetFrom: controls.current.target.clone(),
      targetTo,
      t: 0,
    };
    setCamera({ lat: flyTo.lat, lng: flyTo.lng });
    clearFlyTo();
  }, [flyTo, camera, terrain, clearFlyTo, setCamera]);

  /**
   * Keyboard navigation for the orbit camera.
   *
   * Spec §10.5: pointer-only interaction is a bug. Arrow keys pan across the ground plane,
   * +/− dolly in and out, Escape clears the selection. The walk controller owns the keys
   * while first-person mode is active, and typing in a field must never move the map.
   */
  useEffect(() => {
    if (walk) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const c = controls.current;
      if (!c) return;

      const dolly = (factor: number) => {
        const offset = new THREE.Vector3().subVectors(camera.position, c.target);
        const next = THREE.MathUtils.clamp(offset.length() * factor, c.minDistance, c.maxDistance);
        camera.position.copy(c.target).add(offset.setLength(next));
        c.update();
      };

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        dolly(0.82);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        dolly(1 / 0.82);
        return;
      }
      if (e.key === 'Escape') {
        useOutdoor.getState().selectBuilding(null);
        return;
      }

      const pan = Math.max(2, camera.position.distanceTo(c.target) * 0.06);
      const fwd = new THREE.Vector3().subVectors(c.target, camera.position);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const move = new THREE.Vector3();
      if (e.key === 'ArrowLeft') move.copy(right).multiplyScalar(-pan);
      else if (e.key === 'ArrowRight') move.copy(right).multiplyScalar(pan);
      else if (e.key === 'ArrowUp') move.copy(fwd).multiplyScalar(pan);
      else if (e.key === 'ArrowDown') move.copy(fwd).multiplyScalar(-pan);
      else return;

      e.preventDefault();
      camera.position.add(move);
      c.target.add(move);
      c.update();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walk, camera]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (!f || !controls.current) return;
    f.t = Math.min(1, f.t + delta / 1.5);
    const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2; // cubic in-out
    camera.position.lerpVectors(f.from, f.to, e);
    controls.current.target.lerpVectors(f.targetFrom, f.targetTo, e);
    controls.current.update();
    if (f.t >= 1) flight.current = null;
  });

  return (
    <>
      {/*
        NOTE: no `target` prop here on purpose. Passing one re-applies it on every
        React render, which snapped the orbit target back to the campus centre and made
        zoom/pan appear "stuck" in places. The target is now set once in the mount
        effect above and then owned by the controls.
      */}
      <OrbitControls
        ref={(r) => {
          controls.current = r as OrbitControlsImpl | null;
          set({ controls: r as unknown as THREE.EventDispatcher });
        }}
        makeDefault
        enableDamping
        dampingFactor={0.075}
        enablePan
        panSpeed={1.1}
        zoomSpeed={0.95}
        rotateSpeed={0.85}
        screenSpacePanning={false}
        maxPolarAngle={Math.PI / 2 - 0.015}
        minPolarAngle={0.02}
        minDistance={6}
        maxDistance={4200}
      />
      <WalkMode enabled={walk} setWalk={setWalk} terrain={terrain} />
    </>
  );
}

/** Optional first-person walk: WASD + terrain-following eye height, pointer lock on click. */
function WalkMode({
  enabled,
  setWalk,
  terrain,
}: {
  enabled: boolean;
  setWalk: (v: boolean) => void;
  terrain: TerrainGrid;
}) {
  const camera = useThree((s) => s.camera);
  const keys = useRef<Record<string, boolean>>({});
  const pos = useRef(new THREE.Vector3());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === 'Escape') setWalk(false);
    };
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [setWalk]);

  useFrame((_, delta) => {
    if (!enabled) return;
    pos.current.copy(camera.position);
    const speed = (keys.current['ShiftLeft'] ? 9 : 3.4) * delta;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (keys.current['KeyW'] || keys.current['ArrowUp']) move.add(dir);
    if (keys.current['KeyS'] || keys.current['ArrowDown']) move.sub(dir);
    if (keys.current['KeyD'] || keys.current['ArrowRight']) move.add(right);
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
    }
    const { lat, lng } = localToLatLng(camera.position.x, camera.position.z);
    const ground = terrain.heightAtLatLng(lat, lng) - terrain.datum;
    camera.position.y = ground + CAMERA_DEFAULTS.walkEyeHeightM;
  });

  if (!enabled) return null;
  return <PointerLockControls makeDefault />;
}

/* ───────────────────────────────────────────────────── labels and POIs ───── */

const PRIMARY_CATS = new Set([
  'hostel', 'academic', 'dining', 'library', 'medical', 'admin', 'auditorium', 'sports', 'lab', 'gate',
]);

interface LabelItem {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  priority: number; // 0 best
  buildingId?: string | null;
  primary: boolean;
}

/**
 * LabelLayer — every campus building gets a label, not just a handful.
 *
 * Budgeting: labels are ranked (hand-named / manually verified first, then by category,
 * then the derived locator names) and the visible budget scales with camera distance.
 * Candidates are culled against the frustum at 2 Hz, so a 300-label campus stays smooth
 * while the browser never lays out more than ~90 DOM nodes.
 *
 * Style, font and size are identical for automatic and manual labels, so a manually
 * corrected name is indistinguishable from a generated one — which is the point.
 */
function Labels({ data, terrain }: { data: CampusData; terrain: TerrainGrid }) {
  const show = useOutdoor((s) => s.layers.labels && !s.roadsOnly);
  const labelsAllowed = useUi((s) => s.labelsVisible);
  const showAll = useOutdoor((s) => s.layers.labelsAll);
  const selected = useOutdoor((s) => s.selectedBuildingId);
  const select = useOutdoor((s) => s.selectBuilding);
  const focusPoi = useOutdoor((s) => s.focusPoi);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [, force] = useState(0);
  const acc = useRef(0);
  const [budget, setBudget] = useState(40);

  const items = useMemo<LabelItem[]>(() => {
    const list: LabelItem[] = [];
    const overrides = data.overrides;
    for (const b of data.buildings) {
      if (b.scope !== 'campus' || b.hidden) continue;
      const ov = overrides.get(b.id);
      if (ov?.labelHidden) continue;
      if (b.name_conf === 'manual-hidden') continue;
      const seat = b.entrance_lat != null ? null : null;
      void seat;
      const c = b.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
      const [lng, lat] = ov?.labelAt ?? ([c[0] / b.ring.length, c[1] / b.ring.length] as [number, number]);
      const p = latLngToLocal(lat, lng);
      const ground = terrain.heightAtLatLng(lat, lng) - terrain.datum;
      const manual = Boolean(ov?.labelText) || b.manual || b.conf === 'manual';
      const osmnamed = b.named && b.name_conf !== 'derived';
      const priority = manual || osmnamed ? 0 : PRIMARY_CATS.has(b.cat) ? 1 : 2;
      list.push({
        id: `b:${b.id}`,
        text: ov?.labelText ?? b.name,
        x: p.x,
        y: ground + b.height_m + 3.2 + (ov?.labelOffsetM ?? 0),
        z: p.z,
        priority,
        buildingId: b.id,
        primary: priority <= 1,
      });
    }
    for (const l of data.manualLabels) {
      const p = latLngToLocal(l.lat, l.lng);
      const ground = l.elevM != null ? l.elevM - terrain.datum : terrain.heightAtLatLng(l.lat, l.lng) - terrain.datum;
      list.push({
        id: `m:${l.id}`,
        text: l.text,
        x: p.x,
        y: ground + l.offsetM,
        z: p.z,
        priority: 0,
        buildingId: null,
        primary: l.tier === 'primary',
      });
    }
    return list.sort((a, b) => a.priority - b.priority);
  }, [data.buildings, data.manualLabels, data.overrides, terrain]);

  // per-frame visibility pass, throttled to 2 Hz
  const [visible, setVisible] = useState<LabelItem[]>([]);
  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current < 0.5) return;
    acc.current = 0;

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const dist = Math.hypot(camX, camZ);
    const limit = showAll
      ? (dist < 900 ? 300 : dist < 1800 ? 160 : 80)
      : dist < 500
        ? 46
        : dist < 1100
          ? 30
          : dist < 2200
            ? 18
            : 10;

    // Frustum containment alone left dense clusters (the north-campus core) with
    // stacked, unreadable labels, so placement is now a greedy screen-space
    // de-collision pass. Items arrive sorted by priority, and anything hand-named,
    // manually verified, or currently selected always wins a slot.
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const v = new THREE.Vector3();
    const out: LabelItem[] = [];
    const pad = 4;
    for (const it of items) {
      if (out.length >= limit) break;
      v.set(it.x, it.y, it.z);
      const d = v.distanceTo(camera.position);
      if (d > 3200) continue;
      v.project(camera);
      if (v.z < -1 || v.z > 1) continue;
      if (v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;

      // approximate on-screen box of the label pill, in pixels
      const px = (v.x * 0.5 + 0.5) * size.width;
      const py = (-v.y * 0.5 + 0.5) * size.height;
      const w = 18 + it.text.length * 6.6;
      const h = 22;
      const box = { x0: px - pad, y0: py - h / 2 - pad, x1: px + w + pad, y1: py + h / 2 + pad };

      const protectedLabel = it.priority === 0 || (selected != null && it.buildingId === selected);
      if (!protectedLabel) {
        let clash = false;
        for (const q of placed) {
          if (box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
      }
      if (placed.length < 160) placed.push(box);
      out.push(it);
    }
    setBudget(Math.max(60, dist * 0.35));
    setVisible(out);
    force((n) => n + 1);
  });

  if (!show || !labelsAllowed) return null;

  return (
    <group>
      {visible.map((it) => (
        <Html
          key={it.id}
          position={[it.x, it.y, it.z]}
          center={false}
          distanceFactor={budget}
          zIndexRange={[24, 0]}
          style={{ pointerEvents: 'auto' }}
        >
          <div
            className={`poi-label${it.primary ? '' : ' sub'}`}
            role={it.buildingId ? 'button' : undefined}
            tabIndex={it.buildingId ? 0 : undefined}
            onClick={() => {
              if (it.buildingId) select(it.buildingId);
              else focusPoi(it.id.replace(/^m:/, ''));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && it.buildingId) select(it.buildingId);
            }}
            style={{
              cursor: it.buildingId ? 'pointer' : 'default',
              outline: selected && it.buildingId === selected ? '1px solid var(--accent)' : undefined,
            }}
          >
            {it.text}
          </div>
        </Html>
      ))}
      {/* POI markers only for non-building features, so the scene is not double-labelled */}
      <PoiMarkers pois={data.pois.filter((p) => p.kind !== 'building' && !UNLABELLED_POI_KINDS.has(p.kind))} terrain={terrain} />
    </group>
  );
}

/* ───────────────────────────────────────────────────────────── assembly ───── */

function SceneContents({ data, terrain }: { data: CampusData; terrain: TerrainGrid }) {
  const tier = useUi((s) => s.deviceTier);
  const exaggeration = useOutdoor((s) => s.exaggeration);
  const debugAlign = useUi((s) => s.debug.align);
  const ortho = useTexture('data/ortho/campus.jpg');
  const t = TIERS[tier];

  const widthM = useMemo(() => {
    const a = latLngToLocal(BBOX.north, BBOX.west);
    const b = latLngToLocal(BBOX.south, BBOX.east);
    return { w: Math.abs(b.x - a.x), h: Math.abs(b.z - a.z) };
  }, []);

  return (
    <>
      <SunAndSky terrain={terrain} />
      <group scale={[1, exaggeration, 1]}>
        <TerrainMesh terrain={terrain} segW={t.terrainSegW} segH={t.terrainSegH} />
        <Buildings data={data} terrain={terrain} />
        <RoadsAndTrees data={data} terrain={terrain} />
        <RouteLine terrain={terrain} />
        <Labels data={data} terrain={terrain} />
        {debugAlign && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, terrain.maxM - terrain.datum + 1.2, 0]} raycast={() => null}>
            <planeGeometry args={[widthM.w, widthM.h]} />
            <meshBasicMaterial map={ortho} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
      <AccuracyHud data={data} terrain={terrain} />
    </>
  );
}

export function Campus3D({ data, terrain }: { data: CampusData; terrain: TerrainGrid }) {
  const tier = useUi((s) => s.deviceTier);
  const onPointerMissed = useOutdoor((s) => s.selectBuilding);

  return (
    <Canvas
      dpr={TIERS[tier].dpr}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      camera={{ fov: 52, near: 0.6, far: 9000, position: [0, 900, 1400] }}
      onPointerMissed={() => onPointerMissed(null)}
      frameloop="always"
    >
      <color attach="background" args={['#0d1512']} />
      <Suspense fallback={null}>
        <SceneContents data={data} terrain={terrain} />
      </Suspense>
      <CameraRig terrain={terrain} />
    </Canvas>
  );
}

export const SCENE_COLOR_HELPERS = { WALL_COLORS, ROOF_COLORS };
