import { formatIqd } from '@/lib/money';

export type CardPayOverlayState =
  | { phase: 'idle' }
  | { phase: 'processing'; amount: number }
  | { phase: 'success'; amount: number }
  | { phase: 'error'; amount: number; message: string };

function MastercardMark() {
  return (
    <div className="pos-card-pay-logo" aria-hidden>
      <span className="pos-card-pay-circle pos-card-pay-circle-red" />
      <span className="pos-card-pay-circle pos-card-pay-circle-yellow" />
    </div>
  );
}

function ContactlessWaves() {
  return (
    <div className="pos-card-pay-waves" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

function ProcessingPulse() {
  return (
    <div className="pos-card-pay-pulse" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

function SuccessMark() {
  return (
    <div className="pos-card-pay-success" aria-hidden>
      <svg viewBox="0 0 52 52" className="pos-card-pay-check">
        <circle className="pos-card-pay-check-circle" cx="26" cy="26" r="24" fill="none" />
        <path className="pos-card-pay-check-path" fill="none" d="M14 27l8 8 16-18" />
      </svg>
    </div>
  );
}

function ErrorMark() {
  return (
    <div className="pos-card-pay-error-icon" aria-hidden>
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M18 18l16 16M34 18 18 34" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function CardPayOverlay({
  state,
  onRetry,
  onCancel,
}: {
  state: CardPayOverlayState;
  onRetry: () => void;
  onCancel: () => void;
}) {
  if (state.phase === 'idle') return null;

  const isProcessing = state.phase === 'processing';
  const isSuccess = state.phase === 'success';
  const isError = state.phase === 'error';
  const amount = state.amount;

  return (
    <div className="pos-card-pay-overlay" role="dialog" aria-modal aria-labelledby="pos-card-pay-title">
      <div className={`pos-card-pay-panel ${isProcessing ? 'is-processing' : ''} ${isSuccess ? 'is-success' : ''} ${isError ? 'is-error' : ''}`}>
        {isProcessing && (
          <>
            <ProcessingPulse />
            <ContactlessWaves />
          </>
        )}

        <div className="pos-card-pay-body">
          {isError ? <ErrorMark /> : isSuccess ? <SuccessMark /> : <MastercardMark />}

          <h2 id="pos-card-pay-title" className="pos-card-pay-title">
            {isError ? 'فشل الدفع بالماستر' : isSuccess ? 'تم الدفع بنجاح' : 'ماستر كارد'}
          </h2>

          <p className="pos-card-pay-sub">
            {isError
              ? 'لم تكتمل العملية على جهاز الدفع'
              : isSuccess
                ? 'جاري حفظ الفاتورة…'
                : 'مرّر البطاقة أو أدخلها في جهاز PAX'}
          </p>

          <div className="pos-card-pay-amount num">{formatIqd(amount)}</div>

          {isProcessing && (
            <div className="pos-card-pay-wait">
              <span className="pos-card-pay-dot" />
              <span className="pos-card-pay-dot" />
              <span className="pos-card-pay-dot" />
              <span className="pos-card-pay-wait-text">بانتظار الجهاز</span>
            </div>
          )}

          {isError && (
            <>
              <div className="pos-card-pay-error-box">{state.message}</div>
              <div className="pos-card-pay-actions">
                <button type="button" className="pos-card-pay-btn ghost" onClick={onCancel}>
                  إلغاء
                </button>
                <button type="button" className="pos-card-pay-btn primary" onClick={onRetry}>
                  إعادة المحاولة
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
