import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, attachLiveGoals, deltaPct, liveGoals, setMe, todayKey, type CashierRow, type Dashboard, type LineRow, type SellerRow, type WeekSummary } from './api';
import { buildInsights, unifyCashiers } from './insights';
import {
  applyPeriodCommission, enrichSellerCommissions, filterLines, mergeScopedCashiers, mergeScopedSellers,
  officialPeriod, periodStats, resolveBounds, salesShareBase,
  type PeriodBounds, type PeriodKind, type PeriodStats,
} from './period';
import { useWeek } from './week';

const CACHE_KEY = 'fot_manager_cache_v3';
const LEGACY_CACHE_KEYS = ['fot_manager_cache', 'fot_manager_cache_v2'];
const PERIOD_KEY = 'fot_manager_period';
const PAY_KEY = 'fot_manager_pay';
const RANGE_KEY = 'fot_manager_range';

function normalizeDash(d: Dashboard): Dashboard {
  const goals = liveGoals(d.goals);
  return { ...d, goals, sellers: attachLiveGoals(d.sellers ?? [], goals) };
}

function readKind(key: string, fallback: PeriodKind): PeriodKind {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === 'today' || raw === 'yesterday' || raw === 'wtd' || raw === 'week' || raw === 'custom') return raw;
  } catch { /* ignore */ }
  return fallback;
}

function readRange() {
  try {
    const raw = sessionStorage.getItem(RANGE_KEY);
    if (!raw) return { from: todayKey(), to: todayKey() };
    const parsed = JSON.parse(raw) as { from?: string; to?: string };
    return { from: parsed.from || todayKey(), to: parsed.to || todayKey() };
  } catch {
    return { from: todayKey(), to: todayKey() };
  }
}

type CacheBlob = {
  weekStart?: string;
  dash: Dashboard | null;
  prevDash: Dashboard | null;
  weeks: WeekSummary[];
  lines: LineRow[];
  updatedAt: number | null;
};

function purgeCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
    for (const key of LEGACY_CACHE_KEYS) localStorage.removeItem(key);
  } catch { /* ignore */ }
}

function sanitizeCache(raw: unknown): CacheBlob | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<CacheBlob>;
  const dash = data.dash;
  const prevDash = data.prevDash;
  const validDash = !dash || (typeof dash === 'object' && Array.isArray(dash.sellers) && dash.week);
  const validPrev = !prevDash || (typeof prevDash === 'object' && Array.isArray(prevDash.sellers));
  if (!validDash || !validPrev) {
    return {
      weekStart: data.weekStart,
      dash: validDash ? dash ?? null : null,
      prevDash: validPrev ? prevDash ?? null : null,
      weeks: Array.isArray(data.weeks) ? data.weeks : [],
      lines: Array.isArray(data.lines) ? data.lines : [],
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : null,
    };
  }
  return {
    weekStart: data.weekStart,
    dash: dash ?? null,
    prevDash: prevDash ?? null,
    weeks: Array.isArray(data.weeks) ? data.weeks : [],
    lines: Array.isArray(data.lines) ? data.lines : [],
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : null,
  };
}

function readCache() {
  try {
    for (const key of [CACHE_KEY, ...LEGACY_CACHE_KEYS]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = sanitizeCache(JSON.parse(raw));
      if (key !== CACHE_KEY) {
        localStorage.removeItem(key);
        if (parsed) {
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(parsed)); } catch { /* ignore quota */ }
        }
      }
      return parsed;
    }
  } catch {
    purgeCache();
  }
  return null;
}

