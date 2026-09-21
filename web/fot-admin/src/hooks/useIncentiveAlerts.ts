import { useMemo } from 'react';
import { useNavBadges } from '@/hooks/useNavBadges';

/** Commission due + at-risk targets for command palette (reuses nav badge cache). */
export function useIncentiveAlerts() {
  const { commDue, atRiskCount, monthFrom, today } = useNavBadges();
  return useMemo(() => ({ commDue, atRiskCount, monthFrom, today }), [commDue, atRiskCount, monthFrom, today]);
}
