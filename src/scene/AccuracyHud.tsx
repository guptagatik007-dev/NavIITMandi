/**
 * AccuracyHud.tsx — live render budget + data-honesty readout.
 *
 * Two jobs:
 *  1. Prove the performance budgets from the spec are actually being met (draw calls,
 *     triangles, fps) instead of asserting them in a README.
 *  2. Surface which parts of the model are DERIVED rather than surveyed, so the team
 *     never mistakes a plausible shape for a measured one.
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useUi } from '@/store/uiStore';
import { BUDGETS } from '@/config/map.config';
import type { CampusData } from '@/data/loaders';
import type { TerrainGrid } from '@/geo/terrain';
import { manualStats } from '@/data/loaders';

export function AccuracyHud({ data, terrain }: { data: CampusData; terrain: TerrainGrid }) {
  const open = useUi((s) => s.debug.hud);
  const [stats, setStats] = useState({ calls: 0, tris: 0, fps: 60 });
  const acc = useRef({ t: 0, frames: 0 });
  const gl = useThree((s) => s.gl);

  useFrame((_, delta) => {
    if (!open) return;
    acc.current.t += delta;
    acc.current.frames += 1;
    if (acc.current.t >= 0.5) {
      setStats({
        calls: gl.info.render.calls,
        tris: gl.info.render.triangles,
        fps: Math.round(acc.current.frames / acc.current.t),
      });
      acc.current = { t: 0, frames: 0 };
    }
  });

  const relief = useMemo(() => {
    const withRelief = data.buildings
      .filter((b) => b.scope === 'campus')
      .map((b) => ({ b, s: terrain.footprintStats(b.ring) }))
      .sort((a, b) => b.s.reliefM - a.s.reliefM)
      .slice(0, 7)
      .map(({ b, s }) => ({ id: b.id, name: b.name, relief: s.reliefM }));
    return withRelief;
  }, [data, terrain]);

  if (!open) return null;

  const manual = manualStats(data);
  const steepCount = data.buildings.filter((b) => b.scope === 'campus' && terrain.footprintStats(b.ring).reliefM > 12).length;
  const man = data.manifest;
  const modelled = man.modelled_campus_floor_area_sqm;
  const published = man.published.north_campus_built_area_sqm;
  const deltaPct = ((modelled - published) / published) * 100;

  return (
    <div
      className="glass"
      style={{
        position: 'absolute', top: 12, left: 12, width: 340, maxHeight: '78%', overflow: 'auto',
        borderRadius: 'var(--r-md)', padding: 12, fontSize: 11.5, lineHeight: 1.55, zIndex: 30,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ letterSpacing: '.06em', fontSize: 11 }}>RENDER BUDGET</strong>
        <span className="mono" style={{ color: stats.calls <= BUDGETS.drawCallsVisible ? 'var(--accent)' : 'var(--warn)' }}>
          {stats.calls} calls
        </span>
      </div>
      <Row k="Draw calls" v={`${stats.calls} / ${BUDGETS.drawCallsVisible}`} ok={stats.calls <= BUDGETS.drawCallsVisible} />
      <Row k="Triangles" v={`${(stats.tris / 1000).toFixed(0)}k / ${BUDGETS.trianglesVisible / 1000}k`} ok={stats.tris <= BUDGETS.trianglesVisible} />
      <Row k="FPS" v={String(stats.fps)} ok={stats.fps >= 30} />
      <div className="divider" style={{ margin: '8px 0' }} />
      <strong style={{ letterSpacing: '.06em', fontSize: 11 }}>DATA HONESTY</strong>
      <Row k="Buildings" v={`${man.counts.buildings} (${man.counts.campus_buildings} campus)`} />
      <Row k="Footprints" v="OSM + Overture survey data" />
      <Row k="Floor counts verified" v={`${man.counts.buildings - man.floors_unverified_count} / ${man.counts.buildings}`} ok={false} />
      <Row k="Modelled floor area" v={`${(modelled / 1000).toFixed(1)}k m² vs ${(published / 1000).toFixed(0)}k m² published`} ok={Math.abs(deltaPct) < 15} />
      <Row k="Cross-check delta" v={`${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`} ok={Math.abs(deltaPct) < 15} />
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-3)' }}>
        Floor counts without an <code>building:levels</code> tag come from documented category defaults and are
        flagged <em>derived</em> everywhere they appear.
      </div>
      <div className="divider" style={{ margin: '8px 0' }} />
      <strong style={{ letterSpacing: '.06em', fontSize: 11 }}>MANUAL CORRECTIONS</strong>
      <Row k="Overrides applied" v={`${manual.overridden}`} ok={manual.overridden > 0} />
      <Row k="Manual footprints" v={`${manual.manualBuildings}`} />
      <Row k="Manual labels" v={`${manual.manualLabels}`} />
      {manual.issues.length > 0 && (
        <div style={{ color: 'var(--warn)', fontSize: 10.5, marginTop: 4 }}>
          {manual.issues.length} problem(s) in the manual files — see the editor panel.
        </div>
      )}
      <div className="divider" style={{ margin: '8px 0' }} />
      <strong style={{ letterSpacing: '.06em', fontSize: 11 }}>GEOMETRY INTEGRITY</strong>
      <Row k="Inward-facing walls" v="0 — enforced by npm test" ok />
      <Row k="Downward roof caps" v="0 — enforced by npm test" ok />
      <Row k="Footprints needing a seating survey" v={`${steepCount} (>12 m relief)`} ok={steepCount === 0} />
      <div className="divider" style={{ margin: '8px 0' }} />
      <strong style={{ letterSpacing: '.06em', fontSize: 11 }}>STEEPEST CUT BENCHES</strong>
      <div style={{ marginTop: 4 }}>
        {relief.map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span className="mono" style={{ color: r.relief > 12 ? 'var(--warn)' : 'var(--text-3)' }}>{r.relief.toFixed(1)} m</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-3)' }}>
        Relief = terrain height range across the footprint. Above ~12 m the building needs a survey of its
        actual cut/fill platform; today it is seated on a derived bench.
      </div>
    </div>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span className="mono" style={{ color: ok === undefined ? 'var(--text-2)' : ok ? 'var(--accent)' : 'var(--warn)' }}>{v}</span>
    </div>
  );
}
