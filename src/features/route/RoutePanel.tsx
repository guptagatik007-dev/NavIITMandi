import { useEffect, useMemo, useState } from 'react';
import { useCampus } from '@/app/CampusContext';
import { useOutdoor } from '@/store/outdoorStore';
import { useMap } from '@/store/mapStore';
import { useUi } from '@/store/uiStore';
import { Chip, Section, Segmented, Stat } from '@/ui/primitives';
import { PROFILES, elevationProfile, route as computeRoute, routeAlternatives } from '@/geo/routing';
import { formatDistance, formatDuration } from '@/geo/wgs84';
import { buildShareUrl } from '@/hooks/useDeepLink';

export function RoutePanel() {
  const { data, terrain, graph } = useCampus();
  const routeState = useOutdoor((s) => s.route);
  const roadIssues = useUi((s) => s.roadIssues);


  // Dev-only probe: lets tools/probe-capabilities.mjs read the engine's verdict
  // (ok / reason / distance) instead of inferring it from rendered text.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__routeDebug = () => ({
      status: routeState.status,
      from: routeState.fromBuildingId,
      to: routeState.toBuildingId,
      profile: routeState.profile,
      ok: routeState.result?.ok ?? null,
      reason: routeState.message ?? null,
      distanceM: routeState.result?.ok ? Math.round(routeState.result.distanceM) : null,
      seconds: routeState.result?.ok ? Math.round(routeState.result.seconds) : null,
      steps: routeState.result?.ok ? routeState.result.steps.length : null,
    });
    return () => {
      delete (window as unknown as Record<string, unknown>).__routeDebug;
    };
  }, [routeState]);
  const setRouteEnd = useOutdoor((s) => s.setRouteEnd);
  const setProfile = useOutdoor((s) => s.setProfile);
  const setRouteResult = useOutdoor((s) => s.setRouteResult);
  const setAlternatives = useOutdoor((s) => s.setAlternatives);
  const chooseAlternative = useOutdoor((s) => s.chooseAlternative);
  const select = useOutdoor((s) => s.selectBuilding);
  const requestFlyTo = useMap((s) => s.requestFlyTo);
  const notify = useUi((s) => s.notify);
  const [locating, setLocating] = useState(false);

  const [destFilter, setDestFilter] = useState('');
  const [startFilter, setStartFilter] = useState('');

  // EVERY campus building is a destination — not just the fifteen that happen to carry an
  // OSM name. Unnamed ML footprints use their derived locator name ("North Campus
  // building 12"), and corrections from the manual layer show up here automatically.
  const options = useMemo(
    () =>
      data.buildings
        .filter((b) => b.scope === 'campus')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({ id: b.id, name: b.name, zone: b.zone ?? '', cat: b.cat })),
    [data.buildings],
  );

  const filtered = (q: string) => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.name.toLowerCase().includes(t) || o.cat.includes(t) || o.zone === t);
  };

  /** Prefer the mapped entrance point over the footprint centroid: routes end at the door. */
  const centroidOf = (id: string | null) => {
    const b = id ? data.buildings.find((x) => x.id === id) : null;
    if (!b) return null;
    if (b.entrance_lat != null && b.entrance_lng != null) return { lat: b.entrance_lat, lng: b.entrance_lng };
    if (b.labelAt != null) return { lng: b.labelAt[0], lat: b.labelAt[1] };
    const c = b.ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return { lng: c[0] / b.ring.length, lat: c[1] / b.ring.length };
  };

  useEffect(() => {
    const from = routeState.fromLatLng;
    const to = centroidOf(routeState.toBuildingId);
    if (!from || !to) {
      setAlternatives([], 0, 'idle');
      return;
    }
    setRouteResult(null, 'computing');
    const t = setTimeout(() => {
      // Google-Maps style: compute the recommended route + real alternatives in one go
      const alts = routeAlternatives(graph, from, to, { profile: routeState.profile }, terrain, 3);
      if (alts.length) {
        setAlternatives(alts, 0);
      } else {
        const r = computeRoute(graph, from, to, { profile: routeState.profile }, terrain);
        setRouteResult(null, 'error', r.reason);
      }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState.fromLatLng, routeState.toBuildingId, routeState.profile, graph, terrain]);

  const result = routeState.result;
  const profile = useMemo(() => (result?.ok ? elevationProfile(result.coords, terrain, 90) : []), [result, terrain]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      notify('This browser has no location support — pick a start building instead.', 'warn');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setRouteEnd('from', null, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        notify(`Start set to your device position (±${Math.round(pos.coords.accuracy)} m).`, 'info');
      },
      () => {
        setLocating(false);
        notify('Location permission denied — choose a start building instead.', 'warn');
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div>
      {roadIssues.length > 0 && (
        <div style={{ border: '1px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 8, margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5 }}>
          <strong>{roadIssues.length} hand-drawn road(s)</strong> are saved but not routable — their ends are too far from an
          existing road, so the router can't reach them. Open <strong>Edit → Routes</strong> and use <em>Fix now</em> to extend
          them onto the network (amber hint shows the join point).
        </div>
      )}

      <Section title="Plan a walk">
        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>
          From {options.length > 20 && <span style={{ color: 'var(--text-3)' }}>· {options.length} destinations available</span>}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={startFilter}
            onChange={(e) => setStartFilter(e.target.value)}
            placeholder="filter…"
            aria-label="Filter start points"
            style={{ width: '100%', minHeight: 32, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: '0 10px', marginBottom: 6 }}
          />
          <select
            value={routeState.fromBuildingId ?? (routeState.fromLatLng ? '__loc' : '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__loc') useMyLocation();
              else if (v === '') setRouteEnd('from', null, null);
              else {
                const c = centroidOf(v);
                if (c) setRouteEnd('from', v, c);
              }
            }}
            aria-label="Start point"
            style={{ flex: 1, minHeight: 40, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: '0 10px' }}
          >
            <option value="">Select a start…</option>
            <option value="__loc">📍 My device location</option>
            {filtered(startFilter).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button className="btn" onClick={useMyLocation} disabled={locating} title="Use my device location">
            {locating ? '…' : '📍'}
          </button>
        </div>

        <div style={{ height: 8 }} />
        <button
          className="btn"
          style={{ width: '100%', minHeight: 32, fontSize: 11.5 }}
          onClick={() => {
            const from = routeState.fromBuildingId;
            const fromLL = routeState.fromLatLng;
            const to = routeState.toBuildingId;
            const toLL = centroidOf(to);
            if (!toLL) return;
            setRouteEnd('from', to, toLL);
            if (from && fromLL) setRouteEnd('to', from);
          }}
        >
          ⇅ Swap start and destination
        </button>

        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', margin: '12px 0 4px' }}>To</label>
        <input
          value={destFilter}
          onChange={(e) => setDestFilter(e.target.value)}
          placeholder="Type to filter: mess, hostel, A18, north…"
          aria-label="Filter destinations"
          style={{ width: '100%', minHeight: 36, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: '0 10px', marginBottom: 6 }}
        />
        <select
          value={routeState.toBuildingId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            setRouteEnd('to', id);
            if (id) {
              const c = centroidOf(id);
              if (c) requestFlyTo({ lat: c.lat, lng: c.lng, zoom: 17.2, pitch: 50 });
            }
          }}
          aria-label="Destination"
          size={6}
          style={{ width: '100%', minHeight: 140, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--hairline)', padding: 4 }}
        >
          <option value="">Select a destination…</option>
          {filtered(destFilter).map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.zone ? ` · ${o.zone}` : ''}</option>
          ))}
        </select>

        <div style={{ marginTop: 12 }}>
          <Segmented
            ariaLabel="Route profile"
            value={routeState.profile}
            options={PROFILES.map((p) => ({ id: p.id, label: p.label, title: p.hint }))}
            onChange={setProfile}
          />
          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 0' }}>
            {PROFILES.find((p) => p.id === routeState.profile)?.hint}
          </p>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={!routeState.fromLatLng || !routeState.toBuildingId}
          onClick={() => {
            const from = routeState.fromLatLng;
            const to = centroidOf(routeState.toBuildingId);
            if (!from || !to) return;
            const alts = routeAlternatives(graph, from, to, { profile: routeState.profile }, terrain, 3);
            if (alts.length) setAlternatives(alts, 0);
            else {
              const r = computeRoute(graph, from, to, { profile: routeState.profile }, terrain);
              setRouteResult(null, 'error', r.reason);
            }
            if (alts.length) requestFlyTo({ lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2, zoom: 16.4, pitch: 55 });
          }}
        >
          {routeState.status === 'computing' ? 'Finding route…' : 'Show route'}
        </button>
      </Section>

      {routeState.status === 'error' && (
        <Section title="No route drawn">
          <p style={{ fontSize: 12, color: 'var(--warn)', lineHeight: 1.6, margin: 0 }}>{routeState.message}</p>
          <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 8 }}>
            Nothing is being hidden: the outdoor network is built only from mapped roads, footpaths and steps.
            Adding the missing links (or switching profile) is what fixes it.
          </p>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setProfile(routeState.profile === 'accessible' ? 'fastest' : 'shortest')}>
            Try the {routeState.profile === 'accessible' ? 'fastest' : 'shortest'} profile
          </button>
        </Section>
      )}

      {result?.ok && routeState.alternatives.length > 1 && (
        <Section title="Route options">
          <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '0 0 8px', lineHeight: 1.5 }}>
            Dull dashed lines on the map are real alternatives — choose by your own feasibility, like Google Maps.
          </p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {routeState.alternatives.map((alt, i) => {
              const active = i === routeState.altIndex;
              const delta = alt.seconds - routeState.alternatives[0].seconds;
              return (
                <button
                  key={i}
                  onClick={() => chooseAlternative(i)}
                  aria-pressed={active}
                  style={{
                    cursor: 'pointer', borderRadius: 'var(--r-md)', padding: '8px 11px', textAlign: 'left',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--hairline-strong)'}`,
                    background: active ? 'rgba(255,48,79,0.12)' : 'var(--surface-2)',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>
                    {i === 0 ? 'Recommended' : `Alternative ${i}`}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    {formatDuration(alt.seconds)}{delta > 20 ? ` · +${Math.round(delta / 60)} min` : ''}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{formatDistance(alt.distanceM)}{alt.steps.some((x) => x.kind === 'stairs') ? ' · has steps' : ''}</div>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {result?.ok && (
        <>
          <Section title="Route summary">
            <div style={{ display: 'flex', gap: 12 }}>
              <Stat label="Distance" value={formatDistance(result.distanceM)} tone="accent" />
              <Stat label="Time" value={formatDuration(result.seconds)} />
              <Stat label="Climb" value={`${Math.round(result.ascentM)} m`} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <Chip tone="accent">{PROFILES.find((p) => p.id === result.profile)?.label}</Chip>
              <Chip tone="muted">descent {Math.round(result.descentM)} m</Chip>
              {result.steps.some((s) => s.kind === 'stairs') && <Chip tone="warn">includes steps</Chip>}
              {result.steps.some((s) => s.approximate) && <Chip tone="warn">last leg approximate</Chip>}
            </div>
            {profile.length > 1 && <ElevationChart data={profile} />}
          </Section>

          <Section
            title="Turn by turn"
            action={
              <button
                className="btn"
                style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
                onClick={async () => {
                  const url = buildShareUrl({ from: routeState.fromBuildingId ?? undefined, to: routeState.toBuildingId ?? undefined, profile: routeState.profile });
                  try {
                    await navigator.clipboard.writeText(url);
                    notify('Route link copied.', 'info');
                  } catch {
                    notify('Copy failed — use the address bar.', 'warn');
                  }
                }}
              >
                Copy link
              </button>
            }
          >
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {result.steps.map((s, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
                  <span
                    className="mono"
                    style={{
                      flex: '0 0 22px', height: 22, borderRadius: 999, textAlign: 'center', lineHeight: '22px', fontSize: 11,
                      background: s.kind === 'stairs' ? 'rgba(192,132,252,.18)' : 'var(--surface-3)',
                      color: s.kind === 'stairs' ? 'var(--stair)' : 'var(--text-2)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 12.5 }}>{s.instruction}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{formatDistance(s.distanceM)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Go">
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={() => {
                  const b = result.coords[result.coords.length - 1];
                  if (b) select(routeState.toBuildingId);
                  requestFlyTo({ lat: result.coords[Math.floor(result.coords.length / 2)][1], lng: result.coords[Math.floor(result.coords.length / 2)][0], zoom: 17, pitch: 60 });
                }}
              >
                Follow route
              </button>
              <button className="btn" onClick={() => { setRouteEnd('to', null); }}>
                Clear
              </button>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function ElevationChart({ data }: { data: { distance_m: number; elevation_m: number }[] }) {
  const w = 300;
  const h = 74;
  const min = Math.min(...data.map((d) => d.elevation_m));
  const max = Math.max(...data.map((d) => d.elevation_m));
  const span = Math.max(1, max - min);
  const maxD = data[data.length - 1].distance_m || 1;
  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${((d.distance_m / maxD) * w).toFixed(1)},${(h - ((d.elevation_m - min) / span) * (h - 12) - 6).toFixed(1)}`)
    .join(' ');
  return (
    <div style={{ marginTop: 12 }}>
      <div className="label-h" style={{ marginBottom: 4 }}>
        Elevation profile · {Math.round(min)}–{Math.round(max)} m
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`Elevation profile rising from ${Math.round(min)} to ${Math.round(max)} metres`}>
        <defs>
          <linearGradient id="elev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#5eead4" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={`${path} L${w},${h} L0,${h} Z`} fill="url(#elev)" stroke="none" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      </svg>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>0 m</span>
        <span>{formatDistance(maxD)}</span>
      </div>
    </div>
  );
}
