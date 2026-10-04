import { create } from 'zustand';
import type { RoadJoinIssue } from '@/data/roadEdits';
import type { Tier } from '@/config/map.config';

export type Mode = 'outdoor' | 'indoor';
export type View = '3d' | 'map';
export type PanelId = 'explore' | 'layers' | 'route' | 'indoor' | 'about' | 'edit' | null;

interface UiState {
  mode: Mode;
  view: View;
  panel: PanelId | null;
  railOpen: boolean;
  deviceTier: Tier;
  theme: 'dark' | 'light';
  onboarded: boolean;
  labelsVisible: boolean;
  toast: { id: number; msg: string; kind: 'info' | 'warn' | 'error' } | null;
  /** §1 hand-drawn roads rejected by the merge pass (not joined to the network) — editor chips + route banner */
  roadIssues: RoadJoinIssue[];
  /** keyboard-shortcuts help overlay */
  showShortcuts: boolean;
  /** v3.2: which ends of each adopted hand-drawn road actually joined the network (✓ in navigation) */
  roadJoins: Record<string, ('start' | 'end')[]>;
  debug: { align: boolean; hud: boolean };
  setMode: (m: Mode) => void;
  setView: (v: View) => void;
  setPanel: (p: PanelId) => void;
  toggleRail: () => void;
  setTier: (t: Tier) => void;
  setTheme: (t: 'dark' | 'light') => void;
  setOnboarded: (v: boolean) => void;
  setLabelsVisible: (v: boolean) => void;
  notify: (msg: string, kind?: 'info' | 'warn' | 'error') => void;
  clearToast: () => void;
  setDebug: (d: Partial<UiState['debug']>) => void;
  setRoadIssues: (i: RoadJoinIssue[]) => void;
  setRoadJoins: (j: Record<string, ('start' | 'end')[]>) => void;
  setShowShortcuts: (v: boolean) => void;
}

const detectTier = (): Tier => {
  if (typeof navigator === 'undefined') return 'high';
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (mobile && (cores <= 6 || mem <= 4)) return 'low';
  if (mobile || cores <= 4) return 'mid';
  return 'high';
};

const hasOnboarded = typeof localStorage !== 'undefined' && localStorage.getItem('iitm-nav-onboarded') === '1';

export const useUi = create<UiState>((set) => ({
  mode: 'outdoor',
  view: '3d',
  // A returning visitor lands straight in Explore. A first-time visitor gets the tour
  // with no panel, and the panel is chosen by their own first click — previously an
  // effect opened Explore on dismiss, which raced with that click and cancelled it.
  panel: hasOnboarded ? 'explore' : null,
  railOpen: true,
  deviceTier: detectTier(),
  theme: 'dark',
  onboarded: hasOnboarded,
  labelsVisible: true,
  toast: null,
  roadIssues: [],
  showShortcuts: false,
  roadJoins: {},
  debug: { align: false, hud: false },
  // Switching to indoor clears the outdoor panel (it does not apply there); switching
  // back to outdoor KEEPS whatever panel was open. Blanking the panel on every mode
  // change used to close the Route panel when you switched 3D/Map, and closed the
  // editor the instant "Trace a footprint" moved you to the 2D view.
  setMode: (mode) => set((s) => ({ mode, panel: mode === 'indoor' ? null : s.panel })),
  setView: (view) => set({ view }),
  setPanel: (panel) => set({ panel, railOpen: panel !== null }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
  setTier: (deviceTier) => set({ deviceTier }),
  setTheme: (theme) => set({ theme }),
  setOnboarded: (onboarded) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('iitm-nav-onboarded', onboarded ? '1' : '0');
    set({ onboarded });
  },
  setLabelsVisible: (labelsVisible) => set({ labelsVisible }),
  notify: (msg, kind = 'info') => set({ toast: { id: Date.now(), msg, kind } }),
  clearToast: () => set({ toast: null }),
  setDebug: (d) => set((s) => ({ debug: { ...s.debug, ...d } })),
  setRoadIssues: (roadIssues) => set({ roadIssues }),
  setShowShortcuts: (showShortcuts) => set({ showShortcuts }),
  setRoadJoins: (roadJoins) => set({ roadJoins }),
}));
