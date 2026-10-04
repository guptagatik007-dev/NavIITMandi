/**
 * indoorStore.ts — floor-plan upload, manual floor labelling and indoor routing.
 *
 * There is deliberately no automatic geometry invention here. A user supplies a real
 * plan image/SVG/PDF (or a contract JSON file), then manually places labels and
 * connections on top of that plan. Those edits live in localStorage until exported or
 * committed as public/data/indoor/<buildingId>/building.json.
 */
import { create } from 'zustand';
import { featureFlags } from '@/config/featureFlags';

export type IndoorLabelKind = 'room' | 'door' | 'stairs' | 'lift' | 'exit' | 'waypoint';

export interface IndoorRoom {
  id: string;
  name: string;
  kind: 'room' | 'lab' | 'office' | 'washroom' | 'hall' | 'amenity' | 'stair' | 'lift' | 'lobby';
  polygon: [number, number][]; // local metres: x east, y north (per-floor, unrotated)
  label?: string;
}

/** Coordinates are normalised 0..1 over the uploaded plan image. */
export interface IndoorFloorLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  kind: IndoorLabelKind;
  accessible?: boolean;
}

export interface IndoorFloorConnection {
  id: string;
  from: string;
  to: string;
  kind: 'walk' | 'stairs' | 'lift' | 'ramp';
  accessible: boolean;
}

/**
 * One image in a floor's plan gallery. The actual bytes live in IndexedDB
 * (see indoorImagesDb.ts) — only this small metadata record goes to
 * localStorage, so uploading multiple multi-megabyte plans no longer hits
 * the localStorage quota (the failure this design replaces).
 */
export interface IndoorPlanImage {
  id: string;
  /** IndexedDB object key holding the image blob */
  key: string;
  name: string;
  mime: string;
  width?: number;
  height?: number;
}

export interface IndoorFloor {
  id: string;
  label: string; // 'G', '1', '2' … or '-1'
  elevationM: number;
  heightM: number;
  planSvg?: string; // path to a committed traced floor-plan SVG (optional)
  /** Browser-uploaded underlay, kept local until exported/committed (legacy single-image path). */
  planImageDataUrl?: string;
  planMime?: string;
  planSourceName?: string;
  planWidth?: number;
  planHeight?: number;
  scaleMPerPixel?: number;
  /** Multi-image gallery (IndexedDB-backed). Falls back to planImageDataUrl when empty. */
  planImages?: IndoorPlanImage[];
  activePlanImageId?: string;
  rooms: IndoorRoom[];
  labels?: IndoorFloorLabel[];
  connections?: IndoorFloorConnection[];
  /**
   * Walkable "floor roads" — polylines in plan coordinates (0..1) drawn by hand along
   * real corridors. Routing only travels here: labels snap onto the nearest corridor
   * point, so the path can never pass through a wall. Corridors join where their
   * vertices coincide (the drawer auto-snaps to existing vertices).
   */
  corridors?: IndoorCorridor[];
}

/** One hand-drawn walkable path (corridor/hall) on a floor. */
export interface IndoorCorridor {
  id: string;
  points: { x: number; y: number }[];
}

export interface IndoorNode {
  id: string;
  x: number;
  y: number;
  floorId: string;
  kind: 'walk' | 'room' | 'door' | 'stairs' | 'lift' | 'exit';
}
export interface IndoorEdge {
  from: string;
  to: string;
  kind: 'walk' | 'stairs' | 'lift' | 'ramp';
  weight: number;
  accessible: boolean;
}
export interface IndoorBuilding {
  id: string;
  name: string;
  /** local metres -> real world: which outdoor coordinate the plan origin sits at */
  origin: { lat: number; lng: number; rotationDeg: number };
  scaleMPerUnit: number;
  floors: IndoorFloor[];
  graph: { nodes: IndoorNode[]; edges: IndoorEdge[] };
  surveyedBy?: string;
  surveyedOn?: string;
  source?: string;
}

