import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, attachLiveGoals, deltaPct, liveGoals, setMe, todayKey, type CashierRow, type Dashboard, type LineRow, type SellerRow, type WeekSummary } from './api';
import { buildInsights, unifyCashiers } from './insights';
import {
  cashiersFromLines, filterLines, officialPeriod, periodStats, resolveBounds, sellersFromLines,
  type PeriodBounds, type PeriodKind, type PeriodStats,
} from './period';
import { useWeek } from './week';

const CACHE_KEY = 'fot_manager_cache';
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

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as {
      weekStart?: string;
      dash: Dashboard | null;
      prevDash: Dashboard | null;
      weeks: WeekSummary[];
      lines: LineRow[];
      updatedAt: number | null;
    } : null;
  } catch {
    return null;
  }
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
    sessionStorage.setItem(PERIOD_KEY, k);
  }, []);
  const setPayKind = useCallback((k: PeriodKind) => {
    setPayKindState(k);
    sessionStorage.setItem(PAY_KEY, k);
  }, []);
  const setCustom = useCallback((from: string, to: string) => {
    const a = from.slice(0, 10);
    const b = to.slice(0, 10);
    setCustomFrom(a);
    setCustomTo(b);
    sessionStorage.setItem(RANGE_KEY, JSON.stringify({ from: a, to: b }));
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

  const useOfficialPeople = period.kind === 'week' && (dash?.sellers.some(s => s.salesAmount > 0) ?? false);
  const scopedSellers = useMemo(
    () => useOfficialPeople
      ? (dash?.sellers ?? [])
      : sellersFromLines(scopedLines, dash?.sellers ?? []),
    [useOfficialPeople, dash, scopedLines],
  );
  const scopedCashiers = useMemo(
    () => useOfficialPeople
      ? cashiers
      : cashiersFromLines(scopedLines, cashiers),
    [useOfficialPeople, cashiers, scopedLines],
  );
  const paySellers = useMemo(
    () => sellersFromLines(payLines, dash?.sellers ?? []).filter(s => s.commissionAmount > 0 || s.salesAmount > 0),
    [payLines, dash],
  );

  const periodTotals = useMemo(() => {
    if (period.kind === 'week' && dash) {
      const weekSales = dash.week.salesAmount || dash.sellers.reduce((s, x) => s + x.salesAmount, 0);
      return periodStats(scopedLines, {
        sales: weekSales,
        receipts: dash.week.receiptCount,
        pieces: dash.week.pieceCount,
      });
    }
    return periodStats(scopedLines, officialPeriod(dash?.days, period.from, period.to));
  }, [period, dash, scopedLines]);

  const payTotals = useMemo(
    () => periodStats(payLines, officialPeriod(dash?.days, payPeriod.from, payPeriod.to)),
    [payLines, dash, payPeriod],
  );

  const value = useMemo<Store>(() => ({
    weekStart, setWeek, periodKind, setPeriodKind, payKind, setPayKind, customFrom, customTo, setCustom,
    period, payPeriod, dash, prevDash, weeks, lines, scopedLines, payLines, cashiers, scopedSellers,
    scopedCashiers, paySellers, periodTotals, payTotals, err, loading, updatedAt, cached, reload,
  }), [
    weekStart, setWeek, periodKind, setPeriodKind, payKind, setPayKind, customFrom, customTo, setCustom,
    period, payPeriod, dash, prevDash, weeks, lines, scopedLines, payLines, cashiers, scopedSellers,
    scopedCashiers, paySellers, periodTotals, payTotals, err, loading, updatedAt, cached, reload,
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
