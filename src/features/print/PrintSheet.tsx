/**
 * PrintSheet.tsx — printable wayfinding cards, one QR per named building.
 *
 * Deep links are the highest-value navigation feature for a real campus: paste these at
 * gates, hostel noticeboards and department entrances, and a scan opens the map already
 * framed on that building. QR images are generated in the browser, so this page needs
 * no network and no third-party image service.
 */
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useCampus } from '@/app/CampusContext';

export function PrintSheet() {
  const { data } = useCampus();
  const [qr, setQr] = useState<Record<string, string>>({});
  const base = useMemo(() => `${window.location.origin}${window.location.pathname}`, []);

  const items = useMemo(
    () =>
      data.buildings
        .filter((b) => b.scope === 'campus' && b.named)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.buildings],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const b of items) {
        out[b.id] = await QRCode.toDataURL(`${base}?b=${encodeURIComponent(b.id)}`, {
          margin: 1,
          width: 220,
          errorCorrectionLevel: 'M',
          color: { dark: '#10241f', light: '#ffffff' },
        });
      }
      if (!cancelled) setQr(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [items, base]);

  return (
    <div style={{ minHeight: '100%', background: '#fff', color: '#10241f', padding: 24, fontFamily: 'var(--font-sans)' }}>
      <header className="no-print" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>IIT Mandi — wayfinding QR sheet</h1>
        <p style={{ fontSize: 12.5, color: '#456', maxWidth: 720, lineHeight: 1.7 }}>
          {items.length} named campus buildings. Each card opens the 3D map already framed on that building.
          Print, laminate and pin at gates, hostel noticeboards and department entrances. Nothing here requires
          a login, and the map itself works from the cached campus basemap.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>Print this sheet</button>
          <a className="btn" href={base}>Back to the map</a>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))', gap: 12 }}>
        {items.map((b) => (
          <div key={b.id} className="print-card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {qr[b.id] ? (
                <img src={qr[b.id]} alt={`QR code for ${b.name}`} width={78} height={78} />
              ) : (
                <div style={{ width: 78, height: 78, background: '#f0f0f0', borderRadius: 6 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.25 }}>{b.name}</div>
                <div style={{ fontSize: 11, color: '#567' }}>{b.cat} · {b.floors} floors</div>
                <div style={{ fontSize: 10, color: '#789', wordBreak: 'break-all', marginTop: 4 }}>
                  {base.replace(/^https?:\/\//, '')}?b={b.id}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <footer style={{ marginTop: 22, fontSize: 11, color: '#678', lineHeight: 1.7 }}>
        Footprints: OpenStreetMap contributors (ODbL) + Overture Maps. Terrain: AWS/Mapzen. Imagery: Esri,
        Maxar, Earthstar Geographics. Floor counts marked as derived come from documented category defaults.
      </footer>
    </div>
  );
}
