import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { PosErrorBoundary } from '@/components/PosErrorBoundary';
import { LoginPage } from '@/pages/LoginPage';
import { SalesPage } from '@/pages/SalesPage';

function Gate() {
  const { session, login, resumeOffline, canResumeOffline, logout } = useAuth();
  if (!session) {
    return (
      <LoginPage
        onLogin={login}
        onResumeOffline={resumeOffline}
        canResumeOffline={canResumeOffline}
      />
    );
  }
  return <SalesPage session={session} onLogout={logout} />;
}

export function App() {
  useEffect(() => {
    window.__fotAppReady = true;
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
