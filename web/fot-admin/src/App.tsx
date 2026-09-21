import { Suspense, useEffect, useMemo, type ReactNode } from 'react';

import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';

import { AuthProvider } from '@/auth/AuthContext';

import { ProtectedRoute } from '@/auth/ProtectedRoute';

import { AppLayout } from '@/layout/AppLayout';

import { LoginPage } from '@/pages/LoginPage';

import { DashboardPage } from '@/pages/DashboardPage';

import { NotFoundPage } from '@/pages/NotFoundPage';

import { PageSkeleton } from '@/components/ui';

import { ErrorBoundary } from '@/components/ErrorBoundary';

import { ToastProvider } from '@/components/Toast';

import { queryClient } from '@/lib/queryClient';
import { listenEditorChanges } from '@/lib/editorWindow';
import { lazyPage, markAppReady } from '@/lib/lazyWithRetry';



function useAppRouter() {
  return useMemo(() => {
    if (typeof window === 'undefined') return HashRouter;
    const electron =
      Boolean(window.fotDesktop) ||
      window.location.protocol === 'file:' ||
      import.meta.env.VITE_ELECTRON === '1';
    return electron ? HashRouter : BrowserRouter;
  }, []);
}

const ProductsPage = lazyPage(() => import('@/pages/ProductsPage'), 'ProductsPage');

const OffersPage = lazyPage(() => import('@/pages/OffersPage'), 'OffersPage');

const GroupsPage = lazyPage(() => import('@/pages/GroupsPage'), 'GroupsPage');

const AccountsPage = lazyPage(() => import('@/pages/AccountsPage'), 'AccountsPage');

const ReceiptsPage = lazyPage(() => import('@/pages/ReceiptsPage'), 'ReceiptsPage');

const ActivityPage = lazyPage(() => import('@/pages/ActivityPage'), 'ActivityPage');

const ReportsPage = lazyPage(() => import('@/pages/ReportsPage'), 'ReportsPage');

const SalesmenPage = lazyPage(() => import('@/pages/SalesmenPage'), 'SalesmenPage');

const PortalAccountsPage = lazyPage(() => import('@/pages/PortalAccountsPage'), 'PortalAccountsPage');

const CashiersPage = lazyPage(() => import('@/pages/CashiersPage'), 'CashiersPage');

const DiscountQrPage = lazyPage(() => import('@/pages/DiscountQrPage'), 'DiscountQrPage');

const PriceCheckerPage = lazyPage(() => import('@/pages/PriceCheckerPage'), 'PriceCheckerPage');

const CommissionsPage = lazyPage(() => import('@/pages/CommissionsPage'), 'CommissionsPage');

const TargetsPage = lazyPage(() => import('@/pages/TargetsPage'), 'TargetsPage');

const SectionsPage = lazyPage(() => import('@/pages/SectionsPage'), 'SectionsPage');

const TerminalsPage = lazyPage(() => import('@/pages/TerminalsPage'), 'TerminalsPage');

const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage');

const EdariPage = lazyPage(() => import('@/pages/EdariPage'), 'EdariPage');

const SystemHealthPage = lazyPage(() => import('@/pages/SystemHealthPage'), 'SystemHealthPage');

const EditorWindows = {
  Offer: lazyPage(() => import('@/pages/EditorWindows'), 'OfferEditorWindow'),
  Group: lazyPage(() => import('@/pages/EditorWindows'), 'GroupEditorWindow'),
  Target: lazyPage(() => import('@/pages/EditorWindows'), 'TargetEditorWindow'),
};



function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

/** يستمع لتغييرات نوافذ المحررات المنفصلة ويحدّث بيانات التطبيق فوراً. */
function EditorRefreshBridge() {
  const qc = useQueryClient();
  useEffect(
    () => listenEditorChanges(() => { void qc.invalidateQueries(); }),
    [qc],
  );
  return null;
}



function MarkReady() {
  useEffect(() => {
    markAppReady();
  }, []);
  return null;
}

export function App() {
  const Router = useAppRouter();

  return (

    <ErrorBoundary>

      <MarkReady />

      <QueryClientProvider client={queryClient}>

        <ToastProvider>

          <AuthProvider>

            <Router>

              <EditorRefreshBridge />

              <Routes>

                <Route path="/login" element={<LoginPage />} />

                <Route element={<ProtectedRoute />}>

                  <Route element={<AppLayout />}>

                    <Route index element={<DashboardPage />} />

                    <Route path="products" element={<Page><ProductsPage /></Page>} />

                    <Route path="offers" element={<Page><OffersPage /></Page>} />

                    <Route path="groups" element={<Page><GroupsPage /></Page>} />

                    <Route path="accounts" element={<Page><AccountsPage /></Page>} />

                    <Route path="receipts" element={<Page><ReceiptsPage /></Page>} />

                    <Route path="activity" element={<Page><ActivityPage /></Page>} />

                    <Route path="reports" element={<Page><ReportsPage /></Page>} />

                    <Route path="salesmen" element={<Page><SalesmenPage /></Page>} />

                    <Route path="portal-accounts" element={<Page><PortalAccountsPage /></Page>} />

                    <Route path="cashiers" element={<Page><CashiersPage /></Page>} />

                    <Route path="discount-qr" element={<Page><DiscountQrPage /></Page>} />

                    <Route path="price-checker" element={<Page><PriceCheckerPage /></Page>} />

                    <Route path="commissions" element={<Page><CommissionsPage /></Page>} />

                    <Route path="targets" element={<Page><TargetsPage /></Page>} />

                    <Route path="sections" element={<Page><SectionsPage /></Page>} />

                    <Route path="terminals" element={<Page><TerminalsPage /></Page>} />

                    <Route path="settings" element={<Page><SettingsPage /></Page>} />

                    <Route path="edari" element={<Page><EdariPage /></Page>} />

                    <Route path="system" element={<Page><SystemHealthPage /></Page>} />

                    <Route path="*" element={<NotFoundPage />} />

                  </Route>

                  {/* محررات الأقسام — نوافذ نظام منفصلة بلا هيكل التطبيق */}

                  <Route path="/editor/offer/:id" element={<Suspense fallback={<PageSkeleton />}><EditorWindows.Offer /></Suspense>} />

                  <Route path="/editor/group/:id" element={<Suspense fallback={<PageSkeleton />}><EditorWindows.Group /></Suspense>} />

                  <Route path="/editor/target/:id" element={<Suspense fallback={<PageSkeleton />}><EditorWindows.Target /></Suspense>} />

                </Route>

                <Route path="*" element={<Navigate to="/login" replace />} />

              </Routes>

            </Router>

          </AuthProvider>

        </ToastProvider>

      </QueryClientProvider>

    </ErrorBoundary>

  );

}

