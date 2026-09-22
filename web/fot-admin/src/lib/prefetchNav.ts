import { queryClient } from '@/lib/queryClient';

/** Preload lazy route chunks on sidebar hover. */
const ROUTE_CHUNKS: Record<string, () => Promise<unknown>> = {
  '/products': () => import('@/pages/ProductsPage'),
  '/barcode-labels': () => import('@/pages/BarcodeLabelsPage'),
  '/offers': () => import('@/pages/OffersPage'),
  '/groups': () => import('@/pages/GroupsPage'),
  '/accounts': () => import('@/pages/AccountsPage'),
  '/receipts': () => import('@/pages/ReceiptsPage'),
  '/activity': () => import('@/pages/ActivityPage'),
  '/reports': () => import('@/pages/ReportsPage'),
  '/salesmen': () => import('@/pages/SalesmenPage'),
  '/portal-accounts': () => import('@/pages/PortalAccountsPage'),
  '/cashiers': () => import('@/pages/CashiersPage'),
  '/discount-qr': () => import('@/pages/DiscountQrPage'),
  '/price-checker': () => import('@/pages/PriceCheckerPage'),
  '/commissions': () => import('@/pages/CommissionsPage'),
  '/targets': () => import('@/pages/TargetsPage'),
  '/sections': () => import('@/pages/SectionsPage'),
  '/terminals': () => import('@/pages/TerminalsPage'),
  '/settings': () => import('@/pages/SettingsPage'),
  '/edari': () => import('@/pages/EdariPage'),
  '/': () => import('@/pages/DashboardPage'),
};

const prefetchedChunks = new Set<string>();
const prefetchedQueries = new Set<string>();

export function prefetchRouteChunk(path: string) {
  const key = path === '/' ? '/' : path.split('?')[0];
  const loader = ROUTE_CHUNKS[key];
  if (!loader || prefetchedChunks.has(key)) return;
  prefetchedChunks.add(key);
  void loader();
}

export async function prefetchRouteQueries(path: string) {
  const key = path.split('?')[0];
  if (prefetchedQueries.has(key)) return;
  prefetchedQueries.add(key);

  const { api, todayIso, monthStartIso, daysAgoIso } = await import('@/api/client');
  const today = todayIso();
  const monthFrom = monthStartIso();

  const tasks: Promise<unknown>[] = [];

  switch (key) {
    case '/products':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['products'], queryFn: () => api.products(1), staleTime: 120_000 }));
      break;
    case '/barcode-labels':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['print-settings'], queryFn: api.printSettings, staleTime: 120_000 }));
      break;
    case '/offers':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['offers'], queryFn: () => api.offers(), staleTime: 120_000 }));
      break;
    case '/groups':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['groups'], queryFn: api.groups, staleTime: 120_000 }));
      break;
    case '/accounts':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['credit-accounts-selected'], queryFn: api.creditAccountsSelected, staleTime: 120_000 }));
      break;
    case '/receipts':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['hold-receipts'], queryFn: () => api.holdReceipts(), staleTime: 30_000 }));
      break;
    case '/activity':
      tasks.push(queryClient.prefetchQuery({
        queryKey: ['activity', daysAgoIso(1), today, '', ''],
        queryFn: () => api.cashierActivity(daysAgoIso(1), today),
        staleTime: 60_000,
      }));
      break;
    case '/reports':
      tasks.push(queryClient.prefetchQuery({
        queryKey: ['cash-today', today],
        queryFn: () => api.cashReport(today, today),
        staleTime: 60_000,
      }));
      break;
    case '/salesmen':
      tasks.push(
        queryClient.prefetchQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen(), staleTime: 120_000 }),
        queryClient.prefetchQuery({
          queryKey: ['commission-summary', monthFrom, today],
          queryFn: () => api.commissionSummary(monthFrom, today),
          staleTime: 90_000,
        }),
      );
      break;
    case '/portal-accounts':
      tasks.push(
        queryClient.prefetchQuery({ queryKey: ['portal-sellers'], queryFn: api.portalSellers, staleTime: 60_000 }),
        queryClient.prefetchQuery({ queryKey: ['portal-managers'], queryFn: api.portalManagers, staleTime: 60_000 }),
      );
      break;
    case '/cashiers':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['cashiers'], queryFn: () => api.cashiers(), staleTime: 120_000 }));
      break;
    case '/discount-qr':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['discount-qr-people'], queryFn: api.discountQrPeople, staleTime: 60_000 }));
      break;
    case '/commissions':
      tasks.push(
        queryClient.prefetchQuery({ queryKey: ['commission-groups'], queryFn: api.commissionGroups, staleTime: 120_000 }),
        queryClient.prefetchQuery({ queryKey: ['commission-rules'], queryFn: api.commissionRules, staleTime: 120_000 }),
      );
      break;
    case '/targets':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['target-rules'], queryFn: api.targetRules, staleTime: 120_000 }));
      break;
    case '/sections':
      tasks.push(
        queryClient.prefetchQuery({ queryKey: ['sections-summary'], queryFn: () => api.sections(true), staleTime: 120_000 }),
        queryClient.prefetchQuery({ queryKey: ['edari-branches'], queryFn: api.edariBranches, staleTime: 120_000 }),
      );
      break;
    case '/terminals':
      tasks.push(
        queryClient.prefetchQuery({ queryKey: ['terminals'], queryFn: api.terminals, staleTime: 60_000 }),
        queryClient.prefetchQuery({ queryKey: ['terminal-monitor'], queryFn: api.terminalMonitor, staleTime: 60_000 }),
      );
      break;
    case '/settings':
      tasks.push(queryClient.prefetchQuery({ queryKey: ['print-settings'], queryFn: api.printSettings, staleTime: 120_000 }));
      break;
    case '/edari':
      tasks.push(
        queryClient.prefetchQuery({ queryKey: ['edari-settings'], queryFn: api.edariSettings, staleTime: 120_000 }),
        queryClient.prefetchQuery({ queryKey: ['edari-status'], queryFn: api.edariStatus, staleTime: 30_000 }),
      );
      break;
    default:
      break;
  }

  if (key === '/') {
    tasks.push(
      queryClient.prefetchQuery({
        queryKey: ['daily-sales-14', daysAgoIso(13), today],
        queryFn: () => api.dailySales(daysAgoIso(13), today),
        staleTime: 60_000,
      }),
    );
  }

  await Promise.allSettled(tasks);
}

export function prefetchRoute(path: string) {
  prefetchRouteChunk(path);
  void prefetchRouteQueries(path);
}

/** Warm common sections during idle time (not on login burst). */
export function prefetchNavPagesIdle() {
  prefetchRoute('/receipts');
  prefetchRoute('/commissions');
  prefetchRoute('/sections');
}

/** @deprecated use prefetchNavPagesIdle via warmupAfterLogin */
export function prefetchNavPages() {
  prefetchNavPagesIdle();
}
