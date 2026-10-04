/**
 * EditPanel.tsx — the manual building / label workshop (?edit=1).
 *
 * Workflow mirrors how you actually fix a campus map on site:
 *   1. click the building that looks wrong (in 3D or Map view)
 *   2. correct the fields it got wrong — and see it change instantly
 *   3. export, paste into public/data/manual/, commit
 *
 * Add-building traces a polygon in Map view; Place-label drops a label anywhere for
 * features that are not buildings (gate, viewpoint, water point).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCampus } from '@/app/CampusContext';
import { editSummary, exportFiles, useEdit } from '@/store/editStore';
import { useOutdoor } from '@/store/outdoorStore';
import { useUi } from '@/store/uiStore';
import { useMap } from '@/store/mapStore';
import { Chip, Section } from '@/ui/primitives';
import { WALL_COLOR_NAMES } from '@/scene/buildGeometry';
import { serialiseManualBuildings, serialiseOverrides } from '@/data/overrides';
import { polylineIntersectsRing } from '@/geo/polyOps';
import { serialiseSession, mergeSession, SessionFileSchema } from './sessionIO';

const CATS = [
  'academic', 'hostel', 'dining', 'sports', 'admin', 'residential', 'medical', 'utility',
  'gate', 'guesthouse', 'library', 'lab', 'auditorium', 'school', 'worship', 'parking', 'commerce', 'unknown',
];
const ROOFS = ['flat', 'sloped', 'mono-pitch', 'multi-bay', 'shed', 'hipped'];

export function EditPanel() {
  const { data } = useCampus();
  const edit = useEdit();
  const selectedId = useOutdoor((s) => s.selectedBuildingId);
  const selectBuilding = useOutdoor((s) => s.selectBuilding);
  const notify = useUi((s) => s.notify);
  const requestFlyTo = useMap((s) => s.requestFlyTo);
  const [filter, setFilter] = useState('');
  const [roadFilter, setRoadFilter] = useState('');
  const [labelText, setLabelText] = useState('');
  const [labelLatLng, setLabelLatLng] = useState('');
  const [author, setAuthorState] = useState(() => {
    try {
      return localStorage.getItem('iitm-team-author') ?? '';
    } catch {
      return '';
    }
  });
  const [zone, setZone] = useState(() => {
    try {
      return localStorage.getItem('iitm-team-zone') ?? '';
    } catch {
      return '';
    }
  });
  const sessionInput = useRef<HTMLInputElement>(null);
  // author + zone are shared with the floor-bundle exporter (indoor workspace)
  const setAuthor = (v: string) => {
    setAuthorState(v);
    try {
      localStorage.setItem('iitm-team-author', v);
    } catch {
      /* fine */
    }
  };
  const setZoneSafe = (v: string) => {
    setZone(v);
    try {
      localStorage.setItem('iitm-team-zone', v);
    } catch {
      /* fine */
    }
  };

  // Global editor keyboard shortcuts — standard editor muscle memory (v1.8 §8):
  //   Esc        cancel active tool → deselect
  //   Ctrl+Z     undo: vertex while tracing → otherwise history step
  //   Ctrl+Shift+Z / Ctrl+Y   redo
  //   Enter      finish a route drawing (need ≥ 2 points)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Ignore if typing in an input/textarea
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const es = useEdit.getState();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (es.tracing) {
          es.cancelTrace();
          notify('Tracing cancelled.', 'info');
        } else if (es.tracingRoad) {
          es.cancelRoadTrace();
          notify('Route drawing cancelled.', 'info');
        } else if (es.reshaping) {
          es.cancelReshape();
          notify('Reshape cancelled.', 'info');
        } else if (es.roadFixId) {
          es.cancelRoadFix();
          notify('Road fix cancelled.', 'info');
        } else {
          selectBuilding(null);
          es.setTarget(null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (es.tracing && es.traceRing.length > 0) es.undoVertices();
        else if (es.tracingRoad && es.roadTrace.length > 0) es.undoRoadVertex();
        else if (es.past.length > 0) {
          es.undo();
          notify('Undone.', 'info');
        }
      }
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (es.future.length > 0) {
          es.redo();
          notify('Redone.', 'info');
        }
      }
      if (e.key === 'Enter' && es.tracingRoad && es.roadTrace.length >= 2) {
        e.preventDefault();
        const id = es.closeRoadTrace({ name: null, cls: 'footway', width_m: 1.5, surface: 'unpaved' });
        const road = id ? useEdit.getState().addedRoads.find((r) => r.id === id) : null;
        if (road) {
          const blockedBy = data.buildings.filter((b) => !b.hidden && polylineIntersectsRing(road.line, b.ring));
          notify(
            blockedBy.length > 0
              ? `Route crosses ${blockedBy.slice(0, 3).map((b) => b.name).join(', ')}${blockedBy.length > 3 ? '…' : ''} — redraw or fix it unless intended.`
              : 'Route saved locally. Name it in the Routes section; export to keep it.',
            blockedBy.length > 0 ? 'warn' : 'info',
          );
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [edit, selectBuilding, notify, data.buildings]);

  const summary = editSummary(edit);
  const roadCandidates = useMemo(() => {
    const t = roadFilter.trim().toLowerCase();
    return data.roads
      .filter((r) => !edit.hiddenRoads.includes(r.id))
      .filter((r) => !t || (r.name ?? '').toLowerCase().includes(t) || r.id.toLowerCase().includes(t))
      .slice()
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  }, [data.roads, roadFilter, edit.hiddenRoads]);
  const roadsListCount = data.roads.length;
  const roadIssues = useUi((s) => s.roadIssues);
  const roadJoins = useUi((s) => s.roadJoins);
  const building = useMemo(() => data.buildings.find((b) => b.id === selectedId) ?? null, [data.buildings, selectedId]);
  const isOverridden = building ? Boolean(edit.saved[building.id] || data.overrides.get(building.id)) : false;
  const isHidden = Boolean(building && (edit.draft.hidden ?? edit.saved[building.id]?.hidden ?? data.overrides.get(building.id)?.hidden ?? building.hidden));

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return data.buildings
      .filter((b) => b.scope === 'campus')
      .filter((b) => (q ? b.name.toLowerCase().includes(q) || b.id.includes(q) : true))
      .slice(0, 60);
  }, [data.buildings, filter]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied. Paste it into public/data/manual/ and commit.`, 'info');
    } catch {
      notify('Clipboard blocked by the browser — use the download button instead.', 'warn');
    }
  };

  const download = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const effective = (key: keyof typeof edit.draft | string) =>
    building ? ((edit.draft as Record<string, unknown>)[key] ?? (building as unknown as Record<string, unknown>)[key]) : undefined;

  // §7/P7: one visible edit-mode machine — exactly one tool can be live at a time,
  // and the rail shows which. Clicking the live chip cancels it (same as Esc).
  const modeChip: { key: string; label: string; hint: string; cancel: () => void } | null = edit.roadFixId
    ? { key: 'fix', label: `Fixing ${edit.roadFixId}`, hint: 'drag the amber handles', cancel: () => edit.cancelRoadFix() }
    : edit.alignOrigin
      ? { key: 'align', label: 'Aligning footprint', hint: 'arrows nudge · Q/E rotate · Enter saves', cancel: () => edit.cancelReshape() }
      : edit.reshaping
        ? { key: 'reshape', label: 'Reshaping footprint', hint: 'drag corners · click edge to add · right-click to delete', cancel: () => edit.cancelReshape() }
        : edit.tracingRoad
          ? { key: 'route', label: 'Drawing a route', hint: 'click waypoints · double-click/Enter ends', cancel: () => edit.cancelRoadTrace() }
          : edit.tracing
            ? { key: 'trace', label: 'Tracing a footprint', hint: 'click corners · close near start', cancel: () => edit.cancelTrace() }
            : null;

  return (
    <div>
      {modeChip && (
        <div style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface-1, rgba(16,26,22,0.92))', border: '1px solid var(--accent)', borderRadius: 'var(--r-pill)', padding: '6px 12px', marginBottom: 10, backdropFilter: 'blur(6px)' }}>
          <Chip tone="accent">{modeChip.label}</Chip>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', flex: 1 }}>{modeChip.hint}</span>
          <button className="btn" style={{ padding: '3px 10px' }} onClick={() => { modeChip.cancel(); notify('Exited ' + modeChip.label + '.', 'info'); }}>Exit</button>
        </div>
      )}
      <Section title="Manual corrections">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Chip tone={summary.overrides ? 'accent' : 'muted'}>{summary.overrides} overrides</Chip>
          <Chip tone={summary.addedBuildings ? 'accent' : 'muted'}>{summary.addedBuildings} added</Chip>
          <Chip tone={summary.labels ? 'accent' : 'muted'}>{summary.labels} labels</Chip>
        </div>

        {data.manualIssues.length > 0 && (
          <div style={{ border: '1px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 8, marginBottom: 10 }}>
            <div className="label-h" style={{ color: 'var(--warn)' }}>Problems in the manual files</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11 }}>
              {data.manualIssues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a building by name or id…"
          aria-label="Filter buildings"
          style={{ width: '100%', minHeight: 38, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: '0 10px', marginBottom: 8 }}
        />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflow: 'auto' }}>
          {candidates.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => {
                  selectBuilding(b.id);
                  edit.setTarget(b.id);
                  const c = b.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                  requestFlyTo({ lat: c[1] / b.ring.length, lng: c[0] / b.ring.length, zoom: 17.6, pitch: 55 });
                }}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
                  background: selectedId === b.id ? 'var(--surface-3)' : 'transparent', border: 0,
                  borderBottom: '1px solid var(--hairline)', padding: '8px 4px', cursor: 'pointer', color: 'inherit', textAlign: 'left',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{b.id}</span>
                </span>
                <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {(edit.saved[b.id] || data.overrides.get(b.id)) && <Chip tone="accent">edited</Chip>}
                  {(edit.saved[b.id]?.hidden || data.overrides.get(b.id)?.hidden || b.hidden) && <Chip tone="warn">hidden</Chip>}
                  {b.conf === 'manual' && <Chip tone="warn">manual</Chip>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {building && (
        <Section title={`Editing — ${building.name}`}>
          {/* Building inspector: everything about THIS building in one place —
              identity, quick navigation, and every edit action. Double-clicking a
              building in 3D or 2D lands here directly. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <Chip tone="muted"><span className="mono">{building.id}</span></Chip>
            <Chip tone="muted">{building.cat}</Chip>
            <Chip tone="muted">{Number(effective('floors') ?? building.floors)} floors</Chip>
            <Chip tone="muted">{Number(effective('height_m') ?? building.height_m).toFixed(1)} m</Chip>
            {building.conf === 'manual' ? <Chip tone="warn">manual</Chip> : <Chip tone="muted">generated</Chip>}
            {isHidden && <Chip tone="warn">hidden</Chip>}
            {isOverridden && <Chip tone="accent">edited</Chip>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              className="btn"
              onClick={() => {
                const c = building.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                requestFlyTo({ lat: c[1] / building.ring.length, lng: c[0] / building.ring.length, zoom: 17.8, pitch: 55 });
              }}
            >
              Fly to
            </button>
            <button
              className="btn"
              onClick={() => {
                useOutdoor.getState().setRouteEnd('to', building.id);
                useUi.getState().setPanel('explore');
                notify(`Destination set to ${building.name}. Route panel opened.`, 'info');
              }}
            >
              Navigate here
            </button>
            <button
              className="btn"
              onClick={() => {
                useOutdoor.getState().setRouteEnd('from', building.id);
                useUi.getState().setPanel('explore');
                notify(`Start point set to ${building.name}. Pick a destination.`, 'info');
              }}
            >
              Route from here
            </button>
            <button
              className="btn"
              onClick={() => {
                useUi.getState().setView('map');
                const c = building.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                requestFlyTo({ lat: c[1] / building.ring.length, lng: c[0] / building.ring.length, zoom: 18.2 });
              }}
            >
              Inspect in Map
            </button>
          </div>
          <Field label="Name">
            <input
              value={String(effective('name') ?? '')}
              onChange={(e) => edit.patchDraft({ name: e.target.value })}
              style={inputStyle}
              aria-label="Building name"
            />
          </Field>
          <Field label="Category">
            <select value={String(effective('cat') ?? building.cat)} onChange={(e) => edit.patchDraft({ cat: e.target.value as never })} style={inputStyle} aria-label="Category">
              {CATS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label={`Floors — ${Number(effective('floors') ?? building.floors)}  (each floor = ${building.f2f.toFixed(1)} m, same as the rest of the campus)`}>
            <input
              type="range" min={1} max={10} step={1}
              value={Number(effective('floors') ?? building.floors)}
              onChange={(e) => {
                // Changing floors always recomputes height = floors × floor-to-floor
                // so every building on campus keeps one consistent per-floor height
                // (the requested "old building" behaviour). The Height slider below
                // can still override it afterwards if a specific total is needed.
                const floors = parseInt(e.target.value, 10);
                const height = Math.round((floors * building.f2f + 1) * 100) / 100;
                edit.patchDraft({ floors, height_m: height });
              }}
              style={rangeStyle}
              aria-label="Floors"
            />
          </Field>
          <Field label={`Height — ${Number(effective('height_m') ?? building.height_m).toFixed(1)} m  (auto follows floors × ${building.f2f.toFixed(1)} m unless you move this slider)`}>
            <input
              type="range" min={3} max={45} step={0.5}
              value={Number(effective('height_m') ?? building.height_m)}
              onChange={(e) => edit.patchDraft({ height_m: parseFloat(e.target.value) })}
              style={rangeStyle}
              aria-label="Height"
            />
          </Field>
          <Field label="Roof form">
            <select value={String(effective('roof') ?? building.roof)} onChange={(e) => edit.patchDraft({ roof: e.target.value as never })} style={inputStyle} aria-label="Roof form">
              {ROOFS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label={`Roof pitch — ${Number(effective('pitch') ?? building.pitch)}°`}>
            <input type="range" min={0} max={45} step={1} value={Number(effective('pitch') ?? building.pitch)} onChange={(e) => edit.patchDraft({ pitch: parseInt(e.target.value, 10) })} style={rangeStyle} aria-label="Roof pitch" />
          </Field>
          <Field label="Wall material">
            <select value={String(effective('wall') ?? building.wall)} onChange={(e) => edit.patchDraft({ wall: e.target.value })} style={inputStyle} aria-label="Wall material">
              {WALL_COLOR_NAMES.map((w) => (
                <option key={w} value={w}>{w.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label={`Opacity — ${Number(effective('opacity') ?? 1).toFixed(2)}  (1 = solid; below 1 renders in the transparent batch)`}>
            <input type="range" min={0.2} max={1} step={0.05} value={Number(effective('opacity') ?? 1)} onChange={(e) => edit.patchDraft({ opacity: parseFloat(e.target.value) })} style={rangeStyle} aria-label="Opacity" />
          </Field>
          <Field label={`Seat offset — ${Number(effective('seatOffsetM') ?? 0).toFixed(1)} m  (raise/lower the cut platform)`}>
            <input type="range" min={-6} max={6} step={0.25} value={Number(effective('seatOffsetM') ?? 0)} onChange={(e) => edit.patchDraft({ seatOffsetM: parseFloat(e.target.value) })} style={rangeStyle} aria-label="Seat offset" />
          </Field>
          <Field label="Label text (blank = use the name)">
            <input value={String(effective('labelText') ?? '')} onChange={(e) => edit.patchDraft({ labelText: e.target.value })} style={inputStyle} aria-label="Label text" />
          </Field>
          <Field label="Verified by / on (turns a guess into data)">
            <input value={String(effective('verifiedBy') ?? '')} placeholder="name" onChange={(e) => edit.patchDraft({ verifiedBy: e.target.value })} style={inputStyle} aria-label="Verified by" />
          </Field>
          <Field label="Note">
            <input value={String(effective('note') ?? '')} placeholder="what did you check it against?" onChange={(e) => edit.patchDraft({ note: e.target.value })} style={inputStyle} aria-label="Note" />
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { edit.saveDraft(); notify('Building correction saved locally.', 'info'); }} disabled={!summary.pending}>Save change</button>
            <button
              className="btn"
              aria-label="Reshape footprint"
              onClick={() => {
                // Reshape works on ANY building: generated footprints become an
                // override ring (overrides.json), manual buildings the same path.
                const current = (edit.draft.ring ?? edit.saved[building.id]?.ring ?? building.ring) as [number, number][];
                const open = current.length > 1 && current[0][0] === current[current.length - 1][0] && current[0][1] === current[current.length - 1][1]
                  ? current.slice(0, -1)
                  : current.slice();
                edit.startReshape(building.id, open);
                useUi.getState().setView('map');
                useUi.getState().setMode('outdoor');
                const c = open.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                requestFlyTo({ lat: c[1] / open.length, lng: c[0] / open.length, zoom: 18.4 });
                notify('Footprint handles are live on the map — drag corners, click the dashed edge to add one, right-click to delete.', 'info');
              }}
            >
              Reshape footprint
            </button>
            <button
              className="btn"
              aria-label="Align footprint to satellite imagery"
              title="Move the whole footprint corner-to-corner: ← → ↑ ↓ nudge 0.3 m (Shift = 1 m), Q / E rotate, Enter saves"
              onClick={() => {
                const current = (edit.draft.ring ?? edit.saved[building.id]?.ring ?? building.ring) as [number, number][];
                const open = current.length > 1 && current[0][0] === current[current.length - 1][0] && current[0][1] === current[current.length - 1][1]
                  ? current.slice(0, -1)
                  : current.slice();
                edit.startAlign(building.id, open);
                useUi.getState().setView('map');
                useUi.getState().setMode('outdoor');
                const c = open.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                requestFlyTo({ lat: c[1] / open.length, lng: c[0] / open.length, zoom: 17.2, pitch: 60 });
                notify('ALIGN MODE — arrows nudge 0.3 m (Shift 1 m), Q/E rotate 0.5° (Shift 2°), Enter saves, Esc cancels. Watch corners against the HD basemap.', 'info');
              }}
            >
              Align to imagery
            </button>
            <button
              className="btn"
              aria-label="Set entrance on a road"
              title="Click the road where navigation should END for this building — routes terminate at the door"
              onClick={() => {
                useUi.getState().setView('map');
                useUi.getState().setMode('outdoor');
                edit.armEntrancePick(true);
                const c = building.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                requestFlyTo({ lat: c[1] / building.ring.length, lng: c[0] / building.ring.length, zoom: 17.8 });
                notify('Now click the ROAD that leads to this door (within 60 m). The door snaps onto it — navigation will end there, node-to-node.', 'info');
              }}
            >
              Set entrance on road
            </button>
            {(building as { entrance_lat?: number }).entrance_lat != null && (
              <button
                className="btn"
                aria-label="Clear entrance"
                onClick={() => {
                  edit.setEntrance(null);
                  notify('Door cleared — routing falls back to the footprint centroid.', 'info');
                }}
              >
                Clear door
              </button>
            )}
            <button
              className="btn"
              aria-label="Move map pin (label, search node, route end)"
              title="Click anywhere on the map to move this building's MAP PIN — where its label sits, where search results point, and (when no door is set) where routes end"
              onClick={() => {
                useUi.getState().setView('map');
                useUi.getState().setMode('outdoor');
                edit.armLabelPick(true);
                const c = building.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                requestFlyTo({ lat: c[1] / building.ring.length, lng: c[0] / building.ring.length, zoom: 17.8 });
                notify('Now click where this building’s PIN belongs — the label, search result and default route end will all follow that spot.', 'info');
              }}
            >
              📍 Move map pin (label / search node)
            </button>
            {(edit.draft.labelAt ?? edit.saved[building.id]?.labelAt ?? (building as { labelAt?: [number, number] }).labelAt) != null && (
              <button
                className="btn"
                aria-label="Clear map pin"
                onClick={() => {
                  edit.setLabelAt(null);
                  notify('Map pin cleared — labels and routing fall back to the footprint centre.', 'info');
                }}
              >
                Clear map pin
              </button>
            )}
            <button
              className="btn"
              aria-label="Dissolve fragment"
              title="This is a nuisance cell of a bigger block — hide it and (optionally) add its area to the parent block yourself"
              onClick={() => {
                if (!window.confirm(`Dissolve “${building.name}” into its parent block? It will disappear from the map and navigation. Reversible (Restore).`)) return;
                edit.patchDraft({ hidden: true, note: 'dissolved fragment of parent block' });
                edit.saveDraft();
                notify('Fragment dissolved. Restore any time via Remove list → Restore.', 'warn');
              }}
            >
              Dissolve fragment
            </button>
            <button
              className="btn"
              aria-label={isHidden ? 'Restore building' : 'Remove building'}
              onClick={() => {
                // This is an immediate action, not a draft-only toggle. The old code used
                // `!building` here, which is always false while a building is selected,
                // so removing a building never worked.
                edit.patchDraft({ hidden: !isHidden });
                edit.saveDraft();
                notify(isHidden ? 'Building restored to the map.' : 'Building removed from the map. Use Restore building or Revert to restore it.', 'info');
              }}
            >
              {isHidden ? 'Restore building' : 'Remove from map'}
            </button>
            {isOverridden && <button className="btn" onClick={() => { edit.revertTarget(); notify('This building was reverted to generated data.', 'info'); }}>Revert this building</button>}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
            Changes preview as you drag. Saving stores them locally; export below produces the file text to commit.
            Nothing is written to a server.
          </p>
        </Section>
      )}

      <Section title="Add a missing building">
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 0 }}>
          Switch to <strong>Map</strong> view, press <strong>Trace a footprint</strong>, then click each corner of the
          building on the imagery. Three or more points to close the shape.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { useUi.getState().setView('map'); useUi.getState().setMode('outdoor'); edit.startTrace(); }}>
            Trace a footprint
          </button>
          {edit.tracing && <Chip tone="accent">{edit.traceRing.length} points</Chip>}
          {edit.tracing && <button className="btn" onClick={edit.undoVertices} disabled={!edit.traceRing.length}>Undo point</button>}
          {edit.tracing && <button className="btn" onClick={edit.cancelTrace}>Cancel</button>}
        </div>
        {edit.addedBuildings.length > 0 && (
          <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
            {edit.addedBuildings.map((b) => (
              <li key={b.properties.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
                <span style={{ fontSize: 12 }}>{b.properties.name} <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>({b.ring.length} pts)</span></span>
                <button className="btn" style={{ minHeight: 26, padding: '2px 8px' }} onClick={() => edit.removeAddedBuilding(b.properties.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ marginTop: 14 }}>
          <div className="label-h" style={{ marginBottom: 6 }}>Place a label (gate, viewpoint, water point…)</div>
          <input value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Label text" style={inputStyle} aria-label="Label text to place" />
          <input value={labelLatLng} onChange={(e) => setLabelLatLng(e.target.value)} placeholder="lat, lng — or right-click the map to fill" style={{ ...inputStyle, marginTop: 6 }} aria-label="Label coordinates" />
          <button
            className="btn"
            style={{ marginTop: 6 }}
            disabled={!labelText.trim() || !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(labelLatLng.trim())}
            onClick={() => {
              const [lat, lng] = labelLatLng.split(',').map((x) => parseFloat(x.trim()));
              edit.addLabel({ id: `label-${Date.now().toString(36)}`, text: labelText.trim(), lat, lng, tier: 'primary', offsetM: 6 });
              setLabelText('');
              setLabelLatLng('');
              notify('Label queued. Export to keep it.', 'info');
            }}
          >
            Add label
          </button>
          {edit.addedLabels.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
              {edit.addedLabels.map((l) => (
                <li key={l.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--hairline)', fontSize: 12 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={l.text}
                      aria-label={`Edit label ${l.id}`}
                      onChange={(e) => edit.updateLabel(l.id, { text: e.target.value })}
                      style={{ ...inputStyle, marginTop: 0, minHeight: 30, flex: 1 }}
                    />
                    <button className="btn" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => { edit.removeLabel(l.id); notify('Manual label removed.', 'info'); }}>Remove</button>
                  </div>
                <span className="mono" style={{ display: 'block', marginTop: 4, fontSize: 10, color: 'var(--text-3)' }}>{l.lat.toFixed(5)}, {l.lng.toFixed(5)} · {l.tier}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Routes — draw new, fix existing">
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 0 }}>
          Fix a generated route that cuts through a building, or draw a path the network is missing.
          In Map view: click = start (green) → waypoints (white) → double-click / Enter = end (red).
          Endpoints snap to the existing network and the route graph rebuilds immediately.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              useUi.getState().setView('map');
              useUi.getState().setMode('outdoor');
              edit.startRoadTrace();
              notify('Click to place the START of the route, then waypoints; double-click or Enter to end it.', 'info');
            }}
          >
            Draw a route
          </button>
          <button
            className="btn"
            disabled={Boolean(edit.roadFixId)}
            onClick={() => {
              useUi.getState().setView('map');
              useUi.getState().setMode('outdoor');
              edit.armRoadPick(true);
              notify('Now click directly on the road line you want to correct.', 'info');
            }}
          >
            Fix an existing road
          </button>
          {summary.manualRoads > 0 && <Chip tone="accent">{summary.manualRoads} new</Chip>}
          {summary.fixedRoads > 0 && <Chip tone="accent">{summary.fixedRoads} fixed</Chip>}
        </div>

        {edit.hiddenRoads.length > 0 && (
          <div style={{ border: '1px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 8, marginBottom: 8, fontSize: 11.5 }}>
            <div className="label-h" style={{ color: 'var(--warn)', marginBottom: 6 }}>Hidden roads — removed from the network</div>
            {edit.hiddenRoads.map((id) => (
              <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 10.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{id}</span>
                <button className="btn" style={{ padding: '2px 10px' }} onClick={() => { edit.restoreRoad(id); notify(`Road ${id} restored to the network.`, 'info'); }}>Restore</button>
              </div>
            ))}
            <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '4px 0 0' }}>
              To replace one: keep it hidden, press <strong>Draw a route</strong> and trace the new line over the imagery — it
              adopts the moment its ends touch the remaining network.
            </p>
          </div>
        )}

        <details style={{ marginBottom: 8 }}>
          <summary style={{ fontSize: 12, cursor: 'pointer', padding: '4px 0' }}>Manage existing roads ({roadsListCount})</summary>
          <input
            value={roadFilter}
            onChange={(e) => setRoadFilter(e.target.value)}
            placeholder="Filter roads by name or id…"
            style={{ width: '100%', minHeight: 34, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: '0 10px', margin: '6px 0' }}
          />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 190, overflow: 'auto' }}>
            {roadCandidates.slice(0, 30).map((r) => (
              <li key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--hairline)' }}>
                <span style={{ fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name ?? r.id} <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>{r.cls}</span>
                </span>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => {
                    useUi.getState().setView('map');
                    useUi.getState().setMode('outdoor');
                    edit.startRoadFix(r.id, r.line);
                    const c = r.line.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
                    requestFlyTo({ lat: c[1] / r.line.length, lng: c[0] / r.line.length, zoom: 17.6 });
                    notify(`Fixing ${r.name ?? r.id} — drag handles to move vertices, arrows move the whole line, Enter saves.`, 'info');
                  }}
                >
                  Fix shape
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => {
                    if (!window.confirm(`Hide “${r.name ?? r.id}” from the network AND the map? Draw a replacement afterwards. (Restorable any time.)`)) return;
                    edit.hideRoad(r.id);
                    notify(`Road hidden. It stays listed here until you Restore it. Draw a route to replace it.`, 'warn');
                  }}
                >
                  Hide
                </button>
              </li>
            ))}
          </ul>
        </details>

        {edit.roadFixId && (
          <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', padding: 8, marginBottom: 8, fontSize: 11.5 }}>
            Editing <span className="mono">{edit.roadFixId}</span> — handles are on the map. Save or cancel from the map toolbar.
          </div>
        )}

        <div style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--r-sm)', padding: 8, marginBottom: 8, fontSize: 11.5 }}>
          <div className="label-h" style={{ marginBottom: 4 }}>Campus alignment vs HD imagery</div>
          <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '0 0 6px', lineHeight: 1.5 }}>
            If rocks, roads and footprints all sit a few metres off the satellite photo (check the Auditorium or a
            round dome), slide the ENTIRE generated campus into place. Hand-drawn content is untouched.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip tone={edit.datum.dxM !== 0 || edit.datum.dyM !== 0 ? 'accent' : 'muted'}>
              shift {edit.datum.dxM.toFixed(1)} m E · {edit.datum.dyM.toFixed(1)} m N
            </Chip>
            {[[-0.3,0,'← 0.3'],[0.3,0,'→ 0.3'],[0,0.3,'↑ 0.3'],[0,-0.3,'↓ 0.3'],[-1,0,'← 1'],[1,0,'→ 1'],[0,1,'↑ 1'],[0,-1,'↓ 1']].map(([dx, dy, label]) => (
              <button key={String(label)} className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }}
                onClick={() => (edit.shiftDatum as (a: number, b: number) => void)(dx as number, dy as number)}>
                {label as string}
              </button>
            ))}
            <button className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }} disabled={edit.datum.dxM === 0 && edit.datum.dyM === 0}
              onClick={() => edit.resetDatum()}>Reset</button>
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '6px 0 0' }}>Nudge, look at the map, repeat — small steps beat one big guess.</p>
        </div>

        {roadIssues.length > 0 && (
          <div style={{ border: '1px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 8, marginBottom: 8 }}>
            <div className="label-h" style={{ color: 'var(--warn)', marginBottom: 6 }}>Not joined to the network — NOT routable yet</div>
            <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '0 0 6px', lineHeight: 1.5 }}>
              Each road below was saved but its ends are too far from an existing road. "Fix now" resumes drawing
              from the failing end — just click along the ground until you touch an existing road, then double-click.
            </p>
            {roadIssues.map((issue) => {
              const road = edit.addedRoads.find((r) => r.id === issue.id);
              const end = issue.end === 'start' ? road?.line[0] : road?.line[road.line.length - 1];
              return (
                <div key={issue.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 11.5, flex: 1 }}>
                    {issue.name ?? issue.id} <span className="mono" style={{ color: 'var(--text-3)' }}>{Number.isFinite(issue.gapM) ? `gap ${issue.gapM.toFixed(0)} m` : 'no road nearby'} · {issue.end} end</span>
                  </span>
                  <button
                    className="btn"
                    disabled={!end}
                    onClick={() => {
                      if (!end) return;
                      useUi.getState().setView('map');
                      useUi.getState().setMode('outdoor');
                      useMap.getState().requestFlyTo({ lat: end[1], lng: end[0], zoom: 17.4, pitch: 0 });
                      edit.startRoadTrace();
                      edit.addRoadVertex([...end] as [number, number]);
                      notify(`Drawing from the ${issue.end} end of ${issue.name ?? issue.id}. Click along the ground to an existing road (amber hint = will join), double-click to finish.`, 'info');
                    }}
                  >
                    Fix now
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {Object.keys(edit.roadEdits).length > 0 && (
          <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0 }}>
            {Object.keys(edit.roadEdits).map((rid) => (
              <li key={rid} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>{data.roads.find((r) => r.id === rid)?.name ?? rid}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{rid} · {edit.roadEdits[rid].length} pts (geometry replaced)</span>
                </span>
                <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    className="btn" style={{ minHeight: 26, padding: '2px 8px' }}
                    onClick={() => {
                      edit.startRoadFix(rid, edit.roadEdits[rid]);
                      useUi.getState().setView('map');
                    }}
                  >
                    Re-edit
                  </button>
                  <button
                    className="btn" style={{ minHeight: 26, padding: '2px 8px' }}
                    onClick={() => { edit.removeRoadFix(rid); notify('Road restored to generated geometry.', 'warn'); }}
                  >
                    Restore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {edit.addedRoads.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {edit.addedRoads.map((r) => (
              <li key={r.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--hairline)' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={r.name ?? ''}
                    placeholder="(unnamed path)"
                    aria-label={`Name for ${r.id}`}
                    onChange={(e) => edit.updateManualRoad(r.id, { name: e.target.value || null })}
                    style={{ ...inputStyle, marginTop: 0, minHeight: 30, flex: 1 }}
                  />
                  <select
                    value={r.cls}
                    aria-label={`Type for ${r.id}`}
                    onChange={(e) => edit.updateManualRoad(r.id, { cls: e.target.value as typeof r.cls })}
                    style={{ ...inputStyle, marginTop: 0, minHeight: 30 }}
                  >
                    {['footway', 'path', 'service', 'residential', 'track', 'steps'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button className="btn" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => { edit.removeManualRoad(r.id); notify('Hand-drawn route removed.', 'warn'); }}>Remove</button>
                </div>
                <div style={{ marginTop: 4 }}>
                  {roadIssues.some((i) => i.id === r.id) ? (
                    <Chip tone="warn">✗ not routable — extend an end onto a road or a door</Chip>
                  ) : (
                    <Chip tone="accent">✓ in navigation{roadJoins[r.id]?.length ? ` (joined at ${roadJoins[r.id].join(' + ')})` : ''}</Chip>
                  )}
                </div>
                <span className="mono" style={{ display: 'block', marginTop: 4, fontSize: 10, color: 'var(--text-3)' }}>
                  {r.id} · {r.line.length} pts · {r.surface}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Teamwork — share & merge sessions">
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 0 }}>
          Each teammate works in their own browser (see <strong>docs/TEAM_WORKFLOW.md</strong> for the 6-role split),
          then sends one session file to the integrator. Importing merges it into your session — Ctrl+Z undoes
          a bad import. Final files are still exported below the normal way.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <Field label="Your name (goes into the file)">
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Aditi" style={inputStyle} aria-label="Session author name" />
          </Field>
          <Field label="Your zone (optional)">
            <input value={zone} onChange={(e) => setZoneSafe(e.target.value)} placeholder="e.g. North campus" style={inputStyle} aria-label="Session zone" />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={!summary.dirty}
            onClick={() => {
              const s = useEdit.getState();
              const text = serialiseSession(
                { saved: s.saved, addedBuildings: s.addedBuildings, addedLabels: s.addedLabels, roadEdits: s.roadEdits, addedRoads: s.addedRoads, hiddenRoads: s.hiddenRoads },
                author,
                zone,
              );
              download(text, `session-${(author.trim() || 'teammate').toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`);
              notify('Session file downloaded. Send it to your integrator (WhatsApp / Drive).', 'info');
            }}
          >
            Export my session
          </button>
          <button className="btn" onClick={() => sessionInput.current?.click()}>
            Import teammate's session
          </button>
          <input
            ref={sessionInput}
            type="file"
            accept="application/json,.json"
            multiple
            style={{ display: 'none' }}
            aria-label="Import session files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (!files.length) return;
              void (async () => {
                for (const f of files) {
                  try {
                    const parsed = SessionFileSchema.safeParse(JSON.parse(await f.text()));
                    if (!parsed.success) {
                      notify(`"${f.name}" is not a valid session file (${parsed.error.issues[0]?.message ?? 'parse error'}).`, 'warn');
                      continue;
                    }
                    const s = useEdit.getState();
                    const result = mergeSession(
                      { saved: s.saved, addedBuildings: s.addedBuildings, addedLabels: s.addedLabels, roadEdits: s.roadEdits, addedRoads: s.addedRoads, hiddenRoads: s.hiddenRoads },
                      {
                        saved: parsed.data.saved,
                        addedBuildings: parsed.data.addedBuildings,
                        addedLabels: parsed.data.addedLabels,
                        roadEdits: parsed.data.roadEdits,
                        addedRoads: parsed.data.addedRoads,
                        hiddenRoads: parsed.data.hiddenRoads ?? [],
                        datum: parsed.data.datum ?? { dxM: 0, dyM: 0 },
                      },
                    );
                    s.importMerged(result.merged);
                    const a = result.applied;
                    const parts = [
                      a.buildings ? `${a.buildings} building edits` : null,
                      a.addedBuildings ? `${a.addedBuildings} new buildings` : null,
                      a.labels ? `${a.labels} labels` : null,
                      a.roads ? `${a.roads} new routes` : null,
                      a.roadFixes ? `${a.roadFixes} road fixes` : null,
                    ].filter(Boolean);
                    notify(
                      `Merged ${parsed.data.author}${parsed.data.zone ? ` (${parsed.data.zone})` : ''}: ${parts.length ? parts.join(', ') : 'nothing new'}${result.conflicts.length ? `. ${result.conflicts.length} conflict(s) kept yours: ${result.conflicts.slice(0, 2).join('; ')}${result.conflicts.length > 2 ? '…' : ''}` : ''}`,
                      result.conflicts.length ? 'warn' : 'info',
                    );
                  } catch (err) {
                    notify(`Could not read "${f.name}": ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
                  }
                }
                if (sessionInput.current) sessionInput.current.value = '';
              })();
            }}
          />
        </div>
      </Section>

      <Section title="History — undo / redo">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={!summary.canUndo} onClick={() => { edit.undo(); notify('Undone.', 'info'); }}>
            Ctrl+Z Undo ({edit.past.length})
          </button>
          <button className="btn" disabled={!summary.canRedo} onClick={() => { edit.redo(); notify('Redone.', 'info'); }}>
            Redo ({edit.future.length})
          </button>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '6px 0 0' }}>
          Every saved action is one undo step (building edits, removes, labels, route draws/fixes, reshapes).
        </p>
      </Section>

      <Section title="Export — commit these files">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!summary.overrides} onClick={() => copy(exportFiles(edit).overrides, 'overrides.json')}>
            Copy overrides.json
          </button>
          <button className="btn" disabled={!summary.addedBuildings} onClick={() => copy(exportFiles(edit).buildingsGeoJson, 'buildings.geojson')}>
            Copy buildings.geojson
          </button>
          <button className="btn" disabled={!summary.labels} onClick={() => copy(exportFiles(edit).labels, 'labels.json')}>
            Copy labels.json
          </button>
          <button className="btn" disabled={!summary.fixedRoads} onClick={() => copy(exportFiles(edit).roadFixes, 'road_fixes.json')}>
            Copy road_fixes.json
          </button>
          <button className="btn" disabled={!summary.manualRoads} onClick={() => copy(exportFiles(edit).roadsManual, 'roads_manual.json')}>
            Copy roads_manual.json
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn" disabled={!summary.overrides} onClick={() => download(exportFiles(edit).overrides, 'overrides.json')}>Download overrides.json</button>
          <button className="btn" disabled={!summary.addedBuildings} onClick={() => download(exportFiles(edit).buildingsGeoJson, 'buildings.geojson')}>Download buildings.geojson</button>
          <button className="btn" disabled={!summary.labels} onClick={() => download(exportFiles(edit).labels, 'labels.json')}>Download labels.json</button>
          <button className="btn" disabled={!summary.fixedRoads} onClick={() => download(exportFiles(edit).roadFixes, 'road_fixes.json')}>Download road_fixes.json</button>
          <button className="btn" disabled={!summary.manualRoads} onClick={() => download(exportFiles(edit).roadsManual, 'roads_manual.json')}>Download roads_manual.json</button>
        </div>
        <pre className="mono" style={{ marginTop: 10, padding: 8, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', fontSize: 10, maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {summary.dirty
            ? `public/data/manual/overrides.json\npublic/data/manual/buildings.geojson\npublic/data/manual/labels.json\npublic/data/manual/road_fixes.json\npublic/data/manual/roads_manual.json\n\n“reload the page after pasting — the data layer merges these files on boot”`
            : 'No edits yet. Pick a building above to start.'}
        </pre>
        <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => { edit.resetAll(); notify('All local edits cleared.', 'warn'); }}>
          Clear all local edits
        </button>
      </Section>

      <Section title="Consistency guarantee">
        <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
          Exports use the project’s own serialisers, so a manual label is byte-identical in shape to a generated
          one — same style, font and size on the map. When you paste them into <code>public/data/manual/</code> and
          reload, the manual layer is merged on top of the generated data and reported in About → Data honesty.
        </p>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8 }}>
          serialisers: {serialiseOverrides.name}, {serialiseManualBuildings.name}
        </div>
      </Section>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 36,
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface-2)',
  border: '1px solid var(--hairline)',
  padding: '0 10px',
  fontSize: 12.5,
  marginTop: 3,
};
const rangeStyle: React.CSSProperties = { width: '100%', accentColor: 'var(--accent)', marginTop: 4 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      {children}
    </div>
  );
}
