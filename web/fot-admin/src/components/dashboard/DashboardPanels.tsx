import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatNum, receiptDisplayNumber } from '@/api/client';
import type {
  CashierActivityDto,
  CashierPerformanceRowDto,
  CashierVoidReportDto,
  EdariSyncLogDto,
  HoldReceiptDto,
  OfferSalesClosureDto,
  PosTerminalMonitorDto,
  ReceiptSummary,
  ReorderReportDto,
  SalesmanCommissionSummaryDto,
  SlowMoverReportDto,
  TargetBreakdownDto,
} from '@/api/types';
import { Btn, EmptyState, Skeleton } from '@/components/ui';
import { IconCheckCircle, IconChevronDown } from '@/components/icons';
import { fixEdariName } from '@/lib/text';
import { prettyPos } from './HomeWidgets';
import { timeAgo, weekdayShort } from './dashboardUtils';

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  idle: 'bg-slate-300',
};

function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${formatNum(v / 1_000_000, 1)}M`;
  if (a >= 1_000) return `${formatNum(v / 1_000, 0)}K`;
  return formatNum(v);
}

/* ── ساعة حية ── */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

const DAILY_TARGET_KEY = 'fot.dashboard.dailyTarget';

function readDailyTarget(): number {
  try {
    const v = Number(localStorage.getItem(DAILY_TARGET_KEY) || 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/* ── الرأس: مبيعات اليوم الصافية + التوقع + الوتيرة + اختيار التاريخ ── */
export function DashboardHero({
  greeting,
  dateLabel,
  updatedAt,
  live,
  sales,
  salesDelta,
  salesDeltaLabel,
  receipts,
  average,
  forecast,
  yesterdayTotal,
  pace,
  loading,
  refreshing,
  onRefresh,
  selectedDate,
  realToday,
  yesterdayIso,
  onSelectDate,
  onExportExcel,
  onPrintSummary,
}: {
  greeting: string;
  dateLabel: string;
  updatedAt?: string | null;
  live: boolean;
  sales: number;
  salesDelta: number | null;
  salesDeltaLabel: string;
  receipts: number;
  average: number;
  forecast: number | null;
  yesterdayTotal: number;
  /** null = لا مبيعات أمس للمقارنة */
  pace: number | null;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
  selectedDate?: string;
  realToday?: string;
  yesterdayIso?: string;
  onSelectDate?: (iso: string) => void;
  onExportExcel?: () => void;
  onPrintSummary?: () => void;
}) {
  const now = useNow();
  const [customTarget, setCustomTarget] = useState<number>(() => readDailyTarget());
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const paceClamped = Math.max(0, Math.min(160, pace ?? 0));
  const paceTone = pace == null ? 'text-slate-400' : pace >= 100 ? 'text-emerald-300' : pace >= 80 ? 'text-amber-200' : 'text-rose-300';
  const forecastVsY = forecast != null && yesterdayTotal > 0 ? Math.round(((forecast - yesterdayTotal) / yesterdayTotal) * 100) : null;
  const deltaRounded = salesDelta == null ? null : Math.round(salesDelta);
  const isToday = !selectedDate || !realToday || selectedDate === realToday;
  const isYesterday = Boolean(selectedDate && yesterdayIso && selectedDate === yesterdayIso);
  const effectiveTarget = customTarget > 0 ? customTarget : yesterdayTotal > 0 ? yesterdayTotal : 0;
  const targetPct = effectiveTarget > 0 ? Math.min(100, Math.round((sales / effectiveTarget) * 100)) : null;

  function saveTarget() {
    const n = Math.round(Number(targetDraft.replace(/[^\d.]/g, '')) || 0);
    setCustomTarget(n);
    try {
      if (n > 0) localStorage.setItem(DAILY_TARGET_KEY, String(n));
      else localStorage.removeItem(DAILY_TARGET_KEY);
    } catch { /* ignore */ }
    setEditingTarget(false);
  }

  return (
    <section
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-[var(--shadow-pop)] md:p-6"
      style={{
        background:
          'radial-gradient(120% 140% at 0% 0%, rgba(15,159,118,0.35) 0%, rgba(15,159,118,0) 55%), radial-gradient(90% 120% at 100% 100%, rgba(217,170,80,0.18) 0%, rgba(217,170,80,0) 60%), linear-gradient(135deg, #0c1322 0%, #131c2e 55%, #04301f 100%)',
      }}
    >
      <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full border border-white/5" />
      <div className="pointer-events-none absolute -left-4 -top-4 h-32 w-32 rounded-full border border-white/5" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-slate-300">{greeting}</p>
          <p className="mt-0.5 text-[12px] text-slate-400">
            {dateLabel} · <span className="num font-semibold text-slate-200">{time}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onSelectDate && realToday && yesterdayIso && (
            <div className="inline-flex items-center gap-1 rounded-lg bg-white/10 p-0.5 ring-1 ring-inset ring-white/15">
              <button
                type="button"
                onClick={() => onSelectDate(realToday)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  isToday ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                اليوم
              </button>
              <button
                type="button"
                onClick={() => onSelectDate(yesterdayIso)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  isYesterday ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                أمس
              </button>
              <input
                type="date"
                value={selectedDate || realToday}
                max={realToday}
                onChange={e => e.target.value && onSelectDate(e.target.value)}
                className="h-7 rounded-md bg-transparent px-1.5 text-[11px] font-semibold text-slate-200 outline-none [color-scheme:dark]"
                title="استعراض يوم محدد"
              />
            </div>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
              !isToday
                ? 'bg-amber-400/20 text-amber-200 ring-amber-300/40'
                : live
                  ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/30'
                  : 'bg-amber-400/10 text-amber-200 ring-amber-300/30'
            }`}
            title={!isToday ? `تستعرض بيانات ${selectedDate}` : live ? 'الأرقام تتحدث فوراً عند كل فاتورة' : 'الاتصال اللحظي منقطع — تحديث دوري'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${!isToday ? 'bg-amber-300' : live ? 'animate-pulse bg-emerald-300' : 'bg-amber-300'}`} />
            {!isToday ? `أرشيف ${selectedDate}` : live ? 'مباشر' : 'تحديث دوري'}
          </span>
          {onExportExcel && (
            <button
              type="button"
              onClick={onExportExcel}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[11.5px] font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
              title="تصدير ملخص اليوم إلى Excel"
            >
              Excel
            </button>
          )}
          {onPrintSummary && (
            <button
              type="button"
              onClick={onPrintSummary}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[11.5px] font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
              title="طباعة ملخص اليوم A4"
            >
              طباعة
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[12px] font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} className={refreshing ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            تحديث
          </button>
        </div>
      </div>

      <div className="relative mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
            {isToday ? 'صافي مبيعات اليوم' : `صافي مبيعات (${selectedDate})`}
          </p>
          {loading ? (
            <div className="mt-2 h-11 w-60 animate-pulse rounded-lg bg-white/10" />
          ) : (
            <p className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-[40px] font-bold leading-none tracking-tight num md:text-[46px]">{formatNum(sales)}</span>
              <span className="text-[14px] font-semibold text-slate-400">IQD</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            {deltaRounded != null ? (
              <span
                dir="ltr"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold num ${
                  deltaRounded > 0 ? 'bg-emerald-400/15 text-emerald-200' : deltaRounded < 0 ? 'bg-rose-400/15 text-rose-200' : 'bg-white/10 text-slate-200'
                }`}
              >
                {deltaRounded > 0 ? '▲' : deltaRounded < 0 ? '▼' : '•'} {formatNum(Math.abs(deltaRounded), 0)}%
              </span>
            ) : null}
            <span className="text-slate-300">{salesDeltaLabel}</span>
          </div>
          {effectiveTarget > 0 && !editingTarget && (
            <div className="mt-3 max-w-md rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-inset ring-white/10">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-300">
                  هدف اليوم: <b className="num text-white">{formatNum(effectiveTarget)}</b> IQD
                  {customTarget === 0 && <span className="ms-1 text-slate-400">(مبيعات أمس)</span>}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-300 num">{targetPct}%</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetDraft(String(customTarget || effectiveTarget));
                      setEditingTarget(true);
                    }}
                    className="text-[10.5px] font-semibold text-slate-400 underline hover:text-white"
                  >
                    تعديل الهدف
                  </button>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-amber-300 transition-[width] duration-700"
                  style={{ width: `${targetPct ?? 0}%` }}
                />
              </div>
            </div>
          )}
          {editingTarget && (
            <div className="mt-3 flex max-w-md items-center gap-2 rounded-xl bg-white/10 p-2 ring-1 ring-inset ring-white/20">
              <input
                type="number"
                value={targetDraft}
                onChange={e => setTargetDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditingTarget(false); }}
                placeholder="هدف مبيعات اليوم (IQD)…"
                className="h-7 flex-1 rounded bg-slate-900/70 px-2 text-[12px] font-bold text-white outline-none num"
                autoFocus
              />
              <button type="button" onClick={saveTarget} className="rounded bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white">
                حفظ
              </button>
              <button type="button" onClick={() => setEditingTarget(false)} className="rounded px-2 py-1 text-[11px] text-slate-300">
                إلغاء
              </button>
            </div>
          )}
          {updatedAt && <p className="mt-2 text-[11px] text-slate-500">آخر تحديث <span className="num">{updatedAt}</span></p>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <HeroStat label="الفواتير" value={formatNum(receipts)} />
          <HeroStat label="متوسط الفاتورة" value={compact(average)} />
          <HeroStat
            label="توقع نهاية اليوم"
            value={forecast != null ? compact(forecast) : '—'}
            sub={
              forecastVsY != null ? (
                forecastVsY === 0 ? (
                  'مثل أمس تقريباً'
                ) : (
                  <span className={forecastVsY > 0 ? 'text-emerald-300' : 'text-rose-300'}>
                    {forecastVsY > 0 ? '+' : '−'}
                    {formatNum(Math.abs(forecastVsY), 0)}% عن أمس
                  </span>
                )
              ) : (
                'بعد تراكم المبيعات'
              )
            }
          />
          <div className="col-span-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10">
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-slate-300">وتيرة البيع مقارنة بأمس</span>
              <span className={`font-bold num ${paceTone}`}>{pace == null ? 'لا مقارنة' : `${formatNum(pace, 0)}%`}</span>
            </div>
            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-l from-emerald-300 to-brand-500 transition-[width] duration-700"
                style={{ width: `${(paceClamped / 160) * 100}%` }}
              />
              <div className="absolute inset-y-0 w-px bg-white/50" style={{ right: `${(100 / 160) * 100}%` }} title="نفس وتيرة أمس" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10">
      <p className="truncate text-[11px] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-[19px] font-bold leading-none num">{value}</p>
      {sub && <p className="mt-1 truncate text-[10.5px] text-slate-400">{sub}</p>}
    </div>
  );
}

