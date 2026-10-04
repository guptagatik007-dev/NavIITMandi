import { useEffect } from 'react';
import { useUi } from '@/store/uiStore';

export function Toast() {
  const toast = useUi((s) => s.toast);
  const clear = useUi((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 5200);
    return () => clearTimeout(t);
  }, [toast, clear]);

  if (!toast) return null;
  const color = toast.kind === 'error' ? 'var(--danger)' : toast.kind === 'warn' ? 'var(--warn)' : 'var(--accent)';

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass fade-in"
      style={{
        position: 'absolute', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 60,
        padding: '10px 14px', borderRadius: 'var(--r-pill)', maxWidth: 'min(520px, 90vw)',
        display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, borderLeft: `3px solid ${color}`,
      }}
    >
      <span>{toast.msg}</span>
      <button className="btn btn-icon" style={{ minHeight: 24, padding: 2, border: 0, background: 'transparent' }} onClick={clear} aria-label="Dismiss message">
        ✕
      </button>
    </div>
  );
}
