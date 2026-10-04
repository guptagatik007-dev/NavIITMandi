import { useEffect, useRef } from 'react';
import { useMap } from '@/store/mapStore';
import { useOutdoor } from '@/store/outdoorStore';
import { useUi } from '@/store/uiStore';
import { useCampus } from '@/app/CampusContext';
import { centroidOfRing } from '@/geo/wgs84';

/**
 * Deep links + shareable state.
 *   ?mode=3d|map|indoor   ?lat=&lng=&zoom=   ?b=<buildingId>   ?poi=<poiId>
 *   ?from=<buildingId>&to=<buildingId>&profile=fastest|accessible|shortest
 *   ?debug=align,hud
 * Reading happens once at boot; afterwards the URL tracks the selection so any view
 * can be copied, QR-coded, or revisited.
 */
/**
 * The query string exactly as it arrived.
 *
 * The share-URL effect below rewrites `location.search` on mount, and because it reads the
 * selection from a render closure that is still empty at that moment, it can drop the very
 * parameters the deep link came in with. Reading the intent from this frozen copy is what
 * makes `?b=A1` survive long enough to be honoured.
 */
const INITIAL_SEARCH = typeof window !== 'undefined' ? window.location.search : '';

export function useDeepLink() {
  const requestFlyTo = useMap((s) => s.requestFlyTo);

  useEffect(() => {
    const p = new URLSearchParams(INITIAL_SEARCH);
    const mode = p.get('mode');
    const view = p.get('view');
    const b = p.get('b');
    const poi = p.get('poi');
    const debug = p.get('debug');
    const from = p.get('from');
    const to = p.get('to');
    const profile = p.get('profile');
    const lat = parseFloat(p.get('lat') ?? '');
    const lng = parseFloat(p.get('lng') ?? '');
    const zoom = parseFloat(p.get('zoom') ?? '');

    const ui = useUi.getState();
    if (mode === 'indoor') ui.setMode('indoor');
    else if (mode === 'map' || mode === '3d') {
      ui.setMode('outdoor');
      ui.setView(mode);
    }
    if (view === 'map' || view === '3d') ui.setView(view);
    if (debug) {
      const flags = debug.split(',');
      ui.setDebug({ align: flags.includes('align'), hud: flags.includes('hud') || flags.includes('1') });
    }

    const outdoor = useOutdoor.getState();
    if (b) outdoor.selectBuilding(b);
    if (poi) outdoor.focusPoi(poi);
    if (from) outdoor.setRouteEnd('from', from);
    if (to) outdoor.setRouteEnd('to', to);
    if (profile === 'fastest' || profile === 'accessible' || profile === 'shortest') outdoor.setProfile(profile);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      requestFlyTo({ lat, lng, zoom: Number.isFinite(zoom) ? zoom : 16.5 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the URL shareable
  const selected = useOutdoor((s) => s.selectedBuildingId);
  const mode = useUi((s) => s.mode);
  const view = useUi((s) => s.view);
  const routeFrom = useOutdoor((s) => s.route.fromBuildingId);
  const routeTo = useOutdoor((s) => s.route.toBuildingId);
  const profile = useOutdoor((s) => s.route.profile);

  const synced = useRef(false);
  useEffect(() => {
    // the first run only mirrors the state that was just read *from* the URL; writing it
    // back is what used to strip the incoming parameters
    if (!synced.current) {
      synced.current = true;
      return;
    }
    const p = new URLSearchParams();
    p.set('mode', mode === 'indoor' ? 'indoor' : view);
    if (selected) p.set('b', selected);
    if (routeFrom) p.set('from', routeFrom);
    if (routeTo) p.set('to', routeTo);
    if (profile !== 'fastest') p.set('profile', profile);
    const url = `${window.location.pathname}?${p.toString()}`;
    window.history.replaceState(null, '', url);
  }, [selected, mode, view, routeFrom, routeTo, profile]);
}

/**
 * Deep-link focus.
 *
 * `?b=<buildingId>` is printed on QR codes and pasted into chats, so it must actually
 * take you to the building. Selection alone is invisible from a wide view — and it
 * cannot run at boot, because the campus data is not loaded yet at that point. So this
 * waits for the data, then flies once (never on every render).
 */
export function useDeepLinkFocus() {
  const campus = useCampus();
  const requestFlyTo = useMap((s) => s.requestFlyTo);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const p = new URLSearchParams(INITIAL_SEARCH);
    const lat = parseFloat(p.get('lat') ?? '');
    const lng = parseFloat(p.get('lng') ?? '');
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      done.current = true;
      requestFlyTo({ lat, lng, zoom: Number.isFinite(parseFloat(p.get('zoom') ?? '')) ? parseFloat(p.get('zoom')!) : 16.5 });
      return;
    }
    const bId = p.get('b');
    if (bId) {
      // Resolve by id first, then by name: ids are stable (`osm-474553719`) and are what
      // the QR sheet encodes, but people type `?b=A1`. Failing silently here is exactly
      // the kind of quiet dead end the spec forbids, so an unresolved link says so.
      const needle = bId.trim().toLowerCase();
      const all = campus.data.buildings;
      const b =
        campus.byId.get(bId) ??
        all.find((x) => (x.name ?? '').trim().toLowerCase() === needle) ??
        all.find((x) => (x.name ?? '').trim().toLowerCase().startsWith(needle) && needle.length >= 2);
      if (!b) {
        // the data may still be settling on the first render — only give up once
        // the campus has actually loaded
        if (!all.length) return;
        done.current = true;
        useUi.getState().notify(`No building matches “${bId}”.`, 'warn');
        return;
      }
      const c = centroidOfRing(b.ring);
      done.current = true;
      useOutdoor.getState().selectBuilding(b.id);
      // ~380 m out, tilted, so the building reads as a building and not a speck
      requestFlyTo({ lat: c.lat, lng: c.lng, zoom: 17.4, pitch: 48 });
      return;
    }
    const poiId = p.get('poi');
    if (poiId) {
      const poi = campus.data.pois.find((x) => x.id === poiId) ?? campus.data.pois.find((x) => (x.name ?? '').toLowerCase() === poiId.toLowerCase());
      if (!poi) {
        if (!campus.data.pois.length) return;
        done.current = true;
        useUi.getState().notify(`No place matches “${poiId}”.`, 'warn');
        return;
      }
      done.current = true;
      useOutdoor.getState().focusPoi(poi.id);
      requestFlyTo({ lat: poi.lat, lng: poi.lng, zoom: 17.2, pitch: 46 });
    }
  }, [campus, requestFlyTo]);
}

export function buildShareUrl(overrides: Record<string, string | undefined>): string {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) p.delete(k);
    else p.set(k, v);
  }
  return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
}
