import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, attachLiveGoals, deltaPct, liveGoals, setMe, type CashierRow, type Dashboard, type LineRow, type WeekSummary } from './api';

function normalizeDash(d: Dashboard): Dashboard {
  const goals = liveGoals(d.goals);
  return { ...d, goals, sellers: attachLiveGoals(d.sellers ?? [], goals) };
}
import { buildInsights, unifyCashiers } from './insights';
import { useWeek } from './week';

const CACHE_KEY = 'fot_manager_cache';

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
  dash: Dashboard | null;
  prevDash: Dashboard | null;
  weeks: WeekSummary[];
  lines: LineRow[];
  cashiers: CashierRow[];
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
  const [dash, setDash] = useState<Dashboard | null>(seed?.dash ?? null);
  const [prevDash, setPrevDash] = useState<Dashboard | null>(seed?.prevDash ?? null);
  const [weeks, setWeeks] = useState<WeekSummary[]>(seed?.weeks ?? []);
  const [lines, setLines] = useState<LineRow[]>(seed?.lines ?? []);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!seed?.dash);
  const [updatedAt, setUpdatedAt] = useState<number | null>(seed?.updatedAt ?? null);
  const [cached, setCached] = useState(!!seed?.dash);

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

  const value = useMemo<Store>(() => ({
    weekStart, setWeek, dash, prevDash, weeks, lines, cashiers, err, loading, updatedAt, cached, reload,
  }), [weekStart, setWeek, dash, prevDash, weeks, lines, cashiers, err, loading, updatedAt, cached, reload]);

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
  const { dash, lines, cashiers } = useManager();
  return useMemo(() => buildInsights(lines, dash, cashiers), [lines, dash, cashiers]);
}
