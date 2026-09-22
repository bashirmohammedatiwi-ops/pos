import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  formatCurrency,
  formatNum,
  todayIso,
} from '@/api/client';
import { CompleteHoldDialog, type HoldTarget } from '@/components/CompleteHoldDialog';
import { DataGrid } from '@/components/grid/DataGrid';
import { buildReceiptColumns } from '@/components/receipts/receiptColumns';
import { ReceiptDetailSheet } from '@/components/receipts/ReceiptDetailSheet';
import { ReceiptsSummaryFooter } from '@/components/receipts/ReceiptsSummaryFooter';
import { Btn, Checkbox, Input, Loading, Pagination, Select } from '@/components/ui';
import { IconRefresh } from '@/components/icons';

const RECEIPT_FILTERS_KEY = 'fot_admin_receipts_v2';
const PAGE_SIZE = 100;

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

function loadReceiptFilters(): Partial<AppliedFilters & { showCardInfo?: boolean; useDefaultDate?: boolean }> | null {
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

const COMPACT_CTRL = '!py-1 !px-2 !text-[12px]';

function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className ?? ''}`.trim()}>
      <span className="mb-0.5 block text-[10px] font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function ReceiptsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const highlight = Number(params.get('highlight') || 0) || null;
  const saved = loadReceiptFilters();
  const today = todayIso();

  const [page, setPage] = useState(1);
  const [showCardInfo, setShowCardInfo] = useState(saved?.showCardInfo ?? false);
  const [useDefaultDate, setUseDefaultDate] = useState(saved?.useDefaultDate ?? false);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [openDetailId, setOpenDetailId] = useState<number | null>(highlight);

  const [draft, setDraft] = useState<AppliedFilters>(() => ({
    search: params.get('search') || saved?.search || '',
    from: params.get('from') ?? saved?.from ?? today,
    to: params.get('to') ?? saved?.to ?? today,
    sectionId: params.get('sectionId') || saved?.sectionId || '',
    posId: params.get('posId') || saved?.posId || '',
    cashierId: params.get('cashierId') || saved?.cashierId || '',
    kind: params.get('kind') || saved?.kind || '',
    synced: saved?.synced ?? '',
    hold: params.get('hold') === '1' ? 'true' : (saved?.hold ?? ''),
  }));

  const [applied, setApplied] = useState<AppliedFilters>(() => ({ ...draft }));

  const sectionsQ = useQuery({ queryKey: ['sections'], queryFn: () => api.sections(false) });
  const cashiersQ = useQuery({ queryKey: ['cashiers'], queryFn: () => api.cashiers() });
  const terminalsQ = useQuery({ queryKey: ['terminals'], queryFn: api.terminals });
  const holdsQ = useQuery({ queryKey: ['hold-receipts'], queryFn: () => api.holdReceipts() });

  const applyFilters = useCallback((next?: Partial<AppliedFilters>) => {
    const merged = { ...draft, ...next };
    const dates = useDefaultDate ? { from: today, to: today } : { from: merged.from, to: merged.to };
    const finalApplied = { ...merged, ...dates };
    setDraft(finalApplied);
    setApplied(finalApplied);
    setPage(1);
  }, [draft, today, useDefaultDate]);

  const q = useQuery({
    queryKey: ['receipts', page, applied],
    queryFn: () =>
      api.searchReceipts({
        page,
        pageSize: PAGE_SIZE,
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
    sessionStorage.setItem(RECEIPT_FILTERS_KEY, JSON.stringify({ ...applied, showCardInfo, useDefaultDate }));
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
  }, [applied, showCardInfo, useDefaultDate, highlight, params, setParams]);

  useEffect(() => {
    if (highlight) setOpenDetailId(highlight);
  }, [highlight]);

  function clearFilters() {
    const next = defaultFilters();
    setDraft(next);
    setApplied(next);
    setUseDefaultDate(false);
    setPage(1);
  }

  const columns = useMemo(() => buildReceiptColumns(showCardInfo), [showCardInfo]);
  const summary = q.data?.summary;
  const totalPages = q.data ? Math.ceil(q.data.total / q.data.pageSize) : 1;

  const detailQ = useQuery({
    queryKey: ['receipt-detail', openDetailId],
    queryFn: () => api.receiptDetail(openDetailId!),
    enabled: openDetailId != null,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {q.isError && (
        <div className="mb-1 flex shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          تعذّر تحميل الفواتير
          <Btn size="sm" variant="secondary" onClick={() => q.refetch()}>إعادة</Btn>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        {(holdsQ.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50/90 px-3 py-1.5 text-[11px]">
            <span className="font-bold text-amber-900">معلّقة: {formatNum(holdsQ.data!.length)}</span>
            {holdsQ.data!.slice(0, 4).map(h => (
              <span key={h.id} className="inline-flex items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 ring-1 ring-amber-100">
                <Link to={`/receipts?highlight=${h.id}`} className="font-semibold text-amber-900 hover:underline">#{h.id}</Link>
                <span className="num text-slate-600">{formatCurrency(h.totalAmount)}</span>
                <button type="button" className="font-bold text-brand-700 hover:underline" onClick={() => setHoldTarget(h)}>إكمال</button>
              </span>
            ))}
            <Btn size="sm" variant="secondary" onClick={() => applyFilters({ hold: 'true' })}>عرض الكل</Btn>
          </div>
        )}

        {/* ── شريط الفلاتر — مضغوط ── */}
        <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-2 py-1.5">
          <div className="grid gap-1.5 xl:grid-cols-[118px_118px_repeat(5,minmax(0,1fr))_minmax(140px,1.2fr)_auto] xl:items-end">
            <FilterField label="من">
              <Input
                type="date"
                value={draft.from}
                className={COMPACT_CTRL}
                onChange={e => {
                  setUseDefaultDate(false);
                  setDraft(d => ({ ...d, from: e.target.value }));
                }}
              />
            </FilterField>
            <FilterField label="إلى">
              <Input
                type="date"
                value={draft.to}
                className={COMPACT_CTRL}
                onChange={e => {
                  setUseDefaultDate(false);
                  setDraft(d => ({ ...d, to: e.target.value }));
                }}
              />
            </FilterField>
            <FilterField label="القسم">
              <Select value={draft.sectionId} onChange={e => setDraft(d => ({ ...d, sectionId: e.target.value }))} className={`w-full ${COMPACT_CTRL}`}>
                <option value="">الكل</option>
                {(sectionsQ.data ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="POS">
              <Select value={draft.posId} onChange={e => setDraft(d => ({ ...d, posId: e.target.value }))} className={`w-full ${COMPACT_CTRL}`}>
                <option value="">الكل</option>
                {(terminalsQ.data ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.name ?? t.id}</option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="الكاشير">
              <Select value={draft.cashierId} onChange={e => setDraft(d => ({ ...d, cashierId: e.target.value }))} className={`w-full ${COMPACT_CTRL}`}>
                <option value="">الكل</option>
                {(cashiersQ.data?.items ?? []).map(c => (
                  <option key={c.id} value={c.id}>{c.username}</option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="النوع">
              <Select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} className={`w-full ${COMPACT_CTRL}`}>
                <option value="">الكل</option>
                <option value="0">مبيعات</option>
                <option value="1">مرتجع</option>
                <option value="2">هدية</option>
              </Select>
            </FilterField>
            <FilterField label="المزامنة">
              <Select value={draft.synced} onChange={e => setDraft(d => ({ ...d, synced: e.target.value }))} className={`w-full ${COMPACT_CTRL}`}>
                <option value="">الكل</option>
                <option value="true">متزامنة</option>
                <option value="false">غير متزامنة</option>
              </Select>
            </FilterField>
            <FilterField label="بحث">
              <Input
                value={draft.search}
                onChange={e => setDraft(d => ({ ...d, search: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') applyFilters();
                }}
                placeholder="رقم / مندوب…"
                className={COMPACT_CTRL}
              />
            </FilterField>
            <div className="flex flex-wrap items-end gap-1">
              <Btn size="sm" onClick={() => applyFilters()}>استعراض</Btn>
              <Btn size="sm" variant="secondary" onClick={clearFilters}>مسح</Btn>
              <Btn variant="secondary" size="sm" onClick={() => q.refetch()} title="تحديث">
                <IconRefresh size={14} />
              </Btn>
              <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-header">
                {q.data ? formatNum(q.data.total) : '—'}
              </span>
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            <Checkbox
              label="تاريخ اليوم"
              checked={useDefaultDate}
              onChange={v => {
                setUseDefaultDate(v);
                if (v) setDraft(d => ({ ...d, from: today, to: today }));
              }}
            />
            <Checkbox label="أعمدة الكارت" checked={showCardInfo} onChange={setShowCardInfo} />
            <Select
              value={draft.hold}
              onChange={e => setDraft(d => ({ ...d, hold: e.target.value }))}
              className={`!w-[100px] ${COMPACT_CTRL}`}
              title="حالة الإيصال"
            >
              <option value="">مكتملة</option>
              <option value="true">معلّقة</option>
            </Select>
            <span className="text-slate-400">انقر الصف لعرض الأصناف</span>
          </div>
        </div>

        {/* ── الجدول ── */}
        <div className="min-h-0 flex-1">
          {q.isLoading ? (
            <Loading />
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              filters
              columns={columns}
              rows={q.data?.items ?? []}
              getRowId={r => r.id}
              exportName={`الفواتير-${applied.from}_${applied.to}`}
              counterLabel="فاتورة"
              emptyText="لا فواتير — غيّر الفلاتر ثم اضغط «استعراض»"
              rowTone={r => (r.kind === 1 ? 'bg-[#fde9e9]' : r.number === 0 ? 'bg-[#fff2cc]' : undefined)}
              storageKey={`receipts${showCardInfo ? '-card' : ''}`}
              dense
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

        {/* ── ترقيم + ملخص ── */}
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-2 py-1">
          {q.data && (
            <Pagination compact page={q.data.page} totalPages={totalPages} total={q.data.total} onPage={setPage} />
          )}
        </div>

        <ReceiptsSummaryFooter summary={summary} total={q.data?.total} loading={q.isLoading} />
      </div>

      <CompleteHoldDialog hold={holdTarget} onClose={() => setHoldTarget(null)} />
    </div>
  );
}
