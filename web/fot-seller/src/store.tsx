import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api, deltaPct, liveGoals, setSeller,
  type CommissionLine, type Dashboard, type WeekSummary,
} from './api';
import { scrubSellerPayload } from './privacy';
import { useWeek } from './week';

const CACHE_KEY = 'fot_seller_cache';

function remapDash(d: Dashboard | null): Dashboard | null {
  if (!d) return null;
  return { ...d, goals: liveGoals(d.goals) };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = scrubSellerPayload(JSON.parse(raw) as {
      weekStart?: string;
      dash: Dashboard | null;
      weeks: WeekSummary[];
      lines: CommissionLine[];
      updatedAt: number | null;
    });
    return { ...parsed, dash: remapDash(parsed.dash) };
  } catch {
    return null;
  }
}

type Store = {
  weekStart?: string;
  setWeek: (w?: string) => void;
  dash: Dashboard | null;
  weeks: WeekSummary[];
  lines: CommissionLine[];
  err: string;
  loading: boolean;
  updatedAt: number | null;
  reload: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function SellerProvider({ children }: { children: ReactNode }) {
  const { weekStart, setWeek } = useWeek();
  const seed = useMemo(() => readCache(), []);
  const [dash, setDash] = useState<Dashboard | null>(seed?.dash ?? null);
  const [weeks, setWeeks] = useState<WeekSummary[]>(seed?.weeks ?? []);
  const [lines, setLines] = useState<CommissionLine[]>(seed?.lines ?? []);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!seed?.dash);
  const [updatedAt, setUpdatedAt] = useState<number | null>(seed?.updatedAt ?? null);

  const reload = useCallback(async () => {
    setErr('');
    if (!seed?.dash) setLoading(true);
    try {
      const [d, w] = await Promise.all([api.dashboard(weekStart), api.weeks()]);
      let nextLines: CommissionLine[] = [];
      try {
        nextLines = (await api.commissionLines(weekStart)).lines;
      } catch {
        nextLines = [];
      }
      const now = Date.now();
      setDash(remapDash(d));
      setWeeks(w);
      setLines(nextLines);
      setSeller(d.seller);
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

export function useSeller() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSeller');
  return ctx;
}

export function useWeekCompare(weeks: WeekSummary[], weekStart?: string) {
  return useMemo(() => {
    if (!weeks.length) return { cur: undefined as WeekSummary | undefined, prev: undefined as WeekSummary | undefined, commDelta: 0 };
    const key = weekStart || weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
    const idx = weeks.findIndex(w => w.weekStart.slice(0, 10) === key || w.weekStart === weekStart);
    const cur = idx >= 0 ? weeks[idx] : weeks[0];
    const prev = idx >= 0 ? weeks[idx + 1] : undefined;
    return {
      cur,
      prev,
      commDelta: prev ? deltaPct(cur.commissionAmount, prev.commissionAmount) : 0,
    };
  }, [weeks, weekStart]);
}
