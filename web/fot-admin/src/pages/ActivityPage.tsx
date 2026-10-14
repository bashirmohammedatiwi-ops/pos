import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, daysAgoIso, formatDate, formatNum, todayIso } from '@/api/client';
import type { CashierActivityDto } from '@/api/types';
import { DatePresets } from '@/components/DatePresets';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
  type SummaryCell,
} from '@/components/listWorkspace';
import {
  Alert,
  Badge,
  Btn,
  DeltaBadge,
  EmptyState,
  IconButton,
  Input,
  Panel,
  Select,
  TableSkeleton,
  type Tone,
} from '@/components/ui';
import { useClassicFilters } from '@/components/classic/ClassicListLayout';
import {
  IconActivity,
  IconClock,
  IconDownload,
  IconGrid,
  IconHistory,
  IconPrinter,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconUsers,
  IconX,
} from '@/components/icons';
import { downloadCsv } from '@/utils/exportCsv';
import { printDocument } from '@/lib/print';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';

const ACTIVITY_KEY = 'fot_admin_activity';
const SUB_KEY = 'fot_admin_activity_sub';
// v2: الجدول هو العرض الافتراضي الآن (المفتاح القديم قد يحمل «timeline»)
const VIEW_KEY = 'fot_admin_activity_view_v2';
const PAGE = 300;

type SubTab = 0 | 1 | 2 | 3;
type LogView = 'timeline' | 'table';
type TabName = 'log' | 'cashiers' | 'events' | 'overview';

const TAB_NAMES: TabName[] = ['log', 'cashiers', 'events', 'overview'];

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

function loadView(): LogView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'table';
  } catch {
    return 'table';
  }
}

/** لون الحدث حسب نوعه — للمعنى فقط. */
function eventTone(type: string, label?: string): Tone {
  const t = `${type} ${label ?? ''}`.toLowerCase();
  if (t.includes('login') || t.includes('دخول')) return 'ok';
  if (t.includes('logout') || t.includes('خروج')) return 'default';
  if (t.includes('hold') || t.includes('تعليق') || t.includes('معلّق') || t.includes('معلق')) return 'warn';
  if (t.includes('return') || t.includes('مرتجع') || t.includes('delete') || t.includes('حذف') || t.includes('void') || t.includes('إلغاء')) return 'danger';
  if (t.includes('sale') || t.includes('بيع') || t.includes('receipt') || t.includes('فاتورة')) return 'info';
  return 'default';
}

const DOT: Record<Tone, string> = {
  default: 'bg-slate-300',
  brand: 'bg-brand-500',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
  violet: 'bg-violet-500',
};

