import type { BusinessPeriodSettingsDto } from '@/api/types';

export const DEFAULT_WEEK_START = 6;
export const DEFAULT_WEEK_LENGTH = 7;

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function dayNameAr(day: number) {
  return DAY_NAMES[day] ?? '—';
}

export function isoDate(d: Date | string) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getWeekBounds(
  date = new Date(),
  weekStartDay = DEFAULT_WEEK_START,
  weekLengthDays = DEFAULT_WEEK_LENGTH,
) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() - weekStartDay + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + weekLengthDays - 1);
  return { start, end };
}

export function currentWeekIso(weekStartDay = DEFAULT_WEEK_START, weekLengthDays = DEFAULT_WEEK_LENGTH) {
  const { start, end } = getWeekBounds(new Date(), weekStartDay, weekLengthDays);
  return { from: isoDate(start), to: isoDate(end) };
}

export function previousWeekIso(weekStartDay = DEFAULT_WEEK_START, weekLengthDays = DEFAULT_WEEK_LENGTH) {
  const { start } = getWeekBounds(new Date(), weekStartDay, weekLengthDays);
  const prevStart = new Date(start);
  prevStart.setDate(start.getDate() - weekLengthDays);
  const prevEnd = new Date(prevStart);
  prevEnd.setDate(prevStart.getDate() + weekLengthDays - 1);
  return { from: isoDate(prevStart), to: isoDate(prevEnd) };
}

export function currentMonthIso(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: isoDate(start), to: isoDate(end) };
}

export function previousMonthIso(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return currentMonthIso(d);
}

export function weekEndDay(weekStartDay: number, weekLengthDays: number) {
  return (weekStartDay + weekLengthDays - 1) % 7;
}

export function formatPeriodRange(from: string, to: string) {
  if (!from || !to) return 'كل الفترات';
  try {
    const f = new Date(from);
    const t = new Date(to);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${f.toLocaleDateString('ar-IQ', opts)} — ${t.toLocaleDateString('ar-IQ', opts)}`;
  } catch {
    return `${from} — ${to}`;
  }
}

/** Shift a business-week start date by whole weeks. `from` is YYYY-MM-DD. */
export function shiftWeekIso(from: string, direction: number, weekLengthDays = DEFAULT_WEEK_LENGTH) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00`);
  start.setDate(start.getDate() + direction * weekLengthDays);
  const end = new Date(start);
  end.setDate(start.getDate() + weekLengthDays - 1);
  return { from: isoDate(start), to: isoDate(end) };
}

export function businessWeekLabel(settings?: BusinessPeriodSettingsDto | null) {
  if (settings) {
    return `${settings.weekStartDayName} — ${settings.weekEndDayName} (${settings.weekLengthDays} أيام)`;
  }
  return `${dayNameAr(DEFAULT_WEEK_START)} — ${dayNameAr(weekEndDay(DEFAULT_WEEK_START, DEFAULT_WEEK_LENGTH))}`;
}

export function periodsFromSettings(settings: BusinessPeriodSettingsDto) {
  return {
    currentWeek: { from: isoDate(settings.currentWeekStart), to: isoDate(settings.currentWeekEnd) },
    previousWeek: { from: isoDate(settings.previousWeekStart), to: isoDate(settings.previousWeekEnd) },
    currentMonth: { from: isoDate(settings.currentMonthStart), to: isoDate(settings.currentMonthEnd) },
  };
}
