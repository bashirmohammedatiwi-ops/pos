import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@fot/shared';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort render guard for the POS terminal: a JS error must never white-screen
 * a cashier mid-sale. Shows a recoverable Arabic error screen with reload/retry and
 * reports the error to the server's client-error log.
 */
export class PosErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { context: `POS render: ${info.componentStack?.slice(0, 800) ?? ''}` });
    console.error('[fot-pos] render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'خطأ غير متوقع';
    return (
      <div
        dir="rtl"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          background: '#0b1220',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(239,68,68,.15)',
            color: '#f87171',
            fontSize: 26,
          }}
        >
          ⚠
        </div>
        <h1 style={{ margin: 0, fontSize: 18 }}>حدث خطأ في شاشة البيع</h1>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.8,
            color: '#94a3b8',
            maxWidth: 420,
            wordBreak: 'break-word',
          }}
        >
          {message}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
          أُبلغ الإدارة بالخطأ تلقائياً — الفواتير المحفوظة محلياً آمنة ولن تُفقد
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '.6rem 1.4rem',
              borderRadius: 12,
              border: 0,
              background: '#0f9f76',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            متابعة البيع
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '.6rem 1.4rem',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,.2)',
              background: 'transparent',
              color: '#e2e8f0',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            إعادة تشغيل الشاشة
          </button>
        </div>
      </div>
    );
  }
}
