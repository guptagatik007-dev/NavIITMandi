/**
 * editStore.ts — the manual correction session (v2).
 *
 * Edits are held in memory (and mirrored to localStorage so a refresh does not lose
 * work) and exported as the exact files under public/data/manual/. Nothing is written
 * to the server: a campus map should not have a silent write path to production data.
 *
 * v2 adds, per the v1.8 spec:
 *   - a full undo/redo history (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y, capped at 60 steps)
 *   - the manual route layer: draw new roads/paths, fix generated road geometry
 *   - footprint reshaping for ANY building (generated ≡ manual)
 *
 * Export → paste into the repo → commit. That keeps a review step, which is what
 * "verified" is supposed to mean.
 */
import { create } from 'zustand';
import type { BuildingOverride, ManualBuildingPropsT, ManualLabel } from '@/data/overrides';
import type { ManualRoad, RoadFixes } from '@/data/roadEdits';
import { haversineM, ringAreaM2, ringSelfIntersects } from '@/geo/polyOps';

export interface PendingBuilding {
  properties: ManualBuildingPropsT;
  ring: [number, number][];
}

/** Everything one undo step must restore. */
interface Snapshot {
  saved: Record<string, BuildingOverride>;
  addedBuildings: PendingBuilding[];
  addedLabels: ManualLabel[];
  roadEdits: RoadFixes;
  addedRoads: ManualRoad[];
  /** v3.1 "Road Workbench": generated roads the user deleted (never silently — listed in the panel) */
  hiddenRoads: string[];
  /** v3.2: global imagery-datum correction in metres (east, north) applied ONLY to
   * generated content — manual draws/overrides were already placed on the imagery */
  datum: { dxM: number; dyM: number };
}

interface EditState extends Snapshot {
  enabled: boolean;
  targetId: string | null;
  draft: BuildingOverride;
  tracing: boolean;
  traceRing: [number, number][];

  /** route-drawing mode (§4.2): click start → waypoints → double-click/Enter end */
  tracingRoad: boolean;
  roadTrace: [number, number][];

  /** fix-an-existing-road mode (§4.1): vertex handles over the road line */
  roadFixId: string | null;
  roadFixLine: [number, number][];
  /** one-shot "pick a road on the map" latch armed from the Edit panel */
  roadPickArmed: boolean;

  /** footprint reshape mode: vertex handles over the target building's ring */
  reshaping: boolean;
  shapeRing: [number, number][]; // open (no closing duplicate)

  past: Snapshot[];
  future: Snapshot[];

  setEnabled: (v: boolean) => void;
  setTarget: (id: string | null) => void;
  patchDraft: (p: Partial<BuildingOverride>) => void;
  saveDraft: () => void;
  revertTarget: () => void;
  resetAll: () => void;

  startTrace: () => void;
  addTraceVertex: (lngLat: [number, number]) => void;
  undoVertices: () => void;
  closeTrace: (props: ManualBuildingPropsT) => void;
  cancelTrace: () => void;
  removeAddedBuilding: (id: string) => void;

  addLabel: (label: ManualLabel) => void;
  updateLabel: (id: string, patch: Partial<ManualLabel>) => void;
  removeLabel: (id: string) => void;

  startRoadTrace: () => void;
  addRoadVertex: (lngLat: [number, number]) => void;
  undoRoadVertex: () => void;
  cancelRoadTrace: () => void;
  /** ≥2 points → a manual road; returns the id or null when invalid */
  closeRoadTrace: (props: { name: string | null; cls: ManualRoad['cls']; width_m: number; surface: string }) => string | null;
  removeManualRoad: (id: string) => void;
  updateManualRoad: (id: string, patch: Partial<Pick<ManualRoad, 'name' | 'cls' | 'width_m' | 'surface'>>) => void;

