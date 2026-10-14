import type { TargetBreakdownDto, TargetRuleDto, TargetSalesmanRowDto } from '@/api/types';

/** حسابات تقدّم الأهداف على مستوى الواجهة (من تفصيل الأسبوع الحالي). */

export function targetUnit(targetType?: string | null) {
  return targetType === 'amount' ? 'IQD' : 'قطعة';
}

export interface RuleProgress {
  /** مجموع ما باعه البائعون المكلّفون (قطع أو IQD). */
  achieved: number;
  /** مجموع الأرقام الأسبوعية للبائعين المكلّفين. */
  target: number;
  pct: number;
  assigned: number;
  reached: number;
  /** كل مبيع النطاق بما فيه غير المكلّفين. */
  totalSold: number;
  top: { name: string; pct: number } | null;
}

export function rowMetric(row: TargetSalesmanRowDto, targetType?: string | null) {
  return targetType === 'amount' ? (row.amount ?? 0) : row.quantity;
}

export function ruleWeekProgress(rule: TargetRuleDto, bd?: TargetBreakdownDto): RuleProgress | null {
  if (!bd) return null;
  const weekly = new Map(
    (rule.assignments ?? []).filter(a => a.weeklyTarget > 0).map(a => [a.salesmanId, a]),
  );
  let achieved = 0;
  let target = 0;
  let reached = 0;
  let top: RuleProgress['top'] = null;
  for (const a of weekly.values()) target += a.weeklyTarget;
  for (const row of bd.salesmen ?? []) {
    const a = weekly.get(row.salesmanId);
    if (!a) continue;
    const m = rowMetric(row, rule.targetType);
    achieved += m;
    const pct = a.weeklyTarget > 0 ? (m / a.weeklyTarget) * 100 : 0;
    if (pct >= 100) reached++;
    if (!top || pct > top.pct) top = { name: row.salesmanName ?? a.salesmanName ?? `#${row.salesmanId}`, pct };
  }
  const totalSold = rule.targetType === 'amount' ? (bd.totalAmount ?? 0) : bd.totalQuantity;
  return {
    achieved,
    target,
    pct: target > 0 ? (achieved / target) * 100 : 0,
    assigned: weekly.size,
    reached,
    totalSold,
    top: top && top.pct > 0 ? top : null,
  };
}

