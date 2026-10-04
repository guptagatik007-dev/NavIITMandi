import { create } from 'zustand';
import type { RouteResult, Profile } from '@/geo/routing';
import { DEFAULT_SUN_PRESET } from '@/config/map.config';
import type { SunPresetId } from '@/config/map.config';

export interface Layers {
  terrain: boolean;
  ortho: boolean;
  buildings: boolean;
  campusOnlyHighlight: boolean;
  roads: boolean;
  stairs: boolean;
  trees: boolean;
  labels: boolean;
  poi: boolean;
  route: boolean;
  orientation: boolean; // compass + scale bar overlay
  /** village/context buildings outside the campus cores */
  contextBuildings: boolean;
  /** label EVERY campus building, not just the priority subset (perf cost is warned about) */
  labelsAll: boolean;
}

interface OutdoorState {
  layers: Layers;
  /**
   * Roads-only inspection view: renderers hide buildings, trees, imagery, labels
   * and POI, and drawn roads stay at full strength (works the same in 2D and 3D).
   */
  roadsOnly: boolean;
  sunPreset: SunPresetId;
  hourOverride: number | null;
  exaggeration: number;
  /** global building opacity: 1 = solid, < 1 = X-ray. Per-building overrides win. */
  globalOpacity: number;
  selectedBuildingId: string | null;
  hoveredBuildingId: string | null;
  focusPoiId: string | null;
  route: {
    fromBuildingId: string | null;
    fromLatLng: { lat: number; lng: number } | null;
    toBuildingId: string | null;
    profile: Profile;
    result: RouteResult | null;
    /** all computed route options (active one duplicates into result) */
    alternatives: RouteResult[];
    altIndex: number;
    status: 'idle' | 'computing' | 'ready' | 'error';
    message?: string;
  };
  setRoadsOnly: (v: boolean) => void;
  toggleLayer: (k: keyof Layers) => void;
  setLayer: (k: keyof Layers, v: boolean) => void;
  setSunPreset: (p: SunPresetId) => void;
  setHour: (h: number | null) => void;
  setExaggeration: (v: number) => void;
  setGlobalOpacity: (v: number) => void;
  selectBuilding: (id: string | null) => void;
  hoverBuilding: (id: string | null) => void;
  focusPoi: (id: string | null) => void;
  setRouteEnd: (which: 'from' | 'to', buildingId: string | null, latLng?: { lat: number; lng: number } | null) => void;
  setProfile: (p: Profile) => void;
  setRouteResult: (r: RouteResult | null, status: OutdoorState['route']['status'], message?: string) => void;
  /** store computed route options + which one is active (0 = recommended) */
  setAlternatives: (alts: RouteResult[], altIndex: number, status?: OutdoorState['route']['status'], message?: string) => void;
  /** pick one of the computed alternatives as the active route */
  chooseAlternative: (i: number) => void;
  clearRoute: () => void;
}

export const useOutdoor = create<OutdoorState>((set) => ({
  roadsOnly: false,
  layers: {
    terrain: true,
    ortho: true,
    buildings: true,
    campusOnlyHighlight: false,
    roads: true,
    stairs: true,
    trees: true,
    labels: true,
    poi: true,
    route: true,
    orientation: true,
    contextBuildings: true,
    labelsAll: false,
  },
  sunPreset: DEFAULT_SUN_PRESET,
  hourOverride: null,
  exaggeration: 1,
  globalOpacity: 1,
  selectedBuildingId: null,
  hoveredBuildingId: null,
  focusPoiId: null,
  route: { fromBuildingId: null, fromLatLng: null, toBuildingId: null, profile: 'fastest', result: null, alternatives: [], altIndex: 0, status: 'idle' },
  setRoadsOnly: (v) => set({ roadsOnly: v }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
  setSunPreset: (sunPreset) => set({ sunPreset, hourOverride: null }),
  setHour: (hourOverride) => set({ hourOverride }),
  setExaggeration: (exaggeration) => set({ exaggeration: Math.min(2, Math.max(1, exaggeration)) }),
  setGlobalOpacity: (v) => set({ globalOpacity: Math.min(1, Math.max(0.15, v)) }),
  selectBuilding: (id) => set({ selectedBuildingId: id }),
  hoverBuilding: (hoveredBuildingId) => set({ hoveredBuildingId }),
  focusPoi: (focusPoiId) => set({ focusPoiId }),
  setRouteEnd: (which, buildingId, latLng) =>
    set((s) => ({
      route: {
        ...s.route,
        ...(which === 'from'
          ? { fromBuildingId: buildingId, fromLatLng: latLng ?? null }
          : { toBuildingId: buildingId }),
        status: 'idle',
        result: null,
        alternatives: [],
        altIndex: 0,
      },
    })),
  setProfile: (profile) => set((s) => ({ route: { ...s.route, profile, result: null, alternatives: [], altIndex: 0, status: 'idle' } })),
  setAlternatives: (alts, altIndex, status = 'ready', message) =>
    set((s) => ({ route: { ...s.route, alternatives: alts, altIndex, result: alts[altIndex] ?? alts[0] ?? null, status, message } })),
  chooseAlternative: (i) =>
    set((s) => (s.route.alternatives[i] ? { route: { ...s.route, altIndex: i, result: s.route.alternatives[i], status: 'ready' } } : {})),
  setRouteResult: (result, status, message) => set((s) => ({ route: { ...s.route, result, status, message } })),
  clearRoute: () =>
    set(() => ({
      route: { fromBuildingId: null, fromLatLng: null, toBuildingId: null, profile: 'fastest', result: null, alternatives: [], altIndex: 0, status: 'idle' },
    })),
}));
