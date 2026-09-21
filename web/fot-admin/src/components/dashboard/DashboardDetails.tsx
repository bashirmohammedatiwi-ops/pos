import type { ReactNode } from 'react';
import type { DashboardTab } from '@/hooks/useDashboardData';

export function DashboardDetails({ tab, children }: { tab: DashboardTab; children: ReactNode }) {
  return <div key={tab} className="p-3">{children}</div>;
}
