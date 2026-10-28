import { useQuery } from '@tanstack/react-query';
import { api, monthStartIso, todayIso } from '@/api/client';
import { useSyncStatus } from '@/hooks/useSyncStatus';

/** Shared badge/status queries — single source for sidebar, header, dashboard. */
export function useNavBadges() {
  const hubConnected = useSyncStatus();
  const monthFrom = monthStartIso();
  const today = todayIso();

  // While the hub is connected, pushes (ReceiptCreated / EdariUpdated) refresh
  // these queries; the interval is only a slow safety net. Fast polling when down.
  const poll = (downMs: number) => (hubConnected ? 300_000 : downMs);

  const holdsQ = useQuery({
    queryKey: ['hold-receipts'],
    queryFn: () => api.holdReceipts(),
    staleTime: 45_000,
    refetchInterval: poll(45_000),
  });

  const edariQ = useQuery({
    queryKey: ['edari-status'],
    queryFn: api.edariStatus,
    staleTime: 30_000,
    refetchInterval: poll(45_000),
  });

  const commQ = useQuery({
    queryKey: ['commission-summary', monthFrom, today],
    queryFn: () => api.commissionSummary(monthFrom, today),
    staleTime: 90_000,
    refetchInterval: poll(120_000),
  });

  const targetsQ = useQuery({
    queryKey: ['target-breakdowns', monthFrom, today],
    queryFn: () => api.targetBreakdowns(monthFrom, today),
    staleTime: 90_000,
    refetchInterval: poll(120_000),
  });

  const commList = Array.isArray(commQ.data) ? commQ.data : [];
  const commDue = {
    total: commList.reduce((n, c) => n + Math.max(0, c.balanceDue), 0),
    count: commList.filter(c => c.balanceDue > 0).length,
  };

  let atRiskCount = 0;
  const breakdownList = Array.isArray(targetsQ.data) ? targetsQ.data : [];
  for (const b of breakdownList) {
    for (const m of b.salesmen ?? []) {
      if (m.dailyTarget > 0 && m.dailyPercent < 70) atRiskCount += 1;
    }
  }

  return {
    holds: holdsQ.isError || !Array.isArray(holdsQ.data) ? 0 : holdsQ.data.length,
    unsynced: edariQ.data?.unsyncedCount ?? 0,
    failed: edariQ.data?.failedCount ?? 0,
    edariStatus: edariQ.data,
    commDue,
    atRiskCount,
    monthFrom,
    today,
  };
}
