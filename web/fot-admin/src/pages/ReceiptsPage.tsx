import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api,
  daysAgoIso,
  formatNum,
  todayIso,
} from '@/api/client';
import { CompleteHoldDialog, type HoldTarget } from '@/components/CompleteHoldDialog';
import { DatePresets, PeriodBanner } from '@/components/DatePresets';
import { DataGrid } from '@/components/grid/DataGrid';
import { buildReceiptColumns } from '@/components/receipts/receiptColumns';
import { ReceiptDetailSheet } from '@/components/receipts/ReceiptDetailSheet';
import { ReceiptsSummaryFooter } from '@/components/receipts/ReceiptsSummaryFooter';
import { useClassicFilters } from '@/components/classic/ClassicListLayout';
import {
  Alert,
  Btn,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Select,
  TableSkeleton,
} from '@/components/ui';
import {
  IconCheckCircle,
  IconClock,
  IconCloud,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconX,
} from '@/components/icons';
import { useToast } from '@/components/Toast';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';

const RECEIPT_FILTERS_KEY = 'fot_admin_receipts_v3';
const MAX_RECEIPTS = 10_000;

type AppliedFilters = {
  search: string;
  from: string;
  to: string;
  sectionId: string;
  posId: string;
  cashierId: string;
  kind: string;
  synced: string;
  hold: string;
};

function loadReceiptFilters(): Partial<AppliedFilters & { showCardInfo?: boolean }> | null {
  try {
    return JSON.parse(sessionStorage.getItem(RECEIPT_FILTERS_KEY) || 'null');
  } catch {
    return null;
  }
}

function defaultFilters(): AppliedFilters {
  const today = todayIso();
  return {
    search: '',
    from: today,
    to: today,
    sectionId: '',
    posId: '',
    cashierId: '',
    kind: '',
    synced: '',
    hold: '',
  };
}