interface IndoorState {
  /** Remote/committed indoor datasets plus browser-local uploaded plans. */
  buildings: IndoorBuilding[];
  localPlans: IndoorBuilding[];
  selectedBuildingId: string | null;
  selectedFloorId: string | null;
  route: { fromRoomId: string | null; toRoomId: string | null; path: IndoorNode[] | null };
  loadState: 'idle' | 'empty' | 'loading' | 'ready' | 'error';
  error?: string;
  /** ids we have attempted to load — drives the per-building status chip */
  attempted: Record<string, 'empty' | 'ready' | 'error'>;
  setSelectedBuilding: (id: string | null) => void;
  setSelectedFloor: (id: string | null) => void;
  loadFor: (buildingId: string) => Promise<void>;
  loadManifest: () => Promise<void>;
  upsertLocalFloor: (building: Pick<IndoorBuilding, 'id' | 'name' | 'origin'>, floor: IndoorFloor) => boolean;
  removeLocalFloor: (buildingId: string, floorId: string) => void;
  addFloorLabel: (buildingId: string, floorId: string, label: IndoorFloorLabel) => void;
  updateFloorLabel: (buildingId: string, floorId: string, id: string, patch: Partial<IndoorFloorLabel>) => void;
  removeFloorLabel: (buildingId: string, floorId: string, id: string) => void;
  addFloorConnection: (buildingId: string, floorId: string, connection: IndoorFloorConnection) => void;
  removeFloorConnection: (buildingId: string, floorId: string, id: string) => void;
  /** hand-drawn walkable corridors ("floor roads") — wall-respecting routing runs here */
  addFloorCorridor: (buildingId: string, floorId: string, corridor: IndoorCorridor) => void;
  removeFloorCorridor: (buildingId: string, floorId: string, corridorId: string) => void;
  /** plan gallery (IndexedDB storage, localStorage keeps metadata only) */
  addPlanImage: (buildingId: string, floorId: string, img: IndoorPlanImage) => void;
  removePlanImage: (buildingId: string, floorId: string, imgId: string) => void;
  setActivePlanImage: (buildingId: string, floorId: string, imgId: string) => void;
  /**
   * Building-name propagation: when the outdoor name changes (editor override or
   * merged teammate session), every local indoor building adopts the new name, so
   * floor labels, exports and the floor workspace always agree with the map.
   */
  syncBuildingNames: (names: Map<string, string>) => void;
  /** merge a teammate's floor bundle into local plans (per-floor label granularity) */
  mergeExternalFloors: (building: Pick<IndoorBuilding, 'id' | 'name' | 'origin'>, floors: IndoorFloor[]) => { adopted: string[]; merged: string[]; conflicts: string[] };
  setRoute: (fromRoomId: string | null, toRoomId: string | null, path: IndoorNode[] | null) => void;
  clearRoute: () => void;
}

const LOCAL_KEY = 'iitm-nav-indoor-v1';

function readLocalPlans(): IndoorBuilding[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { buildings?: IndoorBuilding[] };
    return Array.isArray(parsed.buildings) ? parsed.buildings : [];
  } catch {
    return [];
  }
}

function persistLocalPlans(buildings: IndoorBuilding[]): boolean {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 1, buildings }));
    return true;
  } catch {
    // Large raster uploads can exceed browser quota. The current session remains live,
    // but the UI can tell the user to use a smaller PNG/SVG or commit the export.
    return false;
  }
}

function mergeLocalPlans(remote: IndoorBuilding[], local: IndoorBuilding[]): IndoorBuilding[] {
  const byId = new Map(remote.map((b) => [b.id, b]));
  for (const b of local) byId.set(b.id, { ...byId.get(b.id), ...b });
  return [...byId.values()];
}

function floorWith(floor: IndoorFloor): IndoorFloor {
  return { ...floor, labels: floor.labels ?? [], connections: floor.connections ?? [], rooms: floor.rooms ?? [] };
}

/** Index files commonly store `floors` as a count. Normalise that summary before the UI reads it. */
function normaliseIndexBuilding(raw: Partial<IndoorBuilding> & { floors?: unknown }): IndoorBuilding {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? raw.id ?? 'Indoor building'),
    origin: raw.origin ?? { lat: 0, lng: 0, rotationDeg: 0 },
    scaleMPerUnit: Number(raw.scaleMPerUnit ?? 1),
    floors: Array.isArray(raw.floors) ? raw.floors.map((floor) => floorWith(floor as IndoorFloor)) : [],
    graph: raw.graph ?? { nodes: [], edges: [] },
    surveyedBy: raw.surveyedBy,
    surveyedOn: raw.surveyedOn,
    source: raw.source,
  };
}

