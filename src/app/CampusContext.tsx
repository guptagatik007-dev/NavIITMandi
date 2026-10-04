import { createContext, useContext } from 'react';
import type { CampusData, CampusBuilding } from '@/data/loaders';
import type { TerrainGrid } from '@/geo/terrain';
import type { RouteGraph } from '@/geo/routing';
import type { SearchDoc } from '@/data/search';

export interface CampusRuntime {
  data: CampusData;
  terrain: TerrainGrid;
  graph: RouteGraph;
  searchIndex: SearchDoc[];
  byId: Map<string, CampusBuilding>;
  /** graph build + index build timings, surfaced in the HUD */
  builtMs: number;
}

const Ctx = createContext<CampusRuntime | null>(null);

export const CampusProvider = Ctx.Provider;

export function useCampus(): CampusRuntime {
  const c = useContext(Ctx);
  if (!c) throw new Error('Campus data is not loaded yet — this component must be rendered inside <CampusProvider>.');
  return c;
}

export function useOptionalCampus(): CampusRuntime | null {
  return useContext(Ctx);
}
