import { memo } from 'react';
import type { ArticleGroupItemDto } from '@/api/types';
import { formatIqd } from '@/lib/money';
import { isDarkRgb, winCss } from '@/lib/winColor';

export const PosTile = memo(function PosTile({
  item,
  fallbackBg,
  fallbackFg,
  fallbackDark,
  onPick,
}: {
  item: ArticleGroupItemDto;
  fallbackBg: string;
  fallbackFg: string;
  fallbackDark: boolean;
  onPick: (item: ArticleGroupItemDto) => void;
}) {
  const bg = winCss(item.backColour, fallbackBg);
  const fg = winCss(item.foreColour, fallbackFg);
  const priceColor = isDarkRgb(item.backColour) || (item.backColour == null && fallbackDark) ? fg : '#0b7d5d';

  return (
    <button
      type="button"
      className="pos-tile"
      style={{ background: bg, color: fg }}
      onClick={() => onPick(item)}
    >
      <span className="pos-tile-name">{item.name}</span>
      {(item.barcode || item.seq) && (
        <span className="pos-tile-code num" dir="ltr">{item.barcode || item.seq}</span>
      )}
      <span className="pos-tile-price num" style={{ color: priceColor }}>{formatIqd(item.price)}</span>
    </button>
  );
});
