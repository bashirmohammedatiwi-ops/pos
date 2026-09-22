import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { ProductDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { Btn, Checkbox, Input, Select } from '@/components/ui';
import { ClassicSummaryFooter, FilterField } from '@/components/classic/ClassicListLayout';
import { IconPrinter, IconPlus, IconTrash, IconX } from '@/components/icons';
import { isLikelyBarcode } from '@/lib/catalogBrowse';
import {
  CONTENT_TEMPLATES,
  DEFAULT_LABEL_SETTINGS,
  LABEL_SIZES,
  LAYOUT_PRESETS,
  buildLabelPreview,
  buildSheetPreview,
  clampColumns,
  labelNameLooksLong,
  printProductLabels,
  productToLabelItem,
  sheetMetrics,
  type LabelFields,
  type LabelItem,
  type LabelSettings,
  type LabelSizeId,
  type LayoutPreset,
} from '@/lib/labelPrint';
import { fixEdariName } from '@/lib/text';

const STORE_KEY = 'fot-barcode-label-v3';
const FIELD_OPTIONS: { key: keyof LabelFields; label: string }[] = [
  { key: 'name', label: 'اسم المادة' },
  { key: 'price', label: 'السعر' },
  { key: 'originalPrice', label: 'السعر قبل العرض' },
  { key: 'barcode', label: 'رسم الباركود' },
  { key: 'barcodeText', label: 'رقم الباركود' },
  { key: 'articleNum', label: 'رقم المادة' },
  { key: 'offer', label: 'اسم العرض' },
  { key: 'discount', label: 'نسبة الخصم' },
  { key: 'shop', label: 'اسم المحل' },
];

type QueueRow = LabelItem & { id: string; productId: number };

function loadSettings(): LabelSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY)
      || localStorage.getItem('fot-barcode-label-v2')
      || localStorage.getItem('fot-barcode-label-v1');
    if (!raw) return { ...DEFAULT_LABEL_SETTINGS, fields: { ...DEFAULT_LABEL_SETTINGS.fields } };
    const parsed = JSON.parse(raw) as Partial<LabelSettings>;
    return {
      ...DEFAULT_LABEL_SETTINGS,
      ...parsed,
      fields: { ...DEFAULT_LABEL_SETTINGS.fields, ...parsed.fields },
      nameLines: parsed.nameLines === 1 || parsed.nameLines === 3 ? parsed.nameLines : 2,
      codeSize: parsed.codeSize === 'sm' || parsed.codeSize === 'lg' ? parsed.codeSize : 'md',
      insetMm: Math.max(0.6, Math.min(3, Number(parsed.insetMm) || DEFAULT_LABEL_SETTINGS.insetMm)),
      align: parsed.align === 'start' ? 'start' : 'center',
      columns: clampColumns(parsed.columns ?? 3),
      gapMm: Math.max(0, Math.min(10, Number(parsed.gapMm) || 2)),
      rowGapMm: Math.max(0, Math.min(10, Number(parsed.rowGapMm) || 2)),
      marginMm: Math.max(0, Math.min(8, Number(parsed.marginMm) || 0)),
      rowsPerPage: Math.min(8, Math.max(1, Math.round(Number(parsed.rowsPerPage)) || 1)),
    };
  } catch {
    return { ...DEFAULT_LABEL_SETTINGS, fields: { ...DEFAULT_LABEL_SETTINGS.fields } };
  }
}

function newRowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyLayout(preset: LayoutPreset, prev: LabelSettings): LabelSettings {
  return {
    ...prev,
    sizeId: preset.sizeId,
    widthMm: preset.w,
    heightMm: preset.h,
    columns: preset.columns,
    gapMm: preset.gap,
  };
}

