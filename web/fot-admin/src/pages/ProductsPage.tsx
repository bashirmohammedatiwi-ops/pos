import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import { copyText } from '@/lib/clipboard';
import { fixEdariName } from '@/lib/text';
import type { ProductDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useClientSort } from '@/components/grid/DataGrid';
import { Alert, Btn, Field, Input, Loading, Modal, Pagination, Select } from '@/components/ui';
import {
  ClassicFilterActions,
  ClassicListShell,
  ClassicResultBadge,
  ClassicSummaryFooter,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { EmptyWorkspace, SoftChip } from '@/components/workspace';
import { IconPackage } from '@/components/icons';
import { downloadCsv } from '@/utils/exportCsv';

const PAGE_SIZES = [50, 100, 200] as const;
const PAGE_SIZE_KEY = 'fot_admin_product_page';
const PRODUCTS_UI_KEY = 'fot_admin_products_ui';

type StockFilter = 'all' | 'offer' | 'zero';

function loadProductsUi() {
  try {
    return JSON.parse(sessionStorage.getItem(PRODUCTS_UI_KEY) || 'null') as {
      filter?: StockFilter;
    } | null;
  } catch {
    return null;
  }
}

function ProductEditModal({
  product,
  onClose,
}: {
  product: ProductDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [originalPrice, setOriginalPrice] = useState(String(product?.originalPrice ?? 0));
  const [finalPrice, setFinalPrice] = useState(String(product?.price ?? 0));
  const [stock, setStock] = useState(String(product?.stock ?? 0));
  const [storedDiscount, setStoredDiscount] = useState(String(product?.storedDiscountPercent ?? 0));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);

  useEffect(() => {
    if (!product) return;
    setName(product.name ?? '');
    setBarcode(product.barcode ?? '');
    setOriginalPrice(String(product.originalPrice ?? 0));
    setFinalPrice(String(product.price ?? 0));
    setStock(String(product.stock ?? 0));
    setStoredDiscount(String(product.storedDiscountPercent ?? 0));
    setError('');
    setDirty(false);
  }, [product]);

  const save = useMutation({
    mutationFn: () =>
      api.updateProduct(product!.id, {
        name,
        barcode,
        originalPrice: Number(originalPrice),
        finalPrice: Number(finalPrice),
        stock: Number(stock),
        discountPercent: Math.min(100, Math.max(0, Math.round(Number(storedDiscount) || 0))),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['catalog-picker-products'] });
      setDirty(false);
      toast.success('تم حفظ المنتج');
      onClose();
    },
    onError: e => setError(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const persist = useCallback(() => {
    if (dirty && !save.isPending) save.mutate();
  }, [dirty, save]);
  useSaveShortcut(persist, !!product && dirty);

  if (!product) return null;

  const orig = Number(originalPrice) || 0;
  const fin = Number(finalPrice) || orig;
  const drop = orig > 0 && fin < orig ? Math.round((1 - fin / orig) * 100) : 0;

  return (
    <Modal
      open
      size="lg"
      title={fixEdariName(product.name) || 'تعديل منتج'}
      subtitle={`Seq ${formatNum(product.seq)}${product.num ? ` · الرمز ${product.num}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <div className="text-[12px] text-slate-500">
            {dirty ? 'Ctrl+S للحفظ' : 'لا تعديلات غير محفوظة'}
          </div>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? 'جاري الحفظ…' : 'حفظ'}
            </Btn>
          </div>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="الاسم">
            <Input
              value={name}
              onChange={e => { setName(e.target.value); setDirty(true); }}
            />
          </Field>
          <Field label="الباركود">
            <Input
              value={barcode}
              onChange={e => { setBarcode(e.target.value); setDirty(true); }}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="سعر المستهلك">
              <Input
                type="number"
                value={originalPrice}
                onChange={e => { setOriginalPrice(e.target.value); setDirty(true); }}
              />
            </Field>
            <Field label="السعر النهائي">
              <Input
                type="number"
                value={finalPrice}
                onChange={e => { setFinalPrice(e.target.value); setDirty(true); }}
              />
            </Field>
            <Field label="المخزون">
              <Input
                type="number"
                value={stock}
                onChange={e => { setStock(e.target.value); setDirty(true); }}
              />
            </Field>
            <Field label="خصم المنتج %">
              <Input
                type="number"
                value={storedDiscount}
                onChange={e => { setStoredDiscount(e.target.value); setDirty(true); }}
              />
            </Field>
          </div>
        </div>
        <aside className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-[13px]">
          <p className="text-[11px] font-semibold text-slate-500">ملخص</p>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">خصم العرض</span>
            <span className="font-semibold tabular-nums">
              {product.discountPercent > 0 ? `${formatNum(product.discountPercent)}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">خصم المنتج المخزّن</span>
            <span className="font-semibold tabular-nums">
              {Number(storedDiscount) > 0 ? `${formatNum(Number(storedDiscount))}%` : '—'}
            </span>
          </div>
          {drop > 0 && drop !== product.discountPercent && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">فرق السعر المحرَّر</span>
              <span className="font-semibold tabular-nums text-amber-700">{drop}%</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">المخزون</span>
            <span className={`font-semibold tabular-nums ${Number(stock) <= 0 ? 'text-red-600' : ''}`}>
              {formatNum(Number(stock) || 0)}
            </span>
          </div>
          {product.offerName ? (
            <Link
              to={`/offers?q=${encodeURIComponent(product.offerName)}`}
              className="block rounded-xl bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800 hover:underline"
            >
              العرض: {product.offerName}
            </Link>
          ) : (
            <p className="text-[12px] text-slate-400">لا عرض نشط على هذا الصنف</p>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function stockClass(n: number) {
  if (n <= 0) return 'font-semibold text-red-600';
  if (n < 5) return 'font-medium text-amber-600';
  return '';
}

export function ProductsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const savedUi = loadProductsUi();
  const initialSearch = params.get('search') ?? '';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY) || 50);
    return PAGE_SIZES.includes(n as (typeof PAGE_SIZES)[number]) ? n : 50;
  });
  const [search, setSearch] = useState(initialSearch);
  const [debounced, setDebounced] = useState(initialSearch);
  const [stockFilter, setStockFilter] = useState<StockFilter>(savedUi?.filter ?? 'all');
  const [edit, setEdit] = useState<ProductDto | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const s = params.get('search') ?? '';
    setSearch(s);
    setDebounced(s);
    setPage(1);
  }, [params]);

  function applySearch() {
    setDebounced(search.trim());
    setPage(1);
  }

  function clearSearch() {
    setSearch('');
    setDebounced('');
    setStockFilter('all');
    setPage(1);
  }

  useEffect(() => {
    sessionStorage.setItem(PRODUCTS_UI_KEY, JSON.stringify({ filter: stockFilter }));
  }, [stockFilter]);

  const serverFilter = stockFilter === 'all' ? undefined : stockFilter;

  const q = useQuery({
    queryKey: ['products', page, pageSize, debounced, serverFilter],
    queryFn: () => api.products(page, debounced || undefined, pageSize, serverFilter),
    placeholderData: prev => prev,
  });

  const catalogQ = useQuery({
    queryKey: ['catalog-info'],
    queryFn: api.catalogInfo,
    staleTime: 120_000,
  });

  const barcodeLookup = useMutation({
    mutationFn: (code: string) => api.productByBarcode(code),
    onSuccess: p => {
      setSearch(p.barcode || p.name || search);
      setDebounced(p.barcode || p.name || search);
      setEdit(p);
      setSelectedId(p.id);
      setPage(1);
      toast.success(`وُجد: ${fixEdariName(p.name) || p.barcode}`);
    },
    onError: () => toast.error('لا منتج بهذا الباركود'),
  });

  const items = q.data?.items ?? [];
  const qcProducts = { invalidate: () => { qc.invalidateQueries({ queryKey: ['products'] }); } };
  const sortAccessors = useMemo(
    () => ({
      seq: (p: ProductDto) => p.seq,
      num: (p: ProductDto) => p.num ?? '',
      name: (p: ProductDto) => p.name ?? '',
      barcode: (p: ProductDto) => p.barcode ?? '',
      originalPrice: (p: ProductDto) => p.originalPrice,
      price: (p: ProductDto) => p.price,
      discount: (p: ProductDto) => p.discountPercent,
      stock: (p: ProductDto) => p.stock,
      offer: (p: ProductDto) => p.offerName ?? '',
    }),
    [],
  );
  const { sorted } = useClientSort(items, sortAccessors, 'name');
  const selected = sorted.find(p => p.id === selectedId) ?? null;
  const offerOnPage = items.filter(p => p.offerName).length;
  const zeroOnPage = items.filter(p => p.stock <= 0).length;

  // تحرير سريع مباشر من خلية الجدول (السعر النهائي/المخزون/خصم المنتج %)
  const quickEdit = useMutation({
    mutationFn: async (req: { id: number; product: ProductDto; field: 'price' | 'stock' | 'storedDiscount'; value: number }) => {
      await api.updateProduct(req.id, {
        name: req.product.name ?? '',
        barcode: req.product.barcode ?? '',
        originalPrice: req.product.originalPrice,
        finalPrice: req.field === 'price' ? req.value : req.product.price,
        stock: req.field === 'stock' ? req.value : req.product.stock,
        discountPercent: req.field === 'storedDiscount'
          ? Math.min(100, Math.max(0, Math.round(req.value)))
          : undefined,
      });
    },
    onSuccess: (_d, req) => {
      qcProducts.invalidate();
      toast.success(req.field === 'price' ? 'حُدّث السعر' : req.field === 'storedDiscount' ? 'حُدّث خصم المنتج' : 'حُدّث المخزون');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التحديث'),
  });

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, button')) return;
      if (selected) {
        e.preventDefault();
        setEdit(selected);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        banner={
          selected ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-brand-200/70 bg-brand-50/50 px-3 py-1.5 text-[11px]">
              <IconPackage size={13} className="text-brand-700" />
              <span className="font-bold text-header">{fixEdariName(selected.name) || selected.barcode}</span>
              <SoftChip>Seq {formatNum(selected.seq)}</SoftChip>
              {selected.offerName && <SoftChip tone="ok">{selected.offerName}</SoftChip>}
              <div className="mr-auto flex flex-wrap gap-1">
                <Btn size="sm" onClick={() => setEdit(selected)}>تعديل</Btn>
                {selected.barcode && (
                  <Btn size="sm" variant="secondary" onClick={() => copy(selected.barcode!, 'الباركود')}>نسخ الباركود</Btn>
                )}
                <Link to={`/barcode-labels?q=${encodeURIComponent(selected.barcode || selected.num || '')}`}>
                  <Btn size="sm" variant="secondary">طباعة باركود</Btn>
                </Link>
                <Btn size="sm" variant="secondary" onClick={() => copy(String(selected.seq), 'الرقم')}>نسخ Seq</Btn>
                {selected.offerName && (
                  <Link to={`/offers?q=${encodeURIComponent(selected.offerName)}`}>
                    <Btn size="sm" variant="secondary">فتح العرض</Btn>
                  </Link>
                )}
              </div>
            </div>
          ) : undefined
        }
        filters={
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px_auto_auto] lg:items-end">
            <FilterField label="بحث بالاسم أو الرمز أو الباركود">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  const term = search.trim();
                  if (/^\d{6,}$/.test(term)) barcodeLookup.mutate(term);
                  else applySearch();
                }}
                placeholder="ابحث…"
              />
            </FilterField>
            <FilterField label="المخزون / العروض">
              <Select
                value={stockFilter}
                onChange={e => {
                  setStockFilter(e.target.value as StockFilter);
                  setPage(1);
                }}
              >
                <option value="all">الكل</option>
                <option value="offer">بعرض</option>
                <option value="zero">بدون مخزون</option>
              </Select>
            </FilterField>
            <ClassicFilterActions
              applyLabel="بحث"
              onApply={applySearch}
              onClear={clearSearch}
            />
            <ClassicResultBadge>{formatNum(q.data?.total ?? 0)} منتج</ClassicResultBadge>
          </div>
        }
        header={{
          title: 'المنتجات',
          hint: 'انقر مرتين على أي منتج لتعديل السعر والمخزون',
          actions: (
            <Btn
              size="sm"
              variant="secondary"
              disabled={!sorted.length}
              onClick={() =>
                downloadCsv(
                  'products.csv',
                  ['Seq', 'الرمز', 'الاسم', 'باركود', 'أصلي', 'نهائي', 'خصم%', 'مخزون', 'عرض'],
                  sorted.map(p => [
                    p.seq,
                    p.num ?? '',
                    p.name ?? '',
                    p.barcode ?? '',
                    p.originalPrice,
                    p.price,
                    p.discountPercent,
                    p.stock,
                    p.offerName ?? '',
                  ]),
                )
              }
            >
              CSV
            </Btn>
          ),
        }}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
        pagination={
          q.data && sorted.length ? (
            <Pagination compact page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} onPage={setPage} />
          ) : undefined
        }
        footer={
          <ClassicSummaryFooter
            total={q.data?.total}
            totalLabel="نتائج البحث"
            items={[
              { label: 'كتالوج', value: formatNum(catalogQ.data?.totalProducts ?? q.data?.total ?? 0) },
              { label: 'معروض', value: formatNum(q.data?.total ?? 0), accent: true },
              { label: 'بعرض (صفحة)', value: formatNum(offerOnPage) },
              { label: 'مخزون 0 (صفحة)', value: formatNum(zeroOnPage) },
            ]}
            loading={q.isLoading}
          />
        }
      >
        {q.isLoading && !q.data ? (
          <Loading />
        ) : !sorted.length ? (
          <EmptyWorkspace
            title={debounced || stockFilter !== 'all' ? 'لا نتائج مطابقة' : 'لا منتجات'}
            hint={debounced ? 'جرّب اسماً أقصر أو باركود المنتج ثم Enter.' : 'حدّث الكتالوج من صفحة Edari إذا كانت القاعدة فارغة.'}
          />
        ) : (
          <DataGrid
            embedded
            fillHeight
            columns={productColumns({
              page,
              pageSize,
              onCopy: (v, l) => void copy(v, l),
              onQuickEdit: quickEdit.mutate,
            })}
            rows={sorted}
            getRowId={p => p.id}
            storageKey="products"
            exportName={`المنتجات-${debounced || 'الكل'}`}
            counterLabel="منتج"
            emptyText="لا منتجات"
            selectedId={selectedId ?? undefined}
            onSelect={p => setSelectedId(p.id)}
            onEnter={p => setEdit(p)}
            onRowDoubleClick={p => setEdit(p)}
            toolbar={
              <label className="flex items-center gap-1 text-[10.5px] font-bold text-slate-500">
                <span>/صفحة</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    const n = Number(e.target.value);
                    setPageSize(n);
                    setPage(1);
                    localStorage.setItem(PAGE_SIZE_KEY, String(n));
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-bold outline-none"
                >
                  {PAGE_SIZES.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            }
          />
        )}
      </ClassicListShell>

      <ProductEditModal product={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

/* أعمدة المنتجات — DataGrid مع تحرير مباشر للسعر/المخزون */
function productColumns(opts: {
  page: number;
  pageSize: number;
  onCopy: (value: string, label: string) => void;
  onQuickEdit: (req: { id: number; product: ProductDto; field: 'price' | 'stock' | 'storedDiscount'; value: number }) => void;
}): GridColumn<ProductDto>[] {
  return [
    {
      key: 'idx',
      header: '#',
      width: 56,
      align: 'center',
      sortable: false,
      exportable: false,
      render: (_p, i) => <span className="text-slate-400">{(opts.page - 1) * opts.pageSize + i + 1}</span>,
    },
    { key: 'seq', header: 'Seq', width: 90, mono: true },
    { key: 'num', header: 'الرمز', width: 100, mono: true, render: p => p.num ?? '—' },
    {
      key: 'name',
      header: 'الاسم',
      width: 260,
      render: p => (
        <span className="block max-w-[260px] truncate font-semibold text-header" title={fixEdariName(p.name)}>
          {fixEdariName(p.name) || '—'}
        </span>
      ),
    },
    {
      key: 'barcode',
      header: 'الباركود',
      width: 150,
      mono: true,
      render: p =>
        p.barcode ? (
          <button
            type="button"
            className="hover:text-brand-700 hover:underline"
            title="نسخ الباركود"
            onClick={e => {
              e.stopPropagation();
              opts.onCopy(p.barcode!, 'الباركود');
            }}
          >
            {p.barcode}
          </button>
        ) : '—',
    },
    { key: 'originalPrice', header: 'أصلي', width: 110, mono: true, footer: 'avg' },
    {
      key: 'price',
      header: 'نهائي',
      width: 120,
      mono: true,
      footer: 'avg',
      render: p => <span className="font-bold text-header">{formatNum(p.price)}</span>,
      edit: {
        type: 'number',
        getValue: p => p.price,
        onCommit: (p, raw) => {
          const v = Number(raw);
          if (Number.isFinite(v) && v >= 0) opts.onQuickEdit({ id: p.id, product: p, field: 'price', value: v });
        },
      },
    },
    {
      key: 'discountPercent',
      header: 'خصم%',
      width: 80,
      mono: true,
      render: p => (p.discountPercent > 0 ? <span className="rounded bg-emerald-100 px-1 text-emerald-800">{formatNum(p.discountPercent)}%</span> : '—'),
    },
    {
      key: 'storedDiscountPercent',
      header: 'خصم مخزّن',
      width: 100,
      mono: true,
      sortValue: p => p.storedDiscountPercent ?? 0,
      render: p => ((p.storedDiscountPercent ?? 0) > 0
        ? <span className="rounded bg-amber-100 px-1 text-amber-800">{formatNum(p.storedDiscountPercent ?? 0)}%</span>
        : '—'),
      edit: {
        type: 'number',
        getValue: p => p.storedDiscountPercent ?? 0,
        onCommit: (p, raw) => {
          const v = Number(raw);
          if (Number.isFinite(v) && v >= 0) opts.onQuickEdit({ id: p.id, product: p, field: 'storedDiscount', value: v });
        },
      },
    },
    {
      key: 'stock',
      header: 'المخزون',
      width: 110,
      mono: true,
      footer: 'sum',
      render: p => <span className={stockClass(p.stock)}>{formatNum(p.stock)}</span>,
      edit: {
        type: 'number',
        getValue: p => p.stock,
        onCommit: (p, raw) => {
          const v = Number(raw);
          if (Number.isFinite(v)) opts.onQuickEdit({ id: p.id, product: p, field: 'stock', value: v });
        },
      },
    },
    {
      key: 'offerName',
      header: 'عرض',
      width: 150,
      sortValue: p => p.offerName ?? '',
      render: p =>
        p.offerName ? (
          <Link to={`/offers?q=${encodeURIComponent(p.offerName)}`} className="text-brand-700 hover:underline">
            {p.offerName}
          </Link>
        ) : '—',
    },
  ];
}
