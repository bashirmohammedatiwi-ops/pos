import { useEffect } from 'react';

/** Yes/No confirmation over any POS overlay — prevents accidental transfer or delete. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'نعم',
  cancelLabel = 'لا',
  danger = false,
  busy = false,
  alert = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  alert?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (alert) onConfirm();
        else onCancel();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [alert, busy, onCancel, onConfirm]);

  return (
    <div
      className="pos-overlay pos-confirm-overlay"
      onClick={e => {
        e.stopPropagation();
        if (busy) return;
        if (alert) onConfirm();
        else onCancel();
      }}
    >
      <div className="pos-dialog max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold">{title}</h3>
        <p className="mt-2 text-[13px] leading-6 text-slate-600">{message}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          {!alert && (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="h-11 min-w-[88px] rounded-lg border border-slate-200 bg-white px-5 text-[13px] font-bold text-slate-600 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-11 min-w-[88px] rounded-lg px-5 text-[13px] font-bold text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0f9f76] hover:bg-[#0d8a66]'
            }`}
          >
            {busy ? 'جاري…' : alert ? (confirmLabel === 'نعم' ? 'حسناً' : confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
