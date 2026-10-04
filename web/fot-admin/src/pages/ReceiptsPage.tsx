import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  formatCurrency,
  formatNum,
  todayIso,
} from '@/api/client';
import { CompleteHoldDialog, type HoldTarget } from '@/components/CompleteHoldDialog';
import { DatePresets, PeriodBanner } from '@/components/DatePresets';
import { DataGrid } from '@/components/grid/DataGrid';
import { buildReceiptColumns } from '@/components/receipts/receiptColumns';
import { ReceiptDetailSheet } from '@/components/receipts/ReceiptDetailSheet';
import { ReceiptsSummaryFooter } from '@/components/receipts/ReceiptsSummaryFooter';
import {
  ClassicFilterActions,
  ClassicListShell,
  ClassicResultBadge,
  FilterField,
  useClassicFilters,
} from '@/components/classic/ClassicListLayout';
import { Btn, Checkbox, Input, Loading, Select } from '@/components/ui';
import { FilterChip } from '@/components/workspace';
import { IconReceipt, IconSearch } from '@/components/icons';
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

export function ReceiptsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const highlight = Number(params.get('highlight') || 0) || null;
  const saved = loadReceiptFilters();
  const today = todayIso();
  const { settings: periodSettings } = useBusinessPeriod();

  const [showCardInfo, setShowCardInfo] = useState(saved?.showCardInfo ?? false);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [openDetailId, setOpenDetailId] = useState<number | null>(highlight);

  const initial = useMemo<AppliedFilters>(() => ({
    search: params.get('search') || saved?.search || '',
    from: params.get('from') ?? saved?.from ?? today,
    to: params.get('to') ?? saved?.to ?? today,
    sectionId: params.get('sectionId') || saved?.sectionId || '',
    posId: params.get('posId') || saved?.posId || '',
    cashierId: params.get('cashierId') || saved?.cashierId || '',
    kind: params.get('kind') || saved?.kind || '',
    synced: saved?.synced ?? '',
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
    sessionStorage.setItem(RECEIPT_FILTERS_KEY, JSON.stringify({ ...applied, showCardInfo }));
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

  const applyFilters = useCallback((next?: Partial<AppliedFilters>) => {
    apply(next);
  }, [apply]);

  function clearFilters() {
    clear(defaultFilters());
  }

  const columns = useMemo(() => buildReceiptColumns(showCardInfo), [showCardInfo]);
  const summary = q.data?.summary;
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const truncated = total > rows.length;

  const detailQ = useQuery({
    queryKey: ['receipt-detail', openDetailId],
    queryFn: () => api.receiptDetail(openDetailId!),
    enabled: openDetailId != null,
  });

  const invoiceLookup = isInvoiceSearch(applied.search);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {q.isError && (
        <div className="mb-2 flex shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          تعذّر تحميل الفواتير
          <Btn size="sm" variant="secondary" onClick={() => q.refetch()}>إعادة</Btn>
        </div>
      )}

      <ClassicListShell
        banner={
          (holdsQ.data?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-gradient-to-l from-amber-50 to-white px-3 py-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 font-extrabold text-amber-900">
                <IconReceipt size={14} />
                معلّقة: {formatNum(holdsQ.data!.length)}
              </span>
              {holdsQ.data!.slice(0, 5).map(h => (
                <span key={h.id} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 ring-1 ring-amber-100">
                  <Link to={`/receipts?highlight=${h.id}`} className="font-bold text-amber-900 hover:underline">#{h.id}</Link>
                  <span className="num text-slate-600">{formatCurrency(h.totalAmount)}</span>
                  <button type="button" className="font-bold text-brand-700 hover:underline" onClick={() => setHoldTarget(h)}>إكمال</button>
                </span>
              ))}
              <Btn size="sm" variant="secondary" onClick={() => applyFilters({ hold: 'true' })}>عرض الكل</Btn>
            </div>
          ) : undefined
        }
        filters={
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[11px] font-semibold text-slate-500">فترة سريعة</p>
                <DatePresets
                  periodSettings={periodSettings}
                  onPick={(from, to) => {
                    patchDraft({ from, to });
                    apply({ from, to });
                  }}
                />
              </div>
              <PeriodBanner from={applied.from} to={applied.to} periodSettings={periodSettings} />
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(6,minmax(0,1fr))] lg:items-end">
              <FilterField label="بحث برقم الفاتورة أو البائع">
                <div className="relative">
                  <IconSearch size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={draft.search}
                    onChange={e => patchDraft({ search: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') applyFilters();
                    }}
                    placeholder="رقم الفاتورة — Enter للبحث"
                    className="!py-2.5 !ps-9 !text-[14px] font-bold"
                  />
                </div>
                {invoiceLookup && (
                  <p className="mt-1 text-[10.5px] font-semibold text-brand-700">
                    البحث برقم — يتجاهل تاريخ الفترة ويجلب الفاتورة من أي يوم
                  </p>
                )}
              </FilterField>
              <FilterField label="من">
                <Input type="date" value={draft.from} onChange={e => patchDraft({ from: e.target.value })} />
              </FilterField>
              <FilterField label="إلى">
                <Input type="date" value={draft.to} onChange={e => patchDraft({ to: e.target.value })} />
              </FilterField>
              <FilterField label="القسم">
                <Select value={draft.sectionId} onChange={e => patchDraft({ sectionId: e.target.value })} className="w-full">
                  <option value="">الكل</option>
                  {(sectionsQ.data ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="نقطة البيع">
                <Select value={draft.posId} onChange={e => patchDraft({ posId: e.target.value })} className="w-full">
                  <option value="">الكل</option>
                  {(terminalsQ.data ?? []).map(t => (
                    <option key={t.id} value={t.id}>{t.name ?? t.id}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="الكاشير">
                <Select value={draft.cashierId} onChange={e => patchDraft({ cashierId: e.target.value })} className="w-full">
                  <option value="">الكل</option>
                  {(cashiersQ.data?.items ?? []).map(c => (
                    <option key={c.id} value={c.id}>{c.username}</option>
                  ))}
                </Select>
              </FilterField>
              <ClassicFilterActions
                onApply={() => applyFilters()}
                onClear={clearFilters}
                extra={<ClassicResultBadge>{q.data ? formatNum(total) : '—'}</ClassicResultBadge>}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2">
              <FilterChip compact active={draft.kind === ''} onClick={() => { patchDraft({ kind: '' }); applyFilters({ kind: '' }); }}>الكل</FilterChip>
              <FilterChip compact active={draft.kind === '0'} onClick={() => { patchDraft({ kind: '0' }); applyFilters({ kind: '0' }); }}>مبيعات</FilterChip>
              <FilterChip compact active={draft.kind === '1'} onClick={() => { patchDraft({ kind: '1' }); applyFilters({ kind: '1' }); }}>مرتجع</FilterChip>
              <FilterChip compact active={draft.kind === '2'} onClick={() => { patchDraft({ kind: '2' }); applyFilters({ kind: '2' }); }}>هدية</FilterChip>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <FilterChip compact active={draft.hold === ''} onClick={() => { patchDraft({ hold: '' }); applyFilters({ hold: '' }); }}>مكتملة</FilterChip>
              <FilterChip compact active={draft.hold === 'true'} onClick={() => { patchDraft({ hold: 'true' }); applyFilters({ hold: 'true' }); }}>معلّقة</FilterChip>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <FilterChip compact active={draft.synced === ''} onClick={() => patchDraft({ synced: '' })}>كل المزامنة</FilterChip>
              <FilterChip compact active={draft.synced === 'true'} onClick={() => patchDraft({ synced: 'true' })}>متزامنة</FilterChip>
              <FilterChip compact active={draft.synced === 'false'} onClick={() => patchDraft({ synced: 'false' })}>غير متزامنة</FilterChip>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <Checkbox label="أعمدة الكارت" checked={showCardInfo} onChange={setShowCardInfo} />
            </div>
          </div>
        }
        header={{
          title: 'الفواتير',
          hint: truncated
            ? `يُعرض ${formatNum(rows.length)} من ${formatNum(total)} — ضيّق الفترة لعرض الكل`
            : 'كل الفواتير ضمن الفلتر في صفحة واحدة — انقر الصف لعرض الأصناف',
        }}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
        footer={
          <ReceiptsSummaryFooter
            summary={summary}
            total={rows.length}
            loading={q.isLoading}
            truncated={truncated}
          />
        }
      >
        {!q.isLoading && summary && (
          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-100 bg-gradient-to-l from-slate-50 to-white px-3 py-2 sm:grid-cols-4">
            {[
              { label: 'عدد الفواتير', value: formatNum(summary.receiptCount), accent: true },
              { label: 'الإجمالي', value: formatCurrency(summary.grossTotal) },
              { label: 'الصافي', value: formatCurrency(summary.netTotal), accent: true },
              { label: 'المدفوع', value: formatCurrency(summary.totalPayment) },
            ].map(cell => (
              <div
                key={cell.label}
                className={`rounded-xl border px-3 py-2 ${cell.accent ? 'border-brand-200 bg-brand-50/70' : 'border-slate-200 bg-white'}`}
              >
                <p className="text-[10px] font-semibold text-slate-500">{cell.label}</p>
                <p className={`mt-0.5 text-[15px] font-extrabold tabular-nums ${cell.accent ? 'text-brand-800' : 'text-header'}`}>
                  {cell.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {q.isLoading ? (
          <Loading />
        ) : (
          <DataGrid
            variant="sheet"
            embedded
            fillHeight
            filters
            columns={columns}
            rows={rows}
            getRowId={r => r.id}
            exportName={`الفواتير-${applied.from}_${applied.to}`}
            counterLabel="فاتورة"
            emptyText={applied.search
              ? `لا فاتورة لـ «${applied.search}» — جرّب رقم الفاتورة فقط أو وسّع الفترة`
              : 'لا فواتير — غيّر الفلاتر ثم اضغط «استعراض»'}
            rowTone={r => (r.kind === 1 ? 'bg-[#fde9e9]' : r.number === 0 ? 'bg-[#fff8e6]' : undefined)}
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
      </ClassicListShell>

      <CompleteHoldDialog hold={holdTarget} onClose={() => setHoldTarget(null)} />
    </div>
  );
}
