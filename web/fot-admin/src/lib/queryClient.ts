import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 120_000,
      gcTime: 10 * 60_000,
    },
  },
});

let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
const pendingKeys = new Set<string>();

function scheduleInvalidate(keys: string[]) {
  for (const key of keys) pendingKeys.add(key);
  if (invalidateTimer) return;
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    const batch = [...pendingKeys];
    pendingKeys.clear();
    for (const key of batch) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, 400);
}

export function invalidateReceiptLiveData() {
  scheduleInvalidate([
    'dashboard-stats',
    'recent-receipts',
    'receipts',
    'hold-receipts',
    'cash-today',
    'daily-sales-14',
    'salesman-today',
    'activity',
  ]);
}

export function invalidateLiveData() {
  scheduleInvalidate([
    'dashboard-stats',
    'recent-receipts',
    'receipts',
    'terminals',
    'terminal-monitor',
    'hold-receipts',
    'cash-today',
    'daily-sales-14',
    'salesman-today',
    'activity',
  ]);
}

export function invalidateCatalogData() {
  scheduleInvalidate([
    'products',
    'catalog-info',
    'offers',
    'offers-stats',
    'offer-scope',
    'offer-details-all',
    'groups',
    'salesmen',
    'commission-rules',
    'commission-groups',
    'commission-summary',
    'commission-profiles',
    'commission-calculations',
    'target-rules',
    'target-breakdowns',
    'target-progress',
    'sections-summary',
    'sections',
    'permissions',
    'cashiers',
    'print-settings',
    'pos-cashboxes',
    'credit-accounts-selected',
    'cashbox-accounts-edari',
  ]);
}

export function invalidateEdariLinkedData() {
  invalidateLiveData();
  invalidateCatalogData();
  scheduleInvalidate([
    'edari-settings',
    'edari-status',
    'edari-logs',
    'edari-unsynced',
    'edari-dead-letters',
    'credit-accounts-edari',
    'cashbox-accounts-edari',
  ]);
}

/**
 * Leaner invalidation for frequent Edari heartbeat pushes (dataChanged=true):
 * refreshes the Edari status surface and the salesmen list (what a pull actually
 * changes most often) without re-triggering the whole catalog/commission family —
 * the pull service broadcasts a full CatalogUpdated separately when articles changed.
 */
export function invalidateEdariStatusData() {
  scheduleInvalidate([
    'edari-status',
    'edari-logs',
    'edari-unsynced',
    'edari-dead-letters',
    'salesmen',
    'dashboard-stats',
  ]);
}

export function prefetchDashboard() {
  return import('@/api/client').then(({ api, todayIso }) =>
    Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['dashboard-stats'],
        queryFn: api.dashboardStats,
        staleTime: 60_000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['recent-receipts'],
        queryFn: () => api.recentReceipts(12),
        staleTime: 30_000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['cash-today', todayIso()],
        queryFn: () => api.cashReport(todayIso(), todayIso()),
        staleTime: 60_000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['hold-receipts'],
        queryFn: () => api.holdReceipts(),
        staleTime: 30_000,
      }),
    ]),
  );
}

export function prefetchCommonPages() {
  return import('@/api/client').then(({ api }) =>
    Promise.all([
      queryClient.prefetchQuery({ queryKey: ['offers'], queryFn: () => api.offers(), staleTime: 120_000 }),
      queryClient.prefetchQuery({ queryKey: ['products'], queryFn: () => api.products(1), staleTime: 120_000 }),
    ]),
  );
}

let warmupStarted = false;

/** One-shot warm-up after login — avoids duplicate storms from Auth + Layout. */
export function warmupAfterLogin() {
  if (warmupStarted) return;
  warmupStarted = true;
  void prefetchDashboard();
  void prefetchCommonPages();
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => {
      void import('@/lib/prefetchNav').then(m => m.prefetchNavPagesIdle());
    }, { timeout: 4000 });
  } else if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      void import('@/lib/prefetchNav').then(m => m.prefetchNavPagesIdle());
    }, 1500);
  }
}
