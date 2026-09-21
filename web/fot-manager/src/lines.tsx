import { useState } from 'react';
import { cashierLabel, copyText, moneyIq, pieces, receiptLabel, stampLabel, type LineRow } from './api';
import { lineCashier, lineText, type ReceiptGroup } from './insights';
import { Empty, Sheet, useToast } from './ui';

export function LineCard({
  name, sales, commission, receipt, at, qty, extra, onClick,
}: {
  name: string;
  sales?: string;
  commission?: string;
  receipt?: number | null;
  at: string;
  qty?: number;
  extra?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="line-card" onClick={onClick}>
      <span className="line-mark">{(name || 'م').trim().charAt(0)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-extrabold leading-6">{name}</span>
        <span className="line-meta">
          {qty != null && <span className="qty-chip">{qty} قطعة</span>}
          <span className="chip-soft">{receiptLabel(receipt)}</span>
          <span className="chip-soft">{stampLabel(at)}</span>
          {extra && <span className="chip-soft">{extra}</span>}
        </span>
      </span>
      <span className="text-end">
        {sales && <span className="num block text-[15px] font-extrabold">{sales}</span>}
        {commission && <span className="num block text-xs font-extrabold text-gold">{commission}</span>}
      </span>
    </button>
  );
}

export function MoveList({
  lines, onOpen, empty,
}: {
  lines: LineRow[];
  onOpen: (line: LineRow) => void;
  empty?: string;
}) {
  if (!lines.length) return <Empty title={empty || 'لا حركات هذا الأسبوع'} hint="عند حساب العمولة تظهر كل المنتجات والفواتير هنا" />;
  return (
    <div className="line-stack">
      {lines.map(l => (
        <LineCard
          key={l.id}
          name={l.productName}
          sales={moneyIq(l.salesAmount)}
          commission={moneyIq(l.commissionAmount)}
          receipt={l.receiptNumber}
          at={l.occurredAt}
          qty={l.quantity}
          extra={[l.salesmanName, lineCashier(l)].filter(Boolean).join(' · ')}
          onClick={() => onOpen(l)}
        />
      ))}
    </div>
  );
}

export function ReceiptList({
  groups, onOpen,
}: {
  groups: ReceiptGroup[];
  onOpen: (line: LineRow) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!groups.length) return <Empty title="لا فواتير هذا الأسبوع" hint="عندما تُحسب مبيعات تظهر الفواتير هنا" />;
  return (
    <div className="line-stack">
      {groups.map(g => {
        const open = openId === g.id;
        return (
          <div key={g.id} className="receipt-box">
            <button type="button" className="receipt-card" onClick={() => setOpenId(open ? null : g.id)}>
              <span className="line-mark">#</span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-extrabold">{receiptLabel(g.receiptNumber)}</span>
                <span className="line-meta">
                  <span className="qty-chip">{pieces(g.qty)}</span>
                  <span className="chip-soft">{stampLabel(g.at)}</span>
                  {g.cashierName && <span className="chip-soft">{g.cashierName}</span>}
                  <span className="chip-soft">{g.sellers.join(' · ')}</span>
                </span>
              </span>
              <span className="text-end">
                <span className="num block text-[15px] font-extrabold">{moneyIq(g.sales)}</span>
                <span className="num block text-xs font-extrabold text-gold">{moneyIq(g.commission)}</span>
              </span>
            </button>
            {open && (
              <div className="receipt-lines">
                {g.lines.map(l => (
                  <LineCard
                    key={l.id}
                    name={l.productName}
                    sales={moneyIq(l.salesAmount)}
                    commission={moneyIq(l.commissionAmount)}
                    receipt={l.receiptNumber}
                    at={l.occurredAt}
                    qty={l.quantity}
                    extra={l.salesmanName}
                    onClick={() => onOpen(l)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LineSheet({
  open, onClose,
}: {
  open: LineRow | null;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <Sheet open={!!open} title={open?.productName || 'الحركة'} onClose={onClose}>
      {open && (
        <div className="detail-grid">
          <div className="detail-hero">
            <p className="kicker">المبيعات / العمولة</p>
            <p className="num mt-1 text-[28px] font-extrabold">{moneyIq(open.salesAmount)}</p>
            <p className="num mt-1 text-lg font-extrabold text-gold">{moneyIq(open.commissionAmount)}</p>
          </div>
          <div className="detail-cell"><p>البائع</p><strong>{open.salesmanName}</strong></div>
          <div className="detail-cell"><p>الكاشير</p><strong>{cashierLabel(open.cashierName) || cashierLabel(open.mallName) || '—'}</strong></div>
          <div className="detail-cell"><p>الفاتورة</p><strong>{receiptLabel(open.receiptNumber)}</strong></div>
          <div className="detail-cell"><p>الوقت</p><strong>{stampLabel(open.occurredAt)}</strong></div>
          <div className="detail-cell"><p>القطع</p><strong>{pieces(open.quantity)}</strong></div>
          {open.groupName && <div className="detail-cell"><p>المجموعة</p><strong>{open.groupName}</strong></div>}
          <button
            type="button"
            className="copy-btn"
            onClick={async () => {
              toast(await copyText(lineText(open)) ? 'تم النسخ' : 'تعذر النسخ');
            }}
          >
            نسخ التفاصيل
          </button>
        </div>
      )}
    </Sheet>
  );
}