type Store = {
  weekStart?: string;
  setWeek: (w?: string) => void;
  periodKind: PeriodKind;
  setPeriodKind: (k: PeriodKind) => void;
  payKind: PeriodKind;
  setPayKind: (k: PeriodKind) => void;
  customFrom: string;
  customTo: string;
  setCustom: (from: string, to: string) => void;
  period: PeriodBounds;
  payPeriod: PeriodBounds;
  dash: Dashboard | null;
  prevDash: Dashboard | null;
  weeks: WeekSummary[];
  lines: LineRow[];
  scopedLines: LineRow[];
  payLines: LineRow[];
  cashiers: CashierRow[];
  scopedSellers: SellerRow[];
  scopedCashiers: CashierRow[];
  paySellers: SellerRow[];
  periodTotals: PeriodStats;
  payTotals: PeriodStats;
  shareBase: number;
  linesTruncated: boolean;
  err: string;
  loading: boolean;
  updatedAt: number | null;
  cached: boolean;
  reload: (quiet?: boolean) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function ManagerProvider({ children }: { children: ReactNode }) {
  const { weekStart, setWeek } = useWeek();
  const seed = useMemo(() => readCache(), []);
  const seedRange = useMemo(() => readRange(), []);
  const [dash, setDash] = useState<Dashboard | null>(seed?.dash ?? null);
  const [prevDash, setPrevDash] = useState<Dashboard | null>(seed?.prevDash ?? null);
  const [weeks, setWeeks] = useState<WeekSummary[]>(seed?.weeks ?? []);
  const [lines, setLines] = useState<LineRow[]>(seed?.lines ?? []);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!seed?.dash);
  const [updatedAt, setUpdatedAt] = useState<number | null>(seed?.updatedAt ?? null);
  const [cached, setCached] = useState(!!seed?.dash);
  const [periodKind, setPeriodKindState] = useState<PeriodKind>(() => readKind(PERIOD_KEY, 'today'));
  const [payKind, setPayKindState] = useState<PeriodKind>(() => readKind(PAY_KEY, 'wtd'));
  const [customFrom, setCustomFrom] = useState(seedRange.from);
  const [customTo, setCustomTo] = useState(seedRange.to);

  const setPeriodKind = useCallback((k: PeriodKind) => {
    setPeriodKindState(k);
    try { sessionStorage.setItem(PERIOD_KEY, k); } catch { /* ignore */ }
  }, []);
  const setPayKind = useCallback((k: PeriodKind) => {
    setPayKindState(k);
    try { sessionStorage.setItem(PAY_KEY, k); } catch { /* ignore */ }
  }, []);
  const setCustom = useCallback((from: string, to: string) => {
    const a = from.slice(0, 10);
    const b = to.slice(0, 10);
    setCustomFrom(a);
    setCustomTo(b);
    try { sessionStorage.setItem(RANGE_KEY, JSON.stringify({ from: a, to: b })); } catch { /* ignore */ }
  }, []);

  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setErr('');
    if (!quiet && !seed?.dash) setLoading(true);
    try {
      const [rawDash, w] = await Promise.all([api.dashboard(weekStart), api.weeks()]);
      const d = normalizeDash(rawDash);
      let nextLines: LineRow[] = [];
      try {
        nextLines = (await api.lines(weekStart)).lines;
      } catch {
        nextLines = [];
      }
      const key = weekStart || w.find(x => x.isCurrent)?.weekStart.slice(0, 10);
      const idx = w.findIndex(x => x.weekStart.slice(0, 10) === key || x.weekStart === weekStart);
      const prevWeek = idx >= 0 ? w[idx + 1] : undefined;
      let prev: Dashboard | null = null;
      if (prevWeek) {
        try { prev = normalizeDash(await api.dashboard(prevWeek.weekStart.slice(0, 10))); }
        catch { prev = null; }
      }
      const now = Date.now();
      setDash(d);
      setPrevDash(prev);
      setWeeks(w);
      setLines(nextLines);
      setMe(d.manager);
      setUpdatedAt(now);
      setCached(false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          weekStart, dash: d, prevDash: prev, weeks: w, lines: nextLines, updatedAt: now,
        }));
      } catch { /* ignore quota */ }
    } catch (e) {
      if (!quiet || !seed?.dash) setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  }, [weekStart, seed?.dash]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const t = window.setInterval(() => void reload(true), 60000);
    return () => window.clearInterval(t);
  }, [reload]);

  const cashiers = useMemo(
    () => unifyCashiers(dash?.cashiers ?? [], dash?.malls ?? [], lines),
    [dash, lines],
  );

  const period = useMemo(
    () => resolveBounds(periodKind, dash?.week.weekStart, dash?.week.weekEnd, customFrom, customTo),
    [periodKind, dash, customFrom, customTo],
  );
  const payPeriod = useMemo(
    () => resolveBounds(payKind, dash?.week.weekStart, dash?.week.weekEnd, customFrom, customTo),
    [payKind, dash, customFrom, customTo],
  );

  const scopedLines = useMemo(() => filterLines(lines, period.from, period.to), [lines, period]);
  const payLines = useMemo(() => filterLines(lines, payPeriod.from, payPeriod.to), [lines, payPeriod]);

  const weekSales = dash?.week.salesAmount || 0;
  const roster = dash?.sellers ?? [];

  const scopedSellers = useMemo(() => {
    const base = mergeScopedSellers(scopedLines, roster, period, dash);
    const periodSales = base.reduce((s, r) => s + r.salesAmount, 0);
    return attachLiveGoals(
      enrichSellerCommissions(base, roster, {
        prorate: period.kind !== 'week',
        periodSales,
        weekSales,
      }),
      dash?.goals ?? [],
    );
  }, [roster, scopedLines, dash, period, weekSales]);
  const scopedCashiers = useMemo(
    () => mergeScopedCashiers(scopedLines, cashiers, period, dash),
    [cashiers, scopedLines, period, dash],
  );
  const paySellers = useMemo(() => {
    if (payPeriod.kind === 'week' && roster.some(s => s.commissionAmount > 0 || s.salesAmount > 0)) {
      return [...roster]
        .filter(s => s.commissionAmount > 0 || s.salesAmount > 0)
        .sort((a, b) => b.commissionAmount - a.commissionAmount || b.salesAmount - a.salesAmount);
    }
    const fromLines = sellersFromLines(payLines, roster);
    const paySales = fromLines.reduce((s, x) => s + x.salesAmount, 0);
    return enrichSellerCommissions(fromLines, roster, {
      prorate: payPeriod.kind !== 'week',
      periodSales: paySales,
      weekSales,
    }).filter(s => s.commissionAmount > 0 || s.salesAmount > 0);
  }, [payPeriod.kind, payLines, roster, weekSales]);

  const periodTotals = useMemo(() => {
    let stats: PeriodStats;
    if (period.kind === 'week' && dash) {
      const sales = dash.week.salesAmount || dash.sellers.reduce((s, x) => s + x.salesAmount, 0);
      stats = periodStats(scopedLines, {
        sales,
        receipts: dash.week.receiptCount,
        pieces: dash.week.pieceCount,
      });
    } else {
      stats = periodStats(scopedLines, officialPeriod(dash?.days, period.from, period.to));
    }
    return applyPeriodCommission(stats, dash, period);
  }, [period, dash, scopedLines]);

  const payTotals = useMemo(() => {
    const stats = periodStats(payLines, officialPeriod(dash?.days, payPeriod.from, payPeriod.to));
    return applyPeriodCommission(stats, dash, payPeriod);
  }, [payLines, dash, payPeriod]);

  const shareBase = useMemo(
    () => salesShareBase(periodTotals.sales, scopedSellers),
    [periodTotals.sales, scopedSellers],
  );

  const linesTruncated = lines.length >= 1200;

  const value = useMemo<Store>(() => ({
    weekStart, setWeek, periodKind, setPeriodKind, payKind, setPayKind, customFrom, customTo, setCustom,
    period, payPeriod, dash, prevDash, weeks, lines, scopedLines, payLines, cashiers, scopedSellers,
    scopedCashiers, paySellers, periodTotals, payTotals, shareBase, linesTruncated, err, loading, updatedAt, cached, reload,
  }), [
    weekStart, setWeek, periodKind, setPeriodKind, payKind, setPayKind, customFrom, customTo, setCustom,
    period, payPeriod, dash, prevDash, weeks, lines, scopedLines, payLines, cashiers, scopedSellers,
    scopedCashiers, paySellers, periodTotals, payTotals, shareBase, linesTruncated, err, loading, updatedAt, cached, reload,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useManager');
  return ctx;
}

export function useWeekCompare(weeks: WeekSummary[], weekStart?: string) {
  return useMemo(() => {
    if (!weeks.length) {
      return {
        cur: undefined as WeekSummary | undefined,
        prev: undefined as WeekSummary | undefined,
        salesDelta: 0, receiptDelta: 0,
      };
    }
    const key = weekStart || weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
    const idx = weeks.findIndex(w => w.weekStart.slice(0, 10) === key || w.weekStart === weekStart);
    const cur = idx >= 0 ? weeks[idx] : weeks[0];
    const prev = idx >= 0 ? weeks[idx + 1] : undefined;
    return {
      cur,
      prev,
      salesDelta: prev ? deltaPct(cur.salesAmount, prev.salesAmount) : 0,
      receiptDelta: prev ? deltaPct(cur.receiptCount, prev.receiptCount) : 0,
    };
  }, [weeks, weekStart]);
}

export function useShopInsights() {
  const { dash, scopedLines, scopedSellers, scopedCashiers } = useManager();
  return useMemo(
    () => buildInsights(scopedLines, dash ? { ...dash, sellers: scopedSellers } : null, scopedCashiers),
    [scopedLines, dash, scopedSellers, scopedCashiers],
  );
}
