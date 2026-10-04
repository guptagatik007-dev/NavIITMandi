/**
 * IndoorShell.tsx — the floor-navigation workspace.
 *
 * A real plan is the source of truth. The browser accepts an image, SVG, PDF underlay,
 * or an indoor-contract JSON file, associates it with one campus building and floor,
 * then lets the user place labels and connect navigation points by hand. No rooms or
 * corridors are guessed from pixels. Local work is persisted in localStorage and can
 * later be exported as public/data/indoor/<buildingId>/building.json.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCampus } from '@/app/CampusContext';
import {
  getAttempted,
  indoorStatusLine,
  routeOnFloor,
  useIndoor,
  type IndoorBuilding,
  type IndoorFloor,
  type IndoorFloorConnection,
  type IndoorFloorLabel,
  type IndoorLabelKind,
} from '@/store/indoorStore';
import { useUi } from '@/store/uiStore';
import { useOutdoor } from '@/store/outdoorStore';
import { useMap } from '@/store/mapStore';
import { deletePlanImage, idbAvailable, loadPlanImage, savePlanImage } from './indoorImagesDb';
import { buildFloorBundle, installFloorBundle, FloorBundleSchema } from './floorBundle';
import { Chip, EmptyState, LinkRow, ProgressStages, Section } from '@/ui/primitives';
import { featureFlags } from '@/config/featureFlags';
import { IconIndoor } from '@/ui/Icons';

const LABEL_KINDS: IndoorLabelKind[] = ['room', 'door', 'stairs', 'lift', 'exit', 'waypoint'];
const CONNECTION_KINDS: IndoorFloorConnection['kind'][] = ['walk', 'stairs', 'lift', 'ramp'];
const FLOOR_ID_RE = /[^a-z0-9_-]+/gi;

export function IndoorShell() {
  const { data } = useCampus();
  const loadManifest = useIndoor((s) => s.loadManifest);
  const loadFor = useIndoor((s) => s.loadFor);
  const loadState = useIndoor((s) => s.loadState);
  const buildings = useIndoor((s) => s.buildings);
  const selectedBuildingId = useIndoor((s) => s.selectedBuildingId);
  const setSelectedBuilding = useIndoor((s) => s.setSelectedBuilding);
  const selectedFloorId = useIndoor((s) => s.selectedFloorId);
  const setSelectedFloor = useIndoor((s) => s.setSelectedFloor);
  const attempted = useIndoor((s) => s.attempted);
  const status = useIndoor(indoorStatusLine);
  const setMode = useUi((s) => s.setMode);
  const selectOutdoor = useOutdoor((s) => s.selectBuilding);
  const requestFlyTo = useMap((s) => s.requestFlyTo);
  const notify = useUi((s) => s.notify);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  const candidates = useMemo(
    () => data.buildings
      .filter((b) => b.scope === 'campus' && b.named)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [data.buildings],
  );

  // Building-name propagation: a renamed outdoor building (editor override or a
  // merged teammate session) renames every local indoor copy + all its floors'
  // listings and future exports. Runs silently whenever campus names change.
  useEffect(() => {
    const names = new Map(candidates.map((b) => [b.id, b.name]));
    useIndoor.getState().syncBuildingNames(names);
  }, [candidates]);
  const selectedOutdoor = candidates.find((b) => b.id === selectedBuildingId) ?? null;
  const selectedIndoor = buildings.find((b) => b.id === selectedBuildingId) ?? null;
  const selectedFloor = selectedIndoor?.floors.find((f) => f.id === selectedFloorId) ?? null;

  const pickBuilding = (id: string) => {
    setSelectedBuilding(id);
    selectOutdoor(id);
    void loadFor(id);
    const b = candidates.find((x) => x.id === id);
    if (b) {
      const c = b.ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
      requestFlyTo({ lat: c[1] / b.ring.length, lng: c[0] / b.ring.length, zoom: 17.6, pitch: 55 });
    }
  };

  if (!featureFlags.indoor) {
    return <EmptyState art="grid" title="Indoor navigation is switched off" body="The feature flag featureFlags.indoor is false in this build." />;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="chip" style={{ cursor: 'pointer' }} onClick={() => setMode('outdoor')}>Campus</button>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <span className="chip" style={{ color: selectedOutdoor ? 'var(--accent)' : undefined, borderColor: selectedOutdoor ? 'currentcolor' : undefined }}>
          {selectedOutdoor ? selectedOutdoor.name : 'Building'}
        </span>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <span className="chip" style={{ color: selectedFloor ? 'var(--accent)' : undefined, borderColor: selectedFloor ? 'currentcolor' : undefined }}>
          {selectedFloor ? selectedFloor.label : 'Floor'}
        </span>
        <span style={{ marginLeft: 'auto' }}><Chip tone={selectedIndoor?.floors.length ? 'accent' : 'warn'}>{selectedIndoor?.floors.length ? 'floor workspace' : 'upload a real plan'}</Chip></span>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--hairline)', overflowX: 'auto', alignItems: 'center' }}>
        <span className="label-h" style={{ flex: '0 0 auto' }}>Floor</span>
        {selectedIndoor?.floors.map((floor) => (
          <button
            key={floor.id}
            className="chip"
            aria-pressed={selectedFloorId === floor.id}
            onClick={() => setSelectedFloor(floor.id)}
            style={{ minWidth: 38, justifyContent: 'center', cursor: 'pointer', background: selectedFloorId === floor.id ? 'var(--accent)' : undefined, color: selectedFloorId === floor.id ? 'var(--accent-ink)' : undefined }}
          >
            {floor.label}
          </button>
        ))}
        {!selectedIndoor?.floors.length && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No floor plans yet — choose a building, then upload one below.</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', flex: 1, minHeight: 0 }}>
        <div style={{ borderRight: '1px solid var(--hairline)', overflow: 'auto' }}>
          <Section title={`Campus buildings (${candidates.length})`}>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 8px', lineHeight: 1.55 }}>{status}</p>
            {loadState === 'loading' && <ProgressStages stage="Looking for floor data…" />}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {candidates.map((b) => {
                const plan = buildings.find((x) => x.id === b.id);
                const state = getAttempted(useIndoor.getState(), b.id) ?? attempted[b.id];
                return (
                  <li key={b.id}>
                    <button
                      onClick={() => pickBuilding(b.id)}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', background: selectedBuildingId === b.id ? 'var(--surface-3)' : 'transparent', border: 0, borderBottom: '1px solid var(--hairline)', padding: '9px 4px', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{plan?.floors.length ?? 0} uploaded · {b.floors} outdoor floors</span>
                      </span>
                      <Chip tone={plan?.floors.length ? 'accent' : state === 'error' ? 'danger' : 'muted'}>
                        {plan?.floors.length ? 'mapped' : state === 'error' ? 'error' : 'upload'}
                      </Chip>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
          <Section title="No guessing policy">
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
              A plan image is only an underlay. Rooms, doors, stairs, lifts and routes appear
              after you place and connect them manually. The app never converts a blank space
              into invented indoor geometry.
            </p>
          </Section>
        </div>

        <div style={{ position: 'relative', minHeight: 0, overflow: 'auto', padding: 16 }}>
          {selectedOutdoor ? (
            <>
              <UploadFloorCard building={selectedOutdoor} existing={selectedIndoor} notify={notify} />
              {selectedFloor ? (
                <FloorMapEditor buildingId={selectedOutdoor.id} buildingName={selectedOutdoor.name} origin={centroidOrigin(selectedOutdoor.ring)} floor={selectedFloor} notify={notify} />
              ) : (
                <div className="glass" style={{ marginTop: 14, padding: 20, borderRadius: 'var(--r-md)' }}>
                  <FloorPlanArt />
                  <h2 style={{ fontSize: 17, margin: '12px 0 8px', display: 'flex', gap: 8, alignItems: 'center' }}><IconIndoor /> Ready for a floor plan</h2>
                  <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>
                    Upload a PNG, JPG, SVG or PDF floor drawing for <strong>{selectedOutdoor.name}</strong> above.
                    Then place room/door/stair labels and connect them to make a real indoor navigation route.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div style={{ maxWidth: 560, margin: '30px auto' }}>
              <FloorPlanArt />
              <h2 style={{ fontSize: 18, margin: '14px 0 8px', display: 'flex', gap: 8, alignItems: 'center' }}><IconIndoor /> Floor navigation workspace</h2>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)' }}>
                Pick the particular campus building on the left. Upload its actual digital floor footprint,
                label rooms and access points manually, connect the walking graph, and then test navigation
                on that floor. No indoor placeholder map is shown until a real plan is supplied.
              </p>
              <div className="glass" style={{ padding: 14, borderRadius: 'var(--r-md)' }}>
                <div className="label-h" style={{ marginBottom: 8 }}>Workflow</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9, color: 'var(--text-2)' }}>
                  <li>Choose a building.</li>
                  <li>Upload its floor drawing or a contract JSON file.</li>
                  <li>Place labels for rooms, doors, stairs, lifts and exits.</li>
                  <li>Connect points manually, then run the floor route.</li>
                </ol>
              </div>
              <LinkRow href="docs/INDOOR_CONTRACT.md" label="Open the indoor data contract" hint="Use this when you are ready to commit the local floor map into the project." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadFloorCard({
  building,
  existing,
  notify,
}: {
  building: { id: string; name: string; ring: [number, number][] };
  existing: IndoorBuilding | null;
  notify: (message: string, kind?: 'info' | 'warn' | 'error') => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upsertLocalFloor = useIndoor((s) => s.upsertLocalFloor);
  const [floorLabel, setFloorLabel] = useState('G');
  const [elevationM, setElevationM] = useState('0');
  const [heightM, setHeightM] = useState('3.6');
  const [scaleMPerPixel, setScaleMPerPixel] = useState('0.05');
  const [busy, setBusy] = useState(false);

  const upload = async (fileList: File[]) => {
    if (!fileList.length) return;
    setBusy(true);
    try {
      const file = fileList[0];
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        const text = await file.text();
        const rawJson = JSON.parse(text) as Record<string, unknown>;
        // teammate floor bundle (with images): per-floor gap-filling merge
        if (rawJson.app === 'iitmandi-nav-floor-bundle') {
          const parsed = FloorBundleSchema.safeParse(rawJson);
          if (!parsed.success) throw new Error(`Floor bundle did not validate: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
          if (parsed.data.buildingId !== building.id) {
            throw new Error(`That bundle belongs to "${parsed.data.buildingName}" (${parsed.data.buildingId}) — open this building's Indoor page before importing, or import it there.`);
          }
          const installed = await installFloorBundle(parsed.data);
          const res = useIndoor.getState().mergeExternalFloors(
            { id: building.id, name: building.name, origin: centroidOrigin(building.ring) },
            installed.floors,
          );
          notify(
            `Floor bundle from ${parsed.data.author}: ${res.adopted.length ? `adopted floor(s) ${res.adopted.join(', ')}` : ''}${res.merged.length ? ` · merged into floor(s) ${res.merged.join(', ')}` : ''}${res.conflicts.length ? ` · ${res.conflicts.join('; ')}` : ''}. Images stored: ${installed.storedImages}${installed.legacyImages ? ` (+${installed.legacyImages} inline fallback)` : ''}.`,
            res.conflicts.length ? 'warn' : 'info',
          );
          return;
        }
        const parsed = rawJson as Partial<IndoorBuilding>;
        if (!Array.isArray(parsed.floors) || !parsed.floors.length) throw new Error('JSON must contain a non-empty floors array.');
        const origin = parsed.origin ?? centroidOrigin(building.ring);
        for (const raw of parsed.floors) {
          const floor = normaliseImportedFloor(raw, file.name);
          const stored = upsertLocalFloor({ id: building.id, name: building.name, origin }, floor);
          if (!stored) notify('The floor was loaded for this session, but browser storage is full. Export it before closing the tab.', 'warn');
        }
        notify(`${parsed.floors.length} floor plan(s) imported for ${building.name}.`, 'info');
        return;
      }
      for (const f of fileList) {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf'].includes(f.type) && !/\.(png|jpe?g|webp|svg|pdf)$/i.test(f.name)) {
          throw new Error('Use PNG, JPG, WEBP, SVG, PDF, or the indoor contract JSON format.');
        }
      }
      // v1.8: bulk upload. Every image lands in IndexedDB (its blob would blow the
      // localStorage quota past one plan); localStorage keeps only thumbnails-size
      // metadata. If IndexedDB is unavailable (private mode), fall back to the
      // legacy single data-URL underlay with a clear warning.
      const files = fileList;
      const idPart = floorLabel.trim().toLowerCase().replace(FLOOR_ID_RE, '-').replace(/^-|-$/g, '') || 'floor';
      const previous = existing?.floors.find((f) => f.label.trim().toLowerCase() === floorLabel.trim().toLowerCase());
      const floorId = previous?.id ?? `${idPart}-${Date.now().toString(36)}`;
      const baseFloor: IndoorFloor = {
        id: floorId,
        label: floorLabel.trim() || 'G',
        elevationM: Number(elevationM) || 0,
        heightM: Math.max(2, Number(heightM) || 3.6),
        planImageDataUrl: previous?.planImageDataUrl,
        planMime: previous?.planMime,
        planSourceName: previous?.planSourceName,
        planWidth: previous?.planWidth,
        planHeight: previous?.planHeight,
        scaleMPerPixel: previous?.scaleMPerPixel ?? Math.max(0.001, Number(scaleMPerPixel) || 0.05),
        planImages: [...(previous?.planImages ?? [])],
        activePlanImageId: previous?.activePlanImageId,
        rooms: previous?.rooms ?? [],
        labels: previous?.labels ?? [],
        connections: previous?.connections ?? [],
      };

      const canIdb = await idbAvailable();
      let idbCount = 0;
      let legacyUsed = false;
      for (const file of files) {
        if (canIdb) {
          let w: number | undefined;
          let h: number | undefined;
          if (file.type !== 'application/pdf') {
            try {
              const dims = await planDimensions(await readAsDataUrl(file), file.type);
              w = dims.width;
              h = dims.height;
            } catch {
              /* dims unknown: editor falls back to the default aspect */
            }
          }
          const imgId = `img-${Date.now().toString(36)}-${Math.floor(idbCount + files.indexOf(file)).toString(36)}`;
          const key = `${building.id}/${floorId}/${imgId}`;
          const saved = await savePlanImage(key, file);
          if (saved) {
            baseFloor.planImages = [...(baseFloor.planImages ?? []), { id: imgId, key, name: file.name, mime: file.type || guessMime(file.name), width: w, height: h }];
            baseFloor.activePlanImageId = imgId;
            if (idbCount === 0 && w && h) {
              baseFloor.planWidth = w;
              baseFloor.planHeight = h;
            }
            idbCount++;
            continue;
          }
        }
        // fallback path (IDB missing or put failed): first image as legacy data URL
        if (!legacyUsed) {
          const dataUrl = await readAsDataUrl(file);
          const dimensions = await planDimensions(dataUrl, file.type);
          baseFloor.planImageDataUrl = dataUrl;
          baseFloor.planMime = file.type || guessMime(file.name);
          baseFloor.planSourceName = file.name;
          baseFloor.planWidth = dimensions.width;
          baseFloor.planHeight = dimensions.height;
          legacyUsed = true;
        }
      }

      const floor = baseFloor;
      const stored = upsertLocalFloor({ id: building.id, name: building.name, origin: centroidOrigin(building.ring) }, floor);
      if (idbCount > 0) {
        notify(
          `${idbCount} plan image${idbCount === 1 ? '' : 's'} stored in the browser database (IndexedDB) for floor ${floor.label}.${legacyUsed ? ' One image fell back to in-memory storage.' : ''}`,
          'info',
        );
      } else {
        notify(stored ? `Floor ${floor.label} uploaded and mapped to ${building.name}.` : 'Floor uploaded for this session, but browser storage is full. Export it before closing the tab.', stored ? 'info' : 'warn');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read that floor file.', 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Section title={`Upload floor map · ${building.name}`}>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 0 }}>
        Upload the actual digital floor footprint. It becomes an underlay for manual room labels
        and a manually connected navigation graph; it is not silently vectorised from guesses.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Floor label"><input value={floorLabel} onChange={(e) => setFloorLabel(e.target.value)} aria-label="Floor label" style={inputStyle} /></Field>
        <Field label="Elevation (m)"><input type="number" value={elevationM} onChange={(e) => setElevationM(e.target.value)} aria-label="Floor elevation" style={inputStyle} /></Field>
        <Field label="Floor height (m)"><input type="number" min={2} step={0.1} value={heightM} onChange={(e) => setHeightM(e.target.value)} aria-label="Floor height" style={inputStyle} /></Field>
        <Field label="Scale (m / pixel)"><input type="number" min={0.001} step={0.001} value={scaleMPerPixel} onChange={(e) => setScaleMPerPixel(e.target.value)} aria-label="Floor scale" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.json" aria-label="Upload digital floor footprint" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void upload(files); }} style={{ display: 'none' }} />
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy} aria-label="Upload digital floor footprint">{busy ? 'Reading plan…' : 'Upload digital floor footprint'}</button>
        <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>PNG · JPG · WEBP · SVG · PDF · indoor JSON</span>
      </div>
    </Section>
  );
}

