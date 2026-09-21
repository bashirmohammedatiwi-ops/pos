import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatCommissionLabel,
  formatCurrency,
  formatNum,
} from '@/api/client';
import type {
  ProductDto,
  ProductInquiryCommissionRowDto,
  ProductInquiryProductRowDto,
  ProductInquiryReceiptRowDto,
  ProductInquiryRequest,
  ProductInquirySalesmanRowDto,
  ReceiptDetailDto,
  ReceiptItemDto,
  ReceiptSummary,
  TargetTreeLinkDto,
} from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { IconPackage } from '@/components/icons';
import { Btn, Input, Loading, Select } from '@/components/ui';
import { TreeMultiPickerDialog } from '@/components/TreeMultiPickerDialog';
import { SoftChip } from '@/components/workspace';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange } from '@/lib/businessPeriod';
import { isLikelyBarcode, productSeq } from '@/lib/catalogBrowse';
import { fixEdariName } from '@/lib/text';
import { printReceiptA4 } from '@/lib/receiptPrint';
import { ReportAppWindow } from './ReportAppWindow';

type PeriodId = 'week' | 'lastWeek' | 'month' | 'custom';
type ScopeMode = 'products' | 'trees' | 'group';
type ResultTab = 'products' | 'salesmen' | 'commissions' | 'receipts';

type PickedProduct = { seq: number; name: string; barcode?: string };

function shortDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function receiptLabel(number?: number | null, id?: number) {
  if (number && number > 0) return String(number);
  return id ? `#${id}` : '—';
}

