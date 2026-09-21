import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  currentMonthIso,
  currentWeekIso,
  DEFAULT_WEEK_LENGTH,
  DEFAULT_WEEK_START,
  periodsFromSettings,
  previousWeekIso,
} from '@/lib/businessPeriod';

export function useBusinessPeriod() {
  const q = useQuery({
    queryKey: ['business-period'],
    queryFn: api.businessPeriodSettings,
    staleTime: 5 * 60_000,
  });

  const settings = q.data;
  const weekStart = settings?.weekStartDay ?? DEFAULT_WEEK_START;
  const weekLen = settings?.weekLengthDays ?? DEFAULT_WEEK_LENGTH;

  const periods = settings
    ? periodsFromSettings(settings)
    : {
        currentWeek: currentWeekIso(weekStart, weekLen),
        previousWeek: previousWeekIso(weekStart, weekLen),
        currentMonth: currentMonthIso(),
      };

  return {
    ...q,
    settings,
    weekStart,
    weekLen,
    periods,
  };
}
