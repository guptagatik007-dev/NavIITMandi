import { useEffect } from 'react';
import { useUi } from '@/store/uiStore';
import { useOutdoor } from '@/store/outdoorStore';
import { useEdit } from '@/store/editStore';
import { useMap } from '@/store/mapStore';
import { CAMERA_DEFAULTS } from '@/config/map.config';

/**
 * §7/R4 — one global keyboard layer so every panel/view behaves the same.
 * Kept at the App root (not inside a panel) so shortcuts keep working when a
 * panel is closed. Inputs/textareas/selects and contentEditable always win.
 *
 *   /          focus campus search (TopBar own handler keeps the focus)
 *   1 / 2 / 3  3D view / Map view / Indoor viewer
 *   x l r i e a toggle panels: explore, layers, route, indoor, edit, about
 *   v          roads-only inspection view toggle
 *   h          home camera (campus overview)
 *   ?          shortcuts overlay (Shift+/)
 *   Esc        close shortcuts overlay first (panel-specific Esc keeps working)
 *   Backspace  undo last vertex while tracing a building/route (map view)
 *
 * §5.2 align mode (when active on the map):
 *   ← → ↑ ↓    nudge footprint 0.3 m (Shift = 1 m)
 *   Q / E      rotate footprint 0.5° (Shift = 2°)
 *   Enter      save alignment · Esc cancels (handled here too, overlay-first)
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave device/browser chords alone

      const ui = useUi.getState();
      const es = useEdit.getState();
      const outdoor = useOutdoor.getState();
      const map = useMap.getState();

      // ── align-to-imagery mode has absolute priority (its own modal vocabulary) ──
      if (es.reshaping && es.alignOrigin) {
        const key = e.key.toLowerCase();
        const step = e.shiftKey ? 1.0 : 0.3;
        const rot = e.shiftKey ? 2 : 0.5;
        if (e.key === 'ArrowLeft') { e.preventDefault(); es.alignNudge(-step, 0, 0); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); es.alignNudge(step, 0, 0); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); es.alignNudge(0, step, 0); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); es.alignNudge(0, -step, 0); return; }
        if (key === 'q') { e.preventDefault(); es.alignNudge(0, 0, -rot); return; }
        if (key === 'e') { e.preventDefault(); es.alignNudge(0, 0, rot); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          const res = es.saveReshape();
          ui.notify(res.ok ? 'Alignment saved — all four corners should sit on the imagery now.' : (res.reason ?? 'Alignment failed.'), res.ok ? 'info' : 'warn');
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); es.cancelReshape(); ui.notify('Alignment cancelled.', 'info'); return; }
      }

      // v3.1 road-fix keyboard moulding: arrows translate the WHOLE road line while
      // it is being fixed (the user asked to "move / mould" roads, not just vertices);
      // Enter commits the current shape, same as the map toolbar's Save.
      if (es.roadFixId) {
        const step = e.shiftKey ? 1.0 : 0.3;
        if (e.key === 'ArrowLeft') { e.preventDefault(); es.shiftRoadFix(-step, 0); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); es.shiftRoadFix(step, 0); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); es.shiftRoadFix(0, step); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); es.shiftRoadFix(0, -step); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          const fixedId = es.roadFixId;
          const ok = es.saveRoadFix();
          ui.notify(ok ? `Road ${fixedId ?? ''} shape committed — the route graph rebuilds now.` : 'Nothing to save yet.', ok ? 'info' : 'warn');
          return;
        }
      }
      if (e.key === 'Escape') {
        if (ui.showShortcuts) { ui.setShowShortcuts(false); e.preventDefault(); return; }
        return; // drawing modes' own Esc handlers live in EditPanel / Map2D
      }

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        ui.setShowShortcuts(!ui.showShortcuts);
        return;
      }
      if (e.key === 'Backspace') {
        if (es.tracing && es.traceRing.length > 0) { e.preventDefault(); es.undoVertices?.(); return; }
        if (es.tracingRoad && es.roadTrace.length > 0) { e.preventDefault(); es.undoRoadVertex?.(); return; }
        return;
      }

      // plain-letter shortcuts only make sense with no modifier held
      const k = e.key.toLowerCase();
      // while a drawing/edit tool is live, letters keep their tool meaning (Q/E rotate,
      // plain keys already reserved) — never flip views or panels underneath
      if (es.tracing || es.tracingRoad || es.reshaping || es.roadFixId) return;
      switch (k) {
        case '1': ui.setView('3d'); break;
        case '2': ui.setView('map'); break;
        case '3': ui.setView('map'); ui.setMode('indoor'); ui.setPanel('indoor'); break;
        case 'x': ui.setPanel(ui.panel === 'explore' ? null : 'explore'); break;
        case 'l': ui.setPanel(ui.panel === 'layers' ? null : 'layers'); break;
        case 'r': ui.setPanel(ui.panel === 'route' ? null : 'route'); break;
        case 'i': ui.setPanel(ui.panel === 'indoor' ? null : 'indoor'); break;
        case 'e': {
          // don't hijack align-rotate Q/E — handled above; don't toggle edit while drawing
          if (es.tracing || es.tracingRoad || es.reshaping) return;
          const next = ui.panel === 'edit' ? null : 'edit';
          ui.setPanel(next);
          break;
        }
        case 'a': ui.setPanel(ui.panel === 'about' ? null : 'about'); break;
        case 'v': outdoor.setRoadsOnly(!outdoor.roadsOnly); ui.notify(outdoor.roadsOnly ? 'Roads-only off.' : 'Roads-only ON — everything but the network hidden. V to exit.', 'info'); break;
        case 'h':
          map.resetCamera();
          map.requestFlyTo({ lat: CAMERA_DEFAULTS.lat, lng: CAMERA_DEFAULTS.lng, zoom: CAMERA_DEFAULTS.zoom, pitch: CAMERA_DEFAULTS.pitch, bearing: CAMERA_DEFAULTS.bearing });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
