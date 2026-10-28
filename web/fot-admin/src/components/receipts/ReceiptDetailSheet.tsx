import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatCurrency,
  formatDate,
  formatNum,
  receiptDisplayNumber,
  receiptSyncLabel,
} from '@/api/client';
import type {
  ReceiptDetailDto,
  ReceiptEditSnapshotDto,
  ReceiptItemDto,
  ReceiptSummary,
} from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Badge, Btn, Input, Skeleton } from '@/components/ui';
import {
  IconAlert,
  IconBanknote,
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconCloud,
  IconCopy,
  IconHistory,
  IconLink,
  IconMonitor,
  IconPrinter,
  IconUser,
  IconUsers,
  IconWallet,
} from '@/components/icons';
import { ReceiptKindBadge } from '@/components/receipts/receiptColumns';
import { copyText } from '@/lib/clipboard';
import { printReceipt } from '@/lib/print';
import { printReceiptA4, receiptTotals } from '@/lib/receiptPrint';
import { useToast } from '@/components/Toast';

function Money({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`num ${className}`}>
      {formatNum(value)} <span className="text-[10.5px] font-medium text-slate-400">IQD</span>
    </span>
  );
}

const itemColumns: GridColumn<ReceiptItemDto>[] = [
  { key: 'idx', header: '#', width: 42, align: 'center', sortable: false, exportable: false, render: (_r, i) => formatNum(i + 1) },
  {
    key: 'name',
    header: 'المادة',
    width: 220,
    render: r => (
      <Link
        to={`/products?search=${encodeURIComponent(r.barcode || r.name || String(r.articleId))}`}
        onClick={e => e.stopPropagation()}
        className="font-semibold text-header hover:text-brand-700 hover:underline"
      >
        {r.name ?? `#${r.articleId}`}
      </Link>
    ),
  },
  {
    key: 'barcode',
    header: 'الباركود',
    width: 124,
    mono: true,
    render: r =>
      r.barcode ? (
        <Link
          to={`/barcode-labels?barcode=${encodeURIComponent(r.barcode)}`}
          onClick={e => e.stopPropagation()}
          title="طباعة ملصق باركود"
          className="font-mono text-[12px] text-slate-600 hover:text-brand-700 hover:underline"
        >
          {r.barcode}
        </Link>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
  { key: 'quantity', header: 'الكمية', width: 72, mono: true, align: 'center', footer: 'sum' },
  {
    key: 'originalPrice',
    header: 'سعر الوحدة',
    width: 96,
    mono: true,
    render: r => formatCurrency(r.originalPrice > 0 ? r.originalPrice : r.price),
  },
  {
    key: 'discount',
    header: 'الخصم',
    width: 84,
    mono: true,
    footer: 'sum',
    render: r => (r.discount > 0 ? <span className="text-red-600">{formatCurrency(r.discount)}</span> : '—'),
  },
  {
    key: 'lineTotal',
    header: 'الإجمالي',
    width: 100,
    mono: true,
    footer: 'sum',
    render: r => <span className="font-bold text-header">{formatCurrency(r.lineTotal)}</span>,
  },
  {
    key: 'salesmanName',
    header: 'البائع',
    width: 130,
    sortValue: r => r.salesmanName ?? '',
    exportValue: r => ((r.salesmanId ?? 0) > 0 ? (r.salesmanName ?? `#${r.salesmanId}`) : 'بدون بائع'),
    render: r => ((r.salesmanId ?? 0) > 0 ? (r.salesmanName ?? `#${r.salesmanId}`) : <span className="text-slate-400">بدون بائع</span>),
  },
  { key: 'groupLabel', header: 'المجموعة', width: 100, render: r => r.groupLabel || '—' },
];

function Meta({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="icon-tile h-7 w-7 shrink-0 rounded-lg bg-slate-100 text-slate-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-medium text-slate-400">{label}</p>
        <p className="truncate text-[12.5px] font-semibold text-header">{children}</p>
      </div>
    </div>
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
  const [retryingSync, setRetryingSync] = useState(false);
  const [printing, setPrinting] = useState<'thermal' | 'a4' | null>(null);
  const isHold = receipt.number === 0;
  const edited = receipt.wasEdited || detail?.wasEdited;
  const qrPerson = receipt.discountQrPersonName || detail?.discountQrPersonName;
  const number = isHold && !receipt.displayNumber ? `#${receipt.id}` : receiptDisplayNumber(receipt);

  async function retrySyncNow() {
    setRetryingSync(true);
    try {
      const r = await api.retryEdariDeadLetter(receipt.id);
      toast.success(r.message || 'أُعيدت الفاتورة إلى طابور ترحيل الأداري');
      onChanged?.();
    } catch {
      try {
        const r2 = await api.syncEdariReceipts(true, 10);
        toast.success(r2.message || 'تم تشغيل دفعة ترحيل الأداري');
        onChanged?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'تعذر ترحيل الفاتورة');
      }
    } finally {
      setRetryingSync(false);
    }
  }

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
    setPrinting('thermal');
    try {
      await printReceipt(receipt, detail, printQ.data);
      toast.success('أُرسلت الفاتورة للطباعة');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(null);
    }
  }

  async function printA4() {
    if (!detail) return;
    setPrinting('a4');
    try {
      await printReceiptA4(receipt, detail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(null);
    }
  }

  async function copy(text: string, ok: string) {
    try {
      await copyText(text);
      toast.success(ok);
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  /** ملخص نصي للفاتورة — يُلصق في واتساب أو ملاحظة. */
  function summaryText() {
    const lines = [
      `فاتورة ${number} — ${formatDate(receipt.creationDate)}`,
      ...(detail?.items ?? []).map(it => `• ${it.name ?? it.barcode ?? `#${it.articleId}`} × ${formatNum(it.quantity)} = ${formatCurrency(it.lineTotal)}`),
      `الإجمالي: ${formatCurrency(t.sub)}`,
      ...(discount > 0 ? [`الخصم: ${formatCurrency(discount)}`] : []),
      `الصافي: ${formatCurrency(t.total)}`,
    ];
    return lines.join('\n');
  }

  const sellerLabel = (receipt.salesmanCount ?? 0) > 1 ? `${receipt.salesmanCount} باعة` : (receipt.salesmanName ?? '—');

  return (
    <div className="animate-fade-in space-y-3 bg-slate-50/60 p-1">
      {/* ── الرأس ── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-extrabold leading-7 text-header">
                فاتورة <span className="num">{number}</span>
              </h3>
              <ReceiptKindBadge receipt={receipt} />
              {edited && <Badge tone="warn">معدّلة</Badge>}
              {linkedPrinted && linkedPrinted !== receipt.number && <Badge tone="info">ورق {linkedPrinted}</Badge>}
              {receipt.synced
                ? <Badge tone="info" dot>الإداري {receiptSyncLabel(receipt)}</Badge>
                : !isHold && <Badge>غير مرحّلة للإداري</Badge>}
            </div>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              {formatDate(receipt.creationDate)} · {formatNum(receipt.itemCount)} صنف
              {receipt.sectionName && <> · قسم {receipt.sectionName}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onComplete && (
              <Btn size="sm" icon={<IconCheckCircle size={14} />} onClick={onComplete}>
                إكمال الفاتورة المعلّقة
              </Btn>
            )}
            {!receipt.synced && !isHold && (
              <Btn
                size="sm"
                variant="secondary"
                icon={<IconCloud size={14} />}
                loading={retryingSync}
                onClick={() => void retrySyncNow()}
                title="إرسال الفاتورة إلى طابور ترحيل الأداري الآن"
              >
                ترحيل للأداري
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<IconCopy size={14} />} onClick={() => void copy(number, 'تم نسخ رقم الفاتورة')}>
              نسخ الرقم
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              icon={<IconCopy size={14} />}
              disabled={!detail}
              onClick={() => void copy(summaryText(), 'تم نسخ ملخص الفاتورة')}
              title="نسخ الأصناف والمجاميع كنص"
            >
              نسخ الملخص
            </Btn>
            <Btn
              size="sm"
              variant="secondary"
              icon={<IconPrinter size={14} />}
              disabled={!detail || !printQ.data}
              loading={printing === 'thermal'}
              onClick={() => void printThermal()}
            >
              طباعة حرارية
            </Btn>
            <Btn
              size="sm"
              variant={onComplete ? 'secondary' : 'primary'}
              icon={<IconPrinter size={14} />}
              disabled={!detail}
              loading={printing === 'a4'}
              onClick={() => void printA4()}
            >
              طباعة A4
            </Btn>
          </div>
        </div>

        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Meta icon={<IconUser size={14} />} label="الكاشير">{receipt.cashierName ?? '—'}</Meta>
          <Meta icon={<IconUsers size={14} />} label="البائع">{sellerLabel}</Meta>
          <Meta icon={<IconMonitor size={14} />} label="نقطة البيع">{receipt.posName ?? (receipt.posId ? `#${receipt.posId}` : '—')}</Meta>
          <Meta icon={<IconWallet size={14} />} label="الصندوق">
            {receipt.cashBoxNum || receipt.cashBoxName
              ? <>{receipt.cashBoxNum && <span className="num">{receipt.cashBoxNum}</span>} {receipt.cashBoxName}</>
              : '—'}
          </Meta>
          {receipt.accountName && <Meta icon={<IconBanknote size={14} />} label="الحساب">{receipt.accountName}</Meta>}
          {qrPerson && <Meta icon={<IconUser size={14} />} label="خصم بواسطة">{qrPerson}</Meta>}
          {receipt.syncDate && <Meta icon={<IconCloud size={14} />} label="تاريخ الترحيل">{formatDate(receipt.syncDate)}</Meta>}
          {isHold && <Meta icon={<IconClock size={14} />} label="الحالة"><span className="text-amber-700">بانتظار الإكمال</span></Meta>}
        </div>
      </div>

      {/* ── الأصناف + المجاميع ── */}
      {loadingDetail && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="card space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
          <div className="card space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        </div>
      )}
      {!loadingDetail && !detail && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
          <IconAlert size={15} /> تعذّر تحميل أصناف الفاتورة — أغلق الصف وافتحه مجدداً
        </div>
      )}
      {!loadingDetail && detail && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <DataGrid
            variant="sheet"
            columns={itemColumns}
            rows={detail.items}
            getRowId={r => r.id}
            maxHeight="300px"
            filters
            exportName={`فاتورة-${number}`}
            counterLabel="صنف"
            emptyText="لا أصناف في هذه الفاتورة"
          />
          <div className="card h-fit overflow-hidden">
            <div className="border-b border-slate-100 px-3 py-2 text-[12px] font-bold text-header">المجاميع والدفع</div>
            <dl className="space-y-1.5 px-3 py-2.5 text-[12.5px]">
              <TotalLine label="الإجمالي قبل الخصم" value={t.sub} />
              {t.offers > 0 && <TotalLine label="خصم العروض" value={t.offers} negative />}
              {t.user > 0 && <TotalLine label="خصم يدوي" value={t.user} negative />}
              {t.items > 0 && <TotalLine label="خصم الأصناف" value={t.items} negative />}
              {discount === 0 && <TotalLine label="الخصم" value={0} muted />}
            </dl>
            <div className="flex items-center justify-between gap-2 border-y border-brand-100 bg-brand-50/70 px-3 py-2.5">
              <span className="text-[12.5px] font-bold text-brand-900">الصافي</span>
              <Money value={t.total} className="text-[17px] font-extrabold text-brand-800" />
            </div>
            <dl className="space-y-1.5 px-3 py-2.5 text-[12.5px]">
              <TotalLine label="المدفوع" value={t.paid} />
              {receipt.cardAmount != null && receipt.cardAmount > 0 && (
                <TotalLine label={`بطاقة${receipt.cardName ? ` (${receipt.cardName})` : ''}`} value={receipt.cardAmount} muted />
              )}
              <TotalLine label="الباقي للزبون" value={t.back} />
            </dl>
            {receipt.cardAmount != null && receipt.cardAmount > 0 && (receipt.cardAuthCode || receipt.cardRrn) && (
              <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                {receipt.cardAcquirer && <>{receipt.cardAcquirer} · </>}
                {receipt.cardAuthCode && <>موافقة <span className="num">{receipt.cardAuthCode}</span></>}
                {receipt.cardRrn && <> · وصل <span className="num">{receipt.cardRrn}</span></>}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── ربط الرقم المطبوع ── */}
      {receipt.number > 0 && (
        <form
          className="card flex flex-wrap items-center gap-2 px-3 py-2"
          onSubmit={e => {
            e.preventDefault();
            void savePrintedNumber();
          }}
        >
          <span className="icon-tile h-7 w-7 rounded-lg bg-sky-50 text-sky-600"><IconLink size={14} /></span>
          <div className="min-w-[180px] flex-1">
            <p className="text-[12px] font-semibold text-header">الرقم المطبوع على الورق</p>
            <p className="text-[11px] text-slate-500">إن اختلف عن رقم النظام — يجعل مسح باركود الورق يفتح هذه الفاتورة في المرتجع</p>
          </div>
          <Input
            className="!h-8 !w-48 text-[12.5px] font-semibold tabular-nums"
            dir="ltr"
            inputMode="numeric"
            placeholder="مثال 20263000172"
            aria-label="الرقم المطبوع على الورق"
            value={printedDraft}
            onChange={e => setPrintedDraft(e.target.value.replace(/\D/g, ''))}
          />
          <Btn type="submit" size="sm" variant="outline" loading={savingPrinted}>
            {linkedPrinted && !printedDraft ? 'إزالة الربط' : 'ربط للمرتجع'}
          </Btn>
        </form>
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
    <div className="card overflow-hidden border-amber-200">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-amber-50/70 px-3 py-2 text-right text-[12.5px] font-bold text-amber-900 hover:bg-amber-50"
      >
        <span className="inline-flex items-center gap-2">
          <IconHistory size={15} />
          تعديلات الفاتورة — قبل وبعد
          <Badge tone="warn">{formatNum(edits.length)}</Badge>
        </span>
        <IconChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-100 p-2">
          {edits.map((rev, i) => {
            const shown = openIdx === i;
            return (
              <div key={`${rev.editedAt}-${i}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenIdx(shown ? null : i)}
                  aria-expanded={shown}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span>تعديل {formatNum(i + 1)} · <span className="text-slate-500">{formatDate(rev.editedAt)}</span></span>
                  <span className="text-[11px] text-brand-700">{shown ? 'إخفاء' : 'عرض قبل / بعد'}</span>
                </button>
                {shown && (
                  <div className="grid gap-2 border-t border-slate-100 p-2 md:grid-cols-2">
                    <SnapshotCard title="قبل التعديل" snap={rev.before} />
                    <SnapshotCard title="بعد التعديل" snap={rev.after} accent />
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

function SnapshotCard({ title, snap, accent }: { title: string; snap: ReceiptEditSnapshotDto; accent?: boolean }) {
  const seller = snap.salesmanName || (snap.salesmanId > 0 ? `#${snap.salesmanId}` : 'بدون بائع');
  return (
    <div className={`overflow-hidden rounded-lg border ${accent ? 'border-brand-200' : 'border-slate-200'}`}>
      <div className={`px-2.5 py-1.5 text-[11.5px] font-bold ${accent ? 'bg-brand-50 text-brand-800' : 'bg-slate-50 text-slate-600'}`}>{title}</div>
      <div className="space-y-0.5 px-2.5 py-1.5 text-[11.5px]">
        <div className="flex justify-between gap-2"><span className="text-slate-500">البائع</span><span className="font-semibold">{seller}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-500">خصم الفاتورة</span><span className="num font-semibold">{formatCurrency(snap.userDiscount)}</span></div>
      </div>
      <table className="w-full text-[11.5px]">
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
            <tr><td colSpan={4} className="px-2 py-2 text-center text-slate-400">لا أصناف</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TotalLine({ label, value, negative, muted }: { label: string; value: number; negative?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-semibold ${negative ? 'text-red-600' : muted ? 'text-slate-400' : 'text-header'}`}>
        {negative && value > 0 && <span dir="ltr">-</span>}
        <Money value={value} />
      </dd>
    </div>
  );
}