/* ── مركز التنبيهات ── */
export type AttentionItem = {
  id: string;
  tone: 'bad' | 'warn' | 'info';
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  to: string;
  action?: string;
  onQuickAction?: () => void;
  quickActionLabel?: string;
  quickActionLoading?: boolean;
};

const ATTN_TONE = {
  bad: { box: 'border-red-200 bg-red-50/70 hover:border-red-300', tile: 'bg-red-100 text-red-700', title: 'text-red-800' },
  warn: { box: 'border-amber-200 bg-amber-50/70 hover:border-amber-300', tile: 'bg-amber-100 text-amber-700', title: 'text-amber-900' },
  info: { box: 'border-sky-200 bg-sky-50/70 hover:border-sky-300', tile: 'bg-sky-100 text-sky-700', title: 'text-sky-900' },
};

const PHONE_ATTENTION_LIMIT = 3;

export function AttentionCenter({ items, loading }: { items: AttentionItem[]; loading?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  if (loading) return null;
  if (!items.length) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <span className="icon-tile h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700"><IconCheckCircle size={18} /></span>
        <div>
          <p className="text-[13px] font-bold text-emerald-900">كل شيء على ما يرام</p>
          <p className="text-[11.5px] text-emerald-800/80">لا فواتير معلّقة أو عالقة، والربط مع الأداري ونقاط البيع يعمل.</p>
        </div>
      </div>
    );
  }
  const sorted = [...items].sort((a, b) => rank(a.tone) - rank(b.tone));
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-bold text-header">يحتاج انتباهك</h2>
        <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10.5px] font-bold text-white num">{items.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {sorted.map((it, i) => {
          const t = ATTN_TONE[it.tone];
          const phoneHidden = !showAll && i >= PHONE_ATTENTION_LIMIT ? 'hidden sm:flex' : 'flex';
          return (
            <div key={it.id} className={`group ${phoneHidden} items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${t.box}`}>
              <Link to={it.to} className="flex min-w-0 flex-1 items-center gap-3">
                <span className={`icon-tile h-9 w-9 rounded-xl ${t.tile}`}>{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12.5px] font-bold ${t.title}`}>{it.title}</span>
                  <span className="block truncate text-[11.5px] text-slate-600">{it.detail}</span>
                </span>
              </Link>
              {it.onQuickAction && it.quickActionLabel ? (
                <Btn
                  size="xs"
                  variant={it.tone === 'bad' ? 'danger' : 'secondary'}
                  loading={it.quickActionLoading}
                  onClick={it.onQuickAction}
                  className="shrink-0"
                >
                  {it.quickActionLabel}
                </Btn>
              ) : (
                <Link to={it.to} className="shrink-0 text-[11px] font-semibold text-slate-500 transition group-hover:text-slate-800">
                  {it.action ?? 'فتح'} ←
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {sorted.length > PHONE_ATTENTION_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white py-2 text-[12px] font-semibold text-slate-600 sm:hidden"
        >
          {showAll ? 'إخفاء' : `عرض كل التنبيهات (${formatNum(sorted.length)})`}
        </button>
      )}
    </section>
  );
}

function rank(t: AttentionItem['tone']) {
  return t === 'bad' ? 0 : t === 'warn' ? 1 : 2;
}

/* ── شريط التنقل بين الأقسام ── */
const COLLAPSE_EVENT = 'fot:dashboard-collapse';

export function SectionNav({ sections }: { sections: { id: string; label: string; badge?: number }[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const els = sections.map(s => document.getElementById(`dash-${s.id}`)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace('dash-', ''));
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  function setAllCollapsed(collapsed: boolean) {
    const next: Record<string, boolean> = {};
    for (const s of sections) next[s.id] = collapsed;
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(COLLAPSE_EVENT, { detail: collapsed }));
  }

  return (
    <nav className="sticky top-0 z-[var(--z-sticky)] -mx-1 overflow-x-auto px-1 py-1.5 bg-[#f3f5f8]/85 backdrop-blur">
      <div className="inline-flex min-w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-[var(--shadow-soft)]">
        <div className="inline-flex items-center gap-1">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setActive(s.id);
                document.getElementById(`dash-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                active === s.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {s.label}
              {s.badge ? (
                <span className={`rounded-full px-1.5 text-[10px] font-bold num ${active === s.id ? 'bg-white/20' : 'bg-red-100 text-red-700'}`}>
                  {s.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="hidden shrink-0 items-center gap-1 pe-1 sm:inline-flex">
          <button
            type="button"
            onClick={() => setAllCollapsed(false)}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            فتح الكل
          </button>
          <span className="text-slate-200">|</span>
          <button
            type="button"
            onClick={() => setAllCollapsed(true)}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            طي الكل
          </button>
        </div>
      </div>
    </nav>
  );
}

/* ── قسم قابل للطي يحفظ حالته ── */
const COLLAPSE_KEY = 'fot.dashboard.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function DashSection({
  id,
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => Boolean(readCollapsed()[id]));

  useEffect(() => {
    const handler = (e: Event) => {
      const next = Boolean((e as CustomEvent<boolean>).detail);
      setCollapsed(next);
    };
    window.addEventListener(COLLAPSE_EVENT, handler);
    return () => window.removeEventListener(COLLAPSE_EVENT, handler);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    const all = readCollapsed();
    all[id] = next;
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(all));
  }

  return (
    <section id={`dash-${id}`} className="scroll-mt-16 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={toggle} className="group flex min-w-0 items-center gap-2.5 text-right">
          <span className="icon-tile h-8 w-8 rounded-lg bg-slate-900 text-white">{icon}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[15px] font-bold text-header">
              {title}
              <IconChevronDown size={15} className={`text-slate-400 transition group-hover:text-slate-700 ${collapsed ? 'rotate-90' : ''}`} />
            </span>
            {subtitle && <span className="block truncate text-[11.5px] text-slate-500">{subtitle}</span>}
          </span>
        </button>
        {action}
      </header>
      {!collapsed && <div className="animate-fade-in space-y-4">{children}</div>}
    </section>
  );
}

