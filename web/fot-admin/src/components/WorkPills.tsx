import { Link } from 'react-router-dom';
import { formatNum } from '@/api/client';
import { useNavBadges } from '@/hooks/useNavBadges';

export function WorkPills({ className = '' }: { className?: string }) {
  const { holds, unsynced, failed } = useNavBadges();
  if (!holds && !unsynced && !failed) return null;

  const pill = (to: string, label: string, tone: string, title?: string) => (
    <Link to={to} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`} title={title}>
      {label}
    </Link>
  );

  return (
    <div className={`flex items-center gap-1.5 overflow-x-auto ${className}`}>
      {holds > 0 &&
        pill('/receipts?hold=1', `معلّقة ${formatNum(holds)}`, 'bg-amber-50 text-amber-800 hover:bg-amber-100')}
      {unsynced > 0 &&
        pill('/edari', `ترحيل ${formatNum(unsynced)}`, 'bg-sky-50 text-sky-800 hover:bg-sky-100')}
      {failed > 0 &&
        pill('/edari', `فشل ${formatNum(failed)}`, 'bg-red-50 text-red-800 hover:bg-red-100')}
    </div>
  );
}
