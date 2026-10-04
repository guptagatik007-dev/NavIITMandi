import { useMap } from '@/store/mapStore';
import { useOutdoor } from '@/store/outdoorStore';

const zoomToDistance = (zoom: number) => Math.min(3200, Math.max(70, 400 * Math.pow(2, 17 - zoom)));

/**
 * Compass, scale bar and camera read-out for the 3D view.
 * Scale is honest about being a perspective approximation: it reports the ground span
 * near the camera target, which is exactly what a viewer needs to judge distance.
 */
export function Compass() {
  const camera = useMap((s) => s.camera);
  const setCamera = useMap((s) => s.setCamera);
  const resetCamera = useMap((s) => s.resetCamera);
  const show = useOutdoor((s) => s.layers.orientation);

  if (!show) return null;

  const distance = zoomToDistance(camera.zoom);
  const spanM = 2 * distance * Math.tan((52 * Math.PI) / 360); // vertical ground span at the target
  const barM = spanM > 2000 ? 500 : spanM > 900 ? 200 : spanM > 400 ? 100 : 50;
  const barPx = Math.min(150, Math.max(40, (barM / spanM) * 320));

  return (
    <div
      className="glass"
      style={{
        position: 'absolute', left: 12, bottom: 12, zIndex: 20, padding: '10px 12px',
        borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 14, fontSize: 11,
      }}
    >
      <button
        onClick={resetCamera}
        title="Reset the camera to the default campus view"
        style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--hairline)', background: 'var(--surface-2)', display: 'grid', placeItems: 'center', cursor: 'pointer', position: 'relative' }}
      >
        <span
          style={{
            display: 'block', transform: `rotate(${-camera.bearing}deg)`, transition: 'transform var(--dur) var(--ease)',
            fontSize: 10, fontWeight: 700, color: 'var(--accent)',
          }}
        >
          ▲
        </span>
        <span style={{ position: 'absolute', bottom: 3, fontSize: 8, color: 'var(--text-3)', letterSpacing: '.08em' }}>N</span>
      </button>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: barPx, height: 7, borderLeft: '2px solid var(--text-2)', borderRight: '2px solid var(--text-2)', borderBottom: '2px solid var(--text-2)' }} />
          <span className="mono" style={{ color: 'var(--text-2)' }}>{barM} m</span>
        </div>
        <div className="mono" style={{ color: 'var(--text-3)', marginTop: 4 }}>
          {camera.lat.toFixed(5)}, {camera.lng.toFixed(5)} · z{camera.zoom.toFixed(2)} · hdg {Math.round(camera.bearing)}°
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className="btn" style={{ minHeight: 26, padding: '2px 8px', fontSize: 10.5 }} onClick={() => setCamera({ pitch: camera.pitch >= 70 ? 45 : Math.min(85, camera.pitch + 15) })}>
          tilt {Math.round(camera.pitch)}°
        </button>
      </div>
    </div>
  );
}
