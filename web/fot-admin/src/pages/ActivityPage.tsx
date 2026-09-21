import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, daysAgoIso, formatDate, formatNum, todayIso } from '@/api/client';
import type { CashierActivityDto } from '@/api/types';
import { QueryState } from '@/components/QueryState';
import { DatePresets } from '@/components/DatePresets';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, Input, Select } from '@/components/ui';
import {
  ClassicFilterActions,
  ClassicListShell,
  ClassicSummaryFooter,
  ClassicTabBar,
  FilterField,
  useClassicFilters,
} from '@/components/classic/ClassicListLayout';
import { DashCard, FilterChip } from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';
import { printHtmlDoc } from '@/lib/print';

const ACTIVITY_KEY = 'fot_admin_activity';
const SUB_KEY = 'fot_admin_activity_sub';

type SubTab = 0 | 1 | 2 | 3;

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(ACTIVITY_KEY) || 'null') as {
      from?: string;
      to?: string;
      search?: string;
      cashierId?: string;
      eventType?: string;
    } | null;
  } catch {
    return null;
  }
}

function loadSubTab(): SubTab {
  try {
    const n = Number(sessionStorage.getItem(SUB_KEY));
    if (n >= 0 && n <= 3) return n as SubTab;
  } catch { /* ignore */ }
  return 0;
}

function eventTone(type: string, label?: string) {
  const t = `${type} ${label ?? ''}`.toLowerCase();
  if (t.includes('login') || t.includes('دخول')) return 'bg-emerald-100 text-emerald-800';
  if (t.includes('logout') || t.includes('خروج')) return 'bg-slate-100 text-slate-600';
  if (t.includes('hold') || t.includes('تعليق') || t.includes('معلّق')) return 'bg-amber-100 text-amber-800';
  if (t.includes('return') || t.includes('مرتجع') || t.includes('delete') || t.includes('حذف')) return 'bg-red-100 text-red-700';
  if (t.includes('sale') || t.includes('بيع') || t.includes('receipt') || t.includes('فاتورة')) return 'bg-sky-100 text-sky-800';
  return 'bg-slate-100 text-slate-600';
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return formatDate(iso);
}

type CashierAgg = { name: string; count: number; withReceipt: number; lastAt: string };
type EventAgg = { type: string; label: string; count: number };

/* أعمدة سجل النشاط — DataGrid موحد */
const logColumns: GridColumn<CashierActivityDto>[] = [
  { key: 'cashierName', header: 'الكاشير', width: 140, render: a => <span className="font-semibold text-header">{a.cashierName ?? '—'}</span> },
  {
    key: 'eventType',
    header: 'الحدث',
    width: 260,
    render: a => (
      <div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${eventTone(a.eventType, a.eventLabel)}`}>
          {a.eventLabel ?? a.eventType}
        </span>
        {a.message && (
          <div className="mt-0.5 max-w-[280px] truncate text-[11px] text-slate-400" title={a.message}>
            {a.message}
          </div>
        )}
      </div>
    ),
  },
  { key: 'posPath', header: 'نقطة البيع', width: 160, render: a => <span className="text-xs text-muted">{a.posPath ?? '—'}</span> },
  { key: 'createdAt', header: 'الوقت', width: 170, sortValue: a => a.createdAt, render: a => <span className="text-xs">{formatDate(a.createdAt)}</span> },
  {
    key: 'receiptId',
    header: 'الفاتورة',
    width: 100,
    align: 'center',
    render: a =>
      a.receiptId ? (
        <Link to={`/receipts?highlight=${a.receiptId}`} className="font-semibold text-brand-600 hover:underline">
          {a.receiptNum ?? a.receiptId}
        </Link>
      ) : (
        a.receiptNum ?? '—'
      ),
  },
];

function byCashierColumns(max: number): GridColumn<CashierAgg>[] {
  return [
    { key: 'name', header: 'الكاشير', width: 170, render: c => <span className="font-semibold text-header">{c.name}</span> },
    {
      key: 'count',
      header: 'أحداث',
      width: 200,
      mono: true,
      footer: 'sum',
      render: c => (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(6, (c.count / max) * 100)}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'withReceipt', header: 'بفاتورة', width: 100, mono: true, footer: 'sum' },
    { key: 'lastAt', header: 'آخر نشاط', width: 150, sortValue: c => c.lastAt, render: c => <span className="text-[12px] text-muted">{timeAgo(c.lastAt)}</span> },
  ];
}

function byEventColumns(max: number, total: number): GridColumn<EventAgg>[] {
  return [
    {
      key: 'label',
      header: 'الحدث',
      width: 220,
      render: e => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${eventTone(e.type, e.label)}`}>{e.label}</span>,
    },
    {
      key: 'count',
      header: 'العدد',
      width: 200,
      mono: true,
      footer: 'sum',
      render: e => (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(6, (e.count / max) * 100)}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'pct', header: 'النسبة', width: 100, mono: true, sortable: false, exportable: false, render: e => <span className="text-muted">{total ? `${((e.count / total) * 100).toFixed(1)}%` : '—'}</span> },
  ];
}


function prevRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(prevStart), to: iso(prevEnd) };
}

function vsPrev(now: number, prev: number) {
  if (!prev && !now) return 'كما الفترة السابقة';
  if (!prev) return 'بداية الفترة';
  const pct = ((now - prev) / prev) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% مقابل السابقة`;
}

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const saved = loadSaved();
  const tabRaw = params.get('tab');
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (tabRaw === 'cashiers') return 1;
    if (tabRaw === 'events') return 2;
    if (tabRaw === 'overview') return 3;
    return loadSubTab();
  });
  const filterDefaults = {
    from: params.get('from') || saved?.from || daysAgoIso(1),
    to: params.get('to') || saved?.to || todayIso(),
    search: saved?.search ?? '',
    cashierId: params.get('cashierId') || saved?.cashierId || '',
  };
  const { draft, patchDraft, applied, apply, clear } = useClassicFilters(filterDefaults);
  const [eventType, setEventType] = useState(saved?.eventType ?? '');

  const prev = useMemo(() => prevRange(applied.from, applied.to), [applied.from, applied.to]);

  useEffect(() => {
    sessionStorage.setItem(ACTIVITY_KEY, JSON.stringify({ ...applied, eventType }));
  }, [applied, eventType]);

  useEffect(() => {
    sessionStorage.setItem(SUB_KEY, String(subTab));
    const next = new URLSearchParams(params);
    const tabName = subTab === 1 ? 'cashiers' : subTab === 2 ? 'events' : subTab === 3 ? 'overview' : null;
    if (tabName) next.set('tab', tabName);
    else next.delete('tab');
    next.set('from', applied.from);
    next.set('to', applied.to);
    if (applied.cashierId) next.set('cashierId', applied.cashierId);
    else next.delete('cashierId');
    setParams(next, { replace: true });
  }, [subTab, applied.from, applied.to, applied.cashierId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cashiersQ = useQuery({ queryKey: ['cashiers'], queryFn: () => api.cashiers() });
  const q = useQuery({
    queryKey: ['activity', applied.from, applied.to, applied.search, applied.cashierId],
    queryFn: () =>
      api.cashierActivity(
        applied.from,
        applied.to,
        applied.search.trim() || undefined,
        applied.cashierId ? Number(applied.cashierId) : undefined,
      ),
    placeholderData: prev => prev,
  });
  const prevQ = useQuery({
    queryKey: ['activity-prev', prev.from, prev.to, applied.search, applied.cashierId],
    queryFn: () =>
      api.cashierActivity(
        prev.from,
        prev.to,
        applied.search.trim() || undefined,
        applied.cashierId ? Number(applied.cashierId) : undefined,
      ),
    placeholderData: p => p,
  });

  const cashiers = useMemo(() => cashiersQ.data?.items ?? [], [cashiersQ.data]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of q.data ?? []) {
      if (!map.has(a.eventType)) map.set(a.eventType, a.eventLabel ?? a.eventType);
    }
    return [...map.entries()];
  }, [q.data]);

  const rows = useMemo(() => {
    const list = q.data ?? [];
    if (!eventType) return list;
    return list.filter(a => a.eventType === eventType);
  }, [eventType, q.data]);

  const withReceipt = rows.filter(a => a.receiptId).length;
  const uniqueCashiers = new Set(rows.map(a => a.cashierName).filter(Boolean)).size;
  const prevCount = prevQ.data?.length ?? 0;

  const byCashier = useMemo(() => {
    const map = new Map<string, CashierAgg>();
    for (const a of rows) {
      const name = a.cashierName ?? '—';
      const ex = map.get(name);
      if (ex) {
        ex.count += 1;
        if (a.receiptId) ex.withReceipt += 1;
        if (a.createdAt > ex.lastAt) ex.lastAt = a.createdAt;
      } else {
        map.set(name, { name, count: 1, withReceipt: a.receiptId ? 1 : 0, lastAt: a.createdAt });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [rows]);

  const byEvent = useMemo(() => {
    const map = new Map<string, EventAgg>();
    for (const a of rows) {
      const ex = map.get(a.eventType);
      if (ex) ex.count += 1;
      else map.set(a.eventType, { type: a.eventType, label: a.eventLabel ?? a.eventType, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [rows]);

  const maxCashier = Math.max(...byCashier.map(c => c.count), 1);
  const maxEvent = Math.max(...byEvent.map(e => e.count), 1);

  function exportCsv() {
    if (subTab === 1) {
      downloadCsv(`activity-by-cashier_${applied.from}_${applied.to}.csv`, ['الكاشير', 'أحداث', 'مرتبطة بفاتورة', 'آخر نشاط'],
        byCashier.map(c => [c.name, c.count, c.withReceipt, formatDate(c.lastAt)]));
    } else if (subTab === 2) {
      downloadCsv(`activity-by-event_${applied.from}_${applied.to}.csv`, ['الحدث', 'العدد'],
        byEvent.map(e => [e.label, e.count]));
    } else {
      downloadCsv(`cashier-activity_${applied.from}_${applied.to}.csv`, ['الكاشير', 'الحدث', 'نقطة البيع', 'الوقت', 'فاتورة', 'تفاصيل'],
        rows.map(a => [
          a.cashierName ?? '',
          a.eventLabel ?? a.eventType,
          a.posPath ?? '',
          formatDate(a.createdAt),
          a.receiptNum ?? a.receiptId ?? '',
          a.message ?? '',
        ]));
    }
  }

  function printReport() {
    const titles = ['سجل النشاط', 'حسب الكاشير', 'ملخص الأحداث', 'نظرة عامة'];
    const content = document.querySelector('.activity-print')?.innerHTML ?? '';
    void printHtmlDoc(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${titles[subTab]}</title>
      <style>body{font-family:Tahoma,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px;text-align:right}</style>
      </head><body><h2>${titles[subTab]} ${applied.from} — ${applied.to}</h2>${content}</body></html>`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        filters={
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px_140px_160px_auto] lg:items-end">
            <FilterField label="بحث">
              <Input
                value={draft.search}
                onChange={e => patchDraft({ search: e.target.value })}
                placeholder="حدث أو ملاحظة…"
                disabled={subTab !== 0 && subTab !== 3}
              />
            </FilterField>
            <FilterField label="من">
              <Input type="date" value={draft.from} onChange={e => patchDraft({ from: e.target.value })} />
            </FilterField>
            <FilterField label="إلى">
              <Input type="date" value={draft.to} onChange={e => patchDraft({ to: e.target.value })} />
            </FilterField>
            <FilterField label="الكاشير">
              <Select value={draft.cashierId} onChange={e => patchDraft({ cashierId: e.target.value })}>
                <option value="">الكل</option>
                {cashiers.map(c => (
                  <option key={c.id} value={c.id}>{c.accountName ?? c.username}</option>
                ))}
              </Select>
            </FilterField>
            <ClassicFilterActions
              onApply={() => apply()}
              onClear={() => clear(filterDefaults)}
              extra={<DatePresets onPick={(f, t) => patchDraft({ from: f, to: t })} />}
            />
          </div>
        }
        tabs={
          <ClassicTabBar
            items={[
              { id: 0, label: 'السجل', count: rows.length },
              { id: 1, label: 'حسب الكاشير', count: byCashier.length },
              { id: 2, label: 'ملخص الأحداث', count: byEvent.length },
              { id: 3, label: 'نظرة عامة' },
            ]}
            value={subTab}
            onChange={id => setSubTab(Number(id) as SubTab)}
          />
        }
        header={{
          title: ['سجل النشاط', 'حسب الكاشير', 'ملخص الأحداث', 'نظرة عامة'][subTab],
          hint: `${applied.from} — ${applied.to}`,
          actions: (
            <>
              {eventOptions.length > 0 && subTab === 0 && (
                <>
                  <FilterChip compact active={!eventType} onClick={() => setEventType('')}>كل الأحداث</FilterChip>
                  {eventOptions.map(([id, label]) => (
                    <FilterChip key={id} compact active={eventType === id} onClick={() => setEventType(id)}>{label}</FilterChip>
                  ))}
                </>
              )}
              <Btn size="sm" variant="secondary" disabled={!rows.length && subTab === 0} onClick={exportCsv}>CSV</Btn>
              <Btn size="sm" variant="secondary" onClick={printReport}>طباعة</Btn>
              <Link to="/cashiers" className="text-[11px] font-semibold text-brand-700 hover:underline">الكاشير</Link>
              <Link to="/receipts" className="text-[11px] font-semibold text-brand-700 hover:underline">الفواتير</Link>
            </>
          ),
        }}
        onRefresh={() => void q.refetch()}
        refreshing={q.isFetching}
        footer={
          <ClassicSummaryFooter
            total={rows.length}
            items={[
              { label: 'أحداث', value: formatNum(q.data?.length ?? 0), accent: true },
              { label: 'معروض', value: formatNum(rows.length) },
              { label: 'بفاتورة', value: formatNum(withReceipt) },
              { label: 'كاشير', value: formatNum(uniqueCashiers) },
              { label: 'مقارنة', value: vsPrev(rows.length, prevCount) },
            ]}
          />
        }
      >
        {subTab === 3 && (
          <div className="grid gap-2 overflow-auto p-2 lg:grid-cols-2">
            <DashCard title="أكثر الكاشير نشاطاً" compact>
              <ul className="divide-y divide-slate-100">
                {byCashier.slice(0, 8).map(c => (
                  <li key={c.name} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-header">{c.name}</span>
                    <div className="hidden w-20 sm:block">
                      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(6, (c.count / maxCashier) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-[10.5px] font-bold tabular-nums">{formatNum(c.count)}</span>
                  </li>
                ))}
                {!byCashier.length && <li className="px-2 py-6 text-center text-[11px] text-slate-400">لا حركات</li>}
              </ul>
            </DashCard>
            <DashCard title="توزيع الأحداث" compact>
              <ul className="divide-y divide-slate-100">
                {byEvent.slice(0, 10).map(e => (
                  <li key={e.type} className="flex items-center gap-2 px-2 py-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-medium ${eventTone(e.type, e.label)}`}>{e.label}</span>
                    <div className="min-w-0 flex-1">
                      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(6, (e.count / maxEvent) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-[10.5px] font-bold tabular-nums">{formatNum(e.count)}</span>
                  </li>
                ))}
                {!byEvent.length && <li className="px-2 py-6 text-center text-[11px] text-slate-400">لا أحداث</li>}
              </ul>
            </DashCard>
          </div>
        )}

        {subTab === 1 && (
          <DataGrid
            embedded
            fillHeight
            columns={byCashierColumns(maxCashier)}
            rows={byCashier}
            getRowId={c => c.name}
            exportName="نشاط-حسب-الكاشير"
            counterLabel="كاشير"
            emptyText="لا نشاط مسجل"
          />
        )}

        {subTab === 2 && (
          <DataGrid
            embedded
            fillHeight
            columns={byEventColumns(maxEvent, rows.length)}
            rows={byEvent}
            getRowId={e => e.type}
            exportName="ملخص-الأحداث"
            counterLabel="حدث"
            emptyText="لا أحداث مسجلة"
          />
        )}

        {subTab === 0 && (
          <QueryState query={q} empty={null}>
            <DataGrid
              embedded
              fillHeight
              columns={logColumns}
              rows={rows}
              getRowId={a => a.id}
              exportName="سجل-النشاط"
              counterLabel="حدث"
              emptyText="لا نشاط في هذه الفترة"
            />
          </QueryState>
        )}
      </ClassicListShell>
    </div>
  );
}