  armRoadPick: (on: boolean) => void;
  startRoadFix: (roadId: string, line: [number, number][]) => void;
  moveRoadFixVertex: (i: number, lngLat: [number, number]) => void;
  insertRoadFixVertex: (i: number, lngLat: [number, number]) => void;
  deleteRoadFixVertex: (i: number) => void;
  cancelRoadFix: () => void;
  /** ≥2 points → stored in roadEdits (replaces generated geometry on merge) */
  saveRoadFix: () => boolean;
  /** v3.1: move the entire road being fixed by a keyboard nudge (metres) */
  shiftRoadFix: (dxM: number, dyM: number) => void;
  /** v3.1: delete a generated road (stays listed so restore is one click) */
  hideRoad: (id: string) => void;
  restoreRoad: (id: string) => void;
  /** v3.1: latch — next map click near a road sets THIS building's entrance (door) node */
  entranceArmed: boolean;
  armEntrancePick: (v: boolean) => void;
  /** v3.6: latch — next map click freely sets THIS building's map node (label/pin/search point) */
  labelArmed: boolean;
  armLabelPick: (v: boolean) => void;
  /** Write the building's map node into its override as labelAt [lng,lat]; null clears. */
  setLabelAt: (pt: [number, number] | null) => void;
  /**
   * Set the target building's DOOR point (written into the normal building override
   * as entrance_lat/lng, so it exports, merges and routes through the standard
   * pipeline). null clears the door back to the derived centroid. Caller should pass
   * a point already projected ONTO a road — that road then genuinely terminates here.
   */
  setEntrance: (pt: [number, number] | null) => void;
  /** v3.2: slide the whole generated campus by metres to match the HD imagery */
  shiftDatum: (dxM: number, dyM: number) => void;
  resetDatum: () => void;
  removeRoadFix: (roadId: string) => void;

  startReshape: (id: string, openRing: [number, number][]) => void;
  /** §5.2 align-to-imagery: original ring + accumulated transform; nudges are one-step moves from THIS origin */
  alignOrigin: [number, number][] | null;
  startAlign: (id: string, openRing: [number, number][]) => void;
  /** nudge in metres (keyboard arrows) or rotate in degrees (Q/E); re-derives ring from alignOrigin each call */
  alignNudge: (dxM: number, dyM: number, rotDeg: number) => void;
  moveShapeVertex: (i: number, lngLat: [number, number]) => void;
  insertShapeVertex: (i: number, lngLat: [number, number]) => void;
  deleteShapeVertex: (i: number) => void;
  cancelReshape: () => void;
  /** validates (≥3 pts, area ≥ 4 m², no self-intersection) and saves into the draft */
  saveReshape: () => { ok: boolean; reason?: string };

  undo: () => void;
  redo: () => void;

  /** TEAMWORK: merge a teammate's session snapshot in as ONE undoable step. */
  importMerged: (snap: Snapshot) => void;
}

const LS_KEY = 'iitm-nav-edits-v1';
const HISTORY_CAP = 60;

function loadPersisted(): Snapshot {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<Snapshot>;
      return {
        saved: p.saved ?? {},
        addedBuildings: Array.isArray(p.addedBuildings) ? p.addedBuildings : [],
        addedLabels: Array.isArray(p.addedLabels) ? p.addedLabels : [],
        roadEdits: p.roadEdits ?? {},
        addedRoads: Array.isArray(p.addedRoads) ? p.addedRoads : [],
        hiddenRoads: Array.isArray(p.hiddenRoads) ? p.hiddenRoads : [],
        datum: p.datum ?? { dxM: 0, dyM: 0 },
      };
    }
  } catch {
    /* corrupt local draft: start clean rather than crash */
  }
  return { saved: {}, addedBuildings: [], addedLabels: [], roadEdits: {}, addedRoads: [], hiddenRoads: [], datum: { dxM: 0, dyM: 0 } };
}

const persist = (s: Snapshot) => {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        saved: s.saved,
        addedBuildings: s.addedBuildings,
        addedLabels: s.addedLabels,
        roadEdits: s.roadEdits,
        addedRoads: s.addedRoads,
        hiddenRoads: s.hiddenRoads,
        datum: s.datum,
      }),
    );
  } catch {
    /* storage full or disabled: edits still work for this session */
  }
};

const initial = loadPersisted();
let roadSeq = 0;

