import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

function resetAppStorage() {
  try {
    localStorage.removeItem('fot_manager_cache_v3');
    localStorage.removeItem('fot_manager_cache');
    localStorage.removeItem('fot_manager_cache_v2');
  } catch { /* ignore */ }
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FOT Manager boot error', error, info);
    try {
      const retried = sessionStorage.getItem('fot_boot_retry') === '1';
      if (!retried) {
        sessionStorage.setItem('fot_boot_retry', '1');
        resetAppStorage();
        window.location.reload();
      }
    } catch { /* private mode */ }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f7f8fc' }}>
          <div style={{ width: 'min(420px, 100%)', padding: 22, borderRadius: 24, background: '#fff', border: '1px solid #e8edf3' }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>حدث خطأ مؤقت</h1>
            <p style={{ marginTop: 10, color: '#64748b', fontWeight: 600, lineHeight: 1.6 }}>
              حدّث الصفحة. إن استمرّت المشكلة افتح الرابط من المتصفح وليس من اختصار قديم.
            </p>
            <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
              <button type="button" style={{ border: 0, borderRadius: 16, padding: 13, fontWeight: 800, background: '#4338ca', color: '#fff' }} onClick={() => window.location.reload()}>
                تحديث الصفحة
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
