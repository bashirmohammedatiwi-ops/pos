import { useEffect, useRef, type ReactNode } from 'react';
import { formatIqd, formatNum } from '@/lib/money';
import { lineCommissionAmount, lineTotal, type CartLine } from '@/lib/sale';

function discountPct(line: CartLine) {
  return line.originalPrice > line.price && line.originalPrice > 0
    ? Math.round((1 - line.price / line.originalPrice) * 100)
    : 0;
}

export function CartTable({
  cart,
  selectedKey,
  flashKey,
  flashGen,
  showGroups,
  returnMode,
  giftMode,
  allowPriceChange,
  allowDelete,
  onSelect,
  onQtyDelta,
  onQtyFocus,
  onOpenPrice,
  onOpenSeller,
  onRemove,
  onScanFocus,
  footerActions,
}: {
  cart: CartLine[];
  selectedKey: string | null;
  flashKey: string | null;
  flashGen: number;
  showGroups: boolean;
  returnMode: boolean;
  giftMode: boolean;
  allowPriceChange: boolean;
  allowDelete: boolean;
  onSelect: (key: string) => void;
  onQtyDelta: (key: string, delta: number) => void;
  onQtyFocus: (line: CartLine) => void;
  onOpenPrice: (line: CartLine) => void;
  onOpenSeller: (line: CartLine) => void;
  onRemove: (key: string) => void;
  onScanFocus: () => void;
  footerActions?: ReactNode;
}) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pieces = cart.reduce((sum, line) => sum + line.quantity, 0);
  const amount = cart.reduce((sum, line) => sum + lineTotal(line), 0);

  const pinAddedRow = (key: string, flash: boolean) => {
    const scroller = scrollerRef.current;
    const row = rowRefs.current.get(key);
    if (flash && row) {
      row.classList.remove('is-flash');
      void row.offsetWidth;
      row.classList.add('is-flash');
    }
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  };

  const revealSelected = (key: string) => {
    const scroller = scrollerRef.current;
    const row = rowRefs.current.get(key);
    if (!scroller || !row) return;
    const headerH = (scroller.querySelector('thead') as HTMLElement | null)?.getBoundingClientRect().height ?? 34;
    const pad = 12;
    const box = scroller.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.bottom > box.bottom - pad) scroller.scrollTop += rowBox.bottom - (box.bottom - pad);
    else if (rowBox.top < box.top + headerH + 4) scroller.scrollTop += rowBox.top - (box.top + headerH + 4);
  };

  useEffect(() => {
    if (!flashKey) return;
    let cancelled = false;
    const run = () => { if (!cancelled) pinAddedRow(flashKey, true); };
    run();
    const frame = window.requestAnimationFrame(run);
    const t1 = window.setTimeout(run, 40);
    const t2 = window.setTimeout(run, 160);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [cart, flashKey, flashGen]);

  useEffect(() => {
    if (!selectedKey || selectedKey === flashKey) return;
    revealSelected(selectedKey);
  }, [flashKey, selectedKey]);

  return (
    <div className="pos-cart-sheet">
      <div className="pos-cart-sheet-scroll" ref={scrollerRef}>
        <table className="pos-cart-table pos-cart-excel">
          <colgroup>
            <col className="pos-col-idx" />
            <col className="pos-col-code" />
            <col className="pos-col-name" />
            <col className="pos-col-seller" />
            {showGroups && <col className="pos-col-group" />}
            <col className="pos-col-price" />
            <col className="pos-col-disc" />
            <col className="pos-col-qty" />
            <col className="pos-col-total" />
            {allowDelete && <col className="pos-col-del" />}
          </colgroup>
          <thead>
            <tr>
              <th className="pos-td-idx">#</th>
              <th className="pos-td-code">الباركود</th>
              <th className="pos-td-name">المنتج</th>
              <th className="pos-td-seller">المندوب</th>
              {showGroups && <th className="pos-td-group">مجموعة</th>}
              <th className="pos-td-price">السعر</th>
              <th className="pos-td-disc">خصم%</th>
              <th className="pos-td-qty">الكمية</th>
              <th className="pos-td-total">الإجمالي</th>
              {allowDelete && <th className="pos-td-del" aria-label="حذف" />}
            </tr>
          </thead>
          <tbody>
            {cart.map((line, index) => {
              const pct = discountPct(line);
              const selected = selectedKey === line.key;
              const commission = lineCommissionAmount(line);
              const sellerLabel = line.salesmanId > 0
                ? (line.salesmanName || `#${line.salesmanId}`)
                : 'اختر';
              return (
                <tr
                  key={line.key}
                  ref={node => {
                    if (node) rowRefs.current.set(line.key, node);
                    else rowRefs.current.delete(line.key);
                  }}
                  onClick={() => onSelect(line.key)}
                  onDoubleClick={() => onQtyFocus(line)}
                  className={`${selected ? 'is-selected' : index % 2 ? 'is-alt' : ''}`}
                >
                  <td className="pos-td-idx">{index + 1}</td>
                  <td className="pos-td-code">
                    <span className="pos-cart-barcode num" dir="ltr">{line.barcode || line.num || '—'}</span>
                  </td>
                  <td className="pos-td-name" title={line.name}>
                    <span className="pos-cart-name">{line.name}</span>
                    {line.num && line.barcode && line.num !== line.barcode && (
                      <span className="pos-cart-sku num" dir="ltr">{line.num}</span>
                    )}
                  </td>
                  <td className="pos-td-seller">
                    <button
                      type="button"
                      className={`pos-cart-seller-cell ${line.salesmanId ? '' : 'is-empty'}`}
                      title="تعيين المندوب"
                      onClick={e => { e.stopPropagation(); onOpenSeller(line); }}
                    >
                      <span className="truncate">{sellerLabel}</span>
                      {commission > 0 && (
                        <small className="num" dir="ltr">{formatIqd(commission)}</small>
                      )}
                    </button>
                  </td>
                  {showGroups && (
                    <td className="pos-td-group">
                      <span className="pos-cart-group-tag">{line.groupLabel || `م${line.groupKey || 1}`}</span>
                    </td>
                  )}
                  <td className="pos-td-price">
                    <button
                      type="button"
                      className={`pos-cart-price-cell num ${allowPriceChange ? 'is-edit' : ''}`}
                      title={allowPriceChange ? 'تغيير السعر' : undefined}
                      onClick={e => {
                        e.stopPropagation();
                        if (allowPriceChange) onOpenPrice(line);
                      }}
                    >
                      {line.originalPrice > line.price && (
                        <span className="pos-cart-old-price">{formatIqd(line.originalPrice)}</span>
                      )}
                      <span>{formatIqd(line.price)}</span>
                    </button>
                  </td>
                  <td className="pos-td-disc">
                    {pct > 0
                      ? <span className="pos-prod-disc">{formatNum(pct)}%</span>
                      : <span className="pos-cart-dash">—</span>}
                  </td>
                  <td className="pos-td-qty">
                    <div className="pos-sheet-qty" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => { onQtyDelta(line.key, -1); onScanFocus(); }}
                        aria-label="إنقاص"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="pos-sheet-qty-value num"
                        onClick={() => onQtyFocus(line)}
                        aria-label={`كمية ${line.name}`}
                      >
                        {line.quantity}
                      </button>
                      <button
                        type="button"
                        onClick={() => { onQtyDelta(line.key, 1); onScanFocus(); }}
                        aria-label="زيادة"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className={`pos-td-total num ${returnMode ? 'is-return' : giftMode ? 'is-gift' : ''}`}>
                    {returnMode ? '−' : ''}{formatIqd(Math.abs(lineTotal(line)))}
                  </td>
                  {allowDelete && (
                    <td className="pos-td-del">
                      <button
                        type="button"
                        className="pos-cart-del"
                        title="حذف البند"
                        onClick={e => { e.stopPropagation(); onRemove(line.key); }}
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pos-cart-sheet-end" aria-hidden />
      </div>
      <div className="pos-cart-excel-foot">
        <span>{formatNum(cart.length)} بند</span>
        <span>{formatNum(pieces)} قطعة</span>
        {footerActions}
        <strong className={`num ${returnMode ? 'is-return' : ''}`}>
          {returnMode ? '−' : ''}{formatIqd(Math.abs(amount))}
        </strong>
      </div>
    </div>
  );
}