function EventBadge({ type, label }: { type: string; label?: string }) {
  return <Badge tone={eventTone(type, label)} className="whitespace-nowrap">{label ?? type}</Badge>;
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return formatDate(iso);
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string) {
  if (key === todayIso()) return 'اليوم';
  if (key === daysAgoIso(1)) return 'أمس';
  return new Date(`${key}T00:00:00`).toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

type CashierAgg = {
  name: string;
  count: number;
  withReceipt: number;
  firstAt: string;
  lastAt: string;
  events: Map<string, { label: string; count: number }>;
};
type EventAgg = { type: string; label: string; count: number };

function ReceiptLink({ a }: { a: CashierActivityDto }) {
  if (a.receiptId) {
    return (
      <Link
        to={`/receipts?highlight=${a.receiptId}`}
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
        title="فتح الفاتورة"
      >
        <IconReceipt size={12} />
        <span className="num">{a.receiptNum ?? a.receiptId}</span>
      </Link>
    );
  }
  return a.receiptNum ? <span className="num text-slate-500">{a.receiptNum}</span> : <span className="text-slate-300">—</span>;
}

/* أعمدة سجل النشاط — عرض الجدول (الافتراضي) */
function buildLogColumns(onCashier: (name: string) => void): GridColumn<CashierActivityDto>[] {
  return [
    {
      key: 'createdAt',
      header: 'الوقت',
      width: 150,
      sortValue: a => a.createdAt,
      filterValue: a => formatDate(a.createdAt),
      render: a => <span className="num text-slate-600" title={timeAgo(a.createdAt)}>{formatDate(a.createdAt)}</span>,
    },
    {
      key: 'cashierName',
      header: 'الكاشير',
      width: 140,
      render: a => (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onCashier(a.cashierName ?? '—');
          }}
          className="block max-w-[200px] truncate font-semibold text-header hover:text-brand-700 hover:underline"
          title="عرض أحداث هذا الكاشير فقط"
        >
          {a.cashierName ?? '—'}
        </button>
      ),
    },
    {
      key: 'eventType',
      header: 'الحدث',
      width: 140,
      sortValue: a => a.eventLabel ?? a.eventType,
      filterValue: a => a.eventLabel ?? a.eventType,
      render: a => <EventBadge type={a.eventType} label={a.eventLabel} />,
    },
    {
      key: 'message',
      header: 'التفاصيل',
      width: 360,
      render: a =>
        a.message ? (
          <span className="block max-w-[520px] truncate text-slate-600" title={a.message}>{a.message}</span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: 'posPath',
      header: 'نقطة البيع',
      width: 150,
      render: a => <span className="block max-w-[200px] truncate text-slate-500" title={a.posPath ?? ''}>{a.posPath ?? '—'}</span>,
    },
    {
      key: 'receiptId',
      header: 'الفاتورة',
      width: 100,
      align: 'center',
      sortValue: a => a.receiptId ?? 0,
      filterValue: a => String(a.receiptNum ?? a.receiptId ?? ''),
      render: a => <ReceiptLink a={a} />,
    },
  ];
}

function buildCashierColumns(max: number, onOpen: (name: string) => void): GridColumn<CashierAgg>[] {
  return [
    {
      key: 'name',
      header: 'الكاشير',
      width: 170,
      render: c => <span className="block max-w-[220px] truncate font-semibold text-header">{c.name}</span>,
    },
    {
      key: 'count',
      header: 'الأحداث',
      width: 220,
      mono: true,
      footer: 'sum',
      render: c => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (c.count / max) * 100)}%` }} />
          </div>
          <span className="w-12 text-end font-bold">{formatNum(c.count)}</span>
        </div>
      ),
    },
    { key: 'withReceipt', header: 'مرتبطة بفاتورة', width: 110, mono: true, footer: 'sum' },
    {
      key: 'firstAt',
      header: 'أول نشاط',
      width: 150,
      sortValue: c => c.firstAt,
      filterValue: c => formatDate(c.firstAt),
      render: c => <span className="num text-slate-600">{formatDate(c.firstAt)}</span>,
    },
    {
      key: 'lastAt',
      header: 'آخر نشاط',
      width: 150,
      sortValue: c => c.lastAt,
      filterValue: c => formatDate(c.lastAt),
      render: c => <span className="num text-slate-600" title={formatDate(c.lastAt)}>{timeAgo(c.lastAt)}</span>,
    },
    {
      key: 'events',
      header: 'أبرز الأحداث',
      width: 340,
      sortable: false,
      exportable: false,
      filterValue: c => [...c.events.values()].map(e => e.label).join(' '),
      render: c => {
        const events = [...c.events.entries()].sort((a, b) => b[1].count - a[1].count);
        return (
          <div className="flex max-w-[440px] items-center gap-1 overflow-hidden">
            {events.slice(0, 4).map(([type, ev]) => (
              <Badge key={type} tone={eventTone(type, ev.label)} className="shrink-0 whitespace-nowrap">
                {ev.label} <span className="num opacity-80">{formatNum(ev.count)}</span>
              </Badge>
            ))}
            {events.length > 4 && <Badge className="shrink-0">+{formatNum(events.length - 4)}</Badge>}
          </div>
        );
      },
    },
    {
      key: 'open',
      header: '',
      width: 90,
      sortable: false,
      exportable: false,
      align: 'center',
      render: c => (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onOpen(c.name);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold text-brand-700 hover:bg-brand-50"
        >
          <IconHistory size={12} /> سجله
        </button>
      ),
    },
  ];
}

function byEventColumns(max: number, total: number): GridColumn<EventAgg>[] {
  return [
    {
      key: 'label',
      header: 'الحدث',
      width: 220,
      render: e => <EventBadge type={e.type} label={e.label} />,
    },
    {
      key: 'count',
      header: 'العدد',
      width: 300,
      mono: true,
      footer: 'sum',
      render: e => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(4, (e.count / max) * 100)}%` }} />
          </div>
          <span className="w-12 text-end font-bold">{formatNum(e.count)}</span>
        </div>
      ),
    },
    {
      key: 'pct',
      header: 'النسبة',
      width: 90,
      mono: true,
      sortable: false,
      exportable: false,
      render: e => <span className="text-slate-500">{total ? `${((e.count / total) * 100).toFixed(1)}%` : '—'}</span>,
    },
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

