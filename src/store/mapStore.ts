import { create } from 'zustand';
import { CAMERA_DEFAULTS } from '@/config/map.config';

/** Shared camera state so 2D (MapLibre) and 3D (three.js) modes frame identically. */
export interface CameraState {
  lat: number;
  lng: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

interface MapState {
  camera: CameraState;
  /** set by a search hit / POI click; consumed by whichever view is active */
  flyTo: { lat: number; lng: number; zoom?: number; pitch?: number; bearing?: number; nonce: number } | null;
  setCamera: (c: Partial<CameraState>) => void;
  requestFlyTo: (t: { lat: number; lng: number; zoom?: number; pitch?: number; bearing?: number }) => void;
  clearFlyTo: () => void;
  resetCamera: () => void;
}

export const useMap = create<MapState>((set) => ({
  camera: {
    lat: CAMERA_DEFAULTS.lat,
    lng: CAMERA_DEFAULTS.lng,
    zoom: CAMERA_DEFAULTS.zoom,
    bearing: CAMERA_DEFAULTS.bearing,
    pitch: CAMERA_DEFAULTS.pitch,
  },
  flyTo: null,
  setCamera: (c) => set((s) => ({ camera: { ...s.camera, ...c } })),
  requestFlyTo: (t) => set({ flyTo: { ...t, nonce: Date.now() } }),
  clearFlyTo: () => set({ flyTo: null }),
  resetCamera: () =>
    set({
      camera: {
        lat: CAMERA_DEFAULTS.lat,
        lng: CAMERA_DEFAULTS.lng,
        zoom: CAMERA_DEFAULTS.zoom,
        bearing: CAMERA_DEFAULTS.bearing,
        pitch: CAMERA_DEFAULTS.pitch,
      },
    }),
}));
