import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Btn, Alert } from '@/components/ui';

export function DashboardAlerts({
  statsError,
  onRetryStats,
  edariConnected,
  edariMessage,
  firstRun,
  noProducts,
}: {
  statsError?: string;
  onRetryStats: () => void;
  edariConnected?: boolean;
  edariMessage?: string;
  firstRun: boolean;
  noProducts: boolean;
}) {
  const items: { key: string; node: ReactNode }[] = [];

  if (statsError) {
    items.push({
      key: 'stats',
      node: (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
          <p className="text-[11px] text-red-800">{statsError}</p>
          <Btn size="sm" variant="secondary" onClick={onRetryStats}>إعادة المحاولة</Btn>
        </div>
      ),
    });
  }

  if (!edariConnected && edariMessage) {
    items.push({ key: 'edari', node: <Alert type="info">{edariMessage}</Alert> });
  }

  if (firstRun) {
    items.push({
      key: 'first',
      node: (
        <Alert type="info">
          بداية التشغيل: اسحب المنتجات من{' '}
          <Link to="/edari" className="font-medium text-brand-600 hover:underline">Edari</Link>
          {' '}ثم افتح نقطة البيع.
        </Alert>
      ),
    });
  } else if (noProducts && edariConnected) {
    items.push({
      key: 'products',
      node: (
        <Alert type="info">
          لا توجد منتجات —{' '}
          <Link to="/edari" className="font-medium text-brand-600 hover:underline">حدّث من Edari</Link>.
        </Alert>
      ),
    });
  }

  if (!items.length) return null;

  return <div className="space-y-1">{items.map(i => <div key={i.key}>{i.node}</div>)}</div>;
}