export function BarcodeLabelsPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const copiesRef = useRef<HTMLInputElement>(null);
  const openedCode = useRef(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [copies, setCopies] = useState(1);
  const [current, setCurrent] = useState<ProductDto | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<LabelSettings>(loadSettings);
  const [printing, setPrinting] = useState(false);
  const [miss, setMiss] = useState('');
  const [previewMode, setPreviewMode] = useState<'label' | 'sheet'>('label');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const printQ = useQuery({
    queryKey: ['print-settings'],
    queryFn: api.printSettings,
    staleTime: 120_000,
  });
  const shopName = (printQ.data?.headerText || printQ.data?.name || '').trim();

  const printersQ = useQuery({
    queryKey: ['desktop-printers'],
    queryFn: () => window.fotDesktop!.listPrinters!(),
    enabled: Boolean(window.fotDesktop?.listPrinters),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (settings.printerName || !printersQ.data?.length) return;
    const hit = printersQ.data.find(p =>
      /tsc|xprinter|godex|zebra|argox|honeywell|label|barcode|باركود|ملصق/i.test(`${p.name} ${p.displayName}`),
    );
    if (hit) setSettings(s => (s.printerName ? s : { ...s, printerName: hit.name }));
  }, [printersQ.data, settings.printerName]);

  const searchQ = useQuery({
    queryKey: ['barcode-label-search', debounced],
    queryFn: () => api.searchProducts(debounced),
    enabled: debounced.length >= 2 && !isLikelyBarcode(debounced),
  });

  const lookupM = useMutation({
    mutationFn: (code: string) => api.productByBarcode(code),
    onSuccess: product => {
      setCurrent(product);
      setMiss('');
      setQuery(product.barcode || product.num || query);
      if (settings.autoPrint) void printNow(product, copies);
      else copiesRef.current?.select();
    },
    onError: () => {
      setCurrent(null);
      setMiss('لا مادة بهذا الباركود');
      toast.error('لا مادة بهذا الباركود');
      inputRef.current?.select();
    },
  });

  useEffect(() => {
    if (openedCode.current) return;
    const code = params.get('q')?.trim();
    if (!code) return;
    openedCode.current = true;
    setQuery(code);
    if (isLikelyBarcode(code) || /^\d{4,}$/.test(code)) lookupM.mutate(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (printing) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (queue.length) void printItems(queue);
        else if (current) void printNow(current, copies);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, copies, printing, settings, queue]);

  function applySize(id: LabelSizeId) {
    const preset = LABEL_SIZES.find(s => s.id === id);
    if (!preset) return;
    setSettings(s => ({
      ...s,
      sizeId: id,
      widthMm: id === 'custom' ? s.widthMm : preset.w,
      heightMm: id === 'custom' ? s.heightMm : preset.h,
    }));
  }

  function patchField(key: keyof LabelFields, value: boolean) {
    setSettings(s => ({ ...s, fields: { ...s.fields, [key]: value } }));
  }

  function toItem(product: ProductDto, qty = copies): LabelItem {
    return productToLabelItem(product, qty, shopName);
  }

  function addToQueue(product: ProductDto, qty = copies) {
    const item = toItem(product, qty);
    setQueue(rows => {
      const same = rows.find(r => r.productId === product.id && r.barcode === item.barcode);
      if (same) {
        const next = rows.map(r => (r.id === same.id ? { ...r, copies: r.copies + item.copies } : r));
        setSelectedId(same.id);
        return next;
      }
      const row: QueueRow = { ...item, id: newRowId(), productId: product.id };
      setSelectedId(row.id);
      return [...rows, row];
    });
    toast.success(`أُضيف ${item.name} × ${formatNum(item.copies)}`);
    setQuery('');
    inputRef.current?.focus();
  }

  async function printItems(items: LabelItem[]) {
    if (!items.length) {
      toast.error('لا ملصقات للطباعة');
      return;
    }
    setPrinting(true);
    try {
      await printProductLabels(items, settings);
      const metrics = sheetMetrics(settings);
      const total = items.reduce((n, i) => n + i.copies, 0);
      const rows = Math.ceil(total / metrics.columns);
      toast.success(`طُبع ${formatNum(total)} ملصق · ${formatNum(rows)} صف × ${formatNum(metrics.columns)} أعمدة`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
      inputRef.current?.focus();
    }
  }

  async function printNow(product: ProductDto, qty = copies) {
    await printItems([toItem(product, qty)]);
  }

  function onSubmitQuery() {
    const term = query.trim();
    if (!term) return;
    if (current && (term === current.barcode || term === current.num)) {
      void printNow(current, copies);
      return;
    }
    if (isLikelyBarcode(term) || /^\d{4,}$/.test(term)) {
      lookupM.mutate(term);
      return;
    }
    const first = searchQ.data?.[0];
    if (first) {
      setCurrent(first);
      setMiss('');
    } else {
      toast.error('اختر مادة من النتائج أو امسح الباركود');
    }
  }

  const metrics = useMemo(() => sheetMetrics(settings), [settings]);
  const activeLayout = LAYOUT_PRESETS.find(p =>
    p.columns === settings.columns && p.w === settings.widthMm && p.h === settings.heightMm && p.gap === settings.gapMm,
  )?.id;

  const previewItem = useMemo(() => {
    if (selectedId) {
      const row = queue.find(r => r.id === selectedId);
      if (row) return row;
    }
    if (current) return toItem(current, copies);
    return {
      name: 'اسم المادة',
      barcode: '1234567890128',
      articleNum: 'A-100',
      price: 12500,
      originalPrice: 15000,
      offerName: 'عرض الأسبوع',
      discountPercent: 17,
      shopName: shopName || 'اسم المحل',
      copies: 1,
    };
  }, [current, copies, queue, selectedId, shopName]);

  const preview = useMemo(
    () => buildSheetPreview([previewItem], settings),
    [previewItem, settings],
  );
  const labelPreview = useMemo(
    () => buildLabelPreview(previewItem, settings),
    [previewItem, settings],
  );
  const previewScale = Math.min(1, 360 / preview.widthPx, 168 / preview.heightPx);
  const labelScale = Math.min(2.4, 300 / labelPreview.widthPx, 210 / labelPreview.heightPx);
  const longName = labelNameLooksLong(previewItem.name);
  const totalLabels = queue.reduce((n, r) => n + r.copies, 0);
  const queueRows = totalLabels ? Math.ceil(totalLabels / metrics.columns) : 0;

  const columns = useMemo<GridColumn<QueueRow>[]>(() => [
    { key: 'name', header: 'المادة', width: 220, render: r => <span className="font-semibold text-header">{r.name}</span> },
    { key: 'barcode', header: 'الباركود', width: 140, mono: true, render: r => <span dir="ltr">{r.barcode || '—'}</span> },
    { key: 'price', header: 'السعر', width: 100, mono: true, render: r => formatCurrency(r.price) },
    {
      key: 'copies',
      header: 'العدد',
      width: 80,
      mono: true,
      footer: 'sum',
      edit: {
        type: 'number',
        getValue: r => r.copies,
        onCommit: (r, raw) => {
          const n = Math.max(1, Math.min(999, Math.round(Number(raw)) || 1));
          setQueue(rows => rows.map(x => (x.id === r.id ? { ...x, copies: n } : x)));
        },
      },
      render: r => formatNum(r.copies),
    },
    {
      key: 'actions',
      header: '',
      width: 88,
      exportable: false,
      render: r => (
        <div className="flex gap-1">
          <Btn size="sm" variant="secondary" disabled={printing} onClick={() => void printItems([r])}>
            طباعة
          </Btn>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            title="حذف"
            onClick={() => setQueue(rows => rows.filter(x => x.id !== r.id))}
          >
            <IconTrash size={14} />
          </button>
        </div>
      ),
    },
  ], [printing, settings]);

  return (
    <div className="barcode-studio">
      <div className="barcode-scan">
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label="امسح الباركود أو ابحث بالاسم" className="min-w-[280px] flex-1">
            <div className="relative">
              <Input
                ref={inputRef}
                value={query}
                dir="ltr"
                className="barcode-scan-input text-left"
                placeholder="ضع المؤشر هنا وامسح الباركود — أو اكتب الاسم"
                onChange={e => {
                  setQuery(e.target.value);
                  setMiss('');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSubmitQuery();
                  }
                }}
              />
              {searchQ.data && searchQ.data.length > 0 && query.trim().length >= 2 && !isLikelyBarcode(query) && (
                <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {searchQ.data.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-[13px] hover:bg-slate-50"
                      onClick={() => {
                        setCurrent(p);
                        setMiss('');
                        setQuery(p.barcode || p.name || '');
                        inputRef.current?.focus();
                      }}
                    >
                      <span className="font-semibold text-header">{fixEdariName(p.name) || p.barcode}</span>
                      <span className="font-mono text-[11px] text-slate-400" dir="ltr">{p.barcode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </FilterField>
          <FilterField label="عدد الملصقات" className="w-[148px]">
            <div className="barcode-qty">
              <button type="button" onClick={() => setCopies(n => Math.max(1, n - 1))}>−</button>
              <input
                ref={copiesRef}
                type="text"
                inputMode="numeric"
                className="num"
                value={String(copies)}
                onChange={e => setCopies(Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 1)))}
                onKeyDown={e => {
                  if (e.key === 'Enter' && current) {
                    e.preventDefault();
                    void printNow(current, copies);
                  }
                }}
              />
              <button type="button" onClick={() => setCopies(n => Math.min(999, n + 1))}>+</button>
            </div>
          </FilterField>
          <Btn loading={lookupM.isPending} disabled={!query.trim()} variant="secondary" onClick={onSubmitQuery}>
            إظهار المادة
          </Btn>
          <Btn disabled={!current} variant="secondary" onClick={() => current && addToQueue(current)}>
            <IconPlus size={14} /> إضافة للطابور
          </Btn>
          <Btn disabled={!current || printing} loading={printing} onClick={() => current && void printNow(current)}>
            <IconPrinter size={14} /> طباعة الآن
          </Btn>
        </div>
        <p className="text-[11px] text-slate-500">
          الطابعة تطبع <b className="text-header">{formatNum(metrics.columns)} أعمدة</b> في كل صف.
          الصفحة {formatNum(metrics.pageWidthMm)} × {formatNum(metrics.pageHeightMm)} مم
          {copies > 0 && ` · ${formatNum(copies)} ملصق = ${formatNum(Math.ceil(copies / metrics.columns))} صف`}.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-h-0 flex-col overflow-auto border-e border-slate-200">
          {miss && (
            <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{miss}</div>
          )}
          {current ? (
            <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold text-header" title={fixEdariName(current.name) || current.barcode}>
                    {fixEdariName(current.name) || current.barcode}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-slate-500" dir="ltr">{current.barcode || current.num || '—'}</p>
                </div>
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                  onClick={() => { setCurrent(null); setQuery(''); inputRef.current?.focus(); }}
                  title="إغلاق"
                >
                  <IconX size={16} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Detail label="السعر" value={formatCurrency(current.price)} accent />
                <Detail
                  label="قبل العرض"
                  value={current.originalPrice > current.price + 0.005 ? formatCurrency(current.originalPrice) : '—'}
                />
                <Detail label="رقم المادة" value={current.num || '—'} />
                <Detail label="المخزون" value={formatNum(current.stock)} />
                {current.offerName && <Detail label="العرض" value={current.offerName} />}
                {current.discountPercent > 0 && <Detail label="الخصم" value={`${formatNum(current.discountPercent)}%`} />}
              </div>
            </div>
          ) : (
            <div className="border-b border-slate-100 px-3 py-8 text-center text-[13px] text-slate-500">
              امسح الباركود لإظهار المادة — الملصقات تُصفّ {formatNum(metrics.columns)} في الصف الواحد كما تطبع الطابعة
            </div>
          )}

          <div className="min-h-0 flex-1">
            <DataGrid
              columns={columns}
              rows={queue}
              getRowId={r => r.id}
              selectedId={selectedId ?? undefined}
              onRowClick={r => setSelectedId(r.id)}
              embedded
              fillHeight
              maxHeight="100%"
              storageKey="barcode-label-queue"
              counterLabel="مادة"
              emptyText="الطابور فارغ — أضف مواداً لطباعة دفعة واحدة على الرول"
              exportName="طابور-الباركود"
              toolbar={
                queue.length > 0 ? (
                  <div className="flex gap-1">
                    <Btn size="sm" disabled={printing} onClick={() => void printItems(queue)}>
                      طباعة الطابور
                    </Btn>
                    <Btn size="sm" variant="secondary" onClick={() => { setQueue([]); setSelectedId(null); }}>
                      تفريغ
                    </Btn>
                  </div>
                ) : undefined
              }
            />
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto bg-slate-50/60 p-3">
          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12px] font-bold text-header">معاينة الملصق</p>
              <div className="barcode-preview-tabs">
                <button type="button" className={previewMode === 'label' ? 'is-on' : ''} onClick={() => setPreviewMode('label')}>ملصق</button>
                <button type="button" className={previewMode === 'sheet' ? 'is-on' : ''} onClick={() => setPreviewMode('sheet')}>صف الطابعة</button>
              </div>
            </div>
            {previewMode === 'label' ? (
              <>
                <div className="barcode-sheet-stage barcode-sheet-stage-label">
                  <div
                    className="barcode-label-frame"
                    style={{ width: labelPreview.widthPx * labelScale, height: labelPreview.heightPx * labelScale }}
                  >
                    <div
                      className="barcode-sheet-cut overflow-hidden"
                      style={{ width: labelPreview.widthPx * labelScale, height: labelPreview.heightPx * labelScale }}
                    >
                      <div
                        style={{
                          width: labelPreview.widthPx,
                          height: labelPreview.heightPx,
                          transform: `scale(${labelScale})`,
                          transformOrigin: 'top left',
                        }}
                        dangerouslySetInnerHTML={{ __html: labelPreview.html }}
                      />
                    </div>
                  </div>
                </div>
                <p className="barcode-hri-live" dir="ltr">{previewItem.barcode || previewItem.articleNum || '—'}</p>
                <p className="mt-1 text-center text-[11px] leading-5 text-slate-500">
                  {settings.widthMm} × {settings.heightMm} مم · الرقم يُطبع كما هو بدون خانة زائدة
                </p>
              </>
            ) : (
              <>
                <div className="barcode-sheet-stage">
                  <div
                    className="barcode-sheet-cut overflow-hidden"
                    style={{ width: preview.widthPx * previewScale, height: preview.heightPx * previewScale }}
                  >
                    <div
                      style={{
                        width: preview.widthPx,
                        height: preview.heightPx,
                        transform: `scale(${previewScale})`,
                        transformOrigin: 'top left',
                      }}
                      dangerouslySetInnerHTML={{ __html: preview.html }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-center text-[11px] leading-5 text-slate-500">
                  الصفحة {metrics.pageWidthMm} × {metrics.pageHeightMm} مم
                  {metrics.gap > 0 ? ` · فراغ ${metrics.gap} مم` : ''}
                  {' · '}
                  طابق عرض الصفحة مع عرض الرول في تعريف الطابعة
                </p>
              </>
            )}
            {longName && (
              <p className="barcode-warn">الاسم طويل — سيُضغط داخل حدود الملصق دون الخروج عن مكان الطباعة</p>
            )}
          </section>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[12px] font-bold text-header">تخطيط الرول</p>
            <div className="barcode-cols">
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`barcode-col-btn ${settings.columns === n ? 'is-on' : ''}`}
                  onClick={() => setSettings(s => ({ ...s, columns: n, gapMm: n === 1 ? 0 : Math.max(s.gapMm, 2) }))}
                >
                  <span className="barcode-col-dots">
                    {Array.from({ length: n }, (_, i) => <span key={i} />)}
                  </span>
                  <span className="text-[11px] font-bold">{n === 1 ? 'عمود' : `${n} أعمدة`}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LAYOUT_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`barcode-chip ${activeLayout === p.id ? 'is-on' : ''}`}
                  onClick={() => setSettings(s => applyLayout(p, s))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <FilterField label="مقاس الملصق الواحد">
              <Select value={settings.sizeId} onChange={e => applySize(e.target.value as LabelSizeId)}>
                {LABEL_SIZES.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </Select>
            </FilterField>
            {settings.sizeId === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="العرض مم">
                  <Input
                    type="number"
                    min={20}
                    max={120}
                    value={settings.widthMm}
                    onChange={e => setSettings(s => ({ ...s, widthMm: Math.max(20, Math.min(120, Number(e.target.value) || 40)) }))}
                  />
                </FilterField>
                <FilterField label="الارتفاع مم">
                  <Input
                    type="number"
                    min={15}
                    max={100}
                    value={settings.heightMm}
                    onChange={e => setSettings(s => ({ ...s, heightMm: Math.max(15, Math.min(100, Number(e.target.value) || 30)) }))}
                  />
                </FilterField>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <FilterField label="فراغ بين الملصقات">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={settings.gapMm}
                  onChange={e => setSettings(s => ({ ...s, gapMm: Math.max(0, Math.min(10, Number(e.target.value) || 0)) }))}
                />
              </FilterField>
              <FilterField label="هامش الصفحة">
                <Input
                  type="number"
                  min={0}
                  max={8}
                  step={0.5}
                  value={settings.marginMm}
                  onChange={e => setSettings(s => ({ ...s, marginMm: Math.max(0, Math.min(8, Number(e.target.value) || 0)) }))}
                />
              </FilterField>
              <FilterField label="هامش آمن داخل الملصق">
                <Input
                  type="number"
                  min={0.6}
                  max={3}
                  step={0.1}
                  value={settings.insetMm}
                  onChange={e => setSettings(s => ({ ...s, insetMm: Math.max(0.6, Math.min(3, Number(e.target.value) || 1.4)) }))}
                />
              </FilterField>
              <FilterField label="صفوف/صفحة">
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.rowsPerPage}
                  onChange={e => setSettings(s => ({ ...s, rowsPerPage: Math.min(8, Math.max(1, Number(e.target.value) || 1)) }))}
                />
              </FilterField>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">
              للرول ذي ثلاثة أعمدة اترك الصفوف 1. الهامش الآمن يُبقي الأشرطة والرقم داخل حدود الملصق.
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[12px] font-bold text-header">محتوى الملصق</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {CONTENT_TEMPLATES.map(t => {
                const on = JSON.stringify(settings.fields) === JSON.stringify(t.fields);
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={t.hint}
                    className={`barcode-chip ${on ? 'is-on' : ''}`}
                    onClick={() => setSettings(s => ({ ...s, fields: { ...t.fields } }))}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {FIELD_OPTIONS.map(opt => (
                <Checkbox
                  key={opt.key}
                  label={opt.label}
                  checked={settings.fields[opt.key]}
                  onChange={v => patchField(opt.key, v)}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FilterField label="سطور الاسم">
                <Select
                  value={String(settings.nameLines)}
                  onChange={e => setSettings(s => ({
                    ...s,
                    nameLines: e.target.value === '1' ? 1 : e.target.value === '3' ? 3 : 2,
                  }))}
                >
                  <option value="1">سطر واحد</option>
                  <option value="2">سطران</option>
                  <option value="3">ثلاثة — للأسماء الطويلة</option>
                </Select>
              </FilterField>
              <FilterField label="حجم رقم الباركود">
                <Select
                  value={settings.codeSize}
                  onChange={e => setSettings(s => ({
                    ...s,
                    codeSize: e.target.value === 'sm' || e.target.value === 'lg' ? e.target.value : 'md',
                  }))}
                >
                  <option value="sm">صغير</option>
                  <option value="md">واضح</option>
                  <option value="lg">كبير</option>
                </Select>
              </FilterField>
              <FilterField label="المحاذاة">
                <Select
                  value={settings.align}
                  onChange={e => setSettings(s => ({ ...s, align: e.target.value === 'start' ? 'start' : 'center' }))}
                >
                  <option value="center">وسط</option>
                  <option value="start">يمين</option>
                </Select>
              </FilterField>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              الرقم أسفل الأشرطة هو نفس باركود المادة — بلا خانة تحقق زائدة في النهاية.
            </p>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[12px] font-bold text-header">الطابعة</p>
            {printersQ.data && printersQ.data.length > 0 ? (
              <FilterField label="طابعة الباركود">
                <Select
                  value={settings.printerName}
                  onChange={e => setSettings(s => ({ ...s, printerName: e.target.value }))}
                >
                  <option value="">الطابعة الافتراضية</option>
                  {printersQ.data.map(p => (
                    <option key={p.name} value={p.name}>{p.displayName || p.name}</option>
                  ))}
                </Select>
              </FilterField>
            ) : (
              <p className="text-[11px] text-slate-500">اختر الطابعة من إعدادات ويندوز إن لم تظهر هنا.</p>
            )}
            <Checkbox
              label="طباعة مباشرة بعد إدخال الباركود"
              checked={settings.autoPrint}
              onChange={v => setSettings(s => ({ ...s, autoPrint: v }))}
            />
          </section>
        </aside>
      </div>

      <ClassicSummaryFooter
        items={[
          { label: 'مواد الطابور', value: formatNum(queue.length) },
          { label: 'ملصقات', value: formatNum(totalLabels), accent: true },
          { label: 'صفوف ستُطبع', value: formatNum(queueRows) },
          { label: 'أعمدة الطابعة', value: formatNum(metrics.columns) },
          { label: 'مقاس الصفحة', value: `${metrics.pageWidthMm} × ${metrics.pageHeightMm} مم` },
        ]}
      />
    </div>
  );
}

function Detail({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
      <p className={`truncate text-[13px] font-bold ${accent ? 'text-brand-700' : 'text-header'}`}>{value}</p>
    </div>
  );
}

export default BarcodeLabelsPage;
