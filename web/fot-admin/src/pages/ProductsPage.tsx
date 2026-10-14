import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, daysAgoIso, formatNum, todayIso } from '@/api/client';
import { copyText } from '@/lib/clipboard';
import { fixEdariName } from '@/lib/text';
import type { ProductDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useClientSort } from '@/components/grid/DataGrid';
import { Alert, Badge, Btn, EmptyState, Field, IconButton, Input, Kbd, Modal, Pagination, Select, TableSkeleton } from '@/components/ui';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspaceFooter,
  WorkspacePage,
  type SummaryCell,
} from '@/components/listWorkspace';
import {
  IconBarcode,
  IconCopy,
  IconExternal,
  IconPackage,
  IconPencil,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconTag,
  IconX,
} from '@/components/icons';

const PAGE_SIZES = [50, 100, 200] as const;
const PAGE_SIZE_KEY = 'fot_admin_product_page';
const PRODUCTS_UI_KEY = 'fot_admin_products_ui';
/** حد المخزون القليل — أقل منه يظهر تنبيه. */
const LOW_STOCK = 5;

type StockFilter = 'all' | 'offer' | 'zero' | 'negative';

function loadProductsUi() {
  try {
    return JSON.parse(sessionStorage.getItem(PRODUCTS_UI_KEY) || 'null') as {
      filter?: StockFilter;
    } | null;
  } catch {
    return null;
  }
}

function loadPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY) || 50);
    return PAGE_SIZES.includes(n as (typeof PAGE_SIZES)[number]) ? n : 50;
  } catch {
    return 50;
  }
}

/** شارة المخزون: نفد / قليل / رقم عادي. */
function StockCell({ n }: { n: number }) {
  if (n <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-semibold text-red-600 num">{formatNum(n)}</span>
        <Badge tone="danger">نفد</Badge>
      </span>
    );
  }
  if (n < LOW_STOCK) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-semibold text-amber-700 num">{formatNum(n)}</span>
        <Badge tone="warn">قليل</Badge>
      </span>
    );
  }
  return <span className="num">{formatNum(n)}</span>;
}

