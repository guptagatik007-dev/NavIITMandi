import { useEffect, useRef, useState } from 'react';
import { useUi } from '@/store/uiStore';

const STEPS = [
  {
    title: 'Look around the real campus',
    body: 'Drag to orbit, scroll or pinch to zoom, right-drag (or two fingers) to pan. Buildings are placed from surveyed footprints on real terrain — the Uhl river, the ridges and the two campuses are where they actually are.',
  },
  {
    title: 'Search the way students speak',
    body: 'Type “mess”, “A18”, “padhai”, “dispensary” — aliases and Hinglish words are indexed. Press / anywhere to jump to search, then Enter to fly to the result.',
  },
  {
    title: 'Get walking directions that admit their gaps',
    body: 'Pick a destination, choose Fastest or Step-free, and read the climb as well as the distance. If the mapped paths cannot reach somewhere, the app says so instead of drawing a straight line across a hillside.',
  },
];

/**
 * Getting-started card.
 *
 * It must NEVER block the map. An earlier version rendered a full-viewport
 * `inset:0` backdrop that captured every pointer event, which made wheel-zoom,
 * drag-orbit, right-drag pan and even the top-bar buttons dead until the user
 * dismissed three steps — and its `backdropFilter: blur(3px)` made the whole
 * scene read as a grey wash. Both symptoms were reported as "buildings look
 * sludged / zoom is not working".
 *
 * Contract now:
 *  - wrapper is `pointer-events: none`, so the map is fully interactive from the
 *    first frame; only the card itself accepts clicks
 *  - no backdrop dim, no blur — nothing is drawn over the scene
 *  - the first real interaction with the map auto-dismisses the tour and remembers
 *    the choice, so it can never trap a returning user
 */
export function Onboarding() {
  const setOnboarded = useUi((s) => s.setOnboarded);
  const [i, setI] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const step = STEPS[i];

  const finish = (openExplore: boolean) => {
    setOnboarded(true);
    if (openExplore) useUi.getState().setPanel('explore');
  };

  // Any genuine map interaction dismisses the card. Interactions inside the card
  // itself are ignored so its own buttons keep working.
  useEffect(() => {
    const onInteract = (e: Event) => {
      if (cardRef.current && e.target instanceof Node && cardRef.current.contains(e.target)) return;
      finish(false);
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('wheel', onInteract, opts);
    window.addEventListener('pointerdown', onInteract, opts);
    window.addEventListener('keydown', onInteract, opts);
    window.addEventListener('touchstart', onInteract, opts);
    return () => {
      window.removeEventListener('wheel', onInteract, opts);
      window.removeEventListener('pointerdown', onInteract, opts);
      window.removeEventListener('keydown', onInteract, opts);
      window.removeEventListener('touchstart', onInteract, opts);
    };
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'end center',
        padding: '0 20px 84px',
        // the map stays clickable, zoomable and readable behind the card
        pointerEvents: 'none',
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-label="Getting started"
        className="glass fade-in"
        style={{ maxWidth: 460, padding: 18, borderRadius: 'var(--r-lg)', pointerEvents: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,0.45)' }}
      >
        <div className="label-h">Getting started · {i + 1}/{STEPS.length}</div>
        <h2 style={{ fontSize: 16, margin: '7px 0 7px' }}>{step.title}</h2>
        <p style={{ fontSize: 12.6, lineHeight: 1.65, color: 'var(--text-2)', margin: 0 }}>{step.body}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => (i === STEPS.length - 1 ? finish(true) : setI(i + 1))}>
            {i === STEPS.length - 1 ? 'Start exploring' : 'Next'}
          </button>
          <button className="btn" onClick={() => finish(true)}>
            Skip
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>or just start moving the map</span>
          <span style={{ display: 'flex', gap: 5 }}>
            {STEPS.map((s, k) => (
              <span key={s.title} style={{ width: 7, height: 7, borderRadius: 999, background: k === i ? 'var(--accent)' : 'var(--surface-3)' }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
