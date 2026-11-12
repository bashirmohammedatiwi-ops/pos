import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import type { PosSessionDto } from '@/api/types';
import { PosErrorBoundary } from '@/components/PosErrorBoundary';
import { isOrdersApp } from '@/lib/onlineOrders';
import { LoginPage } from '@/pages/LoginPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { SalesPage } from '@/pages/SalesPage';

const ORDERS_APP = isOrdersApp();

function storedSession(): PosSessionDto | null {
  try {
    const raw = localStorage.getItem('fot_pos_session');
    return raw ? (JSON.parse(raw) as PosSessionDto) : null;
  } catch {
    return null;
  }
}

function Gate() {
  const { session, login, resumeOffline, canResumeOffline, logout } = useAuth();
  const [orders, setOrders] = useState<{ code: string | null } | null>(null);

  // «كاشير الطلبات» متصل فقط: الدخول لكاشير يملك صلاحية onlineOrders، ولا دخول محلي.
  const ordersLogin = useCallback(async (username: string, password: string) => {
    const fail = await login(username, password);
    if (fail) return fail;
    const s = storedSession();
    if (s?.permissions?.onlineOrders !== true) {
      logout();
      return 'هذا الحساب لا يملك صلاحية «كاشير الطلبات» — فعّلها من لوحة التحكم';
    }
    return null;
  }, [login, logout]);

  useEffect(() => {
    if (!session) setOrders(null);
  }, [session]);

  if (!session) {
    return (
      <LoginPage
        onLogin={ORDERS_APP ? ordersLogin : login}
        onResumeOffline={resumeOffline}
        canResumeOffline={ORDERS_APP ? async () => false : canResumeOffline}
        title={ORDERS_APP ? 'كاشير الطلبات' : undefined}
      />
    );
  }
  if (ORDERS_APP) return <OrdersPage session={session} onLogout={logout} />;
  if (orders) {
    return <OrdersPage session={session} onLogout={logout} onBack={() => setOrders(null)} initialCode={orders.code} />;
  }
  return (
    <SalesPage
      session={session}
      onLogout={logout}
      onOpenOrders={session.permissions?.onlineOrders ? code => setOrders({ code: code ?? null }) : undefined}
    />
  );
}

export function App() {
  useEffect(() => {
    window.__fotAppReady = true;
    if (ORDERS_APP) document.title = 'FOT POS — كاشير الطلبات';
    try {
      sessionStorage.removeItem('fot_boot_reloads');
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <PosErrorBoundary>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </PosErrorBoundary>
  );
}
