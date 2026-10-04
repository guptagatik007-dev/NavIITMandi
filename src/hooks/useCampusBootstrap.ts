import { useEffect, useState } from 'react';
import { loadCampusData, type CampusData } from '@/data/loaders';
import { loadTerrain, type TerrainGrid } from '@/geo/terrain';
import { buildOutdoorGraph, type RouteGraph } from '@/geo/routing';
import { buildIndex, type SearchDoc } from '@/data/search';

export type Bootstrap =
  | { status: 'loading'; stage: string }
  | { status: 'error'; error: string }
  | {
      status: 'ready';
      data: CampusData;
      terrain: TerrainGrid;
      graph: RouteGraph;
      searchIndex: SearchDoc[];
      byId: Map<string, CampusData['buildings'][number]>;
      builtMs: number;
    };

/**
 * Loads and prepares the whole campus dataset.
 * Graph construction is deferred to an idle callback so first paint is not blocked.
 */
export function useCampusBootstrap(): Bootstrap {
  const [state, setState] = useState<Bootstrap>({ status: 'loading', stage: 'Loading terrain…' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const terrain = await loadTerrain();
        if (cancelled) return;
        setState({ status: 'loading', stage: 'Loading buildings and roads…' });
        const data = await loadCampusData();
        if (cancelled) return;
        setState({ status: 'loading', stage: 'Lighting the scene…' });

        await new Promise<void>((r) => {
          const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
          if (idle) idle(() => r(), { timeout: 400 });
          else setTimeout(r, 0);
        });
        const t0 = performance.now();
        // §2.2: generated network is itself clamped by campus footprints (Oak Mess crossing etc.)
        const graph = buildOutdoorGraph(data.roads, terrain, { buildings: data.buildings });
        const searchIndex = buildIndex(
          data.pois,
          data.buildings.filter((b) => b.named && b.scope === 'campus').map((b) => ({ id: b.id, name: b.name, cat: b.cat })),
        );
        const byId = new Map(data.buildings.map((b) => [b.id, b]));
        const builtMs = performance.now() - t0;
        if (cancelled) return;
        setState({ status: 'ready', data, terrain, graph, searchIndex, byId, builtMs });
      } catch (e) {
        if (cancelled) return;
        setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