export const useEdit = create<EditState>((set, get) => {
  /** Capture the current snapshot, apply a change, push history, persist. */
  const commit = (next: Partial<Snapshot>) => {
    const s = get();
    const snap: Snapshot = {
      saved: s.saved,
      addedBuildings: s.addedBuildings,
      addedLabels: s.addedLabels,
      roadEdits: s.roadEdits,
      addedRoads: s.addedRoads,
      hiddenRoads: s.hiddenRoads,
      datum: s.datum,
    };
    const merged: Snapshot = { ...snap, ...next };
    set({
      ...merged,
      past: [...s.past.slice(-(HISTORY_CAP - 1)), snap],
      future: [],
    });
    persist(merged);
  };

  return {
    enabled: typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('edit') === '1',
    targetId: null,
    draft: {},
    ...initial,
    tracing: false,
    traceRing: [],
    tracingRoad: false,
    roadTrace: [],
    roadFixId: null,
    roadFixLine: [],
    roadPickArmed: false,
    entranceArmed: false,
    labelArmed: false,
    reshaping: false,
    shapeRing: [],
    past: [],
    future: [],

    setEnabled: (enabled) => set({ enabled }),
    setTarget: (id) => set({ targetId: id, draft: {}, reshaping: false, shapeRing: [] }),
    patchDraft: (p) => set((s) => ({ draft: { ...s.draft, ...p } })),

    saveDraft: () => {
      const { targetId, draft, saved } = get();
      if (!targetId || Object.keys(draft).length === 0) return;
      commit({ saved: { ...saved, [targetId]: { ...(saved[targetId] ?? {}), ...draft } } });
      set({ draft: {} });
    },

    revertTarget: () => {
      const { targetId, saved } = get();
      if (!targetId) return;
      const next = { ...saved };
      delete next[targetId];
      commit({ saved: next });
      set({ draft: {} });
    },

    resetAll: () => {
      commit({ saved: {}, addedBuildings: [], addedLabels: [], roadEdits: {}, addedRoads: [], hiddenRoads: [], datum: { dxM: 0, dyM: 0 } });
      set({ draft: {}, targetId: null, reshaping: false, shapeRing: [] });
    },

    // ── building footprint tracing ────────────────────────────────────────────
    startTrace: () => {
      const st = get();
      if ((st.tracing && st.traceRing.length >= 1) || (st.tracingRoad && st.roadTrace.length >= 1)) {
        if (!window.confirm(`Discard the ${st.tracing ? st.traceRing.length : st.roadTrace.length} point(s) of the in-progress shape and start over?`)) return;
      }
      set({ tracing: true, traceRing: [], tracingRoad: false, roadTrace: [] });
    },
    addTraceVertex: (lngLat) => set((s) => ({ traceRing: [...s.traceRing, lngLat] })),
    undoVertices: () => set((s) => ({ traceRing: s.traceRing.slice(0, -1) })),
    cancelTrace: () => set({ tracing: false, traceRing: [] }),

    closeTrace: (props) => {
      const { traceRing, addedBuildings } = get();
      if (traceRing.length < 3) return;
      const ring = [...traceRing, traceRing[0]];
      commit({ addedBuildings: [...addedBuildings, { properties: props, ring }] });
      set({ tracing: false, traceRing: [] });
    },

    removeAddedBuilding: (id) => {
      commit({ addedBuildings: get().addedBuildings.filter((b) => b.properties.id !== id) });
    },

    // ── free labels ──────────────────────────────────────────────────────────
    addLabel: (label) => commit({ addedLabels: [...get().addedLabels, label] }),
    updateLabel: (id, patch) =>
      commit({ addedLabels: get().addedLabels.map((l) => (l.id === id ? { ...l, ...patch } : l)) }),
    removeLabel: (id) => commit({ addedLabels: get().addedLabels.filter((l) => l.id !== id) }),

    // ── route drawing (§4.2) ─────────────────────────────────────────────────
    startRoadTrace: () => {
      const st = get();
      if ((st.tracing && st.traceRing.length >= 1) || (st.tracingRoad && st.roadTrace.length >= 1)) {
        if (!window.confirm(`Discard the ${st.tracing ? st.traceRing.length : st.roadTrace.length} point(s) of the in-progress shape and start over?`)) return;
      }
      set({ tracingRoad: true, roadTrace: [], tracing: false, traceRing: [] });
    },
    addRoadVertex: (lngLat) => set((s) => ({ roadTrace: [...s.roadTrace, lngLat] })),
    undoRoadVertex: () => set((s) => ({ roadTrace: s.roadTrace.slice(0, -1) })),
    cancelRoadTrace: () => set({ tracingRoad: false, roadTrace: [] }),

    closeRoadTrace: (props) => {
      const { roadTrace, addedRoads } = get();
      // double-click finishers fire after two `click` events at the same spot:
      // collapse near-duplicate consecutive points so no zero-length segment
      // can reach the graph builder
      const deduped = roadTrace.filter((p, i) => i === 0 || haversineM(p, roadTrace[i - 1]) > 0.5);
      if (deduped.length < 2) return null;
      const id = `mroad-${Date.now().toString(36)}-${(roadSeq++).toString(36)}`;
      const road: ManualRoad = {
        id,
        name: props.name?.trim() ? props.name.trim() : null,
        cls: props.cls,
        width_m: props.width_m,
        surface: props.surface,
        line: deduped,
      };
      commit({ addedRoads: [...addedRoads, road] });
      set({ tracingRoad: false, roadTrace: [] });
      return id;
    },

    removeManualRoad: (id) => commit({ addedRoads: get().addedRoads.filter((r) => r.id !== id) }),
    updateManualRoad: (id, patch) =>
      commit({ addedRoads: get().addedRoads.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),

    // ── fix an existing road (§4.1) ──────────────────────────────────────────
    armRoadPick: (on) => set({ roadPickArmed: on }),
    startRoadFix: (roadId, line) => set({ roadFixId: roadId, roadFixLine: line.map((p) => [...p] as [number, number]), roadPickArmed: false }),
    moveRoadFixVertex: (i, lngLat) =>
      set((s) => ({ roadFixLine: s.roadFixLine.map((p, k) => (k === i ? lngLat : p)) })),
    insertRoadFixVertex: (i, lngLat) =>
      set((s) => ({ roadFixLine: [...s.roadFixLine.slice(0, i), lngLat, ...s.roadFixLine.slice(i)] })),
    deleteRoadFixVertex: (i) =>
      set((s) => (s.roadFixLine.length <= 2 ? {} : { roadFixLine: s.roadFixLine.filter((_, k) => k !== i) })),
    cancelRoadFix: () => set({ roadFixId: null, roadFixLine: [] }),

    saveRoadFix: () => {
      const { roadFixId, roadFixLine, roadEdits } = get();
      if (!roadFixId || roadFixLine.length < 2) return false;
      commit({ roadEdits: { ...roadEdits, [roadFixId]: roadFixLine } });
      set({ roadFixId: null, roadFixLine: [] });
      return true;
    },

    removeRoadFix: (roadId) => {
      const next = { ...get().roadEdits };
      delete next[roadId];
      commit({ roadEdits: next });
      if (get().roadFixId === roadId) set({ roadFixId: null, roadFixLine: [] });
    },

    // ── v3.1 road workbench ───────────────────────────────────────────────────
    shiftRoadFix: (dxM, dyM) =>
      set((s) => {
        if (!s.roadFixId || s.roadFixLine.length === 0) return {};
        const lat0 = s.roadFixLine.reduce((a, p) => a + p[1], 0) / s.roadFixLine.length;
        const dLng = dxM / (111320 * Math.cos((lat0 * Math.PI) / 180));
        const dLat = dyM / 110540;
        return { roadFixLine: s.roadFixLine.map(([lng, lat]) => [lng + dLng, lat + dLat] as [number, number]) };
      }),
    hideRoad: (id) => {
      const s = get();
      if (s.hiddenRoads.includes(id)) return;
      commit({ hiddenRoads: [...s.hiddenRoads, id] });
      // if this road had a saved shape fix, the fix is now pointless — drop it too
      if (s.roadEdits[id]) {
        const next = { ...s.roadEdits };
        delete next[id];
        commit({ roadEdits: next });
      }
    },
    restoreRoad: (id) => commit({ hiddenRoads: get().hiddenRoads.filter((r) => r !== id) }),
    armEntrancePick: (v) => set({ entranceArmed: v }),
    armLabelPick: (v) => set({ labelArmed: v }),
    setLabelAt: (pt) => {
      const { targetId, saved } = get();
      if (!targetId) return;
      const ov = { ...(saved[targetId] ?? {}) };
      if (pt) ov.labelAt = pt;
      else delete ov.labelAt;
      commit({ saved: { ...saved, [targetId]: ov } });
      set({ labelArmed: false });
    },
    setEntrance: (pt) => {
      const { targetId, saved } = get();
      if (!targetId) return;
      // door goes through the standard building-override pipeline (export/undo/merge included)
      const ov = { ...(saved[targetId] ?? {}) };
      if (pt) {
        ov.entrance_lat = pt[1];
        ov.entrance_lng = pt[0];
      } else {
        delete ov.entrance_lat;
        delete ov.entrance_lng;
      }
      commit({ saved: { ...saved, [targetId]: ov } });
      set({ entranceArmed: false });
    },

    shiftDatum: (dxM, dyM) => {
      const cur = get().datum;
      commit({ datum: { dxM: Math.round((cur.dxM + dxM) * 10) / 10, dyM: Math.round((cur.dyM + dyM) * 10) / 10 } });
    },
    resetDatum: () => commit({ datum: { dxM: 0, dyM: 0 } }),

    // ── footprint reshape (any building) ─────────────────────────────────────
    startReshape: (id, openRing) => set({ targetId: id, reshaping: true, shapeRing: openRing.map((p) => [...p] as [number, number]), alignOrigin: null }),

    alignOrigin: null,
    startAlign: (id, openRing) =>
      set({
        targetId: id,
        reshaping: true,
        shapeRing: openRing.map((p) => [...p] as [number, number]),
        alignOrigin: openRing.map((p) => [...p] as [number, number]),
      }),
    alignNudge: (dxM, dyM, rotDeg) => {
      const s = get();
      if (!s.alignOrigin || !s.reshaping || s.shapeRing.length < 3) return;
      // transform the CURRENT ring by this incremental step (keys accumulate naturally)
      const cur = s.shapeRing;
      const lat0 = cur.reduce((a, p) => a + p[1], 0) / cur.length;
      const cx = cur.reduce((a, p) => a + p[0], 0) / cur.length;
      const dxDeg = dxM / (111320 * Math.cos((lat0 * Math.PI) / 180));
      const dyDeg = dyM / 110540;
      const th = (rotDeg * Math.PI) / 180;
      const cosT = Math.cos(th);
      const sinT = Math.sin(th);
      const kx = Math.cos((lat0 * Math.PI) / 180); // squash lng for rotation then un-squash
      const ring = cur.map(([lng, lat]) => {
        const x = (lng - cx) * kx;
        const y = lat - lat0;
        const rx = x * cosT - y * sinT;
        const ry = x * sinT + y * cosT;
        return [cx + rx / kx + dxDeg, lat0 + ry + dyDeg] as [number, number];
      });
      set({ shapeRing: ring, alignOrigin: ring.map((p) => [...p] as [number, number]) });
    },
    moveShapeVertex: (i, lngLat) => set((s) => ({ shapeRing: s.shapeRing.map((p, k) => (k === i ? lngLat : p)) })),
    insertShapeVertex: (i, lngLat) => set((s) => ({ shapeRing: [...s.shapeRing.slice(0, i), lngLat, ...s.shapeRing.slice(i)] })),
    deleteShapeVertex: (i) => set((s) => (s.shapeRing.length <= 3 ? {} : { shapeRing: s.shapeRing.filter((_, k) => k !== i) })),
    cancelReshape: () => set({ reshaping: false, shapeRing: [], alignOrigin: null }),

    saveReshape: () => {
      const { targetId, shapeRing } = get();
      if (!targetId || shapeRing.length < 3) return { ok: false, reason: 'A footprint needs at least 3 corners.' };
      if (ringSelfIntersects(shapeRing)) return { ok: false, reason: 'The outline crosses itself — move the offending vertex back.' };
      if (Math.abs(ringAreaM2(shapeRing)) < 4) return { ok: false, reason: 'That footprint is smaller than 4 m² — too small to be a building.' };
      const closed: [number, number][] = [...shapeRing, shapeRing[0]];
      set((s) => ({ draft: { ...s.draft, ring: closed }, reshaping: false, shapeRing: [], alignOrigin: null }));
      get().saveDraft();
      return { ok: true };
    },

    // ── undo / redo ──────────────────────────────────────────────────────────
    undo: () => {
      const s = get();
      if (s.past.length === 0) return;
      const snap: Snapshot = {
        saved: s.saved,
        addedBuildings: s.addedBuildings,
        addedLabels: s.addedLabels,
        roadEdits: s.roadEdits,
        addedRoads: s.addedRoads,
        hiddenRoads: s.hiddenRoads,
        datum: s.datum,
        };
      const prev = s.past[s.past.length - 1];
      set({ ...prev, past: s.past.slice(0, -1), future: [...s.future, snap].slice(-HISTORY_CAP), draft: {} });
      persist(prev);
    },

    redo: () => {
      const s = get();
      if (s.future.length === 0) return;
      const snap: Snapshot = {
        saved: s.saved,
        addedBuildings: s.addedBuildings,
        addedLabels: s.addedLabels,
        roadEdits: s.roadEdits,
        addedRoads: s.addedRoads,
        hiddenRoads: s.hiddenRoads,
        datum: s.datum,
        };
      const nxt = s.future[s.future.length - 1];
      set({ ...nxt, future: s.future.slice(0, -1), past: [...s.past, snap].slice(-HISTORY_CAP), draft: {} });
      persist(nxt);
    },

    importMerged: (snap) => {
      // `commit` records history + persists; a merged team import is fully reversible
      commit(snap);
    },
  };
});

export const editSummary = (s: EditState) => ({
  overrides: Object.keys(s.saved).length,
  addedBuildings: s.addedBuildings.length,
  labels: s.addedLabels.length,
  fixedRoads: Object.keys(s.roadEdits).length,
  manualRoads: s.addedRoads.length,
  pending: Object.keys(s.draft).length,
  dirty:
    Object.keys(s.saved).length + s.addedBuildings.length + s.addedLabels.length + Object.keys(s.roadEdits).length + s.addedRoads.length >
    0,
  canUndo: s.past.length > 0,
  canRedo: s.future.length > 0,
});

/** Serialise the session into the files under public/data/manual/. */
export function exportFiles(s: EditState) {
  const buildings: Record<string, BuildingOverride> = {};
  Object.entries(s.saved)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, v]) => (buildings[k] = v));

  const overrides = JSON.stringify(
    {
      note: 'Manual corrections to the generated campus model (exported from the in-app editor). Anything listed here overrides the derived defaults and is treated as human-verified.',
      buildings,
    },
    null,
    2,
  );

  const buildingsGeoJson = JSON.stringify(
    {
      type: 'FeatureCollection',
      note: 'Footprints added by hand where OSM/Overture had none (exported from the in-app editor).',
      features: s.addedBuildings.map((b) => ({
        type: 'Feature',
        id: b.properties.id,
        properties: b.properties,
        geometry: { type: 'Polygon', coordinates: [b.ring] },
      })),
    },
    null,
    2,
  );

  const labels = JSON.stringify(
    {
      note: 'Labels for places that are not buildings (exported from the in-app editor). Rendered with the same style as building labels.',
      labels: s.addedLabels,
    },
    null,
    2,
  );

  const roadFixesObj: RoadFixes = {};
  Object.keys(s.roadEdits)
    .sort()
    .forEach((id) => (roadFixesObj[id] = s.roadEdits[id]));
  const roadFixes = JSON.stringify(
    {
      note: 'Corrected geometry for generated roads (exported from the in-app route editor). Values replace the road line before the route graph builds. `hidden` removes a generated road. Building doors ride in overrides.json (entrance_lat/lng) instead.',
      fixes: roadFixesObj,
      hidden: [...s.hiddenRoads].sort(),
    },
    null,
    2,
  );

  const roadsManual = JSON.stringify(
    {
      note: 'Paths/roads drawn by hand in the editor (start → waypoints → end) where the generated network was missing a connection.',
      roads: [...s.addedRoads].sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    2,
  );

  return { overrides, buildingsGeoJson, labels, roadFixes, roadsManual };
}
