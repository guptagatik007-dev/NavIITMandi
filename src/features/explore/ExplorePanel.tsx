import { useMemo, useState } from 'react';
import { useCampus } from '@/app/CampusContext';
import { useOutdoor } from '@/store/outdoorStore';
import { useMap } from '@/store/mapStore';
import { useUi } from '@/store/uiStore';
import { Chip, EmptyState, LinkRow, Section, Stat } from '@/ui/primitives';
import { SUBTITLES } from '@/data/search';
import { formatArea, haversine } from '@/geo/wgs84';
import { ANCHORS } from '@/config/map.config';

export function ExplorePanel() {
  const { data, terrain } = useCampus();
  const selectedId = useOutdoor((s) => s.selectedBuildingId);
  const select = useOutdoor((s) => s.selectBuilding);
  const setRouteEnd = useOutdoor((s) => s.setRouteEnd);
  const setPanel = useUi((s) => s.setPanel);
  const requestFlyTo = useMap((s) => s.requestFlyTo);
  const notify = useUi((s) => s.notify);
  const [cat, setCat] = useState<string | null>(null);

  const cats = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of data.pois) c.set(p.cat, (c.get(p.cat) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.pois]);

  const list = useMemo(
    () => data.pois.filter((p) => (cat ? p.cat === cat : true)).sort((a, b) => a.name.localeCompare(b.name)),
    [data.pois, cat],
  );

  const selected = selectedId ? data.buildings.find((b) => b.id === selectedId) ?? null : null;

  return (
    <div>
      {selected && (
        <Section title="Selected building">
          <BuildingCard
            building={selected}
            floorsDerived={data.floorsUnverified.has(selected.id)}
            relief={terrain.footprintStats(selected.ring).reliefM}
            onRoute={(which) => {
              setRouteEnd(which, selected.id);
              setPanel('route');
            }}
            onReport={async () => {
              const c = centroid(selected.ring);
              const report = [
                `# Campus map data issue`,
                `building_id: ${selected.id}`,
                `name: ${selected.name}`,
                `category: ${selected.cat}`,
                `centroid: ${c[1].toFixed(6)}, ${c[0].toFixed(6)}`,
                `floors (in app): ${selected.floors} — ${selected.floor_note ?? ''}`,
                `height (in app): ${selected.height_m} m`,
                `footprint area: ${selected.area_m2} m²`,
                `source: ${selected.src}`,
                `confidence: ${selected.conf}`,
                ``,
                `What is wrong (please describe or attach a photo):`,
              ].join('\n');
              try {
                await navigator.clipboard.writeText(report);
                notify('Report copied to clipboard — send it to the project maintainer.', 'info');
              } catch {
                notify('Could not access the clipboard. Note the building id and report it manually.', 'warn');
              }
            }}
            onClose={() => select(null)}
          />
        </Section>
      )}

      <Section title="What is on campus">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button className="chip" onClick={() => setCat(null)} style={{ cursor: 'pointer', borderColor: cat === null ? 'var(--accent)' : undefined, color: cat === null ? 'var(--accent)' : undefined }}>
            All {data.pois.length}
          </button>
          {cats.map(([c, n]) => (
            <button
              key={c}
              className="chip"
              onClick={() => setCat(c === cat ? null : c)}
              style={{ cursor: 'pointer', borderColor: c === cat ? 'var(--accent)' : undefined, color: c === cat ? 'var(--accent)' : undefined }}
            >
              {SUBTITLES[c] ?? c} {n}
            </button>
          ))}
        </div>
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, maxHeight: 300, overflow: 'auto' }}>
          {list.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  if (p.building_id) select(p.building_id);
                  requestFlyTo({ lat: p.lat, lng: p.lng, zoom: 17.3, pitch: 52 });
                }}
                style={{
                  width: '100%', textAlign: 'left', background: 'transparent', border: 0, borderBottom: '1px solid var(--hairline)',
                  padding: '9px 2px', cursor: 'pointer', color: 'inherit', display: 'flex', justifyContent: 'space-between', gap: 10,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{SUBTITLES[p.cat] ?? p.cat} · {p.conf}</span>
                </span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                  {(haversine({ lat: p.lat, lng: p.lng }, ANCHORS.south_core) / 1000).toFixed(2)} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Known facilities — not yet on the map (${data.unplaced.length})`}>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '0 0 8px', lineHeight: 1.55 }}>
          These exist and are documented by the institute, but no public source publishes their coordinates.
          They are listed instead of drawn, because an invented position would be worse than an honest gap.
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.unplaced.map((u) => (
            <li key={u.name} style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ fontSize: 12.5 }}>{u.name}</strong>
                <Chip tone="warn">needs survey</Chip>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{u.why}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{u.src}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Wayfinding sheet">
        <LinkRow
          href="?print=1"
          label="Printable QR sheet for every named building"
          hint="Print, pin at gates and hostel noticeboards — each QR opens the map on that building."
        />
      </Section>
    </div>
  );
}

export function BuildingCard({
  building,
  floorsDerived,
  relief,
  onRoute,
  onReport,
  onClose,
}: {
  building: {
    id: string; name: string; cat: string; area_m2: number; floors: number; height_m: number;
    conf: string; src: string; roof: string; floor_note?: string; ring: [number, number][];
  };
  floorsDerived: boolean;
  relief: number;
  onRoute: (which: 'from' | 'to') => void;
  onReport: () => void;
  onClose: () => void;
}) {
  const c = centroid(building.ring);
  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, lineHeight: 1.25 }}>{building.name}</h2>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{SUBTITLES[building.cat] ?? building.cat}</div>
        </div>
        <button className="btn btn-icon" style={{ minHeight: 30, padding: 5 }} onClick={onClose} aria-label="Close building details">✕</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Chip tone={building.conf === 'osm' ? 'accent' : 'warn'}>
          {building.conf === 'osm' ? 'footprint: survey data' : `floors: ${building.conf}`}
        </Chip>
        {floorsDerived && <Chip tone="warn">floor count derived</Chip>}
        <Chip tone={relief > 12 ? 'warn' : 'muted'}>cut bench {relief.toFixed(1)} m</Chip>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <Stat label="Footprint" value={formatArea(building.area_m2)} />
        <Stat label="Floors" value={String(building.floors)} tone={floorsDerived ? 'warn' : undefined} />
        <Stat label="Height" value={`${building.height_m.toFixed(1)} m`} />
      </div>

      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.7 }}>
        {c[1].toFixed(6)}, {c[0].toFixed(6)}<br />
        roof: {building.roof}{building.floor_note ? ` · ${building.floor_note}` : ''}<br />
        {building.src}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => onRoute('to')}>Directions here</button>
        <button className="btn" onClick={() => onRoute('from')}>Start here</button>
        <button className="btn" onClick={onReport} title="Copy a structured data-issue report">Report error</button>
      </div>
    </div>
  );
}

function centroid(ring: [number, number][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-12) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

export function NoSelection() {
  return (
    <EmptyState
      title="Nothing selected"
      body={
        <>
          Tap any building in the 3D scene or the plan view to inspect it, or search for a hostel, mess or
          academic block by name.
        </>
      }
    />
  );
}
