
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconSearch = (p: { className?: string }) => (
  <svg {...base} className={p.className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconLayers = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
);
export const IconRoute = (p: { className?: string }) => (
  <svg {...base} className={p.className}><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H14a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6.5" /></svg>
);
export const IconInfo = (p: { className?: string }) => (
  <svg {...base} className={p.className}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
);
export const IconClose = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="m6 6 12 12M18 6 6 18" /></svg>
);
export const IconBuilding = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M4 21V6l7-3v18" /><path d="M11 21h9V10l-9-4" /><path d="M7 9h1M7 13h1M7 17h1M15 13h1M15 17h1" /></svg>
);
export const IconIndoor = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M3 3h18v18H3z" /><path d="M9 3v18M9 9h6M9 15h4" /></svg>
);
export const IconCompass = (p: { className?: string }) => (
  <svg {...base} className={p.className}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>
);
export const IconShare = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M12 3v11" /><path d="m8 7 4-4 4 4" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
);
export const IconLocation = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
export const IconWalk = (p: { className?: string }) => (
  <svg {...base} className={p.className}><circle cx="13" cy="4.5" r="1.8" /><path d="m12 8-2 4 2 3 1 6" /><path d="m10 12-3 1" /><path d="m13 11 3 2" /></svg>
);
export const IconStairs = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M4 20h4v-4h4v-4h4V8h4" /></svg>
);
export const IconAlert = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17h.01" /></svg>
);
export const IconPrint = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="2" /><path d="M7 14h10v6H7z" /></svg>
);
export const IconCheck = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="m4 12 5 5L20 6" /></svg>
);
export const IconSpinner = (p: { className?: string }) => (
  <svg {...base} className={p.className} style={{ animation: 'spin 1s linear infinite' }}>
    <path d="M12 3a9 9 0 1 0 9 9" />
    <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
  </svg>
);

export const IconEdit = (p: { className?: string }) => (
  <svg {...base} className={p.className}><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m14 6 4 4" /></svg>
);
