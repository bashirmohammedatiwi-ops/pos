import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@fot/shared';

interface Props {
  children: ReactNode;
  compact?: boolean;
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { context: `Admin render: ${info.componentStack?.slice(0, 800) ?? ''}` });
    console.error('App error:', error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'خطأ غير متوقع';
    const compact = this.props.compact;

    return (
      <div
        dir="rtl"
        className={compact ? 'flex min-h-[40vh] flex-col items-center justify-center p-6 text-center' : ''}
        style={
          compact
            ? undefined
            : {
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
                padding: '2rem',
                background: '#0f172a',
                color: '#fff',
                fontFamily: 'system-ui, sans-serif',
                textAlign: 'center',
              }
        }
      >
        <div className={compact ? 'max-w-md rounded-lg border border-red-200 bg-white p-8 shadow-lg' : undefined} style={compact ? undefined : { maxWidth: 420 }}>
          <h1 className={compact ? 'text-lg font-bold text-slate-900' : undefined} style={compact ? undefined : { margin: 0, fontSize: 18 }}>
            حدث خطأ في لوحة التحكم
          </h1>
          <p className={compact ? 'mt-2 text-sm text-muted' : undefined} style={compact ? undefined : { margin: '10px 0 0', fontSize: 13, lineHeight: 1.8, color: '#94a3b8', wordBreak: 'break-word' }}>
            {message}
          </p>
          <div className={compact ? 'mt-6 flex flex-wrap justify-center gap-2' : undefined} style={compact ? undefined : { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'center' }}>
            <button
              type="button"
              className={compact ? 'rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white' : undefined}
              style={compact ? undefined : { padding: '.6rem 1.4rem', borderRadius: 12, border: 0, background: '#0f9f76', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => this.setState({ error: null })}
            >
              متابعة العمل
            </button>
            <button
              type="button"
              className={compact ? 'rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50' : undefined}
              style={compact ? undefined : { padding: '.6rem 1.4rem', borderRadius: 12, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: '#e2e8f0', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => {
                if (window.fotDesktop?.recover) {
                  void window.fotDesktop.recover();
                  return;
                }
                window.location.reload();
              }}
            >
              إعادة تحميل
            </button>
          </div>
        </div>
      </div>
    );
  }
}
