import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@fot/shared';

interface Props {
  children: ReactNode;
  compact?: boolean;
  resetKey?: string;
}

interface State {
  error: Error | null;
  copied: boolean;
}

/** رسم توضيحي بسيط لحالة الخطأ. */
function ErrorArt({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden>
      <circle cx="48" cy="48" r="44" className="fill-red-50" />
      <rect x="22" y="26" width="52" height="40" rx="7" className="fill-white stroke-red-200" strokeWidth="2" />
      <path d="M22 35h52" className="stroke-red-200" strokeWidth="2" />
      <circle cx="29" cy="30.5" r="1.6" className="fill-red-300" />
      <circle cx="34.5" cy="30.5" r="1.6" className="fill-red-200" />
      <circle cx="40" cy="30.5" r="1.6" className="fill-red-100" />
      <path d="M48 42v10" className="stroke-red-500" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="58" r="2" className="fill-red-500" />
      <path d="M36 74h24" className="stroke-red-200" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error) {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { context: `Admin render: ${info.componentStack?.slice(0, 800) ?? ''}` });
    console.error('App error:', error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, copied: false });
    }
  }

  private reload = () => {
    if (window.fotDesktop?.recover) {
      void window.fotDesktop.recover();
      return;
    }
    window.location.reload();
  };

  private goHome = () => {
    // يعمل مع HashRouter (سطح المكتب) و BrowserRouter (المتصفح)
    // سطح المكتب (file:// أو fotDesktop) يستخدم HashRouter حتى لو كان الـ hash فارغاً
    const hashRouter = Boolean(window.fotDesktop) || window.location.protocol === 'file:' || window.location.hash.startsWith('#/');
    if (hashRouter) {
      window.location.hash = '#/';
      window.location.reload();
    } else {
      window.location.assign('/');
    }
  };

  private copyDetails = async () => {
    const e = this.state.error;
    if (!e) return;
    const text = `${e.name}: ${e.message}\n${e.stack ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 1600);
    } catch { /* ignore */ }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'خطأ غير متوقع';
    const compact = this.props.compact;

    if (compact) {
      return (
        <div dir="rtl" className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center">
          <ErrorArt size={64} />
          <h2 className="mt-3 text-[15px] font-bold text-header">تعذّر عرض هذا الجزء</h2>
          <p className="mt-1 max-w-sm break-words text-[12.5px] leading-5 text-slate-500">{message}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-[13px] font-semibold text-white transition hover:bg-brand-700"
              onClick={() => this.setState({ error: null, copied: false })}
            >
              إعادة المحاولة
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={this.reload}
            >
              إعادة تحميل
            </button>
          </div>
        </div>
      );
    }

    return (
      <div dir="rtl" className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-canvas p-6 text-center">
        <div className="card w-full max-w-md p-8">
          <div className="flex justify-center"><ErrorArt /></div>
          <h1 className="mt-4 text-[18px] font-extrabold text-header">حدث خطأ في لوحة الإدارة</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            لا تقلق، بياناتك محفوظة. جرّب المتابعة أو إعادة تحميل الصفحة.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-5 text-[13px] font-semibold text-white transition hover:bg-brand-700"
              onClick={() => this.setState({ error: null, copied: false })}
            >
              متابعة العمل
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={this.reload}
            >
              إعادة تحميل
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-lg px-4 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100"
              onClick={this.goHome}
            >
              الرئيسية
            </button>
          </div>
          <details className="mt-6 rounded-lg border border-slate-200 bg-slate-50 text-right">
            <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-slate-500">تفاصيل تقنية</summary>
            <div className="border-t border-slate-200 px-3 py-2">
              <p className="break-words font-mono text-[11.5px] leading-5 text-red-700" dir="ltr">{message}</p>
              <button
                type="button"
                onClick={() => void this.copyDetails()}
                className="mt-2 text-[11.5px] font-semibold text-brand-700 hover:text-brand-800"
              >
                {this.state.copied ? 'تم النسخ ✓' : 'نسخ التفاصيل للدعم الفني'}
              </button>
            </div>
          </details>
        </div>
      </div>
    );
  }
}
