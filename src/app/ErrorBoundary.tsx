import React from 'react';

interface State {
  error: Error | null;
  info: string;
}

/** Fail visibly and usefully: a blank canvas with no explanation is the worst outcome. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' });
    // eslint-disable-next-line no-console
    console.error('[campus-map] render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const offline = !navigator.onLine;
    return (
      <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="glass" style={{ maxWidth: 560, padding: 22, borderRadius: 'var(--r-lg)' }}>
          <h1 style={{ fontSize: 17, margin: '0 0 8px' }}>The map hit an error</h1>
          <p style={{ fontSize: 12.8, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>
            {offline
              ? 'This device appears to be offline. The campus basemap is baked into the app, so a reload should still work — if it does not, the local data files may not have loaded.'
              : 'Something threw while rendering. The details below are enough to file a bug; nothing was sent anywhere automatically.'}
          </p>
          <pre className="mono" style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', fontSize: 10.5, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
            {this.state.info ? `\n${this.state.info.split('\n').slice(0, 6).join('\n')}` : ''}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload the map</button>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(`${this.state.error?.message}\n${this.state.info}`)}>
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