export function ProductInquiryApp({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { periods } = useBusinessPeriod();
  const [period, setPeriod] = useState<PeriodId>('week');
  const [customFrom, setCustomFrom] = useState(periods.currentWeek.from);
  const [customTo, setCustomTo] = useState(periods.currentWeek.to);
  const [mode, setMode] = useState<ScopeMode>('products');
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const [trees, setTrees] = useState<TargetTreeLinkDto[]>([]);
  const [groupId, setGroupId] = useState('');
  const [salesmanId, setSalesmanId] = useState('');
  const [treePickerOpen, setTreePickerOpen] = useState(false);
  const [tab, setTab] = useState<ResultTab>('salesmen');
  const [expandedReceiptId, setExpandedReceiptId] = useState<number | null>(null);

  const range = useMemo(() => {
    if (period === 'week') return periods.currentWeek;
    if (period === 'lastWeek') return periods.previousWeek;
    if (period === 'month') return periods.currentMonth;
    return { from: customFrom, to: customTo };
  }, [period, periods, customFrom, customTo]);

  const salesmenQ = useQuery({
    queryKey: ['salesmen', true],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });
  const groupsQ = useQuery({
    queryKey: ['commission-groups'],
    queryFn: api.commissionGroups,
    staleTime: 5 * 60_000,
  });

  const inquiry = useMutation({
    mutationFn: (req: ProductInquiryRequest) => api.productInquiry(req),
    onSuccess: () => setExpandedReceiptId(null),
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الاستعلام'),
  });

  const data = inquiry.data;

  function buildRequest(): ProductInquiryRequest | null {
    const salesman = salesmanId ? Number(salesmanId) : undefined;
    const base: ProductInquiryRequest = {
      from: range.from,
      to: range.to,
      salesmanId: salesman && Number.isFinite(salesman) ? salesman : undefined,
    };
    if (mode === 'products') {
      if (products.length === 0) {
        toast.error('اختر منتجاً واحداً على الأقل');
        return null;
      }
      return { ...base, articleSeqs: products.map(p => p.seq) };
    }
    if (mode === 'trees') {
      if (trees.length === 0) {
        toast.error('اختر شجرة واحدة على الأقل');
        return null;
      }
      return { ...base, treeSeqs: trees.map(t => t.treeSeq) };
    }
    const id = Number(groupId);
    if (!id) {
      toast.error('اختر مجموعة عمولة');
      return null;
    }
    return { ...base, commissionGroupId: id };
  }

  function runInquiry() {
    const req = buildRequest();
    if (!req) return;
    inquiry.mutate(req);
  }

  const periodBtns: { id: PeriodId; label: string }[] = [
    { id: 'week', label: 'هذا الأسبوع' },
    { id: 'lastWeek', label: 'الأسبوع الماضي' },
    { id: 'month', label: 'هذا الشهر' },
    { id: 'custom', label: 'تاريخ' },
  ];
  const modeBtns: { id: ScopeMode; label: string }[] = [
    { id: 'products', label: 'منتجات' },
    { id: 'trees', label: 'شجرة' },
    { id: 'group', label: 'مجموعة عمولة' },
  ];
  const tabs: { id: ResultTab; label: string }[] = [
    { id: 'products', label: 'المنتجات' },
    { id: 'salesmen', label: 'تجميع حسب البائع' },
    { id: 'commissions', label: 'تفاصيل العمولات' },
    { id: 'receipts', label: 'الفواتير' },
  ];

  const scopeHint = useMemo(() => {
    if (mode === 'products') return `${products.length} صنف`;
    if (mode === 'trees') return `${trees.length} شجرة`;
    const g = groupsQ.data?.find(x => String(x.id) === groupId);
    return g?.name ?? 'لم تُختر مجموعة';
  }, [mode, products.length, trees.length, groupsQ.data, groupId]);

  return (
    <ReportAppWindow
      title="استعلام مادة"
      subtitle={`${formatPeriodRange(range.from, range.to)} · ${scopeHint}`}
      icon={<IconPackage size={20} />}
      accent="linear-gradient(135deg, #818cf8 0%, #4338ca 100%)"
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-0.5">
              {periodBtns.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setPeriod(b.id)}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                    period === b.id ? 'bg-header text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="!py-1.5" />
                <span className="text-[12px] text-slate-400">→</span>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="!py-1.5" />
              </div>
            )}
            <div className="flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-0.5">
              {modeBtns.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setMode(b.id)}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                    mode === b.id ? 'bg-indigo-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)} className="!w-[200px] !py-1.5">
              <option value="">كل المندوبين</option>
              {(salesmenQ.data?.items ?? []).map(s => (
                <option key={s.id} value={s.id}>{fixEdariName(s.name) || `#${s.id}`}</option>
              ))}
            </Select>
            <Btn onClick={runInquiry} loading={inquiry.isPending} className="ms-auto">
              استعلام
            </Btn>
          </div>

          {mode === 'products' && (
            <ProductChips
              products={products}
              onAdd={p => setProducts(prev => prev.some(x => x.seq === p.seq) ? prev : [...prev, p])}
              onRemove={seq => setProducts(prev => prev.filter(p => p.seq !== seq))}
            />
          )}
          {mode === 'trees' && (
            <div className="flex flex-wrap items-center gap-2">
              <Btn size="sm" variant="secondary" onClick={() => setTreePickerOpen(true)}>اختيار أشجار</Btn>
              {trees.map(t => (
                <SoftChip key={t.treeSeq} tone="brand">
                  <span className="inline-flex items-center gap-1">
                    {t.treeName ?? `شجرة #${t.treeSeq}`}
                    <button type="button" className="text-indigo-700" onClick={() => setTrees(prev => prev.filter(x => x.treeSeq !== t.treeSeq))}>×</button>
                  </span>
                </SoftChip>
              ))}
              {trees.length === 0 && <span className="text-[12.5px] text-slate-400">لم تُختر شجرة بعد</span>}
            </div>
          )}
          {mode === 'group' && (
            <Select value={groupId} onChange={e => setGroupId(e.target.value)} className="!max-w-md !py-1.5">
              <option value="">اختر مجموعة عمولة</option>
              {(groupsQ.data ?? []).map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}{g.isActive ? '' : ' (متوقفة)'} · {formatNum(g.productCount)} صنف
                </option>
              ))}
            </Select>
          )}
        </div>

        <TreeMultiPickerDialog
          open={treePickerOpen}
          onClose={() => setTreePickerOpen(false)}
          selected={trees}
          onChange={setTrees}
        />

        {!data && !inquiry.isPending && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[16px] font-extrabold text-header">اختر نطاقاً ثم اضغط استعلام</p>
            <p className="max-w-md text-[13.5px] leading-6 text-slate-500">
              منتج واحد أو عدة منتجات، شجرة Edari، أو مجموعة عمولة. تظهر المبيعات والعمولات والبائعون والفواتير لنفس الفترة.
            </p>
          </div>
        )}

        {inquiry.isPending && (
          <div className="flex flex-1 items-center justify-center"><Loading /></div>
        )}

        {data && !inquiry.isPending && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-4">
              <Kpi label="الكمية" value={formatNum(data.summary.quantity)} />
              <Kpi label="مبلغ البيع" value={formatCurrency(data.summary.salesAmount)} />
              <Kpi label="الفواتير" value={formatNum(data.summary.receiptCount)} />
              <Kpi
                label="العمولة"
                value={formatCurrency(data.summary.commissionAmount)}
                hint={`${formatNum(data.summary.commissionLineCount)} سطر`}
              />
            </div>
            {(data.receiptsTruncated || data.commissionsTruncated) && (
              <p className="shrink-0 bg-amber-50 px-4 py-1.5 text-[12px] font-semibold text-amber-800">
                النتائج مقتطعة للعرض
                {data.receiptsTruncated ? ' — أول 400 فاتورة' : ''}
                {data.commissionsTruncated ? ' — أول 800 سطر عمولة' : ''}
                . الملخص أعلاه كامل.
              </p>
            )}
            <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 bg-white px-4 pt-2">
              {tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-t-lg px-3 py-2 text-[12.5px] font-bold transition ${
                    tab === t.id
                      ? 'bg-slate-100 text-header'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 p-3">
              {tab === 'products' && (
                <DataGrid
                  embedded
                  fillHeight
                  columns={productColumns()}
                  rows={data.products}
                  getRowId={r => r.articleSeq}
                  storageKey="product-inquiry-products"
                  exportName={`استعلام-منتجات-${range.from}_${range.to}`}
                  counterLabel="صنف"
                  emptyText="لا مبيعات ولا عمولات لهذه الأصناف في الفترة"
                />
              )}
              {tab === 'salesmen' && (
                <DataGrid
                  embedded
                  fillHeight
                  columns={salesmanColumns()}
                  rows={data.salesmen}
                  getRowId={r => r.salesmanId}
                  storageKey="product-inquiry-salesmen"
                  exportName={`استعلام-بائعين-${range.from}_${range.to}`}
                  counterLabel="بائع"
                  emptyText="لا بائعين في هذا النطاق"
                />
              )}
              {tab === 'commissions' && (
                <DataGrid
                  embedded
                  fillHeight
                  columns={commissionColumns()}
                  rows={data.commissions}
                  getRowId={r => r.id}
                  storageKey="product-inquiry-commissions"
                  exportName={`استعلام-عمولات-${range.from}_${range.to}`}
                  counterLabel="سطر"
                  emptyText="لا عمولات مسجّلة لهذه الأصناف في الفترة"
                  expansion={{
                    isExpanded: r => expandedReceiptId === r.receiptId,
                    onToggle: r => setExpandedReceiptId(id => id === r.receiptId ? null : r.receiptId),
                    render: r => <InquiryReceiptDetail receiptId={r.receiptId} receiptNumber={r.receiptNumber} />,
                  }}
                />
              )}
              {tab === 'receipts' && (
                <DataGrid
                  embedded
                  fillHeight
                  columns={receiptColumns()}
                  rows={data.receipts}
                  getRowId={r => r.receiptId}
                  storageKey="product-inquiry-receipts"
                  exportName={`استعلام-فواتير-${range.from}_${range.to}`}
                  counterLabel="فاتورة"
                  emptyText="لا فواتير بيع لهذه الأصناف في الفترة"
                  expansion={{
                    isExpanded: r => expandedReceiptId === r.receiptId,
                    onToggle: r => setExpandedReceiptId(id => id === r.receiptId ? null : r.receiptId),
                    render: r => <InquiryReceiptDetail receiptId={r.receiptId} receiptNumber={r.receiptNumber} />,
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </ReportAppWindow>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="text-[16px] font-extrabold text-header">{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function ProductChips({
  products,
  onAdd,
  onRemove,
}: {
  products: PickedProduct[];
  onAdd: (p: PickedProduct) => void;
  onRemove: (seq: number) => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ['product-inquiry-search', debounced],
    queryFn: () => api.searchProducts(debounced),
    enabled: debounced.length >= 2 && !isLikelyBarcode(debounced),
  });

  async function addBarcode(code: string) {
    const value = code.trim();
    if (!value) return;
    try {
      const p = await api.productByBarcode(value);
      onAdd({ seq: productSeq(p), name: fixEdariName(p.name) || p.barcode || `#${productSeq(p)}`, barcode: p.barcode ?? undefined });
      setQ('');
    } catch {
      toast.error('لا منتج بهذا الباركود');
    }
  }

  function pick(p: ProductDto) {
    onAdd({
      seq: productSeq(p),
      name: fixEdariName(p.name) || p.barcode || `#${productSeq(p)}`,
      barcode: p.barcode ?? undefined,
    });
    setQ('');
  }

  return (
    <div className="space-y-2">
      <div className="relative max-w-lg">
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (isLikelyBarcode(q)) void addBarcode(q);
          }}
          placeholder="اسم أو باركود ثم Enter — يمكن إضافة أكثر من صنف"
          className="!py-1.5"
        />
        {searchQ.data && searchQ.data.length > 0 && q.trim().length >= 2 && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {searchQ.data.map(p => (
              <button
                key={productSeq(p)}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-[13px] hover:bg-slate-50"
                onClick={() => pick(p)}
              >
                <span className="font-semibold text-header">{fixEdariName(p.name) || p.barcode || `#${productSeq(p)}`}</span>
                <span className="font-mono text-[11px] text-slate-400">{p.barcode}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {products.map(p => (
          <SoftChip key={p.seq} tone="brand">
            <span className="inline-flex items-center gap-1">
              {p.name}
              <button type="button" className="text-indigo-700" onClick={() => onRemove(p.seq)}>×</button>
            </span>
          </SoftChip>
        ))}
      </div>
    </div>
  );
}

function productColumns(): GridColumn<ProductInquiryProductRowDto>[] {
  return [
    { key: 'productName', header: 'المنتج', width: 280, render: r => <span className="font-semibold text-header">{fixEdariName(r.productName) || `#${r.articleSeq}`}</span> },
    { key: 'barcode', header: 'الباركود', width: 140, mono: true },
    { key: 'quantity', header: 'الكمية', width: 110, mono: true, footer: 'sum' },
    { key: 'salesAmount', header: 'مبلغ البيع', width: 140, mono: true, footer: 'sum', render: r => formatCurrency(r.salesAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 140, mono: true, footer: 'sum', render: r => <span className="font-bold text-brand-800">{formatCurrency(r.commissionAmount)}</span> },
    { key: 'receiptCount', header: 'فواتير', width: 90, mono: true, footer: 'sum', align: 'center' },
  ];
}

function salesmanColumns(): GridColumn<ProductInquirySalesmanRowDto>[] {
  return [
    { key: 'salesmanName', header: 'البائع', width: 240, render: r => <span className="font-semibold text-header">{fixEdariName(r.salesmanName) || `#${r.salesmanId}`}</span> },
    { key: 'quantity', header: 'الكمية', width: 110, mono: true, footer: 'sum' },
    { key: 'salesAmount', header: 'مبلغ البيع', width: 150, mono: true, footer: 'sum', render: r => formatCurrency(r.salesAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 150, mono: true, footer: 'sum', render: r => <span className="font-extrabold text-brand-800">{formatCurrency(r.commissionAmount)}</span> },
    { key: 'receiptCount', header: 'فواتير', width: 90, mono: true, footer: 'sum', align: 'center' },
  ];
}

function commissionColumns(): GridColumn<ProductInquiryCommissionRowDto>[] {
  return [
    { key: 'saleDate', header: 'التاريخ', width: 120, render: r => shortDate(r.saleDate) },
    { key: 'receiptNumber', header: 'الفاتورة', width: 110, mono: true, render: r => receiptLabel(r.receiptNumber, r.receiptId) },
    { key: 'productName', header: 'المنتج', width: 200, render: r => fixEdariName(r.productName) || `#${r.articleSeq}` },
    { key: 'salesmanName', header: 'البائع', width: 160, render: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}` },
    { key: 'commissionGroupName', header: 'المجموعة', width: 160, render: r => r.commissionGroupName || '—' },
    {
      key: 'commissionType',
      header: 'النوع',
      width: 140,
      render: r => r.commissionType ? formatCommissionLabel(r.commissionType, r.commissionValue) : '—',
    },
    { key: 'quantity', header: 'الكمية', width: 90, mono: true, footer: 'sum' },
    { key: 'lineAmount', header: 'مبلغ السطر', width: 130, mono: true, footer: 'sum', render: r => formatCurrency(r.lineAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 130, mono: true, footer: 'sum', render: r => <span className="font-bold text-brand-800">{formatCurrency(r.commissionAmount)}</span> },
  ];
}

function receiptColumns(): GridColumn<ProductInquiryReceiptRowDto>[] {
  return [
    { key: 'saleDate', header: 'التاريخ', width: 130, render: r => shortDate(r.saleDate) },
    { key: 'receiptNumber', header: 'الفاتورة', width: 120, mono: true, render: r => <span className="font-bold text-indigo-800">{receiptLabel(r.receiptNumber, r.receiptId)}</span> },
    { key: 'salesmanName', header: 'البائع', width: 180, render: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}` },
    { key: 'quantity', header: 'كمية النطاق', width: 120, mono: true, footer: 'sum' },
    { key: 'salesAmount', header: 'مبلغ النطاق', width: 140, mono: true, footer: 'sum', render: r => formatCurrency(r.salesAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 130, mono: true, footer: 'sum', render: r => formatCurrency(r.commissionAmount) },
    { key: 'lineCount', header: 'بنود', width: 80, mono: true, align: 'center' },
  ];
}

const itemColumns: GridColumn<ReceiptItemDto>[] = [
  { key: 'name', header: 'المنتج', width: 240, render: r => <span className="font-semibold">{fixEdariName(r.name) || `#${r.articleId}`}</span> },
  { key: 'barcode', header: 'الباركود', width: 120, mono: true },
  { key: 'quantity', header: 'الكمية', width: 85, mono: true, footer: 'sum' },
  { key: 'price', header: 'السعر', width: 90, mono: true, render: r => formatCurrency(r.price) },
  { key: 'lineTotal', header: 'الإجمالي', width: 110, mono: true, footer: 'sum', render: r => formatCurrency(r.lineTotal) },
];

function InquiryReceiptDetail({ receiptId, receiptNumber }: { receiptId: number; receiptNumber?: number | null }) {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['receipt-detail', receiptId],
    queryFn: () => api.receiptDetail(receiptId),
  });
  const detail = q.data;

  async function printA4() {
    if (!detail) return;
    try {
      await printReceiptA4(summaryFromDetail(detail), detail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-bold text-header">فاتورة {receiptLabel(receiptNumber ?? detail?.number, receiptId)}</span>
        <Link
          to={`/receipts?highlight=${receiptId}`}
          className="text-[12px] font-semibold text-indigo-700 hover:underline"
        >
          فتح في الفواتير
        </Link>
        <Btn size="sm" variant="secondary" disabled={!detail} onClick={() => void printA4()}>طباعة A4</Btn>
      </div>
      {q.isLoading && <Loading />}
      {q.isError && <p className="text-[12px] font-semibold text-red-700">تعذّر تحميل التفاصيل</p>}
      {detail && (
        <DataGrid
          embedded
          columns={itemColumns}
          rows={detail.items}
          getRowId={r => r.id}
          maxHeight="240px"
          exportName={`فاتورة-${receiptLabel(detail.number, detail.id)}`}
          counterLabel="بند"
          emptyText="لا بنود"
        />
      )}
    </div>
  );
}

function summaryFromDetail(d: ReceiptDetailDto): ReceiptSummary {
  return {
    id: d.id,
    number: d.number,
    creationDate: d.creationDate,
    totalAmount: d.totalAmount,
    payment: d.payment,
    cashBack: d.cashBack,
    salesmanId: d.salesmanId,
    salesmanName: d.salesmanName,
    synced: d.synced,
    edrNum: d.edrNum,
    itemCount: d.items.length,
    itemsDiscount: d.itemsDiscount,
    offersDiscount: d.offersDiscount,
    userDiscount: d.userDiscount,
    kind: 0,
  };
}
