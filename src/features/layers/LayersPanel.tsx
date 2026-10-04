import { useOutdoor, type Layers } from '@/store/outdoorStore';
import { useUi } from '@/store/uiStore';
import { Section, Toggle } from '@/ui/primitives';
import { ATTRIBUTIONS, SUN_PRESETS, type SunPresetId } from '@/config/map.config';
import { featureFlags } from '@/config/featureFlags';
import { useEdit } from '@/store/editStore';

const LAYER_LABELS: { key: keyof Layers; label: string; hint?: string }[] = [
  { key: 'terrain', label: 'Terrain', hint: 'AWS Terrain Tiles DEM, ~4 m/px, inpainted nodata' },
  { key: 'ortho', label: 'Satellite imagery drape', hint: 'Esri World Imagery z17 baked locally, ~1 m/px' },
  { key: 'buildings', label: 'Buildings', hint: 'Procedural massing from surveyed footprints' },
  { key: 'contextBuildings', label: 'Village houses (context)', hint: 'Off-island dwellings outside the campus cores — massing only, no windows' },
  { key: 'roads', label: 'Roads, footpaths, steps', hint: 'Ribbons at real widths from OSM centrelines' },
  { key: 'trees', label: 'Vegetation', hint: 'Inferred from imagery — not a tree survey' },
  { key: 'labels', label: 'Labels' },
  { key: 'labelsAll', label: 'Label EVERY campus building', hint: 'Default shows a ranked, distance-budgeted subset. This turns on the full set.' },
  { key: 'poi', label: 'POI markers' },
  { key: 'route', label: 'Active route' },
  { key: 'orientation', label: 'Compass & scale' },
];

export function LayersPanel() {
  const layers = useOutdoor((s) => s.layers);
  const toggleLayer = useOutdoor((s) => s.toggleLayer);
  const sunPreset = useOutdoor((s) => s.sunPreset);
  const setSunPreset = useOutdoor((s) => s.setSunPreset);
  const hourOverride = useOutdoor((s) => s.hourOverride);
  const setHour = useOutdoor((s) => s.setHour);
  const exaggeration = useOutdoor((s) => s.exaggeration);
  const setExaggeration = useOutdoor((s) => s.setExaggeration);
  const debug = useUi((s) => s.debug);
  const setDebug = useUi((s) => s.setDebug);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const tier = useUi((s) => s.deviceTier);
  const roadsOnly = useOutdoor((s) => s.roadsOnly);
  const setRoadsOnly = useOutdoor((s) => s.setRoadsOnly);
  const globalOpacity = useOutdoor((s) => s.globalOpacity);
  const setGlobalOpacity = useOutdoor((s) => s.setGlobalOpacity);
  const editEnabled = useEdit((s) => s.enabled);
  const setPanel = useUi((s) => s.setPanel);

  return (
    <div>
      <Section title="Roads-only inspection">
        <Toggle
          label="Show ONLY the road network"
          hint="Hides buildings, trees, imagery, labels and POI in both 2D and 3D — use it to see every mapped road and spot gaps before drawing missing segments."
          checked={roadsOnly}
          onChange={() => setRoadsOnly(!roadsOnly)}
        />
      </Section>

      <Section title="Layers">
        {LAYER_LABELS.map((l) => (
          <Toggle key={l.key} label={l.label} hint={l.hint} checked={layers[l.key]} onChange={() => toggleLayer(l.key)} />
        ))}
      </Section>

      <Section title="Time of day">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {(Object.keys(SUN_PRESETS) as SunPresetId[]).map((id) => (
            <button
              key={id}
              className="chip"
              onClick={() => setSunPreset(id)}
              style={{ cursor: 'pointer', borderColor: sunPreset === id && hourOverride === null ? 'var(--accent)' : undefined, color: sunPreset === id && hourOverride === null ? 'var(--accent)' : undefined }}
            >
              {SUN_PRESETS[id].label}
            </button>
          ))}
        </div>
        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>
          Hour {hourOverride === null ? `(${SUN_PRESETS[sunPreset].hour.toFixed(1)} from preset)` : hourOverride.toFixed(1)}
          <input
            type="range" min={4} max={22} step={0.1}
            value={hourOverride ?? SUN_PRESETS[sunPreset].hour}
            onChange={(e) => setHour(parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: 6, accentColor: 'var(--accent)' }}
          />
        </label>
        <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '4px 0 0', lineHeight: 1.5 }}>
          Solar position is computed for the campus latitude. It is a visual approximation — no longitude or
          time-zone correction, so shadows are indicative, not survey grade.
        </p>
      </Section>

      <Section title="Transparency (X-ray)">
        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>
          All buildings · opacity {globalOpacity.toFixed(2)}
          {globalOpacity < 1 && <span style={{ color: 'var(--warn)' }}> — X-ray view, not a survey state</span>}
          <input
            type="range" min={0.2} max={1} step={0.05} value={globalOpacity}
            onChange={(e) => setGlobalOpacity(parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: 6, accentColor: 'var(--accent)' }}
          />
        </label>
        <p style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '4px 0 0', lineHeight: 1.55 }}>
          Buildings are fully opaque by default — if one still looks see-through, its geometry is broken and the
          audit will catch it (<code>npm test</code>). Per-building opacity lives in the editor.
        </p>
      </Section>

      <Section title="Terrain shape">
        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>
          Vertical exaggeration ×{exaggeration.toFixed(1)} {exaggeration > 1 && <span style={{ color: 'var(--warn)' }}>(visual only — not a measurement)</span>}
          <input
            type="range" min={1} max={2} step={0.1} value={exaggeration}
            onChange={(e) => setExaggeration(parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: 6, accentColor: 'var(--accent)' }}
          />
        </label>
        <Toggle
          label="Contour lines"
          hint="Not produced yet — the toggle is disabled rather than faked."
          checked={false}
          onChange={() => undefined}
          disabled={!featureFlags.contours}
        />
      </Section>

      <Section title="Developer & accuracy tools">
        <Toggle label="Satellite alignment overlay" hint="50% ortho over the model, top-down (view from Map mode)" checked={debug.align} onChange={(v) => setDebug({ align: v })} />
        <Toggle label="Render budget & data honesty HUD" checked={debug.hud} onChange={(v) => setDebug({ hud: v })} />
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.7 }}>
          device tier: {tier}<br />
          deep-link flags: ?debug=align,hud
        </div>
      </Section>

      <Section title="Manual corrections">
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 0 }}>
          Fix a building the automatic data got wrong, add a footprint the sources missed, or place a label for a
          gate or viewpoint. Edits preview live and export as the files under <code>public/data/manual/</code>.
        </p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setPanel('edit')}>
          {editEnabled ? 'Open the manual editor' : 'Open the editor (add ?edit=1 to the URL)'}
        </button>
      </Section>

      <Section title="Appearance">
        <Toggle
          label="Light interface"
          hint="Useful on bright screens and for printing"
          checked={theme === 'light'}
          onChange={(v) => {
            setTheme(v ? 'light' : 'dark');
            document.documentElement.setAttribute('data-theme', v ? 'light' : 'dark');
          }}
        />
      </Section>

      <Section title="Data sources">
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.75, color: 'var(--text-2)' }}>
          {ATTRIBUTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
          <li>Search aliases and category defaults: this project, documented in docs/ACCURACY_LOG.md</li>
        </ul>
      </Section>
    </div>
  );
}