/* ── توزيع طرق الدفع (دائري) ── */
export function PaymentMix({
  cash,
  card,
  returns,
  cardCount,
  loading,
}: {
  cash: number;
  card: number;
  returns: number | null;
  cardCount: number;
  loading?: boolean;
}) {
  if (loading) return <div className="flex justify-center p-6"><Skeleton className="h-36 w-36 rounded-full" /></div>;
  const total = Math.max(0, cash) + Math.max(0, card);
  if (total <= 0) return <EmptyState compact title="لا مبيعات اليوم بعد" />;
  const r = 52;
  const c = 2 * Math.PI * r;
  const cardShare = card / total;
  const parts = [
    { label: 'نقدي', value: cash, share: 1 - cardShare, color: '#0f9f76' },
    { label: 'بطاقة', value: card, share: cardShare, color: '#0ea5e9' },
  ];
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center justify-center gap-5 px-4 pb-4">
      <div className="relative h-[140px] w-[140px] shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f6" strokeWidth="16" />
          {parts.map(p => {
            const len = c * p.share;
            const el = (
              <circle
                key={p.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                style={{ transition: 'stroke-dasharray 0.8s ease' }}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-slate-500">البطاقة</span>
          <span className="text-[20px] font-bold leading-none text-header num">{formatNum(cardShare * 100, 0)}%</span>
        </div>
      </div>
      <ul className="min-w-[150px] flex-1 space-y-2.5">
        {parts.map(p => (
          <li key={p.label} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="flex-1 text-slate-600">{p.label}</span>
            <span className="font-bold text-header num">{formatNum(p.value)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-[11.5px] text-slate-500">
          <span className="h-2.5 w-2.5 shrink-0" />
          <span className="flex-1">فواتير البطاقة</span>
          <span className="num">{formatNum(cardCount)}</span>
        </li>
        {returns != null && returns > 0 && (
          <li className="flex items-center gap-2 border-t border-slate-100 pt-2 text-[12px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-red-400" />
            <span className="flex-1 text-slate-600">مرتجعات مطروحة</span>
            <span className="font-bold text-red-600 num">−{formatNum(returns)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

/* ── تقدم الفترة (أسبوع / شهر) ── */
export function PeriodProgress({
  label,
  total,
  receipts,
  compareTotal,
  compareLabel,
  elapsed,
  days,
  forecast,
  best,
  loading,
}: {
  label: string;
  total: number;
  receipts: number;
  compareTotal: number;
  compareLabel: string;
  elapsed: number;
  days: number;
  forecast: number | null;
  best?: { date: string; total: number } | null;
  loading?: boolean;
}) {
  const delta = compareTotal > 0 ? ((total - compareTotal) / compareTotal) * 100 : null;
  const timePct = Math.min(100, (elapsed / Math.max(1, days)) * 100);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-semibold text-slate-500">{label}</p>
        <p className="text-[11px] text-slate-400">
          اليوم <span className="num">{formatNum(elapsed)}</span> من <span className="num">{formatNum(days)}</span>
        </p>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-32" />
      ) : (
        <p className="mt-1 text-[22px] font-bold leading-tight text-header num">
          {formatNum(total)} <span className="text-[11px] font-semibold text-slate-400">IQD</span>
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-500">
        <span className="num">{formatNum(receipts)} فاتورة</span>
        {delta != null && (
          <span className={delta >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
            {delta >= 0 ? '▲' : '▼'} {formatNum(Math.abs(delta), 0)}% {compareLabel}
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
        <div className="h-full rounded-full bg-slate-800 transition-[width] duration-700" style={{ width: `${timePct}%` }} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11.5px]">
        <div>
          <p className="text-slate-400">التوقع بنهاية الفترة</p>
          <p className="font-bold text-header num">{forecast != null ? formatNum(forecast) : '—'}</p>
        </div>
        {best && best.total > 0 && (
          <div>
            <p className="text-slate-400">أفضل يوم</p>
            <p className="font-bold text-header">
              {weekdayShort(best.date)} <span className="num text-slate-500">{compact(best.total)}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── أعمدة أيام الشهر ── */
export function MonthDailyBars({
  days,
  today,
  selectedDate,
  onSelectDay,
  loading,
}: {
  days: { date: string; total: number; receiptCount?: number }[];
  today: string;
  selectedDate?: string;
  onSelectDay?: (iso: string) => void;
  loading?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...days.map(d => d.total)), [days]);
  const avg = useMemo(() => {
    const past = days.filter(d => d.date.slice(0, 10) <= today && d.total > 0);
    return past.length ? past.reduce((n, d) => n + d.total, 0) / past.length : 0;
  }, [days, today]);

  if (loading) return <Skeleton className="mx-4 mb-4 h-[120px]" />;
  const H = 120;
  return (
    <div className="px-4 pb-3">
      <div className="relative" style={{ height: H }}>
        {avg > 0 && (
          <div className="absolute inset-x-0 border-t border-dashed border-amber-400" style={{ bottom: `${(avg / max) * 100}%` }}>
            <span className="absolute -top-4 left-0 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700 num">
              متوسط {compact(avg)}
            </span>
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {days.map((d, i) => {
            const key = d.date.slice(0, 10);
            const isToday = key === today;
            const isSelected = selectedDate ? key === selectedDate : isToday;
            const future = key > today;
            return (
              <div
                key={d.date}
                onClick={!future && onSelectDay ? () => onSelectDay(key) : undefined}
                className={`relative flex h-full flex-1 items-end ${!future && onSelectDay ? 'cursor-pointer' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className={`w-full rounded-t-[3px] transition-[height] duration-500 ${
                    isSelected ? 'bg-brand-600 ring-1 ring-brand-400' : future ? 'bg-slate-100' : d.total >= avg ? 'bg-brand-400' : 'bg-brand-200'
                  } ${hover === i ? 'opacity-80' : ''}`}
                  style={{ height: future ? '4%' : `${(d.total / max) * 100}%`, minHeight: d.total > 0 ? 2 : 0 }}
                />
                {hover === i && !future && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-36 -translate-x-1/2 animate-fade-in rounded-lg bg-slate-900 px-3 py-2 text-[11.5px] text-white shadow-pop">
                    <p className="mb-1 font-bold">{weekdayShort(d.date)} · <span className="num">{key.slice(5)}</span></p>
                    <p className="flex justify-between gap-2"><span className="text-slate-400">المبيعات</span><span className="num font-semibold">{formatNum(d.total)}</span></p>
                    <p className="flex justify-between gap-2"><span className="text-slate-400">الفواتير</span><span className="num">{formatNum(d.receiptCount ?? 0)}</span></p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400 num">
        <span>{days[0]?.date.slice(8, 10)}</span>
        <span>{days[Math.floor(days.length / 2)]?.date.slice(8, 10)}</span>
        <span>{days[days.length - 1]?.date.slice(8, 10)}</span>
      </div>
    </div>
  );
}

/* ── شبكة نقاط البيع ── */
export function TerminalGrid({ terminals, loading }: { terminals: PosTerminalMonitorDto[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (!terminals.length) return <EmptyState compact title="لا توجد نقاط بيع مسجلة" />;
  return (
    <div className="grid max-h-[320px] gap-2 overflow-y-auto px-4 pb-4 sm:grid-cols-2">
      {terminals.map(t => {
        const online = t.isOnline || t.active;
        const dead = t.deadOffline ?? 0;
        const pending = t.pendingOffline ?? 0;
        const tone: Tone = dead > 0 ? 'bad' : !online ? 'idle' : pending > 0 ? 'warn' : 'ok';
        return (
          <Link
            key={t.id}
            to="/terminals"
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition hover:shadow-[var(--shadow-lift)] ${
              dead > 0 ? 'border-red-200 bg-red-50/50' : online ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {online && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${DOT[tone]}`} />}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT[tone]}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[12.5px] font-semibold ${online ? 'text-slate-800' : 'text-slate-500'}`}>
                {prettyPos(t.name, t.sectionName)}
              </span>
              <span className="block truncate text-[11px] text-slate-500">
                {t.sectionName ? `${t.sectionName} · ` : ''}
                {online ? 'متصل' : `آخر اتصال ${timeAgo(t.lastConnection)}`}
                {t.exeVersion ? <span className="num"> · v{t.exeVersion}</span> : null}
              </span>
            </span>
            {(pending > 0 || dead > 0) && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold num ${dead > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                {dead > 0 ? `${formatNum(dead)} عالقة` : `${formatNum(pending)} بانتظار الرفع`}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/* ── أهداف متعثرة ── */
export function TargetRiskList({
  rows,
  onTrack,
  loading,
}: {
  rows: { key: string; name: string; pct: number }[];
  onTrack: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon={<IconCheckCircle size={18} />}
        title={onTrack > 0 ? 'كل البائعين على المسار' : 'لا أهداف نشطة هذا الأسبوع'}
        description={onTrack > 0 ? `${formatNum(onTrack)} بائع فوق 70% من هدف الأسبوع` : undefined}
      />
    );
  }
  return (
    <ul className="space-y-2.5 px-4 pb-4">
      {rows.map(r => {
        const pct = Math.max(0, Math.min(100, r.pct));
        const tone = r.pct < 40 ? 'bg-red-500' : 'bg-amber-500';
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate font-semibold text-slate-800">{r.name}</span>
              <span className={`shrink-0 font-bold num ${r.pct < 40 ? 'text-red-600' : 'text-amber-700'}`}>{formatNum(r.pct, 0)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
      {onTrack > 0 && <li className="pt-1 text-[11.5px] text-emerald-700">✓ {formatNum(onTrack)} بائع على المسار</li>}
    </ul>
  );
}

/* ── عمولات مستحقة ── */
export function CommissionDueList({
  rows,
  total,
  count,
  weekCommission,
  loading,
}: {
  rows: SalesmanCommissionSummaryDto[];
  total: number;
  count: number;
  weekCommission: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2">
          <p className="text-[11px] text-amber-800/80">مستحق للصرف</p>
          <p className="text-[16px] font-bold text-amber-900 num">{formatNum(total)}</p>
          <p className="text-[10.5px] text-amber-800/70 num">{formatNum(count)} بائع</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-[11px] text-slate-500">عمولة الأسبوع</p>
          <p className="text-[16px] font-bold text-header num">{formatNum(weekCommission)}</p>
        </div>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map(r => (
            <li key={r.salesmanId} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
              <span className="truncate text-slate-700">{fixEdariName(r.salesmanName) || `بائع #${r.salesmanId}`}</span>
              <span className="shrink-0 font-bold text-header num">{formatNum(r.balanceDue)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-center text-[11.5px] text-slate-400">لا مستحقات معلّقة</p>
      )}
    </div>
  );
}

/* ── الفواتير المعلّقة ── */
export function HoldsList({
  rows,
  onComplete,
}: {
  rows: HoldReceiptDto[];
  onComplete?: (h: HoldReceiptDto) => void;
}) {
  if (!rows.length) return <EmptyState compact icon={<IconCheckCircle size={18} />} title="لا فواتير معلّقة" />;
  return (
    <ul className="max-h-[260px] divide-y divide-slate-100 overflow-y-auto px-4 pb-3">
      {rows.slice(0, 8).map(h => (
        <li key={h.id} className="flex items-center gap-2.5 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-slate-800">
              {fixEdariName(h.salesmanName) || h.cashierName || `معلّقة #${h.id}`}
            </span>
            <span className="block truncate text-[11px] text-slate-500">
              {prettyPos(h.posName, h.sectionName)} · {formatNum(h.itemCount)} مادة · {timeAgo(h.creationDate)}
            </span>
          </span>
          <span className="shrink-0 text-[12.5px] font-bold text-header num">{formatNum(h.totalAmount)}</span>
          {onComplete && (
            <Btn size="xs" variant="soft" onClick={() => onComplete(h)} className="shrink-0">
              إكمال
            </Btn>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── شريط نبض المتجر الحي ── */
export function StorePulseStrip({
  peakHour,
  unitsSold,
  uniqueSold,
  largestReceipt,
  discountsRecent,
  activeOffers,
  lastBackupAt,
  storedBackupsCount,
}: {
  peakHour: { hour: number; total: number; count: number } | null;
  unitsSold: number;
  uniqueSold: number;
  largestReceipt: { number: string; amount: number } | null;
  discountsRecent: number;
  activeOffers: number;
  lastBackupAt?: string | null;
  storedBackupsCount?: number;
}) {
  const pills = [
    {
      label: 'ساعة الذروة اليوم',
      value: peakHour && peakHour.total > 0 ? `${String(peakHour.hour).padStart(2, '0')}:00 (${compact(peakHour.total)})` : '—',
      sub: peakHour && peakHour.total > 0 ? `${formatNum(peakHour.count)} فاتورة` : 'لم تتحدد بعد',
      to: '/reports?app=peak-hours',
    },
    {
      label: 'القطع المباعة اليوم',
      value: `${formatNum(unitsSold)} قطعة`,
      sub: `${formatNum(uniqueSold)} صنف مختلف`,
      to: '/reports?app=sales',
    },
    {
      label: 'أكبر فاتورة حديثة',
      value: largestReceipt ? `${formatNum(largestReceipt.amount)} IQD` : '—',
      sub: largestReceipt ? `فاتورة #${largestReceipt.number}` : 'لا فواتير',
      to: largestReceipt ? `/receipts?search=${encodeURIComponent(largestReceipt.number)}` : '/receipts',
    },
    {
      label: 'العروض والخصومات',
      value: `${formatNum(activeOffers)} عرض مفعّل`,
      sub: discountsRecent > 0 ? `خصم حديث ${compact(discountsRecent)} IQD` : 'خصومات تلقائية على الكاشير',
      to: '/offers',
    },
    {
      label: 'النسخ الاحتياطي',
      value: lastBackupAt ? timeAgo(lastBackupAt) : 'أنشئ نسخة الآن',
      sub: storedBackupsCount ? `${formatNum(storedBackupsCount)} نسخة في الخزنة` : 'حفظ ورفع شامل (.fotbackup)',
      to: '/backups',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      {pills.map(p => (
        <Link
          key={p.label}
          to={p.to}
          className="group flex items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 transition hover:border-brand-300 hover:shadow-[var(--shadow-lift)]"
        >
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-slate-400">{p.label}</p>
            <p className="mt-0.5 truncate text-[14px] font-bold text-header num group-hover:text-brand-700">{p.value}</p>
            <p className="truncate text-[10.5px] text-slate-500">{p.sub}</p>
          </div>
          <span className="shrink-0 text-[11px] font-semibold text-slate-300 transition group-hover:text-brand-600">←</span>
        </Link>
      ))}
    </div>
  );
}

/* ── رادار المخزون والنواقص ── */
export function InventoryRadarCard({
  reorder,
  loading,
}: {
  reorder: ReorderReportDto | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  if (!reorder) {
    return <EmptyState compact title="لا بيانات مخزون حالياً" />;
  }
  const critical = (reorder.rows ?? []).slice(0, 5);
  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-3 gap-2">
        <Link to="/reports?app=reorder" className="rounded-lg bg-red-50 px-3 py-2 transition hover:bg-red-100/70">
          <p className="text-[11px] text-red-800/80">نافد تماماً</p>
          <p className="text-[17px] font-bold text-red-700 num">{formatNum(reorder.outOfStock)}</p>
        </Link>
        <Link to="/reports?app=reorder" className="rounded-lg bg-amber-50 px-3 py-2 transition hover:bg-amber-100/70">
          <p className="text-[11px] text-amber-800/80">يكفي أقل من أسبوع</p>
          <p className="text-[17px] font-bold text-amber-800 num">{formatNum(reorder.underWeek)}</p>
        </Link>
        <Link to="/reports?app=slow-movers" className="rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100">
          <p className="text-[11px] text-slate-500">إجمالي الحرج</p>
          <p className="text-[17px] font-bold text-header num">{formatNum(reorder.total)}</p>
        </Link>
      </div>
      {critical.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {critical.map(r => {
            const out = r.stock <= 0;
            return (
              <li key={r.articleId} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800" title={r.name ?? ''}>{r.name || r.barcode || `#${r.articleId}`}</p>
                  <p className="text-[10.5px] text-slate-400 num">
                    معدل السحب {formatNum(r.dailyRate, 1)}/يوم · مباع {formatNum(r.soldQty)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold num ${out ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                  {out ? `رصيد ${formatNum(r.stock)}` : `يكفي ${formatNum(r.coverDays, 0)} يوم`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-center text-[11.5px] text-emerald-700">✓ كل الأصناف السريعة متوفرة بمخزون كافٍ</p>
      )}
    </div>
  );
}

/* ── رقابة الحذف والإلغاء اليوم ── */
export function CashierVoidsCard({
  voids,
  loading,
}: {
  voids: CashierVoidReportDto | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  const deletedLines = voids?.deletedLines ?? 0;
  const cancelledInvoices = voids?.cancelledInvoices ?? 0;
  const deletedAmount = voids?.deletedAmount ?? 0;
  const cancelledAmount = voids?.cancelledAmount ?? 0;
  const cashiers = (voids?.cashiers ?? []).filter(c => c.deletedLines > 0 || c.cancelledInvoices > 0).slice(0, 4);

  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-lg px-3 py-2 ${deletedLines > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
          <p className="text-[11px] text-slate-500">بنود محذوفة اليوم</p>
          <p className="text-[16px] font-bold text-header num">{formatNum(deletedLines)}</p>
          <p className="text-[10.5px] text-slate-500 num">{formatNum(deletedAmount)} IQD</p>
        </div>
        <div className={`rounded-lg px-3 py-2 ${cancelledInvoices > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
          <p className="text-[11px] text-slate-500">فواتير ملغاة اليوم</p>
          <p className={`text-[16px] font-bold num ${cancelledInvoices > 0 ? 'text-red-700' : 'text-header'}`}>{formatNum(cancelledInvoices)}</p>
          <p className="text-[10.5px] text-slate-500 num">{formatNum(cancelledAmount)} IQD</p>
        </div>
      </div>
      {cashiers.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {cashiers.map(c => (
            <li key={c.cashierId} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
              <span className="truncate font-semibold text-slate-700">{c.cashierName || `كاشير #${c.cashierId}`}</span>
              <span className="shrink-0 text-[11px] text-slate-500 num">
                حذف <b className="text-amber-800">{formatNum(c.deletedLines)}</b> · إلغاء <b className="text-red-700">{formatNum(c.cancelledInvoices)}</b>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-center text-[11.5px] text-emerald-700">✓ لا عمليات حذف أو إلغاء مسجّلة اليوم</p>
      )}
    </div>
  );
}

/* ── سجل حركات الكاشير الحية ── */
export function CashierActivityFeed({
  rows,
  loading,
}: {
  rows: CashierActivityDto[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
      </div>
    );
  }
  if (!rows.length) return <EmptyState compact title="لا حركات مسجّلة اليوم بعد" />;
  return (
    <ul className="max-h-[220px] divide-y divide-slate-100 overflow-y-auto px-4 pb-3">
      {rows.map(a => (
        <li key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-slate-800">{a.cashierName || 'كاشير'}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-slate-600">{a.eventLabel || a.eventType}</span>
            {a.posPath && <span className="ms-1.5 text-[11px] text-slate-400">({prettyPos(a.posPath)})</span>}
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── أداء الكاشير ── */
export function CashierPerformanceCard({
  rows,
  loading,
}: {
  rows: CashierPerformanceRowDto[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  const active = rows.filter(r => r.receiptCount > 0 || r.netSales > 0);
  if (!active.length) return <EmptyState compact title="لا مبيعات كاشير مسجّلة في هذا اليوم" />;
  const max = Math.max(1, ...active.map(r => r.netSales));
  return (
    <ul className="space-y-2.5 px-4 pb-4">
      {active.slice(0, 5).map(c => {
        const avg = c.receiptCount > 0 ? Math.round(c.netSales / c.receiptCount) : 0;
        const cardPct = c.netSales > 0 ? Math.round((c.cardTotal / c.netSales) * 100) : 0;
        return (
          <li key={c.cashierId} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate font-bold text-slate-800">
                {c.name || `كاشير #${c.cashierId}`}
                {c.sectionName && <span className="ms-1.5 text-[11px] font-normal text-slate-400">({c.sectionName})</span>}
              </span>
              <span className="shrink-0 font-bold text-header num">
                {formatNum(c.netSales)} <span className="text-[10px] font-normal text-slate-400">IQD</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(Math.max(0, c.netSales) / max) * 100}%` }} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-500 num">
              <span>{formatNum(c.receiptCount)} فاتورة</span>
              <span>متوسط {compact(avg)}</span>
              {cardPct > 0 && <span className="text-sky-700">بطاقة {cardPct}%</span>}
              {c.returnsCount > 0 && <span className="text-red-600">مرتجع {formatNum(c.returnsCount)}</span>}
              {c.manualDiscount > 0 && <span className="text-amber-700">خصم يدوي {compact(c.manualDiscount)}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── نظرة عامة على العروض وتقارير العروض المنتهية ── */
export function OffersOverviewCard({
  activeOffers,
  inactiveOffers,
  discountedItems,
  closures,
}: {
  activeOffers: number;
  inactiveOffers: number;
  discountedItems: number;
  closures: OfferSalesClosureDto[];
}) {
  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-3 gap-2">
        <Link to="/offers" className="rounded-lg bg-violet-50 px-3 py-2 transition hover:bg-violet-100/70">
          <p className="text-[11px] text-violet-800/80">عروض مفعّلة</p>
          <p className="text-[17px] font-bold text-violet-900 num">{formatNum(activeOffers)}</p>
        </Link>
        <Link to="/offers" className="rounded-lg bg-emerald-50 px-3 py-2 transition hover:bg-emerald-100/70">
          <p className="text-[11px] text-emerald-800/80">أصناف مخفّضة</p>
          <p className="text-[17px] font-bold text-emerald-800 num">{formatNum(discountedItems)}</p>
        </Link>
        <Link to="/offers" className="rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100">
          <p className="text-[11px] text-slate-500">متوقفة</p>
          <p className="text-[17px] font-bold text-header num">{formatNum(inactiveOffers)}</p>
        </Link>
      </div>
      {closures.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-400">آخر تقارير العروض المنتهية</p>
          <ul className="divide-y divide-slate-100">
            {closures.slice(0, 3).map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                <Link to="/reports?app=offer-sales" className="min-w-0 flex-1 truncate font-semibold text-slate-700 hover:text-brand-700">
                  {c.offerName}
                </Link>
                <span className="shrink-0 text-[11px] text-slate-500 num">
                  <b className="text-header">{compact(c.totalAmount)}</b> · {formatNum(c.totalQuantity)} قطعة
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-center text-[11.5px] text-slate-400">تُحفظ تقارير مبيعات العروض تلقائياً عند انتهاء مدتها</p>
      )}
    </div>
  );
}

/* ── المواد الراكدة والمخزون المجمّد ── */
export function SlowMoversCard({
  report,
  loading,
}: {
  report: SlowMoverReportDto | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  if (!report) return <EmptyState compact title="لا بيانات مواد راكدة" />;
  const top = (report.rows ?? []).slice(0, 4);
  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-3 gap-2">
        <Link to="/reports?app=slow-movers" className="rounded-lg bg-orange-50 px-3 py-2 transition hover:bg-orange-100/70">
          <p className="text-[11px] text-orange-800/80">راكد (60+ يوم)</p>
          <p className="text-[17px] font-bold text-orange-800 num">{formatNum(report.totalCount)}</p>
        </Link>
        <Link to="/reports?app=slow-movers" className="rounded-lg bg-amber-50 px-3 py-2 transition hover:bg-amber-100/70">
          <p className="text-[11px] text-amber-800/80">قيمة مجمّدة</p>
          <p className="text-[17px] font-bold text-amber-900 num">{compact(report.totalValue)}</p>
        </Link>
        <Link to="/reports?app=slow-movers" className="rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100">
          <p className="text-[11px] text-slate-500">لم تُبع أبداً</p>
          <p className="text-[17px] font-bold text-header num">{formatNum(report.neverSoldCount)}</p>
        </Link>
      </div>
      {top.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {top.map(r => (
            <li key={r.articleId} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-800" title={r.name ?? ''}>{r.name || r.barcode || `#${r.articleId}`}</p>
                <p className="text-[10.5px] text-slate-400 num">
                  رصيد {formatNum(r.stock)} · {r.lastSaleDate ? `آخر بيع ${r.lastSaleDate.slice(0, 10)}` : 'لم يُبع من قبل'}
                </p>
              </div>
              <span className="shrink-0 font-bold text-orange-800 num">{compact(r.stockValue)} IQD</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-center text-[11.5px] text-emerald-700">✓ لا توجد أصناف راكدة منذ 60 يوماً</p>
      )}
    </div>
  );
}

/* ── بطاقة إجراء مزامنة مضغوطة ── */
export function SyncTile({
  icon,
  title,
  detail,
  statusTone,
  statusText,
  actionLabel,
  loading,
  disabled,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  statusTone: Tone;
  statusText: string;
  actionLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className="icon-tile h-10 w-10 rounded-xl bg-slate-900 text-white">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[13px] font-bold text-header">{title}</p>
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[statusTone]}`} />
            {statusText}
          </span>
        </div>
        <p className="truncate text-[11.5px] text-slate-500">{detail}</p>
      </div>
      <Btn size="sm" variant="primary" loading={loading} disabled={disabled} onClick={onAction} className="shrink-0">
        {actionLabel}
      </Btn>
    </div>
  );
}

/* ── تقدم قواعد الأهداف النشطة ── */
export function ActiveTargetsOverviewCard({
  rules,
  loading,
}: {
  rules: TargetBreakdownDto[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (!rules.length) {
    return <EmptyState compact title="لا توجد قواعد أهداف منشأة بعد" />;
  }
  return (
    <ul className="space-y-2.5 px-4 pb-4">
      {rules.slice(0, 5).map(b => {
        const assigned = b.salesmen.filter(s => s.weeklyTarget > 0);
        const avgPct = assigned.length
          ? Math.round(assigned.reduce((n, s) => n + Math.min(150, s.weeklyPercent), 0) / assigned.length)
          : 0;
        const onTrack = assigned.filter(s => s.weeklyPercent >= 70).length;
        const isAmount = b.targetType === 'amount';
        return (
          <li key={b.ruleId} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <Link to={`/targets?id=${b.ruleId}`} className="truncate font-bold text-slate-800 hover:text-brand-700">
                {b.ruleName}
              </Link>
              <span className={`shrink-0 font-bold num ${avgPct >= 80 ? 'text-emerald-700' : avgPct >= 50 ? 'text-amber-700' : 'text-red-600'}`}>
                {formatNum(avgPct)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className={`h-full rounded-full ${avgPct >= 80 ? 'bg-emerald-500' : avgPct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(100, avgPct)}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-500 num">
              <span>
                المتحقق:{' '}
                <b className="text-header">
                  {isAmount ? `${compact(b.totalAmount ?? 0)} IQD` : `${formatNum(b.totalQuantity)} قطعة`}
                </b>
              </span>
              <span>
                {formatNum(onTrack)}/{formatNum(assigned.length)} بائع على المسار
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── طابور الفواتير غير المرحّلة وسجل أخطاء الترحيل ── */
export function UnsyncedQueueCard({
  unsynced,
  failedLogs,
  onSelectReceipt,
}: {
  unsynced: ReceiptSummary[];
  failedLogs: EdariSyncLogDto[];
  onSelectReceipt?: (r: ReceiptSummary) => void;
}) {
  if (unsynced.length === 0 && failedLogs.length === 0) {
    return (
      <EmptyState
        compact
        icon={<IconCheckCircle size={18} />}
        title="جميع الفواتير مرحّلة إلى الإداري"
        description="لا توجد فواتير معلّقة في طابور الترحيل ولا أخطاء مسجّلة."
      />
    );
  }
  return (
    <div className="space-y-2.5 px-4 pb-4">
      {failedLogs.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/70 p-2.5">
          <p className="text-[11px] font-bold text-red-800">آخر أخطاء الترحيل ({formatNum(failedLogs.length)})</p>
          <ul className="mt-1 space-y-1 text-[11.5px] text-red-700">
            {failedLogs.map(l => (
              <li key={l.id} className="truncate" title={l.errorMessage || l.status}>
                • {l.errorMessage || l.status}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unsynced.length > 0 && (
        <ul className="max-h-[200px] divide-y divide-slate-100 overflow-y-auto">
          {unsynced.slice(0, 8).map(r => (
            <li
              key={r.id}
              onClick={onSelectReceipt ? () => onSelectReceipt(r) : undefined}
              className={`flex items-center justify-between gap-2 py-1.5 text-[12px] ${onSelectReceipt ? 'cursor-pointer hover:bg-slate-50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <span className="font-bold text-slate-800 num">#{receiptDisplayNumber(r)}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="text-slate-600">{r.cashierName || prettyPos(r.posName, r.sectionName)}</span>
              </div>
              <span className="shrink-0 font-bold text-header num">{formatNum(r.totalAmount)}</span>
              <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(r.creationDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