function isInvoiceSearch(text: string) {
  const raw = text.trim().replace(/^#+/, '');
  return raw.length > 0 && /^\d+$/.test(raw);
}

type SegItem = { id: string; label: string; count?: number; tone?: 'warn' | 'danger' };

/** مبدّل مقسّم صغير مع عدّاد اختياري. */
function Segmented({ items, value, onChange, label }: { items: SegItem[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {items.map(it => {
        const on = it.id === value;
        const activeText = it.tone === 'warn' ? 'text-amber-800' : it.tone === 'danger' ? 'text-red-700' : 'text-brand-800';
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition ${
              on
                ? `bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-slate-200 ${activeText}`
                : 'text-slate-500 hover:bg-white/70 hover:text-header'
            }`}
          >
            {it.label}
            {it.count != null && (
              <span
                className={`rounded-full px-1.5 text-[10.5px] font-bold num ${
                  it.tone === 'warn' && it.count > 0
                    ? 'bg-amber-100 text-amber-800'
                    : on ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/70 text-slate-600'
                }`}
              >
                {formatNum(it.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${value ? '[&_select]:border-brand-300 [&_select]:bg-brand-50/40 [&_select]:font-semibold' : ''}`}>
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>
      <Select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        {children}
      </Select>
    </label>
  );
}

export function ReceiptsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const highlight = Number(params.get('highlight') || 0) || null;
  const saved = loadReceiptFilters();
  const today = todayIso();
  const { settings: periodSettings } = useBusinessPeriod();
  const searchRef = useRef<HTMLInputElement>(null);

  const [showCardInfo, setShowCardInfo] = useState(saved?.showCardInfo ?? false);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [openDetailId, setOpenDetailId] = useState<number | null>(highlight);
  const [syncingEdari, setSyncingEdari] = useState(false);

  async function syncPendingReceipts() {
    setSyncingEdari(true);
    try {
      const r = await api.syncEdariReceipts(true, 50);
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['edari-status'] });
      toast.success(r.message || 'تم ترحيل الفواتير إلى الأداري');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر ترحيل الفواتير');
    } finally {
      setSyncingEdari(false);
    }
  }

  const initial = useMemo<AppliedFilters>(() => ({
    search: params.get('search') || saved?.search || '',
    from: params.get('from') ?? saved?.from ?? today,
    to: params.get('to') ?? saved?.to ?? today,
    sectionId: params.get('sectionId') || saved?.sectionId || '',
    posId: params.get('posId') || saved?.posId || '',
    cashierId: params.get('cashierId') || saved?.cashierId || '',
    kind: params.get('kind') || saved?.kind || '',
    synced: params.get('synced') || (saved?.synced ?? ''),
    hold: params.get('hold') === '1' ? 'true' : (saved?.hold ?? ''),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const { draft, patchDraft, applied, apply, clear } = useClassicFilters<AppliedFilters>(initial);

  const sectionsQ = useQuery({ queryKey: ['sections'], queryFn: () => api.sections(false) });
  const cashiersQ = useQuery({ queryKey: ['cashiers'], queryFn: () => api.cashiers() });
  const terminalsQ = useQuery({ queryKey: ['terminals'], queryFn: api.terminals });
  const holdsQ = useQuery({ queryKey: ['hold-receipts'], queryFn: () => api.holdReceipts() });

  const q = useQuery({
    queryKey: ['receipts', applied],
    queryFn: () =>
      api.searchReceipts({
        page: 1,
        pageSize: MAX_RECEIPTS,
        search: applied.search || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        sectionId: applied.sectionId ? Number(applied.sectionId) : undefined,
        posId: applied.posId ? Number(applied.posId) : undefined,
        cashierId: applied.cashierId ? Number(applied.cashierId) : undefined,
        kind: applied.kind !== '' ? Number(applied.kind) : undefined,
        synced: applied.synced === '' ? undefined : applied.synced === 'true',
        hold: applied.hold === '' ? undefined : applied.hold === 'true',
      }),
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(RECEIPT_FILTERS_KEY, JSON.stringify({ ...applied, showCardInfo }));
    } catch { /* ignore */ }
    const next = new URLSearchParams();
    if (applied.search) next.set('search', applied.search);
    if (applied.from) next.set('from', applied.from);
    if (applied.to) next.set('to', applied.to);
    if (applied.sectionId) next.set('sectionId', applied.sectionId);
    if (applied.posId) next.set('posId', applied.posId);
    if (applied.cashierId) next.set('cashierId', applied.cashierId);
    if (applied.kind !== '') next.set('kind', applied.kind);
    if (applied.synced) next.set('synced', applied.synced);
    if (applied.hold === 'true') next.set('hold', '1');
    if (highlight) next.set('highlight', String(highlight));
    const current = params.toString();
    const target = next.toString();
    if (current !== target) setParams(next, { replace: true });
  }, [applied, showCardInfo, highlight, params, setParams]);

  useEffect(() => {
    if (highlight) setOpenDetailId(highlight);
  }, [highlight]);

  // «/» يركّز مربع البحث من أي مكان في الصفحة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // نافذة مفتوحة (تفاصيل/تأكيد) — لا نسرق التركيز إلى بحث الصفحة خلفها
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const applyFilters = useCallback((next?: Partial<AppliedFilters>) => {
    apply(next);
  }, [apply]);

  function clearFilters() {
    clear(defaultFilters());
  }

  /** عرض كل المعلّقة بغضّ النظر عن التاريخ. */
  function showAllHolds(openId?: number) {
    applyFilters({ hold: 'true', from: '', to: '', kind: '', synced: '', search: '' });
    if (openId) setOpenDetailId(openId);
  }

  const columns = useMemo(() => buildReceiptColumns(showCardInfo), [showCardInfo]);
  const summary = q.data?.summary;
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const truncated = total > rows.length;
  const holds = holdsQ.data ?? [];

  const detailQ = useQuery({
    queryKey: ['receipt-detail', openDetailId],
    queryFn: () => api.receiptDetail(openDetailId!),
    enabled: openDetailId != null,
  });

  const invoiceLookup = isInvoiceSearch(draft.search);
  const defaults = defaultFilters();
  const isDefault = (Object.keys(defaults) as (keyof AppliedFilters)[]).every(k => applied[k] === defaults[k]);
  const dirty = (['search', 'from', 'to'] as const).some(k => draft[k] !== applied[k]);

  // عدّ الأنواع من النتائج المحمّلة — يصح فقط حين لا يوجد فلتر نوع ولا اقتطاع
  const kindCounts = useMemo(() => {
    const c = { all: rows.length, '0': 0, '1': 0, '2': 0 } as Record<string, number>;
    for (const r of rows) c[String(r.kind)] = (c[String(r.kind)] ?? 0) + 1;
    return c;
  }, [rows]);
  const countFor = (id: string) => {
    if (!q.data || truncated) return undefined;
    if (applied.kind === '') return id === '' ? kindCounts.all : kindCounts[id];
    return id === applied.kind ? total : undefined;
  };

  const totalDiscount = summary
    ? summary.totalOffersDiscount + summary.totalUserDiscount + summary.totalItemsDiscount
    : 0;
  const avg = summary && summary.receiptCount > 0 ? summary.netTotal / summary.receiptCount : 0; // الصافي بعد طرح المرتجعات

  const stripCells: { label: string; value: string; hint?: string; tone?: 'brand' | 'warn' | 'danger' }[] = [
    { label: 'عدد الفواتير', value: summary ? formatNum(summary.receiptCount) : '—', hint: summary && summary.receiptCount > 0 ? `متوسط ${formatNum(avg)}` : undefined, tone: 'brand' },
    { label: 'الإجمالي', value: summary ? formatNum(summary.grossTotal) : '—' },
    { label: 'الخصومات', value: summary ? formatNum(totalDiscount) : '—', hint: summary && totalDiscount > 0 ? `عروض ${formatNum(summary.totalOffersDiscount)} · يدوي ${formatNum(summary.totalUserDiscount)}` : undefined, tone: totalDiscount > 0 ? 'warn' : undefined },
    { label: 'الصافي (بعد المرتجعات)', value: summary ? formatNum(summary.netTotal) : '—', tone: 'brand' },
    { label: 'المدفوع', value: summary ? formatNum(summary.totalPayment) : '—' },
    { label: 'الباقي للزبائن', value: summary ? formatNum(summary.totalCashBack) : '—' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* ── الفواتير المعلّقة ── */}
      {holds.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-amber-900">
            <IconClock size={15} className="text-amber-600" />
            {formatNum(holds.length)} فاتورة معلّقة
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {holds.slice(0, 8).map(h => (
              <span key={h.id} className="inline-flex items-center gap-1 rounded-lg bg-white py-0.5 pe-0.5 ps-2 text-[12px] ring-1 ring-amber-200">
                <button
                  type="button"
                  className="font-bold text-amber-900 hover:underline"
                  title={`${h.cashierName ?? ''} — عرض التفاصيل`}
                  onClick={() => showAllHolds(h.id)}
                >
                  #{h.id}
                </button>
                <span className="num text-slate-600">{formatNum(h.totalAmount)}</span>
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 font-bold text-brand-700 hover:bg-brand-50"
                  onClick={() => setHoldTarget(h)}
                >
                  إكمال
                </button>
              </span>
            ))}
          </div>
          <Btn size="xs" variant="secondary" onClick={() => showAllHolds()}>
            عرض كل المعلّقة
          </Btn>
        </div>
      )}

      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* ── الفلاتر ── */}
        <form
          className="shrink-0 border-b border-slate-200 bg-slate-50/70 px-3 pb-2.5 pt-2"
          onSubmit={e => {
            e.preventDefault();
            applyFilters();
          }}
        >
          <div className="grid items-end gap-2 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.6fr)_minmax(330px,auto)_repeat(3,minmax(130px,1fr))_auto]">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">بحث برقم الفاتورة أو البائع</span>
              <div className="relative">
                <IconSearch size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  ref={searchRef}
                  value={draft.search}
                  onChange={e => patchDraft({ search: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Escape' && draft.search) {
                      e.preventDefault();
                      patchDraft({ search: '' });
                    }
                  }}
                  placeholder="رقم الفاتورة — Enter للبحث"
                  className="!ps-9 !pe-9 font-bold"
                />
                {draft.search ? (
                  <button
                    type="button"
                    aria-label="مسح البحث"
                    onClick={() => {
                      patchDraft({ search: '' });
                      if (applied.search) applyFilters({ search: '' });
                    }}
                    className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <IconX size={14} />
                  </button>
                ) : (
                  <span className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>/</Kbd></span>
                )}
              </div>
            </label>

            <div className="min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">الفترة</span>
              <div className="flex items-center gap-1.5">
                <DatePresets
                  variant="menu"
                  periodSettings={periodSettings}
                  from={applied.from}
                  to={applied.to}
                  onPick={(from, to) => applyFilters({ from, to })}
                />
                <Input
                  type="date"
                  aria-label="من تاريخ"
                  title="من تاريخ"
                  value={draft.from}
                  onChange={e => patchDraft({ from: e.target.value })}
                  className="min-w-0 text-[12.5px]"
                />
                <span className="text-slate-400">—</span>
                <Input
                  type="date"
                  aria-label="إلى تاريخ"
                  title="إلى تاريخ"
                  value={draft.to}
                  onChange={e => patchDraft({ to: e.target.value })}
                  className="min-w-0 text-[12.5px]"
                />
              </div>
            </div>

            <FilterSelect label="القسم" value={draft.sectionId} onChange={v => applyFilters({ sectionId: v })}>
              <option value="">كل الأقسام</option>
              {(sectionsQ.data ?? []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="نقطة البيع" value={draft.posId} onChange={v => applyFilters({ posId: v })}>
              <option value="">كل نقاط البيع</option>
              {(terminalsQ.data ?? []).map(t => (
                <option key={t.id} value={t.id}>{t.name ?? t.id}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="الكاشير" value={draft.cashierId} onChange={v => applyFilters({ cashierId: v })}>
              <option value="">كل الكاشير</option>
              {(cashiersQ.data?.items ?? []).map(c => (
                <option key={c.id} value={c.id}>{c.accountName?.trim() || c.username}</option>
              ))}
            </FilterSelect>

            <div className="flex items-center gap-1.5">
              <Btn type="submit" icon={<IconSearch size={15} />} className={dirty ? 'ring-2 ring-brand-300 ring-offset-1' : ''}>
                استعراض
              </Btn>
              {!isDefault && (
                <Btn variant="secondary" onClick={clearFilters} title="إرجاع الفلاتر لفواتير اليوم">
                  مسح
                </Btn>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Segmented
              label="نوع الفاتورة"
              value={applied.kind}
              onChange={id => applyFilters({ kind: id })}
              items={[
                { id: '', label: 'الكل', count: countFor('') },
                { id: '0', label: 'مبيعات', count: countFor('0') },
                { id: '1', label: 'مرتجع', count: countFor('1'), tone: 'danger' },
                { id: '2', label: 'هدية', count: countFor('2') },
              ]}
            />
            <Segmented
              label="حالة الفاتورة"
              value={applied.hold === 'true' ? 'true' : ''}
              onChange={id => applyFilters({ hold: id })}
              items={[
                { id: '', label: 'مكتملة' },
                { id: 'true', label: 'معلّقة', count: holdsQ.data ? holds.length : undefined, tone: 'warn' },
              ]}
            />
            <Segmented
              label="الترحيل للإداري"
              value={applied.synced}
              onChange={id => applyFilters({ synced: id })}
              items={[
                { id: '', label: 'كل الترحيل' },
                { id: 'true', label: 'مرحّلة' },
                { id: 'false', label: 'غير مرحّلة' },
              ]}
            />
            {invoiceLookup && (
              <span className="text-[11.5px] font-semibold text-brand-700">البحث برقم فاتورة يتجاهل الفترة — اضغط Enter</span>
            )}
            <div className="ms-auto flex min-w-0 flex-wrap items-center gap-3">
              <PeriodBanner from={applied.from} to={applied.to} periodSettings={periodSettings} />
            </div>
          </div>
        </form>

        {/* ── شريط المجاميع ── */}
        <div className="grid shrink-0 grid-cols-3 divide-x divide-x-reverse divide-slate-100 border-b border-slate-200 bg-white lg:grid-cols-6">
          {stripCells.map(c => (
            <div key={c.label} className="min-w-0 px-3 py-1.5">
              <p className="truncate text-[10.5px] font-semibold text-slate-500">{c.label}</p>
              {q.isLoading ? (
                <div className="skeleton mt-1 h-4 w-20" />
              ) : (
                <p className={`truncate text-[15px] font-bold leading-6 num ${c.tone === 'brand' ? 'text-brand-800' : c.tone === 'warn' ? 'text-amber-700' : 'text-header'}`}>
                  {c.value}
                </p>
              )}
              {c.hint && !q.isLoading && <p className="hidden truncate text-[10.5px] text-slate-400 num [@media(min-height:840px)]:block">{c.hint}</p>}
            </div>
          ))}
        </div>

        {q.isError && (
          <div className="shrink-0 p-2">
            <Alert title="تعذّر تحميل الفواتير">
              <div className="flex flex-wrap items-center gap-2">
                {q.error instanceof Error ? q.error.message : 'خطأ غير معروف'}
                <Btn size="xs" variant="secondary" icon={<IconRefresh size={13} />} onClick={() => q.refetch()}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}

        {/* ── الجدول ── */}
        <div className="flex min-h-0 flex-1 flex-col">
          {q.isLoading ? (
            <div className="p-3"><TableSkeleton rows={10} cols={9} /></div>
          ) : q.isError && rows.length === 0 ? null : rows.length === 0 ? (
            <EmptyState
              icon={applied.hold === 'true' ? <IconCheckCircle size={24} /> : <IconReceipt size={24} />}
              title={applied.search
                ? `لا فاتورة تطابق «${applied.search}»`
                : applied.hold === 'true' ? 'لا فواتير معلّقة' : 'لا فواتير في هذه الفترة'}
              description={applied.search
                ? 'جرّب رقم الفاتورة فقط، أو وسّع الفترة.'
                : 'غيّر الفترة أو الفلاتر لعرض فواتير أخرى.'}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {applied.from && (
                    <Btn size="sm" variant="secondary" onClick={() => applyFilters({ from: daysAgoIso(30), to: todayIso() })}>
                      آخر 30 يوماً
                    </Btn>
                  )}
                  {!isDefault && <Btn size="sm" variant="ghost" onClick={clearFilters}>مسح الفلاتر</Btn>}
                </div>
              }
            />
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              filters
              columns={columns}
              rows={rows}
              getRowId={r => r.id}
              exportName={`الفواتير-${applied.from || 'الكل'}_${applied.to || 'الكل'}`}
              counterLabel="فاتورة"
              badge={truncated ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                  من أصل {formatNum(total)} — ضيّق الفترة لعرض الكل
                </span>
              ) : (
                <span className="hidden text-[11px] text-slate-400 md:inline">انقر الصف لعرض الأصناف · ↑↓ للتنقل · Enter للفتح</span>
              )}
              toolbar={
                <div className="flex items-center gap-2">
                  {applied.synced === 'false' && rows.length > 0 && (
                    <Btn
                      size="xs"
                      icon={<IconCloud size={13} />}
                      loading={syncingEdari}
                      onClick={() => void syncPendingReceipts()}
                    >
                      ترحيل غير المرحّلة للأداري
                    </Btn>
                  )}
                  <Checkbox label="أعمدة البطاقة" checked={showCardInfo} onChange={setShowCardInfo} />
                  <IconButton label="تحديث" onClick={() => { void q.refetch(); void holdsQ.refetch(); }}>
                    <IconRefresh size={15} className={q.isFetching ? 'animate-spin' : ''} />
                  </IconButton>
                </div>
              }
              emptyText="لا فواتير تطابق فلتر الأعمدة"
              rowTone={r => (r.number === 0 ? 'bg-amber-50/70' : r.kind === 1 ? 'bg-red-50/60' : undefined)}
              storageKey={`receipts${showCardInfo ? '-card' : ''}`}
              dense
              selectedId={openDetailId ?? undefined}
              onSelect={r => setOpenDetailId(r.id)}
              onEnter={r => setOpenDetailId(r.id)}
              expansion={{
                isExpanded: r => openDetailId === r.id,
                onToggle: r => setOpenDetailId(openDetailId === r.id ? null : r.id),
                render: r => (
                  <ReceiptDetailSheet
                    receipt={r}
                    detail={openDetailId === r.id ? detailQ.data : undefined}
                    loadingDetail={openDetailId === r.id && detailQ.isLoading}
                    onChanged={() => {
                      void queryClient.invalidateQueries({ queryKey: ['receipts'] });
                      void queryClient.invalidateQueries({ queryKey: ['receipt-detail', r.id] });
                    }}
                    onComplete={
                      r.number === 0
                        ? () => setHoldTarget({
                            id: r.id,
                            totalAmount: r.totalAmount,
                            cashierName: r.cashierName,
                            salesmanName: r.salesmanName,
                            itemCount: r.itemCount,
                          })
                        : undefined
                    }
                  />
                ),
              }}
            />
          )}
        </div>
        {(q.isLoading || rows.length > 0) && (
          <ReceiptsSummaryFooter
            summary={summary}
            total={rows.length}
            loading={q.isLoading}
            truncated={truncated}
          />
        )}
      </section>

      <CompleteHoldDialog hold={holdTarget} onClose={() => setHoldTarget(null)} />
    </div>
  );
}
