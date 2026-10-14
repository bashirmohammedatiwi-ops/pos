import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatNum } from '@/api/client';
import { useNavBadges } from '@/hooks/useNavBadges';
import { IconAlert, IconClock, IconCloud } from '@/components/icons';

const TONES = {
  warn: 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100',
  info: 'bg-sky-50 text-sky-800 ring-sky-200 hover:bg-sky-100',
  danger: 'bg-red-50 text-red-700 ring-red-200 hover:bg-red-100',
} as const;

function Pill({
  to,
  label,
  count,
  tone,
  icon,
  title,
}: {
  to: string;
  label: string;
  count: number;
  tone: keyof typeof TONES;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      to={to}
      title={title}
      aria-label={`${title}: ${formatNum(count)}`}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold ring-1 ring-inset transition-colors ${TONES[tone]}`}
    >
      {icon}
      <span>{label}</span>
      <span className="num rounded-full bg-white/70 px-1.5 text-[11px] font-bold leading-[18px]">{formatNum(count)}</span>
    </Link>
  );
}

export function WorkPills({ className = '' }: { className?: string }) {
  const { holds, unsynced, failed } = useNavBadges();
  if (!holds && !unsynced && !failed) return null;

  return (
    <div className={`flex items-center gap-1.5 overflow-x-auto ${className}`}>
      {holds > 0 && (
        <Pill
          to="/receipts?hold=1"
          label="معلّقة"
          count={holds}
          tone="warn"
          icon={<IconClock size={13} />}
          title="فواتير معلّقة بانتظار الإكمال"
        />
      )}
      {unsynced > 0 && (
        <Pill
          to="/edari"
          label="بانتظار الترحيل"
          count={unsynced}
          tone="info"
          icon={<IconCloud size={13} />}
          title="فواتير لم تُرحَّل إلى Edari بعد"
        />
      )}
      {failed > 0 && (
        <Pill
          to="/edari"
          label="فشل الترحيل"
          count={failed}
          tone="danger"
          icon={<IconAlert size={13} />}
          title="فواتير فشل ترحيلها إلى Edari"
        />
      )}
    </div>
  );
}
