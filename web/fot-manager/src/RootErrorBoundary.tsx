import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

function resetAppStorage() {
  try {
    localStorage.removeItem('fot_manager_cache_v3');
    localStorage.removeItem('fot_manager_cache');
    sessionStorage.clear();
  } catch { /* ignore */ }
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FOT Manager boot error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-card" style={{ margin: '24px auto', maxWidth: 420, padding: 22, borderRadius: 24, background: '#fff', border: '1px solid #e8edf3' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>تعذّر تحميل لوحة المدير</h1>
          <p style={{ marginTop: 10, color: '#64748b', fontWeight: 600, lineHeight: 1.6 }}>
            {this.state.error.message || 'خطأ غير متوقع'}
          </p>
          <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
            <button type="button" className="boot-primary" style={{ border: 0, borderRadius: 16, padding: 13, fontWeight: 800, background: '#4338ca', color: '#fff' }} onClick={() => window.location.reload()}>
              تحديث الصفحة
            </button>
            <button
              type="button"
              style={{ border: 0, borderRadius: 16, padding: 13, fontWeight: 800, background: '#eef2ff', color: '#4338ca' }}
              onClick={() => { resetAppStorage(); window.location.reload(); }}
            >
              مسح الذاكرة وإعادة المحاولة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
