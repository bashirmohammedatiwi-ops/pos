import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api, deltaPct, setSeller, type Dashboard, type GroupRow, type ProductRow, type WeekSummary,
} from './api';
import { useWeek } from './week';

type Store = {
  weekStart?: string;
  setWeek: (w?: string) => void;
  dash: Dashboard | null;
  weeks: WeekSummary[];
  groups: GroupRow[];
  products: ProductRow[];
  err: string;
  loading: boolean;
  reload: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function SellerProvider({ children }: { children: ReactNode }) {
  const { weekStart, setWeek } = useWeek();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const [d, w] = await Promise.all([api.dashboard(weekStart), api.weeks()]);
      setDash(d);
      setWeeks(w);
      setSeller(d.seller);
      api.groups().then(setGroups).catch(() => undefined);
      api.products().then(setProducts).catch(() => undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<Store>(() => ({
    weekStart, setWeek, dash, weeks, groups, products, err, loading, reload,
  }), [weekStart, setWeek, dash, weeks, groups, products, err, loading, reload]);

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
