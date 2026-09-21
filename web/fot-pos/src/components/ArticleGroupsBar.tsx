import type { CSSProperties } from 'react';
import type { ArticleGroupDto } from '@/api/types';
import { isDarkRgb, winCss } from '@/lib/winColor';
import { formatNum } from '@/lib/money';
import { onInputClickVisualRight, onInputFocusVisualRight } from '@/lib/focusInput';

type SortMode = 'seq' | 'name' | 'price';

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'seq', label: 'الترتيب' },
  { id: 'name', label: 'الاسم' },
  { id: 'price', label: 'السعر' },
];

export function ArticleGroupsBar({
  groups,
  selectedId,
  selectedGroup,
  query,
  onQueryChange,
  sortMode,
  onSortModeChange,
  visibleCount,
  totalInGroup,
  onSelect,
  searchEnabled = true,
}: {
  groups: ArticleGroupDto[];
  selectedId: number | null;
  selectedGroup: ArticleGroupDto | null;
  query: string;
  onQueryChange: (q: string) => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  visibleCount: number;
  totalInGroup: number;
  onSelect: (id: number) => void;
  searchEnabled?: boolean;
}) {
  const accent = selectedGroup ? winCss(selectedGroup.backColour, '#0f9f76') : '#0f9f76';
  const title = selectedGroup?.name || (selectedId ? `مجموعة ${selectedId}` : 'المجاميع');

  return (
    <div className="pos-article-groups">
      <div className="pos-article-groups-head" style={{ '--group-accent': accent } as CSSProperties}>
        <div className="pos-article-groups-title-row">
          <span className="pos-article-groups-dot" aria-hidden />
          <div className="min-w-0">
            <div className="pos-article-groups-title truncate">{title}</div>
            <div className="pos-article-groups-sub num">
              {query.trim()
                ? `${formatNum(visibleCount)} نتيجة من ${formatNum(totalInGroup)}`
                : `${formatNum(totalInGroup)} منتج`}
            </div>
          </div>
        </div>

        <div className="pos-article-groups-tools">
          {searchEnabled && (
            <div className="pos-article-groups-search-wrap">
              <svg className="pos-article-groups-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
              <input
                value={query}
                onChange={e => onQueryChange(e.target.value)}
                onFocus={onInputFocusVisualRight}
                onClick={onInputClickVisualRight}
                placeholder="بحث داخل المجموعة…"
                className="pos-article-groups-search"
                dir="rtl"
              />
              {query && (
                <button type="button" className="pos-article-groups-search-clear" onClick={() => onQueryChange('')} aria-label="مسح">
                  ×
                </button>
              )}
            </div>
          )}

          <div className="pos-article-groups-sort" role="group" aria-label="ترتيب العرض">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSortModeChange(opt.id)}
                className={`pos-article-groups-sort-btn ${sortMode === opt.id ? 'is-on' : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pos-article-groups-tabs">
        {groups.length === 0 && (
          <div className="pos-article-groups-empty">لا توجد مجاميع — زامن الكتالوج من الأدوات</div>
        )}
        {groups.map(g => {
          const on = selectedId === g.id;
          const bg = winCss(g.backColour, '#f1f5f9');
          const fg = winCss(g.foreColour, isDarkRgb(g.backColour) ? '#fff' : '#334155');
          const activeBg = winCss(g.backColour, '#0f9f76');
          const activeFg = on
            ? (isDarkRgb(g.backColour) ? '#fff' : winCss(g.foreColour, '#fff'))
            : fg;

          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              className={`pos-article-groups-tab ${on ? 'is-active' : ''}`}
              style={{
                '--tab-bg': on ? activeBg : bg,
                '--tab-fg': activeFg,
              } as CSSProperties}
            >
              <span className="pos-article-groups-tab-name truncate">{g.name || `مجموعة ${g.id}`}</span>
              {g.itemCount > 0 && (
                <span className="pos-article-groups-tab-count num">{g.itemCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