function updateLocalFloor(
  state: Pick<IndoorState, 'localPlans' | 'buildings'>,
  buildingId: string,
  floorId: string,
  update: (floor: IndoorFloor) => IndoorFloor,
) {
  let changed = false;
  const localPlans = state.localPlans.map((building) => {
    if (building.id !== buildingId) return building;
    const floors = building.floors.map((raw) => {
      if (raw.id !== floorId) return raw;
      changed = true;
      return floorWith(update(floorWith(raw)));
    });
    return { ...building, floors };
  });
  if (!changed) return null;
  return { localPlans, buildings: mergeLocalPlans(state.buildings, localPlans) };
}

const initialLocalPlans = readLocalPlans();

export const useIndoor = create<IndoorState>((set, get) => ({
  buildings: initialLocalPlans,
  localPlans: initialLocalPlans,
  selectedBuildingId: null,
  selectedFloorId: null,
  route: { fromRoomId: null, toRoomId: null, path: null },
  loadState: initialLocalPlans.length ? 'ready' : 'idle',
  attempted: Object.fromEntries(initialLocalPlans.map((b) => [b.id, 'ready'])) as IndoorState['attempted'],
  setSelectedBuilding: (id) => set((s) => ({
    selectedBuildingId: id,
    selectedFloorId: s.buildings.find((b) => b.id === id)?.floors[0]?.id ?? null,
    route: { fromRoomId: null, toRoomId: null, path: null },
  })),
  setSelectedFloor: (selectedFloorId) => set({ selectedFloorId, route: { fromRoomId: null, toRoomId: null, path: null } }),

  /** Index of committed indoor datasets. Missing file is normal when only local uploads exist. */
  loadManifest: async () => {
    if (!featureFlags.indoor) return;
    set({ loadState: 'loading' });
    try {
      const res = await fetch('data/indoor/index.json', { cache: 'no-store' });
      if (res.status === 404) {
        set((s) => ({ buildings: mergeLocalPlans([], s.localPlans), loadState: s.localPlans.length ? 'ready' : 'empty' }));
        return;
      }
      if (!res.ok) throw new Error(`indoor index → HTTP ${res.status}`);
      const body = (await res.json().catch(() => null)) as { buildings?: (Partial<IndoorBuilding> & { floors?: unknown })[] } | null;
      const remote = (body?.buildings ?? []).map(normaliseIndexBuilding).filter((b) => b.id);
      set((s) => ({ buildings: mergeLocalPlans(remote, s.localPlans), loadState: remote.length || s.localPlans.length ? 'ready' : 'empty' }));
    } catch (e) {
      // The app remains useful offline: preserve uploaded plans and report the remote
      // index as unavailable instead of hiding the local workspace.
      set((s) => ({
        loadState: s.localPlans.length ? 'ready' : 'empty',
        error: e instanceof Error ? e.message : String(e),
        buildings: mergeLocalPlans([], s.localPlans),
      }));
    }
  },

  /** Load a committed plan lazily; a local upload takes precedence. */
  loadFor: async (buildingId: string) => {
    const local = get().localPlans.find((b) => b.id === buildingId);
    if (local) {
      set((s) => ({
        buildings: mergeLocalPlans(s.buildings, s.localPlans),
        selectedBuildingId: buildingId,
        selectedFloorId: local.floors[0]?.id ?? null,
        loadState: 'ready',
        attempted: { ...s.attempted, [buildingId]: 'ready' },
        error: undefined,
      }));
      return;
    }
    set({ selectedBuildingId: buildingId, loadState: 'loading' });
    try {
      const res = await fetch(`data/indoor/${buildingId}/building.json`, { cache: 'no-store' });
      if (res.status === 404) {
        set((s) => ({ loadState: 'empty', attempted: { ...s.attempted, [buildingId]: 'empty' }, error: undefined }));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = (await res.json().catch(() => null)) as IndoorBuilding | null;
      if (!b || !Array.isArray(b.floors)) {
        set((s) => ({ loadState: 'empty', attempted: { ...s.attempted, [buildingId]: 'empty' }, error: undefined }));
        return;
      }
      set((s) => ({
        buildings: mergeLocalPlans([...s.buildings.filter((x) => x.id !== b.id), b], s.localPlans),
        loadState: 'ready',
        selectedFloorId: b.floors[0]?.id ?? null,
        attempted: { ...s.attempted, [buildingId]: 'ready' },
      }));
    } catch (e) {
      set((s) => ({ loadState: 'error', error: e instanceof Error ? e.message : String(e), attempted: { ...s.attempted, [buildingId]: 'error' } }));
    }
  },

  upsertLocalFloor: (building, rawFloor) => {
    const floor = floorWith(rawFloor);
    const current = get().localPlans.find((b) => b.id === building.id);
    const nextBuilding: IndoorBuilding = {
      id: building.id,
      name: building.name,
      origin: building.origin,
      scaleMPerUnit: current?.scaleMPerUnit ?? 1,
      floors: [...(current?.floors ?? []).filter((f) => f.id !== floor.id), floor],
      graph: current?.graph ?? { nodes: [], edges: [] },
      surveyedBy: current?.surveyedBy,
      surveyedOn: current?.surveyedOn,
      source: current?.source ?? 'Browser-uploaded plan; verify against the original drawing before committing',
    };
    const localPlans = [...get().localPlans.filter((b) => b.id !== building.id), nextBuilding];
    const stored = persistLocalPlans(localPlans);
    set((s) => ({
      localPlans,
      buildings: mergeLocalPlans(s.buildings, localPlans),
      selectedBuildingId: building.id,
      selectedFloorId: floor.id,
      loadState: 'ready',
      attempted: { ...s.attempted, [building.id]: 'ready' },
    }));
    return stored;
  },

  removeLocalFloor: (buildingId, floorId) => {
    const localPlans = get().localPlans
      .map((b) => b.id === buildingId ? { ...b, floors: b.floors.filter((f) => f.id !== floorId) } : b)
      .filter((b) => b.floors.length > 0);
    persistLocalPlans(localPlans);
    set((s) => ({
      localPlans,
      buildings: mergeLocalPlans(s.buildings.filter((b) => b.id !== buildingId || localPlans.some((x) => x.id === buildingId)), localPlans),
      selectedFloorId: s.selectedFloorId === floorId ? localPlans.find((b) => b.id === buildingId)?.floors[0]?.id ?? null : s.selectedFloorId,
    }));
  },

  addFloorLabel: (buildingId, floorId, label) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({ ...floor, labels: [...(floor.labels ?? []), label] }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },
  updateFloorLabel: (buildingId, floorId, id, patch) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({
      ...floor,
      labels: (floor.labels ?? []).map((label) => label.id === id ? { ...label, ...patch } : label),
    }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },
  removeFloorLabel: (buildingId, floorId, id) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({
      ...floor,
      labels: (floor.labels ?? []).filter((label) => label.id !== id),
      connections: (floor.connections ?? []).filter((edge) => edge.from !== id && edge.to !== id),
    }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },
  addFloorConnection: (buildingId, floorId, connection) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => {
      const existing = floor.connections ?? [];
      if (existing.some((edge) => (edge.from === connection.from && edge.to === connection.to) || (edge.from === connection.to && edge.to === connection.from))) return floor;
      return { ...floor, connections: [...existing, connection] };
    });
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },
  removeFloorConnection: (buildingId, floorId, id) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({ ...floor, connections: (floor.connections ?? []).filter((edge) => edge.id !== id) }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },

  addFloorCorridor: (buildingId, floorId, corridor) => {
    if (corridor.points.length < 2) return;
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor: IndoorFloor) => ({ ...floor, corridors: [...(floor.corridors ?? []), corridor] }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },

  removeFloorCorridor: (buildingId, floorId, corridorId) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({ ...floor, corridors: (floor.corridors ?? []).filter((c) => c.id !== corridorId) }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },

  addPlanImage: (buildingId, floorId, img) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({
      ...floor,
      planImages: [...(floor.planImages ?? []), img],
      activePlanImageId: img.id,
    }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },

  removePlanImage: (buildingId, floorId, imgId) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => {
      const next = (floor.planImages ?? []).filter((img) => img.id !== imgId);
      return {
        ...floor,
        planImages: next,
        activePlanImageId: floor.activePlanImageId === imgId ? next[0]?.id : floor.activePlanImageId,
      };
    });
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },

  setActivePlanImage: (buildingId, floorId, imgId) => {
    const updated = updateLocalFloor(get(), buildingId, floorId, (floor) => ({ ...floor, activePlanImageId: imgId }));
    if (!updated) return;
    persistLocalPlans(updated.localPlans);
    set(updated);
  },

  syncBuildingNames: (names) => {
    let changed = false;
    const localPlans = get().localPlans.map((b) => {
      const n = names.get(b.id);
      if (!n || n === b.name) return b;
      changed = true;
      return { ...b, name: n };
    });
    if (!changed) return;
    persistLocalPlans(localPlans);
    set({ localPlans, buildings: mergeLocalPlans(get().buildings, localPlans) });
  },

  mergeExternalFloors: (building, floors) => {
    const adopted: string[] = [];
    const merged: string[] = [];
    const conflicts: string[] = [];
    const state = get();
    const existing = state.localPlans.find((b) => b.id === building.id);
    let plans = state.localPlans;
    if (!existing) {
      const nb: IndoorBuilding = {
        id: building.id,
        name: building.name,
        origin: building.origin,
        scaleMPerUnit: 1,
        floors: floors.map((f) => floorWith(f)),
        graph: { nodes: [], edges: [] },
        surveyedBy: 'teammate session import',
        source: 'Merged floor bundle',
      };
      plans = [...plans, nb];
      floors.forEach((f) => adopted.push(f.label));
    } else {
      plans = plans.map((b) => {
        if (b.id !== building.id) return b;
        const nextFloors = [...b.floors];
        for (const incoming of floors) {
          const idx = nextFloors.findIndex((f) => f.label.trim().toLowerCase() === incoming.label.trim().toLowerCase());
          if (idx < 0) {
            nextFloors.push(floorWith(incoming));
            adopted.push(incoming.label);
            continue;
          }
          const cur = floorWith(nextFloors[idx]);
          const inc = floorWith(incoming);
          // fill gaps only: incoming contributes what the integrator does not have
          const newLabels = (inc.labels ?? []).filter((l) => !(cur.labels ?? []).some((m) => m.id === l.id || (m.text === l.text && Math.abs(m.x - l.x) < 0.01 && Math.abs(m.y - l.y) < 0.01)));
          const newConns = (inc.connections ?? []).filter((c) => !(cur.connections ?? []).some((m) => m.id === c.id || (m.from === c.from && m.to === c.to)));
          const newRooms = (inc.rooms ?? []).filter((r) => !(cur.rooms ?? []).some((m) => m.id === r.id));
          const newImages = (inc.planImages ?? []).filter((img) => !(cur.planImages ?? []).some((m) => m.id === img.id));
          const newCorridors = (inc.corridors ?? []).filter((c) => !(cur.corridors ?? []).some((m) => m.id === c.id));
          nextFloors[idx] = {
            ...cur,
            labels: [...(cur.labels ?? []), ...newLabels],
            connections: [...(cur.connections ?? []), ...newConns],
            rooms: [...(cur.rooms ?? []), ...newRooms],
            planImages: [...(cur.planImages ?? []), ...newImages],
            corridors: [...(cur.corridors ?? []), ...newCorridors],
            planImageDataUrl: cur.planImageDataUrl ?? inc.planImageDataUrl,
            planWidth: cur.planWidth ?? inc.planWidth,
            planHeight: cur.planHeight ?? inc.planHeight,
            scaleMPerPixel: cur.scaleMPerPixel ?? inc.scaleMPerPixel,
            activePlanImageId: cur.activePlanImageId ?? inc.activePlanImageId,
          };
          if (newLabels.length || newConns.length || newRooms.length || newImages.length || newCorridors.length) merged.push(incoming.label);
          else conflicts.push(`floor ${incoming.label}: nothing new to merge (kept yours)`);
        }
        // keep the outdoor/current name taking precedence over a stale bundle name
        return { ...b, name: building.name, floors: nextFloors };
      });
    }
    persistLocalPlans(plans);
    set({ localPlans: plans, buildings: mergeLocalPlans(state.buildings, plans) });
    return { adopted, merged, conflicts };
  },

  setRoute: (fromRoomId, toRoomId, path) => set({ route: { fromRoomId, toRoomId, path } }),
  clearRoute: () => set({ route: { fromRoomId: null, toRoomId: null, path: null } }),
}));

