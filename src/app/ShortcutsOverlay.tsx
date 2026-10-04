import { useUi } from '@/store/uiStore';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navigate the app',
    rows: [
      ['/', 'focus campus search'],
      ['1 / 2 / 3', '3D view · 2D map · indoor viewer'],
      ['x / l / r', 'toggle Explore / Layers / Route panels'],
      ['i / e / a', 'toggle Indoor / Edit / About panels'],
      ['v', 'roads-only inspection view'],
      ['h', 'home camera (campus overview)'],
      ['?', 'this shortcuts card'],
      ['Esc', 'close card / cancel drawing / deselect'],
    ],
  },
  {
    title: 'Edit · draw a route or footprint (map view)',
    rows: [
      ['click', 'place waypoint'],
      ['double-click / Enter', 'finish route · name it in Edit'],
      ['Backspace / Ctrl+Z', 'undo last vertex'],
      ['Ctrl+Shift+Z / Ctrl+Y', 'redo'],
      ['Esc', 'cancel the current drawing'],
    ],
  },
  {
    title: 'Edit · fix an existing road',
    rows: [
      ['right-click a road', 'jump straight into fixing it'],
      ['drag amber handles', 'move a vertex · click the line to insert · right-click handle to delete'],
      ['← → ↑ ↓', 'move the WHOLE road 0.3 m (Shift = 1 m)'],
      ['Enter', 'save the new shape'],
      ['Esc', 'cancel without saving'],
    ],
  },
  {
    title: 'Edit · align footprint to imagery',
    rows: [
      ['← → ↑ ↓', 'nudge whole footprint 0.3 m (Shift = 1 m)'],
      ['Q / E', 'rotate 0.5° (Shift = 2°)'],
      ['Enter', 'save alignment'],
      ['Esc', 'cancel without saving'],
    ],
  },
];

export function ShortcutsOverlay() {
  const show = useUi((s) => s.showShortcuts);
  const setShow = useUi((s) => s.setShowShortcuts);
  if (!show) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={() => setShow(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
    >
      <div
        className="glass"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: '100%', maxHeight: 'min(84vh, 620px)', overflowY: 'auto', padding: 22, borderRadius: 'var(--r-lg)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Keyboard shortcuts</h2>
          <button className="btn" onClick={() => setShow(false)}>Close</button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 14 }}>
            <div className="label-h" style={{ marginBottom: 6 }}>{g.title}</div>
            {g.rows.map(([keys, desc]) => (
              <div key={keys + desc} style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '3px 0', alignItems: 'baseline' }}>
                <kbd className="mono" style={{ flex: '0 0 150px', padding: '2px 7px', background: 'var(--surface-2, rgba(255,255,255,0.06))', borderRadius: 5, fontSize: 11, border: '1px solid var(--stroke, rgba(255,255,255,0.12))' }}>{keys}</kbd>
                <span style={{ color: 'var(--text-2)' }}>{desc}</span>
              </div>
            ))}
          </div>
        ))}
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '6px 0 0' }}>
          Mouse: drag map to pan · scroll to zoom · right-drag to tilt (3D) · double-click a building to edit it.
        </p>
      </div>
    </div>
  );
}
