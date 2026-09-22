import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  api,
  formatCurrency,
  formatDate,
  formatNum,
  receiptDisplayNumber,
  receiptKindLabel,
  receiptSyncLabel,
} from '@/api/client';
import type {
  ReceiptDetailDto,
  ReceiptEditSnapshotDto,
  ReceiptItemDto,
  ReceiptSummary,
} from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, Loading } from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import { printReceipt } from '@/lib/print';
import { printReceiptA4, receiptTotals } from '@/lib/receiptPrint';
import { useToast } from '@/components/Toast';

const itemColumns: GridColumn<ReceiptItemDto>[] = [
  { key: 'idx', header: '#', width: 42, align: 'center', sortable: false, exportable: false, render: (_r, i) => formatNum(i + 1) },
  { key: 'name', header: 'المادة', width: 220, render: r => r.name ?? `#${r.articleId}` },
  { key: 'barcode', header: 'الباركود', width: 124, mono: true },
  { key: 'quantity', header: 'الكمية', width: 72, mono: true, footer: 'sum' },
  {
    key: 'originalPrice',
    header: 'الإفرادي',
    width: 92,
    mono: true,
    render: r => formatCurrency(r.originalPrice > 0 ? r.originalPrice : r.price),
  },
  {
    key: 'discount',
    header: 'الخصم',
    width: 80,
    mono: true,
    footer: 'sum',
    render: r => (r.discount > 0 ? formatCurrency(r.discount) : '—'),
  },
  { key: 'lineTotal', header: 'الإجمالي', width: 96, mono: true, footer: 'sum', render: r => formatCurrency(r.lineTotal) },
  {
    key: 'salesmanName',
    header: 'البائع',
    width: 130,
    sortValue: r => r.salesmanName ?? '',
    render: r => ((r.salesmanId ?? 0) > 0 ? (r.salesmanName ?? `#${r.salesmanId}`) : 'بدون بائع'),
  },
  { key: 'groupLabel', header: 'المجموعة', width: 100, render: r => r.groupLabel || '—' },
];

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <td className="border border-[#c5c5c5] p-0">
      <div className="grid grid-cols-[88px_minmax(0,1fr)]">
        <div className="border-e border-[#c5c5c5] bg-[#ededed] px-2 py-1 text-[11px] font-bold text-slate-600">{label}</div>
        <div className="bg-white px-2 py-1 text-[12px] font-semibold text-slate-800">{value}</div>
      </div>
    </td>
  );
}

