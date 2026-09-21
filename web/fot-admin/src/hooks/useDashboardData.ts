import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, daysAgoIso, todayIso } from '@/api/client';
import type { PosTerminalMonitorDto } from '@/api/types';
import { fillDaily, bestDay, weekProgress, healthScore, salesPace, healthBreakdown, mergeSalesmenWithSales } from '@/components/dashboard/dashboardUtils';
import { fixEdariName } from '@/lib/text';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useToast } from '@/components/Toast';

export type DashboardTab = 'sales' | 'team' | 'system' | 'reports';

/** Safety-net interval while the hub is connected (pushes drive freshness). */
const CONNECTED_SAFETY_MS = 300_000;

export function useDashboardData() {
  const qc = useQueryClient();
  const toast = useToast();
  const hubConnected = useSyncStatus();
  // Fast polling only when the hub is down; slow safety refresh otherwise.
  const poll = (downMs: number) => (hubConnected ? CONNECTED_SAFETY_MS : downMs);

  const today = todayIso();
  const yesterday = daysAgoIso(1);
  const { settings: periodSettings, periods } = useBusinessPeriod();
  const weekPeriod = periods.currentWeek;
  const prevWeekPeriod = periods.previousWeek;
  const monthPeriod = periods.currentMonth;

  const statsQ = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: api.dashboardStats,
    staleTime: 60_000,
    refetchInterval: poll(60_000),
    placeholderData: prev => prev,
  });

  const edariStatusQ = useQuery({
    queryKey: ['edari-status'],
    queryFn: api.edariStatus,
    staleTime: 15_000,
    refetchInterval: poll(20_000),
  });

  const cashQ = useQuery({
    queryKey: ['cash-today', today],
    queryFn: () => api.cashReport(today, today),
    staleTime: 20_000,
    refetchInterval: poll(40_000),
    placeholderData: prev => prev,
  });

  const yesterdayQ = useQuery({
    queryKey: ['cash-yesterday', yesterday],
    queryFn: () => api.cashReport(yesterday, yesterday),
    staleTime: 120_000,
  });

  const weekQ = useQuery({
    queryKey: ['daily-sales-week', weekPeriod.from, weekPeriod.to, prevWeekPeriod.from, prevWeekPeriod.to],
    queryFn: () => api.dailySales(prevWeekPeriod.from, weekPeriod.to),
    staleTime: 60_000,
    refetchInterval: poll(60_000),
  });

  const recentQ = useQuery({
    queryKey: ['recent-receipts'],
    queryFn: () => api.recentReceipts(12),
    staleTime: 20_000,
    refetchInterval: poll(30_000),
  });

  const terminalsQ = useQuery({
    queryKey: ['terminal-monitor'],
    queryFn: api.terminalMonitor,
    staleTime: 20_000,
    refetchInterval: poll(30_000),
  });

  const holdsQ = useQuery({
    queryKey: ['hold-receipts'],
    queryFn: () => api.holdReceipts(),
    staleTime: 20_000,
    refetchInterval: poll(30_000),
  });

  const salesmenQ = useQuery({
    queryKey: ['salesman-today', today],
    queryFn: () => api.salesBySalesman(today, today),
    staleTime: 45_000,
    refetchInterval: poll(45_000),
  });

  const movementQ = useQuery({
    queryKey: ['report-movement', today, today, ''],
    queryFn: () => api.movement(today, today),
    staleTime: 45_000,
    refetchInterval: poll(60_000),
  });

  const targetsQ = useQuery({
    queryKey: ['target-breakdowns', weekPeriod.from, weekPeriod.to],
    queryFn: () => api.targetBreakdowns(weekPeriod.from, weekPeriod.to),
    staleTime: 90_000,
  });

  // Lightweight counts instead of pulling a full page of offers just for badges.
  const offersStatsQ = useQuery({
    queryKey: ['offers-stats'],
    queryFn: api.offersStats,
    staleTime: 120_000,
  });

  const commWeekQ = useQuery({
    queryKey: ['commission-summary', weekPeriod.from, weekPeriod.to],
    queryFn: () => api.commissionSummary(weekPeriod.from, weekPeriod.to),
    staleTime: 90_000,
    refetchInterval: poll(120_000),
  });

  const weekSalesmenQ = useQuery({
    queryKey: ['salesman-week', weekPeriod.from, weekPeriod.to],
    queryFn: () => api.salesBySalesman(weekPeriod.from, weekPeriod.to),
    staleTime: 90_000,
  });

  // Full salesman catalog (up to 500 rows) — refreshed by CatalogUpdated pushes,
  // not by the clock; slow safety only while the hub is down.
  const catalogSalesmenQ = useQuery({
    queryKey: ['salesmen'],
    queryFn: () => api.salesmen(),
    staleTime: 600_000,
    refetchInterval: hubConnected ? false : 120_000,
  });

  const s = statsQ.data;
  const edari = edariStatusQ.data;
  const unsynced = edari?.unsyncedCount ?? 0;
  const failed = edari?.failedCount ?? 0;
  const holdCount = holdsQ.isError ? 0 : (holdsQ.data?.length ?? 0);

  const unsyncedQ = useQuery({
    queryKey: ['edari-unsynced'],
    queryFn: api.edariUnsynced,
    enabled: unsynced > 0,
    staleTime: 20_000,
  });

  const failedLogsQ = useQuery({
    queryKey: ['edari-logs'],
    queryFn: api.edariLogs,
    enabled: failed > 0,
    staleTime: 30_000,
  });

  const syncReceipts = useMutation({
    mutationFn: () => api.syncEdariReceipts(true, 50),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      qc.invalidateQueries({ queryKey: ['edari-unsynced'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل ترحيل الفواتير'),
  });

  const loading = statsQ.isLoading && !s;
  const sales = cashQ.data?.totalSales ?? 0;
  const receipts = cashQ.data?.receiptCount ?? 0;
  const average = cashQ.data?.averageTicket ?? 0;
  const paid = cashQ.data?.totalPayment ?? 0;
  const cashBack = cashQ.data?.totalCashBack ?? 0;
  const ySales = yesterdayQ.data?.totalSales ?? 0;
  const yReceipts = yesterdayQ.data?.receiptCount ?? 0;

  const weekDays = useMemo(
    () => fillDaily(weekQ.data, weekPeriod.from, weekPeriod.to),
    [weekQ.data, weekPeriod.from, weekPeriod.to],
  );
  const prevDays = useMemo(
    () => fillDaily(weekQ.data, prevWeekPeriod.from, prevWeekPeriod.to),
    [weekQ.data, prevWeekPeriod.from, prevWeekPeriod.to],
  );
  const weekTotal = weekDays.reduce((n, d) => n + d.total, 0);
  const prevWeekTotal = prevDays.reduce((n, d) => n + d.total, 0);
  const weekReceipts = weekDays.reduce((n, d) => n + (d.receiptCount ?? 0), 0);
  const weekProgressInfo = weekProgress(weekPeriod.from, weekPeriod.to, today);
  const bestWeekDay = bestDay(weekDays);
  const returnRate = sales > 0 ? (cashBack / sales) * 100 : 0;

  const terminals = useMemo(() => {
    const list: PosTerminalMonitorDto[] = [];
    for (const g of terminalsQ.data ?? []) {
      for (const t of g.terminals) list.push(t);
    }
    return list.sort((a, b) => Number(b.isOnline || b.active) - Number(a.isOnline || a.active));
  }, [terminalsQ.data]);

  const onlineTerminals = terminals.filter(t => t.isOnline || t.active).length;

  const catalogSalesmen = catalogSalesmenQ.data?.items ?? [];

  const topSalesmen = useMemo(
    () => mergeSalesmenWithSales(catalogSalesmen, salesmenQ.data ?? []),
    [catalogSalesmen, salesmenQ.data],
  );

  const topProducts = useMemo(
    () => [...(movementQ.data ?? [])].sort((a, b) => b.soldAmount - a.soldAmount).slice(0, 5),
    [movementQ.data],
  );

  const commWeek = commWeekQ.data ?? [];
  const weekCommission = commWeek.reduce((n, c) => n + c.totalCommission, 0);
  const commDue = commWeek.reduce((n, c) => n + Math.max(0, c.balanceDue), 0);
  const commDueCount = commWeek.filter(c => c.balanceDue > 0).length;
  const topCommDue = useMemo(
    () => [...commWeek].filter(c => c.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue).slice(0, 4),
    [commWeek],
  );

  const atRiskTargets = useMemo(() => {
    const rows = (targetsQ.data ?? []).flatMap(b =>
      b.salesmen
        .filter(m => m.weeklyTarget > 0)
        .map(m => ({
          key: `${b.ruleId}-${m.salesmanId}`,
          salesmanId: m.salesmanId,
          ruleId: b.ruleId,
          name: fixEdariName(m.salesmanName) || `بائع #${m.salesmanId}`,
          pct: m.weeklyPercent,
        })),
    );
    return rows.filter(r => r.pct < 70).sort((a, b) => a.pct - b.pct).slice(0, 4);
  }, [targetsQ.data]);

  const atRiskCount = useMemo(() => {
    let n = 0;
    for (const b of targetsQ.data ?? []) {
      for (const m of b.salesmen) {
        if (m.weeklyTarget > 0 && m.weeklyPercent < 70) n += 1;
      }
    }
    return n;
  }, [targetsQ.data]);

  const onTrackCount = useMemo(() => {
    let n = 0;
    for (const b of targetsQ.data ?? []) {
      for (const m of b.salesmen) {
        if (m.weeklyTarget > 0 && m.weeklyPercent >= 70) n += 1;
      }
    }
    return n;
  }, [targetsQ.data]);

  const weekTopSalesmen = useMemo(
    () => mergeSalesmenWithSales(catalogSalesmen, weekSalesmenQ.data ?? []),
    [catalogSalesmen, weekSalesmenQ.data],
  );

  const activeOffers = offersStatsQ.data?.enabled ?? 0;
  const inactiveOffers = offersStatsQ.data?.disabled ?? 0;
  const totalOffers = offersStatsQ.data?.total ?? 0;

  const failedLogs = useMemo(
    () => (failedLogsQ.data ?? []).filter(l => /fail|error|فشل/i.test(l.status || l.errorMessage || '')).slice(0, 3),
    [failedLogsQ.data],
  );

  const updatedAt = cashQ.dataUpdatedAt
    ? new Date(cashQ.dataUpdatedAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
    : null;

  const firstRun = !loading && sales === 0 && receipts === 0 && (s?.localProducts ?? 0) === 0;
  const attentionTotal = holdCount + unsynced + failed;
  const hasTeamActivity = catalogSalesmen.length > 0 || commDue > 0 || weekCommission > 0 || atRiskCount > 0 || totalOffers > 0;

  const pace = salesPace(sales, ySales);
  const health = healthScore({
    edariConnected: !!s?.edariConnected,
    onlineTerminals,
    terminalCount: terminals.length,
    attentionTotal,
    sales,
    ySales,
  });

  const healthItems = healthBreakdown({
    edariConnected: !!s?.edariConnected,
    onlineTerminals,
    terminalCount: terminals.length,
    attentionTotal,
    sales,
    ySales,
  });

  const kindCounts = useMemo(() => {
    const list = recentQ.data ?? [];
    return {
      sale: list.filter(r => (r.kind ?? 0) === 0).length,
      return: list.filter(r => r.kind === 1).length,
      gift: list.filter(r => r.kind === 2).length,
    };
  }, [recentQ.data]);

  async function refetchAll() {
    await Promise.all([
      statsQ.refetch(),
      edariStatusQ.refetch(),
      cashQ.refetch(),
      yesterdayQ.refetch(),
      weekQ.refetch(),
      recentQ.refetch(),
      terminalsQ.refetch(),
      holdsQ.refetch(),
      salesmenQ.refetch(),
      movementQ.refetch(),
      targetsQ.refetch(),
      offersStatsQ.refetch(),
      commWeekQ.refetch(),
      weekSalesmenQ.refetch(),
      catalogSalesmenQ.refetch(),
    ]);
  }

  const isRefreshing =
    statsQ.isFetching ||
    cashQ.isFetching ||
    recentQ.isFetching ||
    weekQ.isFetching;

  return {
    today,
    periodSettings,
    weekPeriod,
    monthPeriod,
    statsQ,
    recentQ,
    holdsQ,
    terminalsQ,
    s,
    edari,
    loading,
    sales,
    receipts,
    average,
    paid,
    cashBack,
    ySales,
    yReceipts,
    weekDays,
    weekTotal,
    prevWeekTotal,
    prevDays,
    weekReceipts,
    weekProgressInfo,
    bestWeekDay,
    returnRate,
    pace,
    health,
    healthItems,
    kindCounts,
    terminals,
    onlineTerminals,
    topSalesmen,
    topProducts,
    commDue,
    commDueCount,
    weekCommission,
    atRiskCount,
    onTrackCount,
    weekTopSalesmen,
    catalogSalesmen,
    activeOffers,
    inactiveOffers,
    topCommDue,
    atRiskTargets,
    holdCount,
    unsynced,
    failed,
    unsyncedReceipts: unsyncedQ.data ?? [],
    failedLogs,
    syncReceipts,
    updatedAt,
    firstRun,
    attentionTotal,
    hasTeamActivity,
    refetchAll,
    isRefreshing,
  };
}