function ProductEditModal({
  product,
  onClose,
}: {
  product: ProductDto;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  // تُركَّب النافذة من جديد لكل منتج (key={product.id}) — الحالة الأولية تكفي بلا مزامنة.
  const [name, setName] = useState(product.name ?? '');
  const [barcode, setBarcode] = useState(product.barcode ?? '');
  const [originalPrice, setOriginalPrice] = useState(String(product.originalPrice ?? 0));
  const [finalPrice, setFinalPrice] = useState(String(product.price ?? 0));
  const [stock, setStock] = useState(String(product.stock ?? 0));
  const [storedDiscount, setStoredDiscount] = useState(String(product.storedDiscountPercent ?? 0));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);

  const save = useMutation({
    mutationFn: () =>
      api.updateProduct(product.id, {
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

  // الحقل الفارغ غير صالح — Number('') = 0 كان يحفظ صفراً بصمت.
  const badNum = (v: string, min?: number) =>
    v.trim() === '' || !Number.isFinite(Number(v)) || (min !== undefined && Number(v) < min);
  const priceInvalid = badNum(finalPrice, 0) || badNum(originalPrice, 0);
  const stockInvalid = badNum(stock);
  const discInvalid = badNum(storedDiscount, 0) || Number(storedDiscount) > 100;
  const invalid = priceInvalid || stockInvalid || discInvalid;

  const persist = useCallback(() => {
    if (dirty && !save.isPending && !invalid) save.mutate();
  }, [dirty, save, invalid]);
  useSaveShortcut(persist, dirty);

  const orig = Number(originalPrice) || 0;
  const fin = Number(finalPrice) || orig;
  const drop = orig > 0 && fin < orig ? Math.round((1 - fin / orig) * 100) : 0;
  const stockN = Number(stock) || 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || save.isPending || invalid) return;
    save.mutate();
  }

  async function copyBarcode() {
    if (!product?.barcode) return;
    try {
      await copyText(product.barcode);
      toast.success('تم نسخ الباركود');
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  return (
    <Modal
      open
      size="lg"
      icon={<IconPackage size={18} />}
      title={fixEdariName(product.name) || 'تعديل منتج'}
      subtitle={
        <span className="num">
          Seq {formatNum(product.seq)}
          {product.num ? ` · الرمز ${product.num}` : ''}
          {product.barcode ? ` · ${product.barcode}` : ''}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
            {dirty ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400" /> تعديلات غير محفوظة · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> أو <Kbd>Enter</Kbd>
              </>
            ) : (
              'لا تعديلات غير محفوظة'
            )}
          </div>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn
              type="submit"
              form="product-edit-form"
              loading={save.isPending}
              disabled={!dirty || invalid}
            >
              حفظ
            </Btn>
          </div>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
        <form id="product-edit-form" onSubmit={submit} className="space-y-4">
          {error && <Alert title="تعذر الحفظ">{error}</Alert>}
          <section className="space-y-3">
            <p className="text-[11.5px] font-bold text-slate-500">البيانات الأساسية</p>
            <Field label="الاسم">
              <Input
                value={name}
                onChange={e => { setName(e.target.value); setDirty(true); }}
              />
            </Field>
            <Field label="الباركود" hint="يُستخدم في المسح عند نقطة البيع وفي طباعة الملصقات.">
              <Input
                dir="ltr"
                className="font-mono"
                value={barcode}
                onChange={e => { setBarcode(e.target.value); setDirty(true); }}
              />
            </Field>
          </section>
          <section className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-[11.5px] font-bold text-slate-500">السعر والمخزون</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="سعر المستهلك (IQD)">
                <Input
                  type="number"
                  min={0}
                  className="num"
                  value={originalPrice}
                  onChange={e => { setOriginalPrice(e.target.value); setDirty(true); }}
                />
              </Field>
              <Field label="السعر النهائي (IQD)" hint={drop > 0 ? `أقل من سعر المستهلك بـ ${drop}%` : undefined}>
                <Input
                  type="number"
                  min={0}
                  className="num"
                  value={finalPrice}
                  onChange={e => { setFinalPrice(e.target.value); setDirty(true); }}
                />
              </Field>
              <Field label="المخزون">
                <Input
                  type="number"
                  className="num"
                  value={stock}
                  onChange={e => { setStock(e.target.value); setDirty(true); }}
                />
              </Field>
              <Field label="خصم المنتج %" hint="من 0 إلى 100 — يُحفظ على الصنف نفسه.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="num"
                  value={storedDiscount}
                  onChange={e => { setStoredDiscount(e.target.value); setDirty(true); }}
                />
              </Field>
            </div>
            {priceInvalid && <p className="text-[12px] font-medium text-red-600">الأسعار مطلوبة ويجب أن تكون أرقاماً موجبة.</p>}
            {stockInvalid && <p className="text-[12px] font-medium text-red-600">المخزون مطلوب ويجب أن يكون رقماً.</p>}
            {discInvalid && <p className="text-[12px] font-medium text-red-600">نسبة الخصم يجب أن تكون بين 0 و 100.</p>}
            {/* زر مخفي ليعمل Enter داخل النموذج */}
            <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
          </section>
        </form>
        <aside className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-[13px]">
          <p className="text-[11.5px] font-bold text-slate-500">ملخص</p>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-500">السعر النهائي</span>
            <span className="text-[16px] font-bold text-header num">
              {formatNum(fin)} <span className="text-[10.5px] font-medium text-slate-400">IQD</span>
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">خصم العرض</span>
            <span className="font-semibold num">
              {product.discountPercent > 0 ? `${formatNum(product.discountPercent)}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">خصم المنتج</span>
            <span className="font-semibold num">
              {Number(storedDiscount) > 0 ? `${formatNum(Number(storedDiscount))}%` : '—'}
            </span>
          </div>
          {drop > 0 && drop !== product.discountPercent && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">فرق السعر المحرَّر</span>
              <span className="font-semibold text-amber-700 num">{drop}%</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">المخزون</span>
            <StockCell n={stockN} />
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">قيمة المخزون</span>
            <span className="font-semibold num">{formatNum(Math.max(0, stockN) * fin)}</span>
          </div>
          {product.offerName ? (
            <Link
              to={`/offers?q=${encodeURIComponent(product.offerName)}`}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800 hover:underline"
            >
              <IconTag size={13} /> العرض: {product.offerName}
            </Link>
          ) : (
            <p className="text-[12px] text-slate-400">لا عرض نشط على هذا الصنف</p>
          )}
          <div className="flex flex-wrap gap-1.5 border-t border-slate-200/70 pt-3">
            {product.barcode && (
              <Btn size="xs" variant="secondary" icon={<IconCopy size={12} />} onClick={() => void copyBarcode()}>
                نسخ الباركود
              </Btn>
            )}
            <Link to={`/barcode-labels?q=${encodeURIComponent(product.barcode || product.num || '')}`}>
              <Btn size="xs" variant="secondary" icon={<IconPrinter size={12} />}>طباعة ملصق</Btn>
            </Link>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

export function ProductsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const savedUi = loadProductsUi();
  const initialSearch = params.get('search') ?? '';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(loadPageSize);
  const [search, setSearch] = useState(initialSearch);
  const [debounced, setDebounced] = useState(initialSearch);
  const [stockFilter, setStockFilter] = useState<StockFilter>(savedUi?.filter ?? 'all');
  const [edit, setEdit] = useState<ProductDto | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = params.get('search') ?? '';
    setSearch(s);
    setDebounced(s);
    setPage(1);
  }, [params]);

  // بحث تلقائي بعد توقف الكتابة (Enter يبحث فوراً أو يفتح المنتج بالباركود)
  useEffect(() => {
    const term = search.trim();
    if (term === debounced) return;
    if (/^\d{6,}$/.test(term)) return; // الباركود يُبحث بـ Enter فقط
    const id = window.setTimeout(() => {
      setDebounced(term);
      setPage(1);
    }, 400);
    return () => window.clearTimeout(id);
  }, [search, debounced]);

  function applySearch() {
    setDebounced(search.trim());
    setPage(1);
  }

  function submitSearch() {
    const term = search.trim();
    if (/^\d{6,}$/.test(term)) barcodeLookup.mutate(term);
    else applySearch();
  }

  function clearSearch() {
    setSearch('');
    setDebounced('');
    setStockFilter('all');
    setPage(1);
    searchRef.current?.focus();
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(PRODUCTS_UI_KEY, JSON.stringify({ filter: stockFilter }));
    } catch {
      /* تجاهل */
    }
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
  const pageStats = useMemo(() => {
    let offer = 0;
    let zero = 0;
    let low = 0;
    let value = 0;
    for (const p of items) {
      if (p.offerName) offer++;
      if (p.stock <= 0) zero++;
      else if (p.stock < LOW_STOCK) low++;
      if (p.stock > 0) value += p.stock * p.price;
    }
    return { offer, zero, low, value };
  }, [items]);

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
      // نافذة مفتوحة (تعديل منتج/تأكيد…) — لا اختصارات للصفحة خلفها.
      if (document.querySelector('[role=dialog],[role=alertdialog]')) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest('input, textarea, select, [contenteditable="true"]');
      // "/" أو F3 للانتقال إلى البحث
      if ((e.key === '/' && !typing) || e.key === 'F3') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key !== 'Enter') return;
      if (t?.closest('a, button, input, select, textarea, [contenteditable=true]')) return;
      if (selected) {
        e.preventDefault();
        setEdit(selected);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  function changeFilter(f: StockFilter) {
    setStockFilter(f);
    setPage(1);
  }

  function changePageSize(n: number) {
    setPageSize(n);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      /* تجاهل */
    }
  }

  const hasFilter = !!debounced || stockFilter !== 'all';
  const total = q.data?.total ?? 0;
  const firstLoad = q.isLoading && !q.data;

  const stripCells: SummaryCell[] = [
    {
      label: 'أصناف الكتالوج',
      value: catalogQ.data ? formatNum(catalogQ.data.totalProducts) : '—',
      hint: catalogQ.data ? `آخر Seq ${formatNum(catalogQ.data.maxSeq)}` : undefined,
      tone: 'brand',
    },
    {
      label: hasFilter ? 'نتائج البحث' : 'المعروض',
      value: formatNum(total),
      hint: q.data ? `صفحة ${formatNum(q.data.page)} من ${formatNum(q.data.totalPages || 1)}` : undefined,
    },
    {
      label: 'قيمة المخزون (الصفحة)',
      value: formatNum(pageStats.value),
      hint: 'المخزون × السعر النهائي',
    },
    {
      label: 'نفد المخزون (الصفحة)',
      value: formatNum(pageStats.zero),
      hint: stockFilter === 'zero' ? 'معروض الآن — انقر للإلغاء' : 'انقر لعرض كل النافد',
      tone: pageStats.zero > 0 ? 'danger' : 'ok',
      onClick: () => changeFilter(stockFilter === 'zero' ? 'all' : 'zero'),
      active: stockFilter === 'zero',
    },
    {
      label: 'مخزون قليل (الصفحة)',
      value: formatNum(pageStats.low),
      hint: `أقل من ${formatNum(LOW_STOCK)} قطع`,
      tone: pageStats.low > 0 ? 'warn' : undefined,
    },
    {
      label: 'بعرض (الصفحة)',
      value: formatNum(pageStats.offer),
      hint: stockFilter === 'offer' ? 'معروض الآن — انقر للإلغاء' : 'انقر لعرض كل ما عليه عرض',
      onClick: () => changeFilter(stockFilter === 'offer' ? 'all' : 'offer'),
      active: stockFilter === 'offer',
    },
  ];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar onSubmit={submitSearch}>
          <FilterLabel label="بحث بالاسم أو الرمز أو الباركود" grow>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
                {barcodeLookup.isPending ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                ) : (
                  <IconSearch size={16} />
                )}
              </span>
              <Input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape' && search) {
                    e.preventDefault();
                    setSearch('');
                    setDebounced('');
                    setPage(1);
                  }
                }}
                placeholder="اكتب الاسم أو امسح الباركود ثم Enter…"
                className="!ps-9 !pe-9 font-bold"
                aria-label="بحث المنتجات"
              />
              <span className="absolute inset-y-0 end-2 flex items-center">
                {search ? (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setDebounced(''); setPage(1); searchRef.current?.focus(); }}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="مسح البحث"
                  >
                    <IconX size={14} />
                  </button>
                ) : (
                  <span className="pointer-events-none hidden sm:block"><Kbd>/</Kbd></span>
                )}
              </span>
            </div>
          </FilterLabel>

          <FilterLabel label="المخزون" className={stockFilter === 'zero' || stockFilter === 'negative' ? ACTIVE_SELECT : ''}>
            <Select
              aria-label="فلتر المخزون"
              title="لا يُجمع مع فلتر العروض"
              value={stockFilter === 'zero' || stockFilter === 'negative' ? stockFilter : 'all'}
              onChange={e => {
                const v = e.target.value;
                changeFilter(v === 'zero' || v === 'negative' ? v : stockFilter === 'zero' || stockFilter === 'negative' ? 'all' : stockFilter);
              }}
            >
              <option value="all">كل المخزون</option>
              <option value="zero">نفد المخزون فقط</option>
              <option value="negative">رصيد سالب (يحتاج تصحيح)</option>
            </Select>
          </FilterLabel>

          <FilterLabel label="العروض" className={stockFilter === 'offer' ? ACTIVE_SELECT : ''}>
            <Select
              aria-label="فلتر العروض"
              title="لا يُجمع مع فلتر المخزون"
              value={stockFilter === 'offer' ? 'offer' : 'all'}
              onChange={e => changeFilter(e.target.value === 'offer' ? 'offer' : stockFilter === 'offer' ? 'all' : stockFilter)}
            >
              <option value="all">كل الأصناف</option>
              <option value="offer">عليها عرض فقط</option>
            </Select>
          </FilterLabel>

          <FilterLabel label="لكل صفحة" className="sm:!min-w-[96px]">
            <Select aria-label="عدد الصفوف في الصفحة" value={pageSize} onChange={e => changePageSize(Number(e.target.value))}>
              {PAGE_SIZES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </FilterLabel>

          <FilterActions>
            <Btn type="submit" icon={<IconSearch size={15} />} loading={barcodeLookup.isPending}>
              بحث
            </Btn>
            {hasFilter && (
              <Btn variant="secondary" onClick={clearSearch} title="مسح البحث والفلاتر">
                مسح
              </Btn>
            )}
            <IconButton label="تحديث" onClick={() => { void q.refetch(); void catalogQ.refetch(); }}>
              <IconRefresh size={15} className={q.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </FilterActions>
        </FilterBar>

        <SummaryStrip cells={stripCells} loading={firstLoad} />

        {q.isError && q.data && (
          <div className="shrink-0 p-2">
            <Alert title="تعذر تحديث المنتجات">
              <div className="flex flex-wrap items-center gap-2">
                {q.error instanceof Error ? q.error.message : 'خطأ غير معروف'}
                <Btn size="xs" variant="secondary" onClick={() => q.refetch()}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}

        <WorkspaceBody>
          {q.isError && !q.data ? (
            <div className="p-3">
              <Alert title="تعذر تحميل المنتجات">
                <p>{q.error instanceof Error ? q.error.message : 'خطأ غير معروف'}</p>
                <Btn size="xs" variant="secondary" className="mt-2" onClick={() => q.refetch()}>إعادة المحاولة</Btn>
              </Alert>
            </div>
          ) : firstLoad ? (
            <div className="p-3"><TableSkeleton rows={12} cols={8} /></div>
          ) : !sorted.length ? (
            <EmptyState
              icon={<IconPackage size={24} />}
              title={hasFilter ? 'لا نتائج مطابقة' : 'لا منتجات'}
              description={
                hasFilter
                  ? 'جرّب اسماً أقصر، أو امسح باركود المنتج ثم اضغط Enter.'
                  : 'حدّث الكتالوج من صفحة Edari إذا كانت القاعدة فارغة.'
              }
              action={hasFilter ? <Btn variant="secondary" size="sm" onClick={clearSearch}>مسح الفلاتر</Btn> : undefined}
            />
          ) : (
            <DataGrid
              variant="sheet"
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
              emptyText="لا منتجات تطابق فلتر الأعمدة"
              badge={
                <span className="hidden text-[11px] text-slate-400 lg:inline">
                  مرتين على الصف للتعديل · مرتين على السعر/الخصم/المخزون للتحرير السريع · / أو F3 للبحث
                </span>
              }
              selectedId={selectedId ?? undefined}
              onSelect={p => setSelectedId(p.id)}
              onEnter={p => setEdit(p)}
              onRowDoubleClick={p => setEdit(p)}
              rowTone={p => (p.stock <= 0 ? 'bg-red-50/40' : undefined)}
            />
          )}
        </WorkspaceBody>

        {q.data && sorted.length > 0 && (
          <WorkspaceFooter>
            {selected ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <IconPackage size={14} className="shrink-0 text-brand-700" />
                <span className="max-w-[300px] truncate font-bold text-header" title={fixEdariName(selected.name) || selected.barcode || ''}>
                  {fixEdariName(selected.name) || selected.barcode}
                </span>
                <span className="text-[11.5px] text-slate-500 num">Seq {formatNum(selected.seq)}</span>
                {selected.offerName && <Badge tone="ok" dot>{selected.offerName}</Badge>}
                <ProductSalesChip product={selected} />
                <span className="mx-1 h-4 w-px bg-slate-200" />
                <Btn size="xs" icon={<IconPencil size={12} />} onClick={() => setEdit(selected)}>تعديل</Btn>
                {selected.barcode && (
                  <Btn size="xs" variant="secondary" icon={<IconCopy size={12} />} onClick={() => copy(selected.barcode!, 'الباركود')}>
                    الباركود
                  </Btn>
                )}
                <Btn size="xs" variant="secondary" icon={<IconCopy size={12} />} onClick={() => copy(String(selected.seq), 'الرقم')}>Seq</Btn>
                <Link to={`/barcode-labels?q=${encodeURIComponent(selected.barcode || selected.num || '')}`}>
                  <Btn size="xs" variant="secondary" icon={<IconPrinter size={12} />}>طباعة ملصق</Btn>
                </Link>
                {selected.offerName && (
                  <Link to={`/offers?q=${encodeURIComponent(selected.offerName)}`}>
                    <Btn size="xs" variant="secondary" icon={<IconExternal size={12} />}>فتح العرض</Btn>
                  </Link>
                )}
              </div>
            ) : (
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-400">
                انقر صفاً لتحديده وإظهار أوامره هنا · ↑↓ للتنقل · Enter للتعديل
              </span>
            )}
            <div className="ms-auto">
              <Pagination compact page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} onPage={setPage} />
            </div>
          </WorkspaceFooter>
        )}
      </WorkspaceCard>

      {edit && <ProductEditModal key={edit.id} product={edit} onClose={() => setEdit(null)} />}
    </WorkspacePage>
  );
}

/** مبيعات المادة المحددة: آخر 30 يوماً ومنذ البداية (صافي بعد المرتجعات). */
function ProductSalesChip({ product }: { product: ProductDto }) {
  const term = (product.barcode || product.num || '').trim();
  const today = todayIso();
  const pick = (rows?: { articleId: number; soldQty: number }[]) => rows?.find(r => r.articleId === product.id)?.soldQty ?? 0;
  const recentQ = useQuery({
    queryKey: ['report-movement', daysAgoIso(29), today, term],
    queryFn: () => api.movement(daysAgoIso(29), today, term),
    enabled: Boolean(term),
    staleTime: 120_000,
  });
  const allQ = useQuery({
    queryKey: ['report-movement', '2020-01-01', today, term],
    queryFn: () => api.movement('2020-01-01', today, term),
    enabled: Boolean(term),
    staleTime: 300_000,
  });
  if (!term) return null;
  const loading = recentQ.isLoading || allQ.isLoading;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2 py-0.5 text-[11.5px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200"
      title="صافي الكمية المباعة بعد طرح المرتجعات"
    >
      {loading ? (
        <span className="text-sky-500">مبيعات…</span>
      ) : (
        <>
          مباع 30 يوماً: <span className="num font-extrabold">{formatNum(pick(recentQ.data))}</span>
          <span className="text-sky-300">·</span>
          منذ البداية: <span className="num font-extrabold">{formatNum(pick(allQ.data))}</span>
        </>
      )}
    </span>
  );
}

/** تمييز الفلتر النشط (مثل صفحة الفواتير). */
const ACTIVE_SELECT = '[&_select]:border-brand-300 [&_select]:bg-brand-50/40 [&_select]:font-semibold';

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
      width: 52,
      align: 'center',
      sortable: false,
      exportable: false,
      render: (_p, i) => <span className="text-[11.5px] text-slate-400 num">{(opts.page - 1) * opts.pageSize + i + 1}</span>,
    },
    { key: 'seq', header: 'Seq', width: 84, mono: true },
    { key: 'num', header: 'الرمز', width: 96, mono: true, render: p => p.num ?? '—' },
    {
      key: 'name',
      header: 'الاسم',
      width: 280,
      exportValue: p => fixEdariName(p.name),
      render: p => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block max-w-[260px] truncate font-semibold text-header" title={fixEdariName(p.name)}>
            {fixEdariName(p.name) || '—'}
          </span>
          {p.offerName && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title={`عرض: ${p.offerName}`} />}
        </span>
      ),
    },
    {
      key: 'barcode',
      header: 'الباركود',
      width: 160,
      mono: true,
      render: p =>
        p.barcode ? (
          <button
            type="button"
            dir="ltr"
            className="group inline-flex items-center gap-1 font-mono text-[12px] text-slate-600 hover:text-brand-700"
            title="نسخ الباركود"
            onClick={e => {
              e.stopPropagation();
              opts.onCopy(p.barcode!, 'الباركود');
            }}
          >
            <IconBarcode size={12} className="text-slate-300 group-hover:text-brand-500" />
            {p.barcode}
          </button>
        ) : <span className="text-slate-300">—</span>,
    },
    { key: 'originalPrice', header: 'سعر المستهلك', width: 116, mono: true, footer: 'avg' },
    {
      key: 'price',
      header: 'السعر النهائي',
      width: 120,
      mono: true,
      footer: 'avg',
      render: p => (
        <span className={`font-bold ${p.price < p.originalPrice ? 'text-emerald-700' : 'text-header'}`}>{formatNum(p.price)}</span>
      ),
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
      header: 'خصم العرض',
      width: 92,
      mono: true,
      render: p => (p.discountPercent > 0 ? <Badge tone="ok" className="num">{formatNum(p.discountPercent)}%</Badge> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'storedDiscountPercent',
      header: 'خصم المنتج',
      width: 96,
      mono: true,
      sortValue: p => p.storedDiscountPercent ?? 0,
      render: p => ((p.storedDiscountPercent ?? 0) > 0
        ? <Badge tone="warn" className="num">{formatNum(p.storedDiscountPercent ?? 0)}%</Badge>
        : <span className="text-slate-300">—</span>),
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
      width: 120,
      mono: true,
      footer: 'sum',
      render: p => <StockCell n={p.stock} />,
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
      header: 'العرض',
      width: 160,
      sortValue: p => p.offerName ?? '',
      render: p =>
        p.offerName ? (
          <Link
            to={`/offers?q=${encodeURIComponent(p.offerName)}`}
            onClick={e => e.stopPropagation()}
            className="inline-flex max-w-[150px] items-center gap-1 truncate text-brand-700 hover:underline"
          >
            <IconTag size={12} className="shrink-0" />
            <span className="truncate">{p.offerName}</span>
          </Link>
        ) : <span className="text-slate-300">—</span>,
    },
  ];
}