function FloorMapEditor({ buildingId, buildingName, origin, floor, notify }: { buildingId: string; buildingName: string; origin: { lat: number; lng: number; rotationDeg: number }; floor: IndoorFloor; notify: (message: string, kind?: 'info' | 'warn' | 'error') => void }) {
  const addFloorLabel = useIndoor((s) => s.addFloorLabel);
  const updateFloorLabel = useIndoor((s) => s.updateFloorLabel);
  const removeFloorLabel = useIndoor((s) => s.removeFloorLabel);
  const removeLocalFloor = useIndoor((s) => s.removeLocalFloor);
  const addFloorConnection = useIndoor((s) => s.addFloorConnection);
  const removeFloorConnection = useIndoor((s) => s.removeFloorConnection);
  const addFloorCorridor = useIndoor((s) => s.addFloorCorridor);
  const removeFloorCorridor = useIndoor((s) => s.removeFloorCorridor);
  const route = useIndoor((s) => s.route);
  const setRoute = useIndoor((s) => s.setRoute);
  const clearRoute = useIndoor((s) => s.clearRoute);
  const [labelPoint, setLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState('');
  const [labelKind, setLabelKind] = useState<IndoorLabelKind>('room');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [edgeKind, setEdgeKind] = useState<IndoorFloorConnection['kind']>('walk');
  const [edgeAccessible, setEdgeAccessible] = useState(true);
  const [routeFrom, setRouteFrom] = useState('');
  const [routeTo, setRouteTo] = useState('');
  /** corridor ("floor road") drawing mode: draft = points clicked so far */
  const [corridorMode, setCorridorMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const labels = floor.labels ?? [];
  const connections = floor.connections ?? [];
  const corridors = floor.corridors ?? [];
  const routeForThisFloor = route.path && route.path.length > 1 && route.path.every((node) => node.floorId === floor.id) ? route.path : null;
  const removePlanImage = useIndoor((s) => s.removePlanImage);
  const setActivePlanImage = useIndoor((s) => s.setActivePlanImage);

  // ── plan gallery (IndexedDB-backed): legacy single data-URL + gallery images ──
  const gallery = useMemo(() => {
    const items: { id: string; name: string; mime: string; key?: string; legacyUrl?: string; width?: number; height?: number }[] = [];
    if (floor.planImageDataUrl) {
      items.push({ id: 'legacy', name: floor.planSourceName ?? 'plan', mime: floor.planMime ?? 'image/png', legacyUrl: floor.planImageDataUrl, width: floor.planWidth, height: floor.planHeight });
    }
    (floor.planImages ?? []).forEach((img) => items.push(img));
    return items;
  }, [floor.planImageDataUrl, floor.planSourceName, floor.planMime, floor.planWidth, floor.planHeight, floor.planImages]);

  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const item of gallery) {
        if (item.legacyUrl || !item.key) continue;
        if (urlsRef.current[item.id]) continue;
        const blob = await loadPlanImage(item.key);
        if (blob && alive) {
          const url = URL.createObjectURL(blob);
          setUrls((u) => (u[item.id] ? u : { ...u, [item.id]: url }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [gallery]);
  useEffect(() => {
    // revoke object URLs only when this editor unmounts for good
    return () => {
      Object.values(urlsRef.current).forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* already freed */
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeId = floor.activePlanImageId ?? gallery[0]?.id;
  const active = gallery.find((g) => g.id === activeId) ?? gallery[0];
  const activeUrl = active?.legacyUrl ?? (active ? urls[active.id] : undefined);
  const aspectW = active?.width ?? floor.planWidth ?? 1200;
  const aspectH = active?.height ?? floor.planHeight ?? 800;

  // ── zoom / pan / fit viewport ─────────────────────────────────────────────
  const outerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const s = Math.min(8, Math.max(0.5, v.s * factor));
        const wx = (cx - v.x) / v.s;
        const wy = (cy - v.y) / v.s;
        return { s, x: cx - wx * s, y: cy - wy * s };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) =>
    setView((v) => {
      const el = outerRef.current;
      const cx = el ? el.clientWidth / 2 : 0;
      const cy = el ? el.clientHeight / 2 : 0;
      const s = Math.min(8, Math.max(0.5, v.s * factor));
      const wx = (cx - v.x) / v.s;
      const wy = (cy - v.y) / v.s;
      return { s, x: cx - wx * s, y: cy - wy * s };
    });

  useEffect(() => {
    if (labels.length && !fromId) setFromId(labels[0].id);
    if (labels.length > 1 && !toId) setToId(labels[1].id);
    if (labels.length && !routeFrom) setRouteFrom(labels[0].id);
    if (labels.length > 1 && !routeTo) setRouteTo(labels[1].id);
  }, [floor.id, labels, fromId, toId, routeFrom, routeTo]);

  const handlePlanClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button,input,select')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const p = { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
    if (corridorMode) {
      // snapping to an existing corridor vertex = how branches JOIN the main path
      let sx = p.x;
      let sy = p.y;
      let best = 0.03; // generous in plan units — a corridor width
      for (const c of corridors) {
        for (const q of c.points) {
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < best) {
            best = d;
            sx = q.x;
            sy = q.y;
          }
        }
      }
      const snapped = { x: sx, y: sy };
      const last = draft[draft.length - 1];
      if (last && Math.hypot(last.x - snapped.x, last.y - snapped.y) < 1e-4) return;
      setDraft([...draft, snapped]);
      return;
    }
    setLabelPoint(p);
  };

  const finishCorridor = () => {
    if (draft.length < 2) {
      notify('Draw at least two points before finishing a corridor path.', 'warn');
      return;
    }
    addFloorCorridor(buildingId, floor.id, { id: `corridor-${Date.now().toString(36)}`, points: draft });
    setDraft([]);
    notify('Corridor path saved — routing now sticks to these walkable lines. Place room labels and "Find floor route" will attach them to the path.', 'info');
  };

  const cancelCorridor = () => {
    setDraft([]);
    setCorridorMode(false);
  };

  const saveLabel = () => {
    if (!labelPoint || !labelText.trim()) return;
    addFloorLabel(buildingId, floor.id, { id: `floor-label-${Date.now().toString(36)}`, text: labelText.trim(), x: labelPoint.x, y: labelPoint.y, kind: labelKind, accessible: labelKind !== 'stairs' });
    setLabelPoint(null);
    setLabelText('');
    notify('Floor label saved locally.', 'info');
  };

  const connect = () => {
    if (!fromId || !toId || fromId === toId) return;
    addFloorConnection(buildingId, floor.id, { id: `floor-edge-${Date.now().toString(36)}`, from: fromId, to: toId, kind: edgeKind, accessible: edgeKind === 'stairs' ? false : edgeAccessible });
    notify('Floor navigation connection saved.', 'info');
  };

  const findRoute = () => {
    if (!routeFrom || !routeTo || routeFrom === routeTo) return;
    const path = routeOnFloor(floor, routeFrom, routeTo);
    setRoute(routeFrom, routeTo, path);
    notify(
      path
        ? `Indoor route found — the red line follows ${corridors.length ? 'your hand-drawn corridor lines exactly (walls respected)' : 'your manually connected points'}.`
        : corridors.length
          ? 'No path along the drawn corridors — check that the corridor paths touch near these rooms (vertices must meet to join).'
          : 'No indoor route exists yet — draw corridor paths ("Draw corridor path") or add manual connections first.',
      path ? 'info' : 'warn',
    );
  };

  return (
    <Section title={`Digital floor map · ${floor.label}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <Chip tone="accent">{labels.length} labels</Chip>
        <Chip tone={corridors.length ? 'accent' : 'warn'}>{corridors.length} corridor paths</Chip>
        <Chip tone={connections.length ? 'accent' : 'warn'}>{connections.length} connections</Chip>
        <button
          className="btn"
          aria-pressed={corridorMode}
          style={corridorMode ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          title="Draw the walkable roads of this floor: click along corridors (click near an existing vertex to join a branch), double-click or Finish to save. Navigation then sticks to these lines and cannot cut through walls."
          onClick={() => {
            if (corridorMode && draft.length) {
              notify(`Finish the ${draft.length}-point corridor first (double-click or Finish), or Cancel drawing.`, 'warn');
              return;
            }
            setCorridorMode(!corridorMode);
            setDraft([]);
            setLabelPoint(null);
          }}
        >
          {corridorMode ? '✏️ Drawing corridor…' : 'Draw corridor path'}
        </button>
        {corridorMode && draft.length > 0 && (
          <>
            <span className="glass mono" style={{ fontSize: 10, padding: '3px 8px', borderRadius: 'var(--r-pill)' }}>{draft.length} pts</span>
            <button className="btn btn-primary" onClick={finishCorridor}>Finish path</button>
            <button className="btn" onClick={cancelCorridor}>Cancel</button>
            <button
              className="btn"
              title="Remove the last clicked point"
              onClick={() => setDraft(draft.slice(0, -1))}
            >
              Undo point
            </button>
          </>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 1 }}>{active?.name ?? floor.planSourceName ?? 'uploaded plan'} · {gallery.length} image{gallery.length === 1 ? '' : 's'} in gallery</span>
        <button className="btn" onClick={() => downloadJson(`${buildingId}-${floor.id}.json`, { id: buildingId, name: buildingName, origin, scaleMPerUnit: 1, floors: [floor], graph: { nodes: [], edges: [] }, source: `Exported from the IIT Mandi floor workspace; underlay: ${floor.planSourceName ?? 'uploaded plan'}` })}>Export floor JSON</button>
        <button
          className="btn"
          title="Share this floor WITH its plan images to a teammate (per-floor sub-assignments merge label-by-label)"
          onClick={() => {
            void (async () => {
              const author = (() => { try { return localStorage.getItem('iitm-team-author') ?? ''; } catch { return ''; } })();
              const buildingPick = { id: buildingId, name: buildingName, origin };
              const { text, embeddedImages, skippedImages } = await buildFloorBundle(buildingPick, [floor], author);
              const blob = new Blob([text], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `floor-bundle-${buildingId}-${floor.label}-${(author.trim() || 'teammate').toLowerCase().replace(/\s+/g, '-')}.json`;
              a.click();
              URL.revokeObjectURL(url);
              notify(
                `Floor ${floor.label} bundle exported with ${embeddedImages} embedded image${embeddedImages === 1 ? '' : 's'}${skippedImages.length ? ` (${skippedImages.length} image(s) were missing from local storage and skipped: ${skippedImages.join(', ')})` : ''}. Send it to your integrator.`,
                skippedImages.length ? 'warn' : 'info',
              );
            })();
          }}
        >
          Export floor bundle (with images)
        </button>
        <button className="btn" onClick={() => { removeLocalFloor(buildingId, floor.id); clearRoute(); notify(`Floor ${floor.label} removed from this browser.`, 'warn'); }}>Remove uploaded floor</button>
      </div>
      <div
        ref={outerRef}
        className="floor-map-editor"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: view.x, baseY: view.y, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
          if (d.moved) setView((v) => ({ ...v, x: d.baseX + dx, y: d.baseY + dy }));
        }}
        onPointerUp={() => {
          if (dragRef.current?.moved) suppressClick.current = true;
          dragRef.current = null;
        }}
        style={{ position: 'relative', width: '100%', maxWidth: 920, aspectRatio: `${aspectW} / ${aspectH}`, minHeight: 300, overflow: 'hidden', borderRadius: 'var(--r-md)', border: '1px solid var(--hairline-strong)', background: 'var(--surface-2)', cursor: 'crosshair', touchAction: 'none' }}
      >
        {/* transformed canvas: click coords stay normalised via the inner rect */}
        <div
          onClick={(e) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            handlePlanClick(e);
          }}
          onDoubleClick={(e) => {
            if (corridorMode) {
              e.preventDefault();
              finishCorridor();
            }
          }}
          style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        >
          {activeUrl && active?.mime === 'application/pdf' ? (
            <object data={activeUrl} type="application/pdf" aria-label={`Floor plan ${floor.label}`} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
          ) : activeUrl ? (
            <img src={activeUrl} alt={`Uploaded floor plan ${floor.label}`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} draggable={false} />
          ) : floor.planSvg ? (
            <img src={floor.planSvg} alt={`Committed floor plan ${floor.label}`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} draggable={false} />
          ) : gallery.length > 0 ? (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>Loading plan from the browser database…</div>
          ) : (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>No plan underlay — labels are still stored in normalized coordinates.</div>
          )}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {connections.map((edge) => {
              const a = labels.find((l) => l.id === edge.from); const b = labels.find((l) => l.id === edge.to);
              return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edge.accessible ? '#2dd4bf' : '#ffb454'} strokeOpacity="0.45" strokeWidth="0.004" strokeDasharray={edge.kind === 'walk' ? undefined : '0.018 0.012'} /> : null;
            })}
            {/* hand-drawn walkable corridors — the ONLY lines routing may travel */}
            {corridors.map((c) => (
              <g key={c.id}>
                <polyline points={c.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2dd4bf" strokeWidth="0.010" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.85" />
                {c.points.map((p, i) => (
                  <rect key={i} x={p.x - 0.004} y={p.y - 0.004} width="0.008" height="0.008" fill="#0d3b35" stroke="#2dd4bf" strokeWidth="0.002" />
                ))}
              </g>
            ))}
            {draft.length > 0 && (
              <g>
                <polyline points={draft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffb454" strokeWidth="0.010" strokeDasharray="0.012 0.010" strokeLinecap="round" />
                {draft.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="0.006" fill="#ffb454" />
                ))}
              </g>
            )}
            {routeForThisFloor && <polyline points={routeForThisFloor.map((node) => `${node.x},${node.y}`).join(' ')} fill="none" stroke="#1a73e8" strokeWidth="0.012" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          {labels.map((label) => (
            <div key={label.id} className="floor-label" style={{ position: 'absolute', left: `${label.x * 100}%`, top: `${label.y * 100}%`, transform: 'translate(-50%, -50%) scale(1)', padding: '3px 6px', borderRadius: 'var(--r-pill)', background: label.kind === 'room' ? 'rgba(6,14,12,.86)' : 'rgba(65,23,30,.9)', border: `1px solid ${label.kind === 'stairs' ? '#ffb454' : '#1a73e8'}`, color: '#fff', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'auto' }}>
              {label.text}
            </div>
          ))}
          {labelPoint && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: `${labelPoint.x * 100}%`, top: `${labelPoint.y * 100}%`, transform: 'translate(-50%, 10px)', zIndex: 3, width: 210, padding: 9, borderRadius: 'var(--r-md)', background: 'var(--surface-1)', border: '1px solid var(--hairline-strong)', boxShadow: 'var(--shadow)' }}>
              <div className="label-h">New floor label</div>
              <input autoFocus value={labelText} onChange={(e) => setLabelText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); }} placeholder="Room 101 / Main door" aria-label="New floor label" style={inputStyle} />
              <select value={labelKind} onChange={(e) => setLabelKind(e.target.value as IndoorLabelKind)} aria-label="Floor label kind" style={{ ...inputStyle, marginTop: 6 }}>
                {LABEL_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}><button className="btn btn-primary" onClick={saveLabel} disabled={!labelText.trim()}>Save label</button><button className="btn" onClick={() => setLabelPoint(null)}>Cancel</button></div>
            </div>
          )}
        </div>
        {/* zoom controls sit outside the transform */}
        <div onPointerDown={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 10, top: 10, zIndex: 5, display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="btn" style={{ minHeight: 28, padding: '2px 9px' }} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.35)}>−</button>
          <span className="glass mono" style={{ fontSize: 10, padding: '3px 7px', borderRadius: 'var(--r-pill)' }}>{Math.round(view.s * 100)}%</span>
          <button className="btn" style={{ minHeight: 28, padding: '2px 9px' }} aria-label="Zoom in" onClick={() => zoomBy(1.35)}>+</button>
          <button className="btn" style={{ minHeight: 28, padding: '2px 9px' }} onClick={() => setView({ x: 0, y: 0, s: 1 })}>Fit</button>
        </div>
        <div style={{ position: 'absolute', left: 10, bottom: 8, zIndex: 5, fontSize: 10, color: 'var(--text-3)', background: 'rgba(6,12,10,.7)', padding: '2px 8px', borderRadius: 'var(--r-pill)', pointerEvents: 'none' }}>
          {corridorMode ? 'corridor mode: click = vertex · near existing vertex = join · double-click/Finish = save' : 'scroll to zoom · drag to pan · click to label'}
        </div>
      </div>

      {gallery.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {gallery.map((g) => {
            const url = g.legacyUrl ?? urls[g.id];
            const isActive = g.id === (active?.id ?? '');
            return (
              <div
                key={g.id}
                role="button"
                aria-label={`Show plan image ${g.name}`}
                onClick={() => setActivePlanImage(buildingId, floor.id, g.id)}
                style={{
                  position: 'relative', flexShrink: 0, width: 84, height: 60, borderRadius: 'var(--r-sm)', overflow: 'hidden', cursor: 'pointer',
                  border: isActive ? '2px solid var(--accent)' : '1px solid var(--hairline)', background: 'var(--surface-2)',
                }}
              >
                {url && g.mime !== 'application/pdf' ? (
                  <img src={url} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                ) : g.mime === 'application/pdf' ? (
                  <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }}>PDF</div>
                ) : (
                  <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 9, color: 'var(--text-3)' }}>loading…</div>
                )}
                <span style={{ position: 'absolute', left: 3, bottom: 3, right: 3, fontSize: 8, color: '#fff', textShadow: '0 1px 2px #000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                {g.key && (
                  <button
                    aria-label={`Delete plan image ${g.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deletePlanImage(g.key!);
                      removePlanImage(buildingId, floor.id, g.id);
                      notify('Plan image removed from the browser database.', 'warn');
                    }}
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 8, border: 'none', background: 'rgba(6,12,10,.8)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1 }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {corridors.length > 0 && (
        <div className="glass" style={{ padding: 10, borderRadius: 'var(--r-sm)', marginTop: 10 }}>
          <div className="label-h" style={{ marginBottom: 7 }}>Corridor paths (walkable floor roads)</div>
          <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '0 0 7px', lineHeight: 1.5 }}>
            Routing travels only along these teal lines — a label joins the nearest point
            automatically, so paths follow real corridors instead of cutting through rooms.
            Branches join where their vertices meet.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {corridors.map((c, i) => (
              <Chip key={c.id} tone="accent">path {i + 1} · {c.points.length} pts <button className="btn" style={{ minHeight: 18, padding: '0 4px', marginLeft: 4 }} onClick={() => removeFloorCorridor(buildingId, floor.id, c.id)}>×</button></Chip>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 12 }}>
        <div className="glass" style={{ padding: 10, borderRadius: 'var(--r-sm)' }}>
          <div className="label-h" style={{ marginBottom: 7 }}>Edit labels</div>
          {labels.length === 0 && <p style={{ color: 'var(--text-3)', fontSize: 11, margin: 0 }}>Click the uploaded plan to place the first label.</p>}
          {labels.map((label) => (
            <div key={label.id} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
              <input value={label.text} aria-label={`Edit floor label ${label.id}`} onChange={(e) => updateFloorLabel(buildingId, floor.id, label.id, { text: e.target.value })} style={{ ...inputStyle, marginTop: 0, minHeight: 30 }} />
              <button className="btn" style={{ minHeight: 30, padding: '2px 7px' }} onClick={() => removeFloorLabel(buildingId, floor.id, label.id)}>Remove</button>
            </div>
          ))}
        </div>
        <div className="glass" style={{ padding: 10, borderRadius: 'var(--r-sm)' }}>
          <div className="label-h" style={{ marginBottom: 7 }}>Connect navigation points</div>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="Floor connection start" style={inputStyle}><option value="">From point…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}</select>
          <select value={toId} onChange={(e) => setToId(e.target.value)} aria-label="Floor connection destination" style={{ ...inputStyle, marginTop: 6 }}><option value="">To point…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}</select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><select value={edgeKind} onChange={(e) => setEdgeKind(e.target.value as IndoorFloorConnection['kind'])} aria-label="Floor connection kind" style={{ ...inputStyle, marginTop: 0 }} >{CONNECTION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select><label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-3)' }}><input type="checkbox" checked={edgeAccessible} disabled={edgeKind === 'stairs'} onChange={(e) => setEdgeAccessible(e.target.checked)} /> step-free</label></div>
          <button className="btn btn-primary" style={{ marginTop: 7 }} onClick={connect} disabled={!fromId || !toId || fromId === toId}>Add connection</button>
          {connections.length > 0 && <ul style={{ margin: '9px 0 0', paddingLeft: 16, fontSize: 10.5, color: 'var(--text-2)' }}>{connections.map((edge) => <li key={edge.id} style={{ marginBottom: 3 }}>{labelName(labels, edge.from)} → {labelName(labels, edge.to)} <button className="btn" style={{ minHeight: 22, padding: '1px 5px', marginLeft: 4 }} onClick={() => removeFloorConnection(buildingId, floor.id, edge.id)}>×</button></li>)}</ul>}
        </div>
      </div>

      <div className="glass" style={{ padding: 10, borderRadius: 'var(--r-sm)', marginTop: 10 }}>
        <div className="label-h" style={{ marginBottom: 7 }}>Test floor navigation</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)} aria-label="Indoor route start" style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: 150 }}><option value="">Start…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}</select>
          <span style={{ color: 'var(--text-3)' }}>→</span>
          <select value={routeTo} onChange={(e) => setRouteTo(e.target.value)} aria-label="Indoor route destination" style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: 150 }}><option value="">Destination…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}</select>
          <button className="btn btn-primary" onClick={findRoute} disabled={!routeFrom || !routeTo || routeFrom === routeTo}>Find floor route</button>
          {routeForThisFloor && <button className="btn" onClick={clearRoute}>Clear route</button>}
        </div>
        <p style={{ fontSize: 11, color: routeForThisFloor ? 'var(--accent)' : 'var(--text-3)', margin: '8px 0 0' }}>
          {routeForThisFloor
            ? `Route ready — red line tracks ${corridors.length ? 'the corridor lines (no wall crossings)' : 'your connected points'}.`
            : corridors.length
              ? 'Routes travel on the corridor lines you drew; labels snap onto the nearest corridor point.'
              : 'Draw a corridor path along real walkways for wall-respecting routes, or manually connect points as a fallback.'}
        </p>
      </div>
    </Section>
  );
}

