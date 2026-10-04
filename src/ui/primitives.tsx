import React from 'react';

export function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' | 'warn' | 'danger' | 'muted' }) {
  const color =
    tone === 'accent' ? 'var(--accent)' : tone === 'warn' ? 'var(--warn)' : tone === 'danger' ? 'var(--danger)' : tone === 'muted' ? 'var(--text-3)' : 'var(--text-2)';
  return (
    <span className="chip" style={{ color, borderColor: tone === 'default' || tone === 'muted' ? undefined : 'currentcolor' }}>
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 0' }}>
      <label htmlFor={id} style={{ cursor: disabled ? 'not-allowed' : 'pointer', flex: 1, opacity: disabled ? 0.55 : 1 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
      </label>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 42, height: 24, borderRadius: 999, border: '1px solid var(--hairline)',
          background: checked ? 'var(--accent)' : 'var(--surface-3)', position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer', flex: '0 0 auto', opacity: disabled ? 0.5 : 1,
          transition: 'background var(--dur) var(--ease)',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
            background: checked ? 'var(--accent-ink)' : 'var(--text-3)', transition: 'left var(--dur) var(--ease)',
          }}
        />
      </button>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 className="label-h" style={{ margin: 0 }}>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
  art = 'grid',
}: {
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  art?: 'grid' | 'route' | 'search';
}) {
  return (
    <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-2)' }}>
      <Art kind={art} />
      <h3 style={{ margin: '14px 0 6px', fontSize: 15, color: 'var(--text)' }}>{title}</h3>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>{body}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

function Art({ kind }: { kind: 'grid' | 'route' | 'search' }) {
  return (
    <svg width="132" height="88" viewBox="0 0 132 88" aria-hidden="true" style={{ opacity: 0.55 }}>
      <defs>
        <pattern id={`p-${kind}`} width="11" height="11" patternUnits="userSpaceOnUse">
          <path d="M11 0H0v11" fill="none" stroke="var(--hairline-strong)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="132" height="88" fill={`url(#p-${kind})`} opacity="0.5" />
      {kind === 'route' ? (
        <>
          <path d="M14 74 C 44 74, 34 40, 62 40 S 96 12, 118 14" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="5 4" />
          <circle cx="14" cy="74" r="5" fill="var(--accent)" />
          <circle cx="118" cy="14" r="5" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        </>
      ) : (
        <>
          <rect x="18" y="22" width="40" height="30" fill="none" stroke="var(--text-3)" strokeWidth="1.6" />
          <rect x="70" y="34" width="44" height="40" fill="none" stroke="var(--text-3)" strokeWidth="1.6" />
          <path d="M18 60h96M58 22v52" stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3" />
        </>
      )}
    </svg>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { id: T; label: string; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          aria-pressed={value === o.id}
          aria-disabled={o.disabled}
          title={o.title}
          disabled={o.disabled}
          onClick={() => !o.disabled && onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'warn' }) {
  return (
    <div style={{ flex: 1, minWidth: 74 }}>
      <div className="label-h">{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: tone === 'accent' ? 'var(--accent)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)' }}>
        {value}
      </div>
    </div>
  );
}

/** Staged progress copy instead of a bare spinner (spec: no >1 s spinner with no words). */
export function ProgressStages({ stage }: { stage: string }) {
  const stages = ['Loading terrain…', 'Loading buildings and roads…', 'Lighting the scene…', 'Almost there…'];
  const idx = Math.max(0, stages.findIndex((s) => s === stage));
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div className="mono" style={{ fontSize: 12, color: 'var(--accent)', letterSpacing: '.04em' }}>{stage}</div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 12 }}>
        {stages.map((s, i) => (
          <span
            key={s}
            style={{
              width: 34, height: 4, borderRadius: 999,
              background: i <= (idx < 0 ? 0 : idx) ? 'var(--accent)' : 'var(--surface-3)',
              transition: 'background var(--dur) var(--ease)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Accessible "handoff" row used for links (docs, contract, report a data error). */
export function LinkRow({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'block', padding: '9px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--hairline)',
        textDecoration: 'none', color: 'var(--text)', marginBottom: 8, background: 'var(--surface-2)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
    </a>
  );
}
