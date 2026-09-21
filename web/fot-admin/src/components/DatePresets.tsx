import { daysAgoIso, monthStartIso, todayIso } from '@/api/client';
import type { BusinessPeriodSettingsDto } from '@/api/types';
import { Btn } from '@/components/ui';
import {
  businessWeekLabel,
  currentMonthIso,
  currentWeekIso,
  previousMonthIso,
  previousWeekIso,
} from '@/lib/businessPeriod';

export type DatePresetMode = 'commissions' | 'targets' | 'all';

export function DatePresets({
  onPick,
  periodSettings,
  mode = 'all',
}: {
  onPick: (from: string, to: string) => void;
  periodSettings?: BusinessPeriodSettingsDto | null;
  mode?: DatePresetMode;
}) {
  const weekStart = periodSettings?.weekStartDay ?? 6;
  const weekLen = periodSettings?.weekLengthDays ?? 7;
  const weekLabel = businessWeekLabel(periodSettings);

  const currentWeek = periodSettings
    ? { from: periodSettings.currentWeekStart.slice(0, 10), to: periodSettings.currentWeekEnd.slice(0, 10) }
    : currentWeekIso(weekStart, weekLen);
  const previousWeek = periodSettings
    ? { from: periodSettings.previousWeekStart.slice(0, 10), to: periodSettings.previousWeekEnd.slice(0, 10) }
    : previousWeekIso(weekStart, weekLen);
  const currentMonth = periodSettings
    ? { from: periodSettings.currentMonthStart.slice(0, 10), to: periodSettings.currentMonthEnd.slice(0, 10) }
    : currentMonthIso();
  const prevMonth = previousMonthIso();

  const showWeek = mode === 'all' || mode === 'commissions' || mode === 'targets';
  const showMonth = mode === 'all' || mode === 'targets';

  return (
    <div className="flex flex-wrap gap-1">
      {showWeek && (
        <>
          <Btn size="sm" variant="secondary" onClick={() => onPick(currentWeek.from, currentWeek.to)}>
            هذا الأسبوع
          </Btn>
          <Btn size="sm" variant="secondary" onClick={() => onPick(previousWeek.from, previousWeek.to)}>
            الأسبوع الماضي
          </Btn>
        </>
      )}
      <Btn size="sm" variant="secondary" onClick={() => onPick(todayIso(), todayIso())}>اليوم</Btn>
      {showMonth && (
        <>
          <Btn size="sm" variant="secondary" onClick={() => onPick(currentMonth.from, currentMonth.to)}>
            هذا الشهر
          </Btn>
          <Btn size="sm" variant="secondary" onClick={() => onPick(prevMonth.from, prevMonth.to)}>
            الشهر الماضي
          </Btn>
        </>
      )}
      {mode === 'all' && (
        <>
          <Btn size="sm" variant="secondary" onClick={() => onPick(daysAgoIso(7), todayIso())}>7 أيام</Btn>
          <Btn size="sm" variant="secondary" onClick={() => onPick(monthStartIso(), todayIso())}>من بداية الشهر</Btn>
          <Btn size="sm" variant="secondary" onClick={() => onPick(daysAgoIso(30), todayIso())}>30 يوم</Btn>
        </>
      )}
      <Btn size="sm" variant="ghost" onClick={() => onPick('', '')} title={weekLabel}>
        كل الفترات
      </Btn>
    </div>
  );
}

export function PeriodBanner({
  from,
  to,
  periodSettings,
  hint,
}: {
  from: string;
  to: string;
  periodSettings?: BusinessPeriodSettingsDto | null;
  hint?: string;
}) {
  if (!from || !to) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-2 text-[12px] text-amber-900">
        عرض <strong>كل الفترات</strong> — قد يكون بطيئاً. يُفضّل اختيار أسبوع عمل ({businessWeekLabel(periodSettings)}).
      </div>
    );
  }

  const f = new Date(from);
  const t = new Date(to);
  const label = `${f.toLocaleDateString('ar-IQ', { weekday: 'short', day: 'numeric', month: 'short' })} — ${t.toLocaleDateString('ar-IQ', { weekday: 'short', day: 'numeric', month: 'short' })}`;

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-2 text-[12px] text-brand-900">
      <span className="font-semibold">فترة العرض:</span> {label}
      {hint && <span className="mr-2 text-brand-800/70">· {hint}</span>}
      {periodSettings && (
        <span className="mr-2 text-brand-800/60">
          · أسبوع العمل: {periodSettings.weekStartDayName} → {periodSettings.weekEndDayName}
        </span>
      )}
    </div>
  );
}