function normaliseImportedFloor(raw: IndoorFloor, sourceName: string): IndoorFloor {
  return {
    ...raw,
    id: raw.id || `floor-${Date.now().toString(36)}`,
    label: raw.label || raw.id || 'G',
    elevationM: Number(raw.elevationM) || 0,
    heightM: Number(raw.heightM) || 3.6,
    planSourceName: raw.planSourceName ?? sourceName,
    rooms: raw.rooms ?? [],
    labels: raw.labels ?? [],
    connections: raw.connections ?? [],
  };
}

function centroidOrigin(ring: [number, number][]) {
  return {
    lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
    lng: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    rotationDeg: 0,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function planDimensions(dataUrl: string, mime: string): Promise<{ width: number; height: number }> {
  if (mime === 'application/pdf') return Promise.resolve({ width: 1200, height: 850 });
  if (mime === 'image/svg+xml') return Promise.resolve({ width: 1200, height: 850 });
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1200, height: image.naturalHeight || 850 });
    image.onerror = () => resolve({ width: 1200, height: 850 });
    image.src = dataUrl;
  });
}

function guessMime(name: string): string {
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.png$/i.test(name)) return 'image/png';
  return 'image/jpeg';
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function labelName(labels: IndoorFloorLabel[], id: string): string {
  return labels.find((label) => label.id === id)?.text ?? id;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)' }}>{label}{children}</label>;
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 34, borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: '0 8px', fontSize: 12,
};

function FloorPlanArt() {
  return (
    <svg width="260" height="150" viewBox="0 0 260 150" aria-hidden="true" style={{ opacity: 0.9 }}>
      <defs><pattern id="floor-grid" width="13" height="13" patternUnits="userSpaceOnUse"><path d="M13 0H0v13" fill="none" stroke="var(--hairline-strong)" strokeWidth="1" /></pattern></defs>
      <rect x="10" y="10" width="240" height="130" rx="8" fill="url(#floor-grid)" />
      <rect x="34" y="30" width="80" height="42" fill="none" stroke="var(--text-3)" strokeWidth="1.4" strokeDasharray="5 4" />
      <rect x="130" y="30" width="96" height="42" fill="none" stroke="var(--text-3)" strokeWidth="1.4" strokeDasharray="5 4" />
      <path d="M104 86h122" stroke="#1a73e8" strokeWidth="2" strokeDasharray="6 5" />
      <circle cx="60" cy="72" r="3.5" fill="#1a73e8" /><circle cx="60" cy="120" r="3.5" fill="#1a73e8" />
    </svg>
  );
}