/** Convenience selector used by the UI to describe the current indoor state honestly. */
export function indoorStatusLine(state: Pick<IndoorState, 'loadState' | 'error' | 'buildings'>): string {
  switch (state.loadState) {
    case 'loading': return 'Looking for floor data…';
    case 'ready': return `${state.buildings.filter((b) => Array.isArray(b.floors) && b.floors.length > 0).length} building(s) with floor data loaded.`;
    case 'error': return `Could not read floor data: ${state.error ?? 'unknown error'}`;
    case 'empty': return 'No floor plans have been uploaded or surveyed yet.';
    default: return 'Indoor mapping workspace ready.';
  }
}

export const selectIndoorBuilding = (s: IndoorState, id: string | null) => s.buildings.find((b) => b.id === id) ?? null;
export const selectFloor = (s: IndoorState) => {
  const b = selectIndoorBuilding(s, s.selectedBuildingId);
  return b?.floors.find((f) => f.id === s.selectedFloorId) ?? null;
};
export const getAttempted = (s: IndoorState, id: string) => s.attempted[id];
export const indoorIsActive = (s: IndoorState, id: string) => s.loadState === 'ready' && s.buildings.some((b) => b.id === id && b.floors.length > 0);

/** Convert the manually placed floor labels/connections into a real graph route. */
/* ────────── corridor ("floor roads") routing — the path can never cross a wall ── */