export function ReceiptDetailSheet({
  receipt,
  detail,
  loadingDetail,
  onComplete,
  onChanged,
}: {
  receipt: ReceiptSummary;
  detail?: ReceiptDetailDto;
  loadingDetail: boolean;
  onComplete?: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const printQ = useQuery({ queryKey: ['print-settings'], queryFn: api.printSettings });
  const t = receiptTotals(receipt, detail);
  const discount = t.offers + t.user + t.items;
  const linkedPrinted = detail?.printedNumber ?? receipt.printedNumber ?? null;
  const [printedDraft, setPrintedDraft] = useState(linkedPrinted ? String(linkedPrinted) : '');
  const [savingPrinted, setSavingPrinted] = useState(false);

  useEffect(() => {
    setPrintedDraft(linkedPrinted ? String(linkedPrinted) : '');
  }, [receipt.id, linkedPrinted]);

  async function savePrintedNumber() {
    const raw = printedDraft.replace(/\D/g, '');
    const next = raw ? Number(raw) : null;
    if (next != null && (!Number.isFinite(next) || next <= 0)) {
      toast.error('رقم مطبوع غير صالح');
      return;
    }
    setSavingPrinted(true);
    try {
      await api.setReceiptPrintedNumber(receipt.id, next);
      toast.success(next
        ? 'رُبط الرقم المطبوع — مسح باركود الورق يفتح هذه الفاتورة في المرتجع'
        : 'أُزيل ربط الرقم المطبوع');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر ربط الرقم المطبوع');
    } finally {
      setSavingPrinted(false);
    }
  }

  async function printThermal() {
    if (!printQ.data || !detail) return;
    try {
      await printReceipt(receipt, detail, printQ.data);
      toast.success('أُرسلت الفاتورة للطباعة');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    }
  }

  async function printA4() {
    if (!detail) return;
    try {
      await printReceiptA4(receipt, detail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    }
  }

  return (
    <div className="space-y-2 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-bold text-header">
          فاتورة <span className="num">{receiptDisplayNumber(receipt)}</span>
          {(receipt.wasEdited || detail?.wasEdited) && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">معدّلة</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {onComplete && <Btn size="sm" onClick={onComplete}>إكمال التعليق</Btn>}
          <Btn
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await copyText(receiptDisplayNumber(receipt));
                toast.success('تم نسخ رقم الفاتورة');
              } catch {
                toast.error('تعذر النسخ');
              }
            }}
          >
            نسخ الرقم
          </Btn>
          <Btn size="sm" variant="secondary" disabled={!detail} onClick={() => void printThermal()}>
            طباعة حرارية
          </Btn>
          <Btn size="sm" disabled={!detail} onClick={() => void printA4()}>
            طباعة A4
          </Btn>
        </div>
      </div>

      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <tbody>
          <tr>
            <InfoCell
              label="الرقم"
              value={linkedPrinted && linkedPrinted !== receipt.number
                ? `${receiptDisplayNumber(receipt)} · ورق ${linkedPrinted}`
                : receiptDisplayNumber(receipt)}
            />
            <InfoCell label="التاريخ" value={formatDate(receipt.creationDate)} />
            <InfoCell label="النوع" value={receiptKindLabel(receipt)} />
            <InfoCell label="الكاشير" value={receipt.cashierName ?? '—'} />
          </tr>
          <tr>
            <InfoCell label="البائع" value={(receipt.salesmanCount ?? 0) > 1 ? `${receipt.salesmanCount} باعة` : (receipt.salesmanName ?? '—')} />
            <InfoCell label="الصندوق" value={receipt.cashBoxName || receipt.cashBoxNum || '—'} />
            <InfoCell label="القسم" value={receipt.sectionName ?? '—'} />
            <InfoCell label="الإداري" value={receiptSyncLabel(receipt)} />
          </tr>
          {(receipt.discountQrPersonName || detail?.discountQrPersonName) && (
            <tr>
              <InfoCell label="خصم بواسطة" value={receipt.discountQrPersonName || detail?.discountQrPersonName || '—'} />
              <InfoCell label="خصم الفاتورة" value={formatCurrency(receipt.userDiscount)} />
              <InfoCell label="الحساب" value={receipt.accountName ?? '—'} />
              <InfoCell label="الصافي" value={formatCurrency(receipt.netAmount ?? receipt.totalAmount)} />
            </tr>
          )}
        </tbody>
      </table>

      {receipt.number > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-2">
          <label className="min-w-[180px] flex-1">
            <span className="mb-0.5 block text-[10px] font-semibold text-sky-800">الرقم المطبوع على الورق إن اختلف</span>
            <input
              className="h-8 w-full rounded border border-sky-200 bg-white px-2 text-[12px] font-semibold tabular-nums"
              dir="ltr"
              inputMode="numeric"
              placeholder="مثال 20263000172"
              value={printedDraft}
              onChange={e => setPrintedDraft(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <Btn size="sm" disabled={savingPrinted} onClick={() => void savePrintedNumber()}>
            {savingPrinted ? 'جاري الربط…' : 'ربط للمرتجع'}
          </Btn>
        </div>
      )}

      {loadingDetail && <Loading />}
      {!loadingDetail && detail && (
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
          <DataGrid
            variant="sheet"
            embedded
            columns={itemColumns}
            rows={detail.items}
            getRowId={r => r.id}
            maxHeight="280px"
            exportName={`فاتورة-${receiptDisplayNumber(receipt)}`}
            counterLabel="بند"
            emptyText="لا بنود في هذه الفاتورة"
            filters
          />
          <table className="h-fit w-full border-separate border-spacing-0 text-[12px]">
            <tbody>
              <TotalRow label="الإجمالي" value={t.sub} />
              <TotalRow label="الخصم" value={discount} negative={discount > 0} />
              <TotalRow label="الصافي للدفع" value={t.total} strong />
              <TotalRow label="الدفعة" value={t.paid} />
              <TotalRow label="المبلغ المرتجع" value={t.back} />
            </tbody>
          </table>
        </div>
      )}
      {!loadingDetail && !detail && (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">تعذّر تحميل التفاصيل</p>
      )}
      {!loadingDetail && detail && (detail.edits?.length ?? 0) > 0 && (
        <ReceiptEditsPanel edits={detail.edits!} />
      )}
    </div>
  );
}

function ReceiptEditsPanel({ edits }: { edits: NonNullable<ReceiptDetailDto['edits']> }) {
  const [open, setOpen] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(edits.length === 1 ? 0 : null);
  return (
    <div className="border border-amber-200 bg-amber-50/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-right text-[12px] font-bold text-amber-900"
      >
        <span>تعديلات الفاتورة — قبل وبعد ({formatNum(edits.length)})</span>
        <span className="text-[11px] font-semibold text-amber-700">{open ? 'إخفاء' : 'استعراض'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-200 px-3 py-2">
          {edits.map((rev, i) => {
            const shown = openIdx === i;
            return (
              <div key={`${rev.editedAt}-${i}`} className="border border-amber-100 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenIdx(shown ? null : i)}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-[12px] font-semibold text-slate-700"
                >
                  <span>تعديل {formatNum(i + 1)} · {formatDate(rev.editedAt)}</span>
                  <span className="text-[11px] text-slate-500">{shown ? 'إخفاء التفاصيل' : 'عرض قبل / بعد'}</span>
                </button>
                {shown && (
                  <div className="grid gap-2 border-t border-slate-100 p-2 md:grid-cols-2">
                    <SnapshotCard title="قبل التعديل" snap={rev.before} />
                    <SnapshotCard title="بعد التعديل" snap={rev.after} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SnapshotCard({ title, snap }: { title: string; snap: ReceiptEditSnapshotDto }) {
  const seller = snap.salesmanName || (snap.salesmanId > 0 ? `#${snap.salesmanId}` : 'بدون بائع');
  return (
    <div className="border border-slate-200">
      <div className="bg-[#ededed] px-2 py-1 text-[11px] font-bold text-slate-600">{title}</div>
      <div className="space-y-0.5 px-2 py-1.5 text-[11px]">
        <div className="flex justify-between gap-2"><span className="text-slate-500">البائع</span><span className="font-semibold">{seller}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-500">خصم الفاتورة</span><span className="num font-semibold">{formatCurrency(snap.userDiscount)}</span></div>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-slate-50 text-slate-500">
            <th className="px-2 py-1 text-right font-semibold">المادة</th>
            <th className="px-2 py-1 text-center font-semibold">كمية</th>
            <th className="px-2 py-1 text-left font-semibold">سعر</th>
            <th className="px-2 py-1 text-right font-semibold">بائع</th>
          </tr>
        </thead>
        <tbody>
          {(snap.items ?? []).map((item, i) => (
            <tr key={`${item.articleId}-${i}`} className="border-t border-slate-100">
              <td className="px-2 py-1">{item.name || item.barcode || `#${item.articleId}`}</td>
              <td className="px-2 py-1 text-center num">{formatNum(item.quantity)}</td>
              <td className="px-2 py-1 text-left num">{formatCurrency(item.price)}</td>
              <td className="px-2 py-1">{item.salesmanName || (item.salesmanId ? `#${item.salesmanId}` : '—')}</td>
            </tr>
          ))}
          {(snap.items ?? []).length === 0 && (
            <tr><td colSpan={4} className="px-2 py-2 text-center text-slate-400">لا بنود</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({ label, value, strong, negative }: { label: string; value: number; strong?: boolean; negative?: boolean }) {
  return (
    <tr>
      <th className={`w-[58%] border border-[#b4b4b4] bg-[#ededed] px-2 py-1.5 text-right font-bold ${strong ? 'text-header' : 'text-slate-600'}`}>
        {label}
      </th>
      <td className={`border border-[#b4b4b4] px-2 py-1.5 text-left num font-bold ${strong ? 'bg-[#fff2cc] text-header' : 'bg-white text-slate-800'}`}>
        {negative ? `-${formatCurrency(value)}` : formatCurrency(value)}
      </td>
    </tr>
  );
}
