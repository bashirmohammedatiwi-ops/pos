import { Link } from 'react-router-dom';
import { IconCloud, IconPackage, IconPercent, IconReceipt, IconTarget, IconTrendUp } from '@/components/icons';

const LINKS = [
  { to: '/receipts', label: 'الفواتير', icon: IconReceipt },
  { to: '/products', label: 'المنتجات', icon: IconPackage },
  { to: '/offers', label: 'العروض', icon: IconPercent },
  { to: '/targets', label: 'الأهداف', icon: IconTarget },
  { to: '/reports', label: 'التقارير', icon: IconTrendUp },
  { to: '/edari', label: 'Edari', icon: IconCloud },
] as const;

export function DashboardQuickLinks() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LINKS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-brand-200 hover:bg-brand-50/40 hover:text-brand-800"
        >
          <Icon size={13} />
          {label}
        </Link>
      ))}
    </div>
  );
}