const SNAP_JOIN_EPS = 0.006; // corridors merge where vertices sit this close (plan units)

/** Project p onto segment a→b; returns the closest point and its [0,1] position. */
function nearestOnSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { x, y, t, d: Math.hypot(p.x - x, p.y - y) };
}

type CorridorGraph = { nodes: Map<string, { x: number; y: number }>; adj: Map<string, { id: string; w: number }[]> };

/** Build one graph from all corridors: coincident vertices become junctions. */
function buildCorridorGraph(corridors: IndoorCorridor[]): CorridorGraph {
  const nodes = new Map<string, { x: number; y: number }>();
  const adj = new Map<string, { id: string; w: number }[]>();
  const ids: (string | null)[][] = corridors.map(() => []);
  // vertex ids: identical near-coincident points across corridors collapse into a junction
  coincident(corridors);
  function coincident(cs: IndoorCorridor[]): void {
    for (let ci = 0; ci < cs.length; ci++) {
      const pts = cs[ci].points;
      for (let pi = 0; pi < pts.length; pi++) {
        let found: string | null = null;
        const key = `c${ci}p${pi}`;
        void key;
        for (const [id, n] of nodes) {
          if (Math.hypot(n.x - pts[pi].x, n.y - pts[pi].y) <= SNAP_JOIN_EPS) {
            found = id;
            break;
          }
        }
        if (!found) {
          found = `v${nodes.size}`;
          nodes.set(found, { x: pts[pi].x, y: pts[pi].y });
        }
        ids[ci][pi] = found;
      }
    }
  }
  const link = (a: string | null, b: string | null) => {
    if (!a || !b || a === b) return;
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const w = Math.hypot(na.x - nb.x, na.y - nb.y);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ id: b, w });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ id: a, w });
  };
  for (const per of ids) for (let i = 0; i + 1 < per.length; i++) link(per[i], per[i + 1]);
  return { nodes, adj };
}

