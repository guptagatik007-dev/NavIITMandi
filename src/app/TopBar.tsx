import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '@/store/uiStore';
import { useOutdoor } from '@/store/outdoorStore';
import { useMap } from '@/store/mapStore';
import { useCampus } from '@/app/CampusContext';
import { search } from '@/data/search';
import { IconBuilding, IconClose, IconIndoor, IconSearch, IconShare, IconInfo } from '@/ui/Icons';
import { Segmented } from '@/ui/primitives';
import { buildShareUrl } from '@/hooks/useDeepLink';

export function TopBar() {
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const notify = useUi((s) => s.notify);
  const { searchIndex, data } = useCampus();
  const selectBuilding = useOutdoor((s) => s.selectBuilding);
  const focusPoi = useOutdoor((s) => s.focusPoi);
  const requestFlyTo = useMap((s) => s.requestFlyTo);

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => (q.trim().length >= 2 ? search(searchIndex, q, 8) : []), [q, searchIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  const pick = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    let lat = hit.lat;
    let lng = hit.lng;
    if (!Number.isFinite(lat) && hit.buildingId) {
      const b = data.buildings.find((x) => x.id === hit.buildingId);
      if (b) {
        const c = b.ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
        lng = c[0] / b.ring.length;
        lat = c[1] / b.ring.length;
      }
    }
    if (hit.buildingId) selectBuilding(hit.buildingId);
    else focusPoi(hit.id);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      requestFlyTo({ lat, lng, zoom: 17.2, pitch: 52 });
      if (mode === 'indoor') setMode('outdoor');
    }
    setOpen(false);
    setQ(hit.title);
  };

  return (
    <header
      className="scrim-top"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 'var(--bar-h)', zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
        <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', borderRadius: 'var(--r-pill)' }}>
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0b1210" />
            <path d="M6 21l6-11 4 7 3-5 7 9z" fill="#5eead4" />
            <circle cx="24" cy="9" r="3" fill="#2dd4bf" />
          </svg>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em' }}>IIT Mandi Campus Map</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-3)', letterSpacing: '.08em' }}>
              3D DIGITAL TWIN · KAMAND
            </div>
          </div>
        </div>
      </div>

      <div style={{ pointerEvents: 'auto' }}>
        <Segmented
          ariaLabel="Navigate outdoor or indoor"
          value={mode === 'indoor' ? 'indoor' : view}
          options={[
            { id: '3d', label: '3D', title: 'Outdoor 3D campus scene' },
            { id: 'map', label: 'Map', title: 'Outdoor plan / satellite view' },
            { id: 'indoor', label: 'Indoor', title: 'Indoor navigation — upload and label a real floor plan' },
          ]}
          onChange={(v) => {
            if (v === 'indoor') setMode('indoor');
            else {
              setMode('outdoor');
              setView(v);
            }
          }}
        />
      </div>

      <div ref={wrapRef} style={{ position: 'relative', flex: '1 1 260px', maxWidth: 460, pointerEvents: 'auto' }}>
        <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: 'var(--r-pill)', height: 40 }}>
          <IconSearch className="text-[var(--text-3)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter') pick(active);
            }}
            placeholder="Search buildings, mess, A18, health centre…  ( / )"
            aria-label="Search campus"
            aria-expanded={open}
            aria-controls="search-results"
            style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', fontSize: 13, minWidth: 0 }}
          />
          {q && (
            <button className="btn btn-icon" style={{ minHeight: 28, padding: 4, background: 'transparent', border: 0 }} onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Clear search">
              <IconClose />
            </button>
          )}
        </div>
        {open && hits.length > 0 && (
          <ul
            id="search-results"
            role="listbox"
            className="glass fade-in"
            style={{ position: 'absolute', top: 46, left: 0, right: 0, margin: 0, padding: 6, listStyle: 'none', borderRadius: 'var(--r-md)', maxHeight: 340, overflow: 'auto' }}
          >
            {hits.map((h, i) => (
              <li key={h.id}>
                <button
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  style={{
                    display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left',
                    background: i === active ? 'var(--surface-3)' : 'transparent', border: 0, padding: '9px 10px',
                    borderRadius: 'var(--r-sm)', cursor: 'pointer',
                  }}
                >
                  <IconBuilding className="text-[var(--accent)]" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>{h.subtitle}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, pointerEvents: 'auto' }}>
        <button
          className="btn btn-icon"
          title="Copy a shareable link to this view"
          aria-label="Share this view"
          onClick={async () => {
            const url = buildShareUrl({});
            try {
              await navigator.clipboard.writeText(url);
              notify('Link copied. It reopens this exact view.', 'info');
            } catch {
              notify('Copy failed — the URL is in the address bar.', 'warn');
            }
          }}
        >
          <IconShare />
        </button>
        <button
          className="btn btn-icon"
          title="About this map, its data sources and its accuracy"
          aria-label="About this map"
          onClick={() => useUi.getState().setPanel('about')}
        >
          <IconInfo />
        </button>
      </div>
    </header>
  );
}

export function ModeBadge() {
  const mode = useUi((s) => s.mode);
  return (
    <span className="chip" style={{ gap: 6 }}>
      {mode === 'indoor' ? <IconIndoor /> : <IconBuilding />}
      {mode === 'indoor' ? 'Indoor' : 'Outdoor'}
    </span>
  );
}
