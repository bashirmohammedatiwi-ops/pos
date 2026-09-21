import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, formatNum } from '@/api/client';
import { useToast } from '@/components/Toast';
import { Btn, Field, Input, Modal } from '@/components/ui';

export interface HoldTarget {
  id: number;
  totalAmount: number;
  cashierName?: string | null;
  salesmanName?: string | null;
  itemCount?: number;
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

  const paid = Number(payment);
  const change = Number.isFinite(paid) ? Math.max(0, paid - (hold?.totalAmount ?? 0)) : 0;

  const complete = useMutation({
    mutationFn: () => {
      if (!hold) throw new Error('لا فاتورة');
      if (!Number.isFinite(paid) || paid < hold.totalAmount) {
        throw new Error('المبلغ المدفوع يجب ألا يقل عن إجمالي الفاتورة');
      }
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

  return (
    <Modal open={!!hold} title="إكمال فاتورة معلّقة" onClose={onClose}>
      {hold && (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-600">
            كاشير: <strong>{hold.cashierName ?? hold.salesmanName ?? '—'}</strong>
            {hold.itemCount != null && <> · أصناف: {formatNum(hold.itemCount)}</>}
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px]">
            المستحق: <strong>{formatCurrency(hold.totalAmount)}</strong>
          </div>
          <Field label="المبلغ المدفوع">
            <Input
              type="number"
              min={hold.totalAmount}
              value={payment}
              onChange={e => setPayment(e.target.value)}
              autoFocus
            />
          </Field>
          <p className="text-[12px] text-slate-500">الباقي للزبون: {formatCurrency(change)}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn onClick={() => complete.mutate()} disabled={complete.isPending}>
              {complete.isPending ? 'جاري الإكمال…' : 'إكمال الفاتورة'}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
