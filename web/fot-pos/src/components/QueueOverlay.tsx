import { useMemo, useState } from 'react';
import type { OutboxRow } from '@/lib/db';
import { OUTBOX_MAX_RETRIES } from '@/lib/catalogSync';
import { formatIqd, formatNum } from '@/lib/money';
import type { ResolvedCashierPermissions } from '@/lib/permissions';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export type QueueTab = 'deferred' | 'queued' | 'dead';

function kindLabel(kind: number) {
  if (kind === 1) return 'مرتجع';
  if (kind === 2) return 'هدية';
  return 'بيع';
}

type QueuePayloadItem = {
  articleId: number;
  barcode?: string | null;
  quantity: number;
  price: number;
  originalPrice: number;
};

export type QueuePayload = {
  kind?: number;
  payment?: number;
  userDiscount?: number;
  items?: QueuePayloadItem[];
};

export function queueRowTotal(row: OutboxRow): number {
  const payload = (row.payload ?? {}) as QueuePayload;
  const items = payload.items ?? [];
  const raw = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price) || 0), 0);
  const subtotal = payload.kind === 1 ? Math.abs(raw) : raw;
  return Math.max(0, subtotal - (Number(payload.userDiscount) || 0));
}

export function queueRowCount(row: OutboxRow): number {
  return ((row.payload as QueuePayload | null)?.items ?? []).length;
}

