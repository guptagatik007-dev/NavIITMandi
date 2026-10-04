import { useCampus } from '@/app/CampusContext';
import { useUi } from '@/store/uiStore';
import { Chip, LinkRow, Section, Stat } from '@/ui/primitives';
import { ATTRIBUTIONS, BBOX } from '@/config/map.config';
import { formatArea } from '@/geo/wgs84';

/**
 * "About" is where the project states, in public, what is measured and what is derived.
 * A campus map that hides its confidence is worse than one that admits its gaps.
 */
export function AboutPanel() {
  const { data, builtMs } = useCampus();
  const setDebug = useUi((s) => s.setDebug);

  const m = data.manifest;
  const modelled = m.modelled_campus_floor_area_sqm;
  const published = m.published.north_campus_built_area_sqm;
  const delta = ((modelled - published) / published) * 100;

  return (
    <div>
      <Section title="What this is">
        <p style={{ fontSize: 12.3, lineHeight: 1.7, margin: 0, color: 'var(--text-2)' }}>
          A 3D digital twin of IIT Mandi's Kamand campus (North and South), built only from published
          spatial data: OpenStreetMap footprints where they exist, Overture Maps ML footprints to fill the
          gaps, a terrain model from open DEM tiles, and satellite imagery for the drape. Buildings are
          generated procedurally from their surveyed footprint plus documented attributes — no hand-waved
          geometry, and nothing copied from any other campus map.
        </p>
      </Section>

      <Section title="Accuracy, stated plainly">
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <Stat label="Buildings" value={String(m.counts.buildings)} />
          <Stat label="Campus" value={String(m.counts.campus_buildings)} />
          <Stat label="Roads" value={String(m.counts.roads)} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <Chip tone="accent">footprints: survey data</Chip>
          <Chip tone="warn">{m.floors_unverified_count} floor counts derived</Chip>
          <Chip tone="warn">{data.trees.length} trees inferred</Chip>
          <Chip tone="muted">graph built in {builtMs.toFixed(0)} ms</Chip>
        </div>
        <p style={{ fontSize: 11.6, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>
          Floor counts without an OSM <code>building:levels</code> tag use documented category defaults —
          every one of those buildings is flagged <em>derived</em> in its detail card. Aggregate sanity check:
          the model holds <strong>{formatArea(modelled)}</strong> of campus floor area against the institute's
          published figure of {formatArea(published)} for North Campus ({delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}%).
        </p>
        <p style={{ fontSize: 11.6, lineHeight: 1.7, color: 'var(--text-2)', margin: '10px 0 0' }}>
          Vegetation is <strong>inferred from satellite imagery</strong>, not surveyed: individual tree heights
          and radii are plausible species ranges. Ten facilities that certainly exist (A-9, A18, Sports
          Complex, Main Gate, Vyas Kund, the guest house, the dining-cum-SAC block and others) have no
          published coordinates, so they are listed in the Explore panel as gaps instead of being drawn.
        </p>
      </Section>

      <Section title="Extent &amp; terrain">
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.8 }}>
          bbox {BBOX.west}–{BBOX.east} E, {BBOX.south}–{BBOX.north} N<br />
          terrain {m.generators.terrain}<br />
          imagery {m.generators.imagery}<br />
          data generated {m.generated}
        </div>
      </Section>

      <Section title="Known limits — read before trusting a number">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.6, lineHeight: 1.8, color: 'var(--text-2)' }}>
          <li>Roof shapes and facade materials are category-derived, not measured per building.</li>
          <li>Window rhythm is generated from floor height; it is a plausible pattern, not a facade survey.</li>
          <li>Buildings sit on a derived cut bench (low-percentile seating + plinth), not a surveyed pad level.</li>
          <li>Entrances are placed on the longest facade nearest a mapped path; the final metres of any route to a building are labelled approximate.</li>
          <li>Solar position ignores longitude and time zone — shadows are indicative.</li>
          <li>Indoor navigation has no fabricated data: upload a real floor plan in the Indoor workspace, then label and connect it manually.</li>
        </ul>
        <button className="btn" style={{ marginTop: 12, width: '100%' }} onClick={() => setDebug({ hud: true, align: true })}>
          Open the accuracy HUD &amp; alignment overlay
        </button>
      </Section>

      <Section title="Sources &amp; licences">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.4, lineHeight: 1.8, color: 'var(--text-2)' }}>
          {ATTRIBUTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <LinkRow href="docs/ACCURACY_LOG.md" label="docs/ACCURACY_LOG.md" hint="Per-building tolerances and the open verification list." />
          <LinkRow href="docs/DATA_SOURCES.md" label="docs/DATA_SOURCES.md" hint="Every dataset, licence and refresh command." />
          <LinkRow href="docs/MASTER_PROMPT.md" label="docs/MASTER_PROMPT.md" hint="The specification this build is measured against." />
        </div>
      </Section>
    </div>
  );
}