function defaultActivityFilters() {
  return { from: daysAgoIso(1), to: todayIso(), search: '', cashierId: '' };
}

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const saved = loadSaved();
  const { settings: periodSettings } = useBusinessPeriod();
  const tabRaw = params.get('tab');
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (tabRaw === 'cashiers') return 1;
    if (tabRaw === 'events') return 2;
    if (tabRaw === 'overview') return 3;
    if (tabRaw === 'log') return 0;
    return loadSubTab();
  });
  const [view, setView] = useState<LogView>(loadView);
  const filterDefaults = {
    from: params.get('from') || saved?.from || daysAgoIso(1),
    to: params.get('to') || saved?.to || todayIso(),
    search: saved?.search ?? '',
    cashierId: params.get('cashierId') || saved?.cashierId || '',
  };
  const { draft, patchDraft, applied, apply, clear } = useClassicFilters(filterDefaults);
  const [eventType, setEventType] = useState(saved?.eventType ?? '');
  const [nameFilter, setNameFilter] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const prev = useMemo(() => prevRange(applied.from, applied.to), [applied.from, applied.to]);

  useEffect(() => {
    try {
      sessionStorage.setItem(ACTIVITY_KEY, JSON.stringify({ ...applied, eventType }));
    } catch { /* ignore */ }
  }, [applied, eventType]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch { /* ignore */ }
  }, [view]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SUB_KEY, String(subTab));
    } catch { /* ignore */ }
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

  useEffect(() => {
    setLimit(PAGE);
  }, [applied, eventType, nameFilter]);

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
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  }, [q.data]);

  const rows = useMemo(() => {
    let list = q.data ?? [];
    if (eventType) list = list.filter(a => a.eventType === eventType);
    if (nameFilter) list = list.filter(a => (a.cashierName ?? '—') === nameFilter);
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [eventType, nameFilter, q.data]);

  const withReceipt = rows.filter(a => a.receiptId).length;
  const uniqueCashiers = new Set(rows.map(a => a.cashierName).filter(Boolean)).size;
  const nowCount = q.data?.length ?? 0;
  const prevCount = prevQ.data?.length ?? 0;
  const delta = prevQ.data && prevCount > 0 ? ((nowCount - prevCount) / prevCount) * 100 : null;

  const byCashier = useMemo(() => {
    const map = new Map<string, CashierAgg>();
    for (const a of rows) {
      const name = a.cashierName ?? '—';
      let ex = map.get(name);
      if (!ex) {
        ex = { name, count: 0, withReceipt: 0, firstAt: a.createdAt, lastAt: a.createdAt, events: new Map() };
        map.set(name, ex);
      }
      ex.count += 1;
      if (a.receiptId) ex.withReceipt += 1;
      if (a.createdAt > ex.lastAt) ex.lastAt = a.createdAt;
      if (a.createdAt < ex.firstAt) ex.firstAt = a.createdAt;
      const ev = ex.events.get(a.eventType);
      if (ev) ev.count += 1;
      else ex.events.set(a.eventType, { label: a.eventLabel ?? a.eventType, count: 1 });
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

  const byHour = useMemo(() => {
    const h = Array.from({ length: 24 }, () => 0);
    for (const a of rows) h[new Date(a.createdAt).getHours()] += 1;
    return h;
  }, [rows]);

  const days = useMemo(() => {
    const out: { key: string; items: CashierActivityDto[] }[] = [];
    for (const a of rows.slice(0, limit)) {
      const k = dayKey(a.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(a);
      else out.push({ key: k, items: [a] });
    }
    return out;
  }, [rows, limit]);

  const dayTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of rows) {
      const k = dayKey(a.createdAt);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const maxCashier = Math.max(...byCashier.map(c => c.count), 1);
  const maxEvent = Math.max(...byEvent.map(e => e.count), 1);
  const maxHour = Math.max(...byHour, 1);
  const lastAt = rows[0]?.createdAt;
  const peakHour = byHour.reduce((best, n, h) => (n > byHour[best] ? h : best), 0);

  const defaults = defaultActivityFilters();
  const isDefault = applied.from === defaults.from && applied.to === defaults.to && !applied.search && !applied.cashierId && !eventType && !nameFilter;
  const dirty = (['search', 'from', 'to'] as const).some(k => draft[k] !== applied[k]);

  const logColumns = useMemo(() => buildLogColumns(setNameFilter), []);
  const cashierColumns = useMemo(() => buildCashierColumns(maxCashier, openCashierLog), [maxCashier]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearAll() {
    clear(defaultActivityFilters());
    setEventType('');
    setNameFilter('');
  }

  function openCashierLog(name: string) {
    setNameFilter(name);
    setSubTab(0);
  }

  function exportCsv() {
    if (subTab === 1) {
      downloadCsv(`activity-by-cashier_${applied.from}_${applied.to}.csv`, ['الكاشير', 'أحداث', 'مرتبطة بفاتورة', 'أول نشاط', 'آخر نشاط'],
        byCashier.map(c => [c.name, c.count, c.withReceipt, formatDate(c.firstAt), formatDate(c.lastAt)]));
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

  /** طباعة من البيانات مباشرة (لا تعتمد على شكل الصفحة). */
  function printReport() {
    const titles = ['سجل النشاط', 'النشاط حسب الكاشير', 'ملخص الأحداث', 'نظرة عامة على النشاط'];
    const table = (head: string[], body: (string | number)[][]) =>
      `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`;
    const cashierTable = table(['الكاشير', 'أحداث', 'بفاتورة', 'أول نشاط', 'آخر نشاط'],
      byCashier.map(c => [c.name, formatNum(c.count), formatNum(c.withReceipt), formatDate(c.firstAt), formatDate(c.lastAt)]));
    const eventTable = table(['الحدث', 'العدد', 'النسبة'],
      byEvent.map(e => [e.label, formatNum(e.count), rows.length ? `${((e.count / rows.length) * 100).toFixed(1)}%` : '—']));
    const content = subTab === 1
      ? cashierTable
      : subTab === 2
        ? eventTable
        : subTab === 3
          ? `<h3>حسب الكاشير</h3>${cashierTable}<h3>الأحداث</h3>${eventTable}`
          : table(['الوقت', 'الكاشير', 'الحدث', 'التفاصيل', 'نقطة البيع', 'الفاتورة'],
            rows.map(a => [formatDate(a.createdAt), a.cashierName ?? '', a.eventLabel ?? a.eventType, a.message ?? '', a.posPath ?? '', a.receiptNum ?? a.receiptId ?? '']));
    void printDocument(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${titles[subTab]}</title>
      <style>body{font-family:Tahoma,sans-serif;padding:16px;font-size:12px} h2{margin:0 0 4px} p{margin:0 0 12px;color:#555}
      table{width:100%;border-collapse:collapse;margin-bottom:12px} td,th{border:1px solid #ddd;padding:5px 6px;text-align:right} th{background:#f3f4f6}</style>
      </head><body><h2>${titles[subTab]}</h2><p>${esc(applied.from)} — ${esc(applied.to)} · ${formatNum(rows.length)} حدث</p>${content}</body></html>`);
  }

  const busy = q.isLoading;
  const empty = !busy && !q.isError && rows.length === 0;

  const stripCells: SummaryCell[] = [
    {
      label: 'الأحداث',
      value: formatNum(rows.length),
      hint: rows.length !== nowCount ? `من أصل ${formatNum(nowCount)}` : delta != null ? <span className="inline-flex items-center gap-1"><DeltaBadge value={delta} /> عن الفترة السابقة</span> : undefined,
      tone: 'brand',
    },
    { label: 'مرتبطة بفاتورة', value: formatNum(withReceipt), hint: rows.length ? `${((withReceipt / rows.length) * 100).toFixed(0)}% من الأحداث` : undefined },
    { label: 'كاشير نشِط', value: formatNum(uniqueCashiers), onClick: () => setSubTab(1), active: subTab === 1 },
    { label: 'أنواع الأحداث', value: formatNum(byEvent.length), onClick: () => setSubTab(2), active: subTab === 2 },
    { label: 'ساعة الذروة', value: rows.length ? `${peakHour}:00` : '—', hint: rows.length ? `${formatNum(byHour[peakHour])} حدث` : undefined, onClick: () => setSubTab(3), active: subTab === 3 },
    { label: 'آخر حدث', value: lastAt ? timeAgo(lastAt) : '—', hint: lastAt ? formatDate(lastAt) : undefined },
  ];

  const tabName = TAB_NAMES[subTab];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        {/* ── الفلاتر ── */}
        <FilterBar
          onSubmit={() => apply()}
          footer={
            <>
              <SegmentedFilter<TabName>
                label="طريقة التجميع"
                value={tabName}
                onChange={id => setSubTab(TAB_NAMES.indexOf(id) as SubTab)}
                items={[
                  { id: 'log', label: 'السجل', count: busy ? undefined : rows.length },
                  { id: 'cashiers', label: 'حسب الكاشير', count: busy ? undefined : byCashier.length },
                  { id: 'events', label: 'ملخص الأحداث', count: busy ? undefined : byEvent.length },
                  { id: 'overview', label: 'نظرة عامة' },
                ]}
              />
              {subTab === 0 && (
                <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="طريقة العرض">
                  {([['table', 'جدول', <IconGrid key="g" size={13} />], ['timeline', 'خط زمني', <IconClock key="c" size={13} />]] as const).map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={view === id}
                      onClick={() => setView(id)}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition ${
                        view === id ? 'bg-slate-100 text-brand-800 ring-1 ring-slate-200' : 'text-slate-500 hover:bg-slate-50 hover:text-header'
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {(nameFilter || eventType) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {nameFilter && <FilterTag onClear={() => setNameFilter('')}>الكاشير: {nameFilter}</FilterTag>}
                  {eventType && (
                    <FilterTag onClear={() => setEventType('')}>
                      الحدث: {eventOptions.find(([id]) => id === eventType)?.[1] ?? eventType}
                    </FilterTag>
                  )}
                </div>
              )}
              <span className="ms-auto text-[11px] text-slate-400 num">
                {applied.from} — {applied.to}
              </span>
            </>
          }
        >
          <FilterLabel label="بحث في الأحداث والملاحظات" grow>
            <div className="relative">
              <IconSearch size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={draft.search}
                onChange={e => patchDraft({ search: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Escape' && draft.search) {
                    e.preventDefault();
                    patchDraft({ search: '' });
                  }
                }}
                placeholder="نص الحدث أو الملاحظة — Enter للبحث"
                className="!ps-9"
              />
            </div>
          </FilterLabel>
          <div className="min-w-0">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">الفترة</span>
            <div className="flex items-center gap-1.5">
              <DatePresets
                variant="menu"
                periodSettings={periodSettings}
                from={applied.from}
                to={applied.to}
                onPick={(f, t) => apply({ from: f || daysAgoIso(30), to: t || todayIso() })}
              />
              <Input type="date" aria-label="من تاريخ" title="من تاريخ" value={draft.from} onChange={e => patchDraft({ from: e.target.value })} className="!w-[138px] text-[12.5px]" />
              <span className="text-slate-400">—</span>
              <Input type="date" aria-label="إلى تاريخ" title="إلى تاريخ" value={draft.to} onChange={e => patchDraft({ to: e.target.value })} className="!w-[138px] text-[12.5px]" />
            </div>
          </div>
          <FilterLabel label="الكاشير" className={draft.cashierId ? '[&_select]:border-brand-300 [&_select]:bg-brand-50/40 [&_select]:font-semibold' : ''}>
            <Select aria-label="الكاشير" value={draft.cashierId} onChange={e => apply({ cashierId: e.target.value })}>
              <option value="">كل الكاشير</option>
              {cashiers.map(c => (
                <option key={c.id} value={c.id}>{c.accountName ?? c.username}</option>
              ))}
            </Select>
          </FilterLabel>
          <FilterLabel label="نوع الحدث" className={eventType ? '[&_select]:border-brand-300 [&_select]:bg-brand-50/40 [&_select]:font-semibold' : ''}>
            <Select aria-label="نوع الحدث" value={eventType} onChange={e => setEventType(e.target.value)} disabled={!eventOptions.length && !eventType}>
              <option value="">كل الأحداث</option>
              {eventType && !eventOptions.some(([id]) => id === eventType) && <option value={eventType}>{eventType}</option>}
              {eventOptions.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </Select>
          </FilterLabel>
          <FilterActions>
            <Btn type="submit" icon={<IconSearch size={15} />} className={dirty ? 'ring-2 ring-brand-300 ring-offset-1' : ''}>استعراض</Btn>
            {!isDefault && <Btn variant="secondary" onClick={clearAll} title="إرجاع الفلاتر لآخر يومين">مسح</Btn>}
            <IconButton label="تصدير CSV" onClick={exportCsv} disabled={!rows.length}>
              <IconDownload size={16} />
            </IconButton>
            <IconButton label="طباعة" onClick={printReport} disabled={!rows.length}>
              <IconPrinter size={16} />
            </IconButton>
            <IconButton label="تحديث" onClick={() => { void q.refetch(); void prevQ.refetch(); }}>
              <IconRefresh size={16} className={q.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </FilterActions>
        </FilterBar>

        {/* ── شريط المجاميع ── */}
        <SummaryStrip cells={stripCells} loading={busy} />

        {q.isError && (
          <div className="shrink-0 p-2">
            <Alert title="تعذّر تحميل سجل النشاط">
              <div className="flex flex-wrap items-center gap-2">
                {q.error instanceof Error ? q.error.message : 'خطأ غير معروف'}
                <Btn size="xs" variant="secondary" icon={<IconRefresh size={13} />} onClick={() => q.refetch()}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}

        {/* ── المحتوى ── */}
        <WorkspaceBody>
          {busy && <div className="p-3"><TableSkeleton rows={10} cols={6} /></div>}

          {empty && (
            <EmptyState
              icon={<IconHistory size={24} />}
              title="لا نشاط في هذه الفترة"
              description={isDefault ? 'لم يُسجَّل أي حدث من الكاشير خلال آخر يومين.' : 'لا أحداث تطابق الفلاتر الحالية.'}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Btn size="sm" variant="secondary" onClick={() => apply({ from: daysAgoIso(7), to: todayIso() })}>آخر 7 أيام</Btn>
                  {!isDefault && <Btn size="sm" variant="ghost" onClick={clearAll}>مسح الفلاتر</Btn>}
                </div>
              }
            />
          )}

          {!busy && rows.length > 0 && (
            <>
              {subTab === 0 && view === 'table' && (
                <DataGrid
                  variant="sheet"
                  embedded
                  fillHeight
                  dense
                  columns={logColumns}
                  rows={rows}
                  getRowId={a => a.id}
                  exportName={`سجل-النشاط-${applied.from}_${applied.to}`}
                  counterLabel="حدث"
                  storageKey="activity-log"
                  emptyText="لا نشاط يطابق فلتر الأعمدة"
                  rowTone={a => {
                    const t = eventTone(a.eventType, a.eventLabel);
                    return t === 'danger' ? 'bg-red-50/40' : t === 'warn' ? 'bg-amber-50/50' : undefined;
                  }}
                  badge={<span className="hidden text-[11px] text-slate-400 md:inline">انقر اسم الكاشير لعرض أحداثه فقط</span>}
                />
              )}

              {subTab === 0 && view === 'timeline' && (
                <div className="min-h-0 flex-1 overflow-auto">
                  {days.map(day => (
                    <div key={day.key}>
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-50/95 px-3 py-1 backdrop-blur">
                        <span className="text-[12px] font-bold text-header">{dayLabel(day.key)}</span>
                        <span className="text-[11px] text-slate-500 num">{formatNum(dayTotals.get(day.key) ?? day.items.length)} حدث</span>
                      </div>
                      <ol>
                        {day.items.map(a => {
                          const tone = eventTone(a.eventType, a.eventLabel);
                          return (
                            <li key={a.id} className="flex h-8 items-center gap-2.5 border-b border-slate-100 px-3 text-[12.5px] hover:bg-slate-50/80">
                              <span className="w-[64px] shrink-0 text-[11.5px] text-slate-500 num" title={formatDate(a.createdAt)}>
                                {timeOnly(a.createdAt)}
                              </span>
                              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
                              <button
                                type="button"
                                onClick={() => setNameFilter(a.cashierName ?? '—')}
                                className="max-w-[160px] shrink-0 truncate font-bold text-header hover:text-brand-700 hover:underline"
                                title="عرض أحداث هذا الكاشير فقط"
                              >
                                {a.cashierName ?? '—'}
                              </button>
                              <span className="shrink-0"><EventBadge type={a.eventType} label={a.eventLabel} /></span>
                              <span className="min-w-0 flex-1 truncate text-slate-500" title={a.message ?? ''}>{a.message ?? ''}</span>
                              {a.posPath && <span className="hidden max-w-[160px] shrink-0 truncate text-[11px] text-slate-400 lg:inline" title={a.posPath}>{a.posPath}</span>}
                              {(a.receiptId || a.receiptNum) && <span className="shrink-0 text-[12px]"><ReceiptLink a={a} /></span>}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ))}
                  {rows.length > limit && (
                    <div className="flex items-center justify-center gap-3 border-t border-slate-100 py-2 text-[12px] text-slate-500">
                      يُعرض {formatNum(limit)} من {formatNum(rows.length)}
                      <Btn size="sm" variant="secondary" onClick={() => setLimit(l => l + PAGE)}>عرض المزيد</Btn>
                    </div>
                  )}
                </div>
              )}

              {subTab === 1 && (
                <DataGrid
                  variant="sheet"
                  embedded
                  fillHeight
                  dense
                  columns={cashierColumns}
                  rows={byCashier}
                  getRowId={c => c.name}
                  exportName={`النشاط-حسب-الكاشير-${applied.from}_${applied.to}`}
                  counterLabel="كاشير"
                  storageKey="activity-cashiers"
                  badge={<span className="hidden text-[11px] text-slate-400 md:inline">انقر الصف لعرض سجل الكاشير</span>}
                  onRowClick={c => openCashierLog(c.name)}
                  emptyText="لا كاشير يطابق فلتر الأعمدة"
                />
              )}

              {subTab === 2 && (
                <DataGrid
                  variant="sheet"
                  embedded
                  fillHeight
                  dense
                  columns={byEventColumns(maxEvent, rows.length)}
                  rows={byEvent}
                  getRowId={e => e.type}
                  exportName="ملخص-الأحداث"
                  counterLabel="نوع حدث"
                  badge={<span className="text-[11px] text-slate-400">انقر الحدث لعرض سجله</span>}
                  onRowClick={e => { setEventType(e.type); setSubTab(0); }}
                  emptyText="لا أحداث مسجلة"
                />
              )}

              {subTab === 3 && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <div className="grid gap-2 p-2 lg:grid-cols-2">
                    <Panel title="أكثر الكاشير نشاطاً" icon={<IconUsers size={16} />}>
                      <ul className="divide-y divide-slate-100">
                        {byCashier.slice(0, 10).map(c => (
                          <li key={c.name}>
                            <button type="button" onClick={() => openCashierLog(c.name)} className="flex w-full items-center gap-3 px-4 py-1.5 text-right hover:bg-slate-50">
                              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-header">{c.name}</span>
                              <div className="w-32">
                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (c.count / maxCashier) * 100)}%` }} />
                                </div>
                              </div>
                              <span className="w-12 text-end text-[12px] font-bold num">{formatNum(c.count)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Panel>
                    <Panel title="توزيع الأحداث" icon={<IconActivity size={16} />}>
                      <ul className="divide-y divide-slate-100">
                        {byEvent.slice(0, 10).map(e => (
                          <li key={e.type}>
                            <button type="button" onClick={() => { setEventType(e.type); setSubTab(0); }} className="flex w-full items-center gap-3 px-4 py-1.5 text-right hover:bg-slate-50">
                              <span className="w-36 shrink-0 truncate"><EventBadge type={e.type} label={e.label} /></span>
                              <div className="min-w-0 flex-1">
                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(4, (e.count / maxEvent) * 100)}%` }} />
                                </div>
                              </div>
                              <span className="w-12 text-end text-[12px] font-bold num">{formatNum(e.count)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Panel>
                    <Panel title="النشاط حسب الساعة" subtitle="عدد الأحداث في كل ساعة من اليوم" icon={<IconClock size={16} />} className="lg:col-span-2">
                      <div className="px-4 pb-3 pt-3">
                        <div className="flex h-32 items-end gap-1" dir="ltr">
                          {byHour.map((n, h) => (
                            <div key={h} className="group flex h-full flex-1 flex-col justify-end" title={`${h}:00 — ${formatNum(n)} حدث`}>
                              <div
                                className={`w-full rounded-t ${n ? 'bg-brand-500 group-hover:bg-brand-600' : 'bg-slate-100'}`}
                                style={{ height: `${n ? Math.max(4, (n / maxHour) * 100) : 3}%` }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 flex gap-1 text-[10.5px] text-slate-400 num" dir="ltr">
                          {byHour.map((_, h) => (
                            <span key={h} className="flex-1 text-center">{h % 3 === 0 ? h : ''}</span>
                          ))}
                        </div>
                      </div>
                    </Panel>
                  </div>
                </div>
              )}
            </>
          )}
        </WorkspaceBody>
      </WorkspaceCard>
    </WorkspacePage>
  );
}

function FilterTag({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pe-1 ps-2.5 text-[11.5px] font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">
      {children}
      <button type="button" onClick={onClear} aria-label="إزالة الفلتر" className="rounded-full p-0.5 hover:bg-brand-100">
        <IconX size={12} />
      </button>
    </span>
  );
}
