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
import { IconDownload, IconFolder, IconPackage, IconSearch, IconX } from '@/components/icons';
import { Btn, EmptyState, Input, Kbd, Loading, Select, Tabs } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import { TreeMultiPickerDialog } from '@/components/TreeMultiPickerDialog';
import { isLikelyBarcode, productSeq } from '@/lib/catalogBrowse';
import { fixEdariName } from '@/lib/text';
import { downloadProductInquiryExcel } from '@/lib/productInquiryExcel';
import { printReceiptA4 } from '@/lib/receiptPrint';
import { ReportAppWindow } from './ReportAppWindow';
import {
  ChartBlock,
  ChartToggle,
  HBarChart,
  Money,
  PeriodSelector,
  ReportBanner,
  ReportCenter,
  ReportError,
  ReportFill,
  ReportNote,
  ReportSplit,
  useChartDock,
  useReportPeriod,
} from './ReportKit';

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

function ScopeChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 max-w-[260px] items-center gap-1 rounded-full border border-brand-200 bg-brand-50 ps-2.5 pe-1 text-[12px] font-medium text-brand-800">
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-brand-700 transition hover:bg-brand-100"
        aria-label="إزالة"
      >
        <IconX size={12} />
      </button>
    </span>
  );
}

export function ProductInquiryApp({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const period = useReportPeriod({
    storageKey: 'product-inquiry',
    presets: ['today', 'week', 'lastWeek', 'month', 'lastMonth', 'custom'],
    fallback: 'week',
  });
  const range = period.range;
  const [mode, setMode] = useState<ScopeMode>('products');
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const [trees, setTrees] = useState<TargetTreeLinkDto[]>([]);
  const [groupId, setGroupId] = useState('');
  const [salesmanId, setSalesmanId] = useState('');
  const [treePickerOpen, setTreePickerOpen] = useState(false);
  const [tab, setTab] = useState<ResultTab>('salesmen');
  const [expandedReceiptId, setExpandedReceiptId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

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

  // Ctrl+Enter يشغّل الاستعلام من أي مكان في النافذة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        // لا تشغيل خلف منتقي الشجرة المفتوح أو أثناء استعلام جارٍ
        if (treePickerOpen || inquiry.isPending) return;
        e.preventDefault();
        runInquiry();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function exportExcel() {
    const req = buildRequest();
    if (!req) return;
    setExporting(true);
    try {
      const full = await api.productInquiry({ ...req, fullDetails: true });
      downloadProductInquiryExcel(full, {
        from: range.from,
        to: range.to,
        scope: full.scope.label ?? scopeHint,
      });
      if (full.receiptsTruncated || full.commissionsTruncated) {
        toast.error('تم التصدير لكن بعض السجلات تجاوزت حد التصدير — قلّل الفترة أو النطاق');
      } else {
        toast.success('تم تنزيل ملف Excel');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تصدير Excel');
    } finally {
      setExporting(false);
    }
  }

  const modeBtns: { id: ScopeMode; label: string }[] = [
    { id: 'products', label: 'منتجات' },
    { id: 'trees', label: 'شجرة' },
    { id: 'group', label: 'مجموعة عمولة' },
  ];

  const scopeHint = useMemo(() => {
    if (mode === 'products') return `${products.length} صنف`;
    if (mode === 'trees') return `${trees.length} شجرة`;
    const g = groupsQ.data?.find(x => String(x.id) === groupId);
    return g?.name ?? 'لم تُختر مجموعة';
  }, [mode, products.length, trees.length, groupsQ.data, groupId]);

  const scopeReady = mode === 'products' ? products.length > 0 : mode === 'trees' ? trees.length > 0 : !!groupId;
  const dock = useChartDock();

  const salesmenChart = data && data.salesmen.length > 1 ? (
    <ChartBlock title="البائعون في هذا النطاق" subtitle="مبلغ البيع والعمولة — أعلى 10">
      <HBarChart
        series={[
          { key: 'sales', label: 'مبلغ البيع' },
          { key: 'commission', label: 'العمولة' },
        ]}
        format={n => formatCurrency(n)}
        items={[...data.salesmen]
          .sort((a, b) => b.salesAmount - a.salesAmount)
          .slice(0, 10)
          .map(s => ({
            id: s.salesmanId,
            label: fixEdariName(s.salesmanName) || `#${s.salesmanId}`,
            values: [s.salesAmount, s.commissionAmount],
            sub: `${formatNum(s.quantity)} قطعة · ${formatNum(s.receiptCount)} فاتورة`,
          }))}
      />
    </ChartBlock>
  ) : null;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #38bdf8 0%, #0369a1 100%)"
      title="استعلام مادة"
      subtitle={`${period.label} · ${scopeHint}`}
      icon={<IconPackage size={16} />}
      toolbar={<PeriodSelector state={period} />}
      actions={
        <Btn
          size="sm"
          variant="secondary"
          icon={<IconDownload size={14} />}
          onClick={() => void exportExcel()}
          loading={exporting}
          disabled={exporting || inquiry.isPending || !scopeReady}
          title="تصدير كامل التفاصيل إلى Excel"
        >
          تصدير Excel
        </Btn>
      }
      onClose={onClose}
    >
      <ReportFill>
        {/* نطاق الاستعلام — شريط فلاتر بعناوين صغيرة */}
        <div className="relative z-20 shrink-0 border-b border-slate-200 bg-slate-50/70 px-3 pb-2 pt-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">النطاق</span>
              <div className="flex rounded-lg bg-slate-200/60 p-0.5" role="radiogroup" aria-label="نوع النطاق">
                {modeBtns.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === b.id}
                    onClick={() => setMode(b.id)}
                    className={`h-7 rounded-md px-3 text-[12px] font-semibold transition ${
                      mode === b.id
                        ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-header'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'products' && (
              <ProductChips
                products={products}
                onAdd={p => setProducts(prev => prev.some(x => x.seq === p.seq) ? prev : [...prev, p])}
              />
            )}
            {mode === 'trees' && (
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">الأشجار</span>
                <Btn size="sm" variant="secondary" icon={<IconFolder size={14} />} onClick={() => setTreePickerOpen(true)}>
                  اختيار أشجار{trees.length ? ` (${formatNum(trees.length)})` : ''}
                </Btn>
              </div>
            )}
            {mode === 'group' && (
              <label className="block w-full sm:w-[320px]">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">مجموعة العمولة</span>
                <Select value={groupId} onChange={e => setGroupId(e.target.value)} className="!h-8 text-[12.5px]" aria-label="مجموعة العمولة">
                  <option value="">اختر مجموعة عمولة</option>
                  {(groupsQ.data ?? []).map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name}{g.isActive ? '' : ' (متوقفة)'} · {formatNum(g.productCount)} صنف
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <label className="block w-full sm:w-[200px]">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">البائع</span>
              <Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)} className="!h-8 text-[12.5px]" aria-label="البائع">
                <option value="">كل البائعين</option>
                {(salesmenQ.data?.items ?? []).map(s => (
                  <option key={s.id} value={s.id}>{fixEdariName(s.name) || `#${s.id}`}</option>
                ))}
              </Select>
            </label>

            <div className="ms-auto flex items-center gap-2">
              <span className="hidden items-center gap-1 text-[11px] text-slate-400 lg:inline-flex">
                <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>
              </span>
              <Btn onClick={runInquiry} loading={inquiry.isPending} disabled={!scopeReady} icon={<IconSearch size={14} />} title="Ctrl+Enter">
                استعلام
              </Btn>
            </div>
          </div>

          {mode === 'products' && products.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {products.map(p => (
                <ScopeChip key={p.seq} onRemove={() => setProducts(prev => prev.filter(x => x.seq !== p.seq))}>{p.name}</ScopeChip>
              ))}
              {products.length > 1 && (
                <Btn size="xs" variant="ghost" onClick={() => setProducts([])}>مسح الكل</Btn>
              )}
            </div>
          )}
          {mode === 'trees' && trees.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {trees.map(t => (
                <ScopeChip key={t.treeSeq} onRemove={() => setTrees(prev => prev.filter(x => x.treeSeq !== t.treeSeq))}>
                  {t.treeName ?? `شجرة #${t.treeSeq}`}
                </ScopeChip>
              ))}
            </div>
          )}
        </div>

        <TreeMultiPickerDialog
          open={treePickerOpen}
          onClose={() => setTreePickerOpen(false)}
          selected={trees}
          onChange={setTrees}
        />

        {inquiry.isError && !inquiry.isPending && (
          <ReportBanner><ReportError error={inquiry.error} title="تعذّر الاستعلام" onRetry={runInquiry} /></ReportBanner>
        )}

        {!data && !inquiry.isPending && !inquiry.isError && (
          <ReportCenter>
            <EmptyState
              icon={<IconPackage size={24} />}
              title="اختر نطاقاً ثم اضغط «استعلام»"
              description="تظهر الكمية ومبلغ البيع والعمولات، مع تجميع حسب البائع وتفاصيل الفواتير لنفس الفترة."
            />
          </ReportCenter>
        )}

        {inquiry.isPending && (
          <>
            <SummaryStrip loading cells={[{ label: 'الكمية', value: '' }, { label: 'مبلغ البيع', value: '' }, { label: 'الفواتير', value: '' }, { label: 'العمولة', value: '' }]} />
            <ReportCenter><Loading /></ReportCenter>
          </>
        )}

        {data && !inquiry.isPending && (
          <>
            <SummaryStrip
              cells={[
                { label: 'الكمية', value: formatNum(data.summary.quantity) },
                { label: 'مبلغ البيع', value: <Money value={data.summary.salesAmount} />, tone: 'brand' },
                { label: 'الفواتير', value: formatNum(data.summary.receiptCount) },
                { label: 'العمولة', value: <Money value={data.summary.commissionAmount} />, hint: `${formatNum(data.summary.commissionLineCount)} سطر` },
                { label: 'البائعون', value: formatNum(data.salesmen.length) },
                { label: 'الأصناف', value: formatNum(data.products.length) },
              ]}
            />
            {(data.receiptsTruncated || data.commissionsTruncated) && (
              <ReportNote tone="warn" bar>
                النتائج مقتطعة للعرض
                {data.receiptsTruncated ? ' — أول 400 فاتورة' : ''}
                {data.commissionsTruncated ? ' — أول 800 سطر عمولة' : ''}
                . الملخص أعلاه كامل. استخدم «تصدير Excel» للتفاصيل الكاملة.
              </ReportNote>
            )}

            <div className="shrink-0 bg-white px-2">
              <Tabs
                items={[
                  { id: 'salesmen' as ResultTab, label: 'تجميع حسب البائع', count: data.salesmen.length },
                  { id: 'products' as ResultTab, label: 'المنتجات', count: data.products.length },
                  { id: 'commissions' as ResultTab, label: 'تفاصيل العمولات', count: data.commissions.length },
                  { id: 'receipts' as ResultTab, label: 'الفواتير', count: data.receipts.length },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>

            {tab === 'products' && (
              <DataGrid
                variant="sheet"
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
              <ReportSplit chart={salesmenChart} open={dock.open}>
                <DataGrid
                  variant="sheet"
                  embedded
                  fillHeight
                  columns={salesmanColumns()}
                  rows={data.salesmen}
                  getRowId={r => r.salesmanId}
                  storageKey="product-inquiry-salesmen"
                  exportName={`استعلام-بائعين-${range.from}_${range.to}`}
                  counterLabel="بائع"
                  emptyText="لا بائعين في هذا النطاق"
                  toolbar={salesmenChart ? <ChartToggle dock={dock} /> : undefined}
                />
              </ReportSplit>
            )}
            {tab === 'commissions' && (
              <DataGrid
                variant="sheet"
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
                variant="sheet"
                embedded
                fillHeight
                columns={receiptColumns()}
                rows={data.receipts}
                getRowId={r => `${r.receiptId}-${r.salesmanId}`}
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
          </>
        )}
      </ReportFill>
    </ReportAppWindow>
  );
}

/** حقل بحث المنتج (اسم/باركود) — الشرائح تُعرض تحت شريط النطاق. */
function ProductChips({
  products,
  onAdd,
}: {
  products: PickedProduct[];
  onAdd: (p: PickedProduct) => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ['product-inquiry-search', debounced],
    queryFn: () => api.searchProducts(debounced),
    enabled: debounced.length >= 2 && !isLikelyBarcode(debounced),
  });
  const results = q.trim().length >= 2 ? (searchQ.data ?? []) : [];

  useEffect(() => setActive(0), [debounced]);

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
    <div className="min-w-[240px] flex-[2_1_320px]">
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">
        المنتجات{products.length ? ` (${formatNum(products.length)})` : ''}
      </span>
      <div className="relative">
        <IconSearch size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' && results.length) {
              e.preventDefault();
              setActive(i => Math.min(results.length - 1, i + 1));
              return;
            }
            if (e.key === 'ArrowUp' && results.length) {
              e.preventDefault();
              setActive(i => Math.max(0, i - 1));
              return;
            }
            if (e.key === 'Escape' && q) {
              e.preventDefault();
              setQ('');
              return;
            }
            if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            if (isLikelyBarcode(q)) void addBarcode(q);
            // النتائج من بحث مؤجَّل — لا نختار إلا إن طابقت النص الحالي واكتمل الجلب
            else if (debounced === q.trim() && !searchQ.isFetching && results[active]) pick(results[active]);
          }}
          placeholder="اسم أو باركود ثم Enter — يمكن إضافة أكثر من صنف"
          className="!h-8 !ps-8 text-[12.5px]"
          aria-label="بحث منتج"
        />
        {results.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-[var(--shadow-pop)]" role="listbox">
            {results.map((p, i) => (
              <button
                key={productSeq(p)}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right text-[12.5px] ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(p)}
              >
                <span className="truncate font-medium text-header">{fixEdariName(p.name) || p.barcode || `#${productSeq(p)}`}</span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{p.barcode}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function productColumns(): GridColumn<ProductInquiryProductRowDto>[] {
  return [
    { key: 'productName', header: 'المنتج', width: 280, exportValue: r => fixEdariName(r.productName) || `#${r.articleSeq}`, render: r => <span className="font-semibold text-header">{fixEdariName(r.productName) || `#${r.articleSeq}`}</span> },
    { key: 'barcode', header: 'الباركود', width: 140, mono: true },
    { key: 'quantity', header: 'الكمية', width: 110, mono: true, footer: 'sum' },
    { key: 'salesAmount', header: 'مبلغ البيع', width: 140, mono: true, footer: 'sum', render: r => formatCurrency(r.salesAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 140, mono: true, footer: 'sum', render: r => <span className="font-bold text-brand-800">{formatCurrency(r.commissionAmount)}</span> },
    { key: 'receiptCount', header: 'فواتير', width: 90, mono: true, footer: 'sum', align: 'center' },
  ];
}

function salesmanColumns(): GridColumn<ProductInquirySalesmanRowDto>[] {
  return [
    { key: 'salesmanName', header: 'البائع', width: 240, exportValue: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}`, render: r => <span className="font-semibold text-header">{fixEdariName(r.salesmanName) || `#${r.salesmanId}`}</span> },
    { key: 'quantity', header: 'الكمية', width: 110, mono: true, footer: 'sum' },
    { key: 'salesAmount', header: 'مبلغ البيع', width: 150, mono: true, footer: 'sum', render: r => formatCurrency(r.salesAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 150, mono: true, footer: 'sum', render: r => <span className="font-extrabold text-brand-800">{formatCurrency(r.commissionAmount)}</span> },
    { key: 'receiptCount', header: 'فواتير', width: 90, mono: true, footer: 'sum', align: 'center' },
  ];
}

function commissionColumns(): GridColumn<ProductInquiryCommissionRowDto>[] {
  return [
    { key: 'saleDate', header: 'التاريخ', width: 120, exportValue: r => shortDate(r.saleDate), render: r => shortDate(r.saleDate) },
    { key: 'receiptNumber', header: 'الفاتورة', width: 110, mono: true, exportValue: r => receiptLabel(r.receiptNumber, r.receiptId), render: r => receiptLabel(r.receiptNumber, r.receiptId) },
    { key: 'productName', header: 'المنتج', width: 200, exportValue: r => fixEdariName(r.productName) || `#${r.articleSeq}`, render: r => fixEdariName(r.productName) || `#${r.articleSeq}` },
    { key: 'salesmanName', header: 'البائع', width: 160, exportValue: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}`, render: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}` },
    { key: 'commissionGroupName', header: 'المجموعة', width: 160, render: r => r.commissionGroupName || '—' },
    {
      key: 'commissionType',
      header: 'النوع',
      width: 140,
      exportValue: r => (r.commissionType ? formatCommissionLabel(r.commissionType, r.commissionValue) : '—'),
      render: r => r.commissionType ? formatCommissionLabel(r.commissionType, r.commissionValue) : '—',
    },
    { key: 'quantity', header: 'الكمية', width: 90, mono: true, footer: 'sum' },
    { key: 'lineAmount', header: 'مبلغ السطر', width: 130, mono: true, footer: 'sum', render: r => formatCurrency(r.lineAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 130, mono: true, footer: 'sum', render: r => <span className="font-bold text-brand-800">{formatCurrency(r.commissionAmount)}</span> },
  ];
}

function receiptColumns(): GridColumn<ProductInquiryReceiptRowDto>[] {
  return [
    { key: 'saleDate', header: 'التاريخ', width: 130, exportValue: r => shortDate(r.saleDate), render: r => shortDate(r.saleDate) },
    { key: 'receiptNumber', header: 'الفاتورة', width: 120, mono: true, exportValue: r => receiptLabel(r.receiptNumber, r.receiptId), render: r => <span className="font-bold text-brand-800">{receiptLabel(r.receiptNumber, r.receiptId)}</span> },
    { key: 'salesmanName', header: 'البائع', width: 180, exportValue: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}`, render: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}` },
    { key: 'quantity', header: 'كمية النطاق', width: 120, mono: true, footer: 'sum' },
    { key: 'salesAmount', header: 'مبلغ النطاق', width: 140, mono: true, footer: 'sum', render: r => formatCurrency(r.salesAmount) },
    { key: 'commissionAmount', header: 'العمولة', width: 130, mono: true, footer: 'sum', render: r => formatCurrency(r.commissionAmount) },
    { key: 'lineCount', header: 'بنود', width: 80, mono: true, align: 'center' },
  ];
}

const itemColumns: GridColumn<ReceiptItemDto>[] = [
  { key: 'name', header: 'المنتج', width: 240, exportValue: r => fixEdariName(r.name) || `#${r.articleId}`, render: r => <span className="font-semibold">{fixEdariName(r.name) || `#${r.articleId}`}</span> },
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
          className="text-[12px] font-semibold text-brand-700 hover:underline"
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
