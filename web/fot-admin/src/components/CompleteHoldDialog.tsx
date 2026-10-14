import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { useToast } from '@/components/Toast';
import { Btn, Field, Input, Modal } from '@/components/ui';
import { IconCheckCircle, IconClock } from '@/components/icons';

export interface HoldTarget {
  id: number;
  totalAmount: number;
  cashierName?: string | null;
  salesmanName?: string | null;
  itemCount?: number;
}

/** مبالغ مقترحة: المبلغ نفسه ثم التقريب لأقرب فئات نقدية شائعة. */
function quickAmounts(total: number) {
  const set = new Set<number>([total]);
  for (const step of [1000, 5000, 10000, 25000, 50000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) set.add(v);
    if (set.size >= 4) break;
  }
  return [...set].sort((a, b) => a - b);
}

export function CompleteHoldDialog({
  hold,
  onClose,
}: {
  hold: HoldTarget | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [payment, setPayment] = useState('');

  useEffect(() => {
    if (hold) setPayment(String(hold.totalAmount));
  }, [hold]);

  const due = hold?.totalAmount ?? 0;
  const paid = Number(payment);
  const valid = payment.trim() !== '' && Number.isFinite(paid) && paid >= due;
  const change = Number.isFinite(paid) ? Math.max(0, paid - due) : 0;
  const quick = useMemo(() => quickAmounts(due), [due]);

  const complete = useMutation({
    mutationFn: () => {
      if (!hold) throw new Error('لا فاتورة');
      if (!valid) throw new Error('المبلغ المدفوع يجب ألا يقل عن إجمالي الفاتورة');
      return api.completeHold(hold.id, paid);
    },
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['hold-receipts'] });
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['recent-receipts'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['cash-today'] });
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      toast.success(`تم إكمال الفاتورة #${r.number}`);
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل إكمال الفاتورة'),
  });

  function submit() {
    if (!valid || complete.isPending) return;
    complete.mutate();
  }

  return (
    <Modal
      open={!!hold}
      title="إكمال فاتورة معلّقة"
      subtitle={hold ? `فاتورة #${hold.id}` : undefined}
      icon={<IconClock size={18} />}
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
          <Btn
            icon={<IconCheckCircle size={15} />}
            onClick={submit}
            disabled={!valid}
            loading={complete.isPending}
          >
            إكمال الفاتورة
          </Btn>
        </div>
      }
    >
      {hold && (
        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-slate-500">الكاشير</p>
              <p className="truncate font-semibold text-header">{hold.cashierName ?? '—'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-slate-500">{hold.salesmanName ? 'البائع' : 'الأصناف'}</p>
              <p className="truncate font-semibold text-header">
                {hold.salesmanName ?? (hold.itemCount != null ? formatNum(hold.itemCount) : '—')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
            <span className="text-[12.5px] font-semibold text-brand-900">
              المستحق
              {hold.itemCount != null && hold.salesmanName && (
                <span className="ms-1 font-normal text-brand-800/70">· {formatNum(hold.itemCount)} صنف</span>
              )}
            </span>
            <span className="num text-[20px] font-extrabold text-brand-800">
              {formatNum(due)} <span className="text-[11px] font-medium text-brand-700/70">IQD</span>
            </span>
          </div>

          <Field
            label="المبلغ المدفوع"
            hint={!valid && payment.trim() !== '' ? (
              <span className="text-red-600">المبلغ أقل من المستحق</span>
            ) : 'Enter للإكمال'}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={due}
              value={payment}
              onChange={e => setPayment(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              className="!h-11 text-[16px] font-bold tabular-nums"
              aria-invalid={!valid}
              autoFocus
            />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {quick.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setPayment(String(v))}
                className={`h-8 rounded-lg border px-3 text-[12px] font-semibold num transition ${
                  paid === v
                    ? 'border-brand-300 bg-brand-50 text-brand-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {v === due ? 'المبلغ نفسه' : formatNum(v)}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5 text-[13px]">
            <span className="text-slate-500">الباقي للزبون</span>
            <span className={`num text-[16px] font-bold ${change > 0 ? 'text-header' : 'text-slate-400'}`}>
              {formatNum(change)} <span className="text-[11px] font-medium text-slate-400">IQD</span>
            </span>
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