/** Snapped attachment of a label onto the network: split the nearest segment. */
function attach(graph: CorridorGraph, p: { x: number; y: number }, mindId = 'snap'): { id: string; d: number } | null {
  let best: { a: string; b: string } | null = null;
  let hit = { x: 0, y: 0, d: Infinity };
  const seen = new Set<string>();
  for (const [a, es] of graph.adj) {
    for (const e of es) {
      const key = a < e.id ? `${a}|${e.id}` : `${e.id}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const na = graph.nodes.get(a)!;
      const nb = graph.nodes.get(e.id)!;
      const r = nearestOnSegment(p, na, nb);
      if (r.d < hit.d) {
        hit = { x: r.x, y: r.y, d: r.d };
        best = { a, b: e.id };
      }
    }
  }
  if (!best) return null;
  // if essentially at a vertex, use that vertex instead of a synthetic node
  for (const end of [best.a, best.b]) {
    const n = graph.nodes.get(end)!;
    if (Math.hypot(n.x - hit.x, n.y - hit.y) <= SNAP_JOIN_EPS) return { id: end, d: hit.d };
  }
  const id = `${mindId}-${graph.nodes.size}`;
  graph.nodes.set(id, { x: hit.x, y: hit.y });
  const wA = Math.hypot(hit.x - graph.nodes.get(best.a)!.x, hit.y - graph.nodes.get(best.a)!.y);
  const wB = Math.hypot(hit.x - graph.nodes.get(best.b)!.x, hit.y - graph.nodes.get(best.b)!.y);
  graph.adj.set(id, [
    { id: best.a, w: wA },
    { id: best.b, w: wB },
  ]);
  graph.adj.get(best.a)!.push({ id, w: wA });
  graph.adj.get(best.b)!.push({ id, w: wB });
  // remove the original edge we split (both directions)
  for (const [x, y] of [[best.a, best.b], [best.b, best.a]] as const) {
    graph.adj.set(x, graph.adj.get(x)!.filter((e) => e.id !== y));
  }
  return { id, d: hit.d };
}

function dijkstra(adj: Map<string, { id: string; w: number }[]>, fromId: string, toId: string): string[] | null {
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([fromId]);
  while (open.size) {
    let cur: string | null = null;
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        cur = id;
      }
    }
    if (!cur) break;
    open.delete(cur);
    if (cur === toId) break;
    for (const nx of adj.get(cur) ?? []) {
      if (dist.get(nx.id) != null && dist.get(nx.id)! <= best + nx.w) continue;
      dist.set(nx.id, best + nx.w);
      prev.set(nx.id, cur);
      open.add(nx.id);
    }
  }
  if (!dist.has(toId)) return null;
  const out = [toId];
  while (out[0] !== fromId) {
    const p = prev.get(out[0]);
    if (!p) return null;
    out.unshift(p);
  }
  return out;
}

/** Corridor-first routing: labels attach to the nearest hand-drawn walkable path. */
export function routeOnCorridors(floor: IndoorFloor, fromId: string, toId: string): IndoorNode[] | null {
  const corridors = (floor.corridors ?? []).filter((c) => c.points.length >= 2);
  if (!corridors.length) return null;
  const labels = floor.labels ?? [];
  const from = labels.find((l) => l.id === fromId);
  const to = labels.find((l) => l.id === toId);
  if (!from || !to) return null;
  const g = buildCorridorGraph(corridors);
  const s = attach(g, from, from.id);
  const t = attach(g, to, to.id);
  if (!s || !t) return null;
  const ids = dijkstra(g.adj, s.id, t.id);
  if (!ids) return null;
  const nodes: IndoorNode[] = [{ id: from.id, x: from.x, y: from.y, floorId: floor.id, kind: from.kind === 'waypoint' ? 'walk' : from.kind }];
  for (const id of ids) {
    const n = g.nodes.get(id)!;
    nodes.push({ id, x: n.x, y: n.y, floorId: floor.id, kind: 'walk' });
  }
  nodes.push({ id: to.id, x: to.x, y: to.y, floorId: floor.id, kind: to.kind === 'waypoint' ? 'walk' : to.kind });
  return nodes;
}

export function routeOnFloor(floor: IndoorFloor, fromId: string, toId: string): IndoorNode[] | null {
  // corridor network wins — only it can guarantee the path stays inside walkways
  if ((floor.corridors ?? []).some((c) => c.points.length >= 2)) {
    return routeOnCorridors(floor, fromId, toId);
  }
  const labels = floor.labels ?? [];
  const byId = new Map(labels.map((l) => [l.id, l]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const edges = floor.connections ?? [];
  const adjacency = new Map<string, { id: string; weight: number }[]>();
  for (const edge of edges) {
    const a = byId.get(edge.from); const b = byId.get(edge.to);
    if (!a || !b) continue;
    const weight = Math.hypot(a.x - b.x, a.y - b.y) * (edge.kind === 'stairs' ? 1.8 : edge.kind === 'lift' ? 2.2 : 1);
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { id: edge.to, weight }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { id: edge.from, weight }]);
  }
  const dist = new Map<string, number>([[fromId, 0]]);
  const previous = new Map<string, string>();
  const open = new Set([fromId]);
  while (open.size) {
    let current: string | null = null;
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) { best = d; current = id; }
    }
    if (!current) break;
    open.delete(current);
    if (current === toId) break;
    for (const next of adjacency.get(current) ?? []) {
      const alt = best + next.weight;
      if (alt < (dist.get(next.id) ?? Infinity)) {
        dist.set(next.id, alt);
        previous.set(next.id, current);
        open.add(next.id);
      }
    }
  }
  if (!dist.has(toId)) return null;
  const ids = [toId];
  while (ids[0] !== fromId) {
    const prior = previous.get(ids[0]);
    if (!prior) return null;
    ids.unshift(prior);
  }
  return ids.map((id) => {
    const l = byId.get(id)!;
    return { id: l.id, x: l.x, y: l.y, floorId: floor.id, kind: l.kind === 'waypoint' ? 'walk' : l.kind } as IndoorNode;
  });
}
