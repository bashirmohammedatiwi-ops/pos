import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, deltaPct, setMe, type Dashboard, type LineRow, type WeekSummary } from './api';
import { useWeek } from './week';

const CACHE_KEY = 'fot_manager_cache';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as {
      weekStart?: string;
      dash: Dashboard | null;
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
  weeks: WeekSummary[];
  lines: LineRow[];
  err: string;
  loading: boolean;
  updatedAt: number | null;
  reload: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function ManagerProvider({ children }: { children: ReactNode }) {
  const { weekStart, setWeek } = useWeek();
  const seed = useMemo(() => readCache(), []);
  const [dash, setDash] = useState<Dashboard | null>(seed?.dash ?? null);
  const [weeks, setWeeks] = useState<WeekSummary[]>(seed?.weeks ?? []);
  const [lines, setLines] = useState<LineRow[]>(seed?.lines ?? []);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!seed?.dash);
  const [updatedAt, setUpdatedAt] = useState<number | null>(seed?.updatedAt ?? null);

  const reload = useCallback(async () => {
    setErr('');
    if (!seed?.dash) setLoading(true);
    try {
      const [d, w] = await Promise.all([api.dashboard(weekStart), api.weeks()]);
      let nextLines: LineRow[] = [];
      try {
        nextLines = (await api.lines(weekStart)).lines;
      } catch {
        nextLines = [];
      }
      const now = Date.now();
      setDash(d);
      setWeeks(w);
      setLines(nextLines);
      setMe(d.manager);
      setUpdatedAt(now);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          weekStart, dash: d, weeks: w, lines: nextLines, updatedAt: now,
        }));
      } catch { /* ignore quota */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  }, [weekStart, seed?.dash]);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<Store>(() => ({
    weekStart, setWeek, dash, weeks, lines, err, loading, updatedAt, reload,
  }), [weekStart, setWeek, dash, weeks, lines, err, loading, updatedAt, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useManager');
  return ctx;
}

export function useWeekCompare(weeks: WeekSummary[], weekStart?: string) {
  return useMemo(() => {
    if (!weeks.length) return { cur: undefined as WeekSummary | undefined, prev: undefined as WeekSummary | undefined, salesDelta: 0, commDelta: 0 };
    const key = weekStart || weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
    const idx = weeks.findIndex(w => w.weekStart.slice(0, 10) === key || w.weekStart === weekStart);
    const cur = idx >= 0 ? weeks[idx] : weeks[0];
    const prev = idx >= 0 ? weeks[idx + 1] : undefined;
    return {
      cur,
      prev,
      salesDelta: prev ? deltaPct(cur.salesAmount, prev.salesAmount) : 0,
      commDelta: prev ? deltaPct(cur.commissionAmount, prev.commissionAmount) : 0,
    };
  }, [weeks, weekStart]);
}