/** Local queue dashboard: deferred (manual transfer), waiting, and failed invoices. */
export function QueueOverlay({
  rows,
  px,
  busy,
  onTransfer,
  onEdit,
  onDelete,
  onRetry,
  onFlush,
  onClose,
  onReprint,
}: {
  rows: OutboxRow[];
  px: ResolvedCashierPermissions;
  busy: boolean;
  onTransfer: (ids?: number[]) => void;
  onEdit: (row: OutboxRow) => void;
  onDelete: (row: OutboxRow) => void;
  onRetry: (row: OutboxRow) => void;
  onFlush: () => void;
  onClose: () => void;
  onReprint: (row: OutboxRow) => void;
}) {
  const isDead = (r: OutboxRow) => (r.retryCount ?? 0) >= OUTBOX_MAX_RETRIES;
  const deferred = useMemo(() => rows.filter(r => r.status === 'deferred' && !isDead(r)), [rows]);
  const queued = useMemo(() => rows.filter(r => r.status !== 'deferred' && !isDead(r)), [rows]);
  const dead = useMemo(() => rows.filter(isDead), [rows]);
  const initial: QueueTab = deferred.length > 0 ? 'deferred' : dead.length > 0 ? 'dead' : 'queued';
  const [tab, setTab] = useState<QueueTab>(initial);
  const [confirm, setConfirm] = useState<
    | { kind: 'all' }
    | { kind: 'transfer'; row: OutboxRow }
    | { kind: 'delete'; row: OutboxRow }
    | null
  >(null);
  const canEdit = px.allowEditReceipt;

  const tabs: Array<{ id: QueueTab; label: string; count: number; tone: string }> = [
    { id: 'deferred', label: 'مؤجلة', count: deferred.length, tone: 'text-amber-700' },
    { id: 'queued', label: 'الطابور', count: queued.length, tone: 'text-teal-700' },
    { id: 'dead', label: 'فاشلة', count: dead.length, tone: 'text-red-600' },
  ];
  const visible = tab === 'deferred' ? deferred : tab === 'queued' ? queued : dead;

  return (
    <div className="pos-overlay" onClick={onClose}>
      <div className="pos-dialog max-w-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">الفواتير المحلية</h2>
          <div className="flex items-center gap-2">
            {tab === 'deferred' && deferred.length > 0 && (
              <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'all' })} className="h-9 rounded-lg bg-[#0f9f76] px-4 text-[13px] font-bold text-white disabled:opacity-50">
                ترحيل الكل ({formatNum(deferred.length)})
              </button>
            )}
            {tab === 'queued' && (
              <button type="button" disabled={busy} onClick={onFlush} className="pos-chip">إعادة الرفع</button>
            )}
            <button type="button" onClick={onClose} className="text-[12px] text-slate-500">إغلاق</button>
          </div>
        </div>

        <div className="mb-3 flex gap-1 border-b border-slate-100 pb-2">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`pos-chip ${tab === t.id ? 'pos-chip-on' : ''}`}
            >
              <span className={t.count > 0 ? t.tone : ''}>{t.label}</span>
              <span className="num mr-1 rounded-full bg-slate-100 px-1.5 text-[11px]">{formatNum(t.count)}</span>
            </button>
          ))}
        </div>

        {tab === 'deferred' && (
          <p className="mb-2 text-[12px] text-slate-500">
            {canEdit
              ? 'فواتير محفوظة محلياً — افتح التعديل للترحيل أو الحذف، أو استخدم «ترحيل الكل»'
              : 'فواتير محفوظة محلياً — لا تُرفع للإدارة إلا بضغط «ترحيل»'}
          </p>
        )}
        {tab === 'dead' && (
          <p className="mb-2 text-[12px] text-red-600">
            فواتير فشل رفعها بعد عدة محاولات — تبقى محفوظة ولن تُحذف إلا بعد قبول الخادم. «إعادة المحاولة» تصفّر عداد المحاولات.
          </p>
        )}

        {visible.length === 0 && (
          <p className="py-8 text-center text-slate-400">
            {tab === 'deferred' ? 'لا توجد فواتير مؤجلة' : tab === 'queued' ? 'الطابور فارغ' : 'لا توجد فواتير فاشلة'}
          </p>
        )}

        <div className="max-h-96 space-y-1.5 overflow-auto">
          {visible.map(row => {
            const payload = (row.payload ?? {}) as QueuePayload;
            return (
              <div key={row.id ?? row.clientReceiptId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
                <div className="min-w-0">
                  <div className="font-semibold">
                    #{row.localNumber} — {kindLabel(payload.kind ?? 0)} · {formatNum(queueRowCount(row))} بند
                  </div>
                  <div className="text-slate-500">
                    {new Date(row.createdAt).toLocaleString('en-GB')}
                    {row.status === 'deferred' ? ' · مؤجلة' : ` · محاولات ${formatNum(row.retryCount ?? 0)}`}
                    {row.editedAt ? ' · معدّلة' : ''}
                  </div>
                  {row.lastError && <div className="mt-1 text-red-600">{row.lastError}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="num text-[13px] font-semibold">{formatIqd(queueRowTotal(row))}</div>
                  {tab === 'deferred' && (
                    <>
                      {canEdit && (
                        <button type="button" onClick={() => onEdit(row)} className="pos-chip">تعديل</button>
                      )}
                      {!canEdit && (
                        <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'transfer', row })} className="pos-chip">ترحيل</button>
                      )}
                      {!canEdit && px.discardReceipt && (
                        <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'delete', row })} className="pos-chip text-red-600">حذف</button>
                      )}
                    </>
                  )}
                  {tab === 'dead' && (
                    <button type="button" onClick={() => onRetry(row)} className="pos-chip">إعادة المحاولة</button>
                  )}
                  <button type="button" onClick={() => onReprint(row)} className="pos-chip">طباعة</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {confirm?.kind === 'all' && (
        <ConfirmDialog
          title="ترحيل كل الفواتير؟"
          message={`سيتم ترحيل ${formatNum(deferred.length)} فاتورة مؤجلة إلى الإدارة. هل تريد المتابعة؟`}
          busy={busy}
          onConfirm={() => { setConfirm(null); onTransfer(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === 'transfer' && (
        <ConfirmDialog
          title="ترحيل الفاتورة؟"
          message={`هل تريد ترحيل الفاتورة #${formatNum(confirm.row.localNumber)} بمبلغ ${formatIqd(queueRowTotal(confirm.row))}؟`}
          busy={busy}
          onConfirm={() => { const id = confirm.row.id; setConfirm(null); if (id != null) onTransfer([id]); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title="حذف الفاتورة؟"
          message={`هل تريد حذف الفاتورة #${formatNum(confirm.row.localNumber)}؟ لا يمكن التراجع بعد الحذف.`}
          danger
          busy={busy}
          onConfirm={() => { const row = confirm.row; setConfirm(null); onDelete(row); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
