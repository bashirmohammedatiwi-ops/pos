import { formatNum } from '@/api/client';
import type { ProductCommissionMembershipDto } from '@/api/types';

export function commissionValueLabel(type: string, value: number) {
  if ((type ?? '').toLowerCase() === 'percentage') return `${formatNum(value)}٪`;
  return `${formatNum(value)} د.ع`;
}

export function otherCommissionMemberships(
  groups: ProductCommissionMembershipDto[] | undefined,
  currentGroupId?: number,
) {
  return (groups ?? []).filter(g =>
    !g.excluded && (currentGroupId == null || g.groupId !== currentGroupId));
}

export function CommissionGroupPills({
  groups,
  currentGroupId,
  mode = 'all',
  onOpenGroup,
}: {
  groups?: ProductCommissionMembershipDto[];
  currentGroupId?: number;
  mode?: 'all' | 'others';
  onOpenGroup?: (groupId: number) => void;
}) {
  const list = mode === 'others'
    ? otherCommissionMemberships(groups, currentGroupId)
    : (groups ?? []);

  if (list.length === 0) return null;

  return (
    <div className="mt-1 min-w-0">
      {mode === 'others' && (
        <p className="mb-0.5 text-[10px] font-bold text-amber-800">موجود في مجموعة عمولات أخرى</p>
      )}
      <ul className="flex flex-wrap gap-1">
        {list.map(g => {
          const cls = `inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${
            mode === 'others'
              ? 'bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100'
              : g.isActive
                ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-50'
          }`;
          const body = (
            <>
              <span className="truncate">{g.groupName}</span>
              <span className="shrink-0 text-[9.5px] text-slate-400">
                {commissionValueLabel(g.commissionType, g.commissionValue)}
              </span>
              {g.sourceTreeName && (
                <span className="truncate text-[9.5px] text-slate-400">· {g.sourceTreeName}</span>
              )}
              {!g.isActive && <span className="shrink-0 text-[9.5px]">متوقفة</span>}
            </>
          );
          return (
            <li key={g.groupId}>
              {onOpenGroup ? (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onOpenGroup(g.groupId);
                  }}
                  className={cls}
                  title={g.groupName}
                >
                  {body}
                </button>
              ) : (
                <span className={cls} title={g.groupName}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
