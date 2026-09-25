import { useState } from 'react';
import { cashierLabel, copyText, moneyIq, pieces, receiptLabel, stampLabel, type LineRow } from './api';
import { lineCashier, lineText, type ReceiptGroup } from './insights';
import { Empty, Sheet, useToast } from './ui';

const PAGE = 40;

function ShowMore({ shown, total, onMore, onAll }: { shown: number; total: number; onMore: () => void; onAll: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="bill-more">
      <p>{shown} من {total}</p>
      <button type="button" className="pill" onClick={onMore}>عرض المزيد</button>
      <button type="button" className="pill pill-primary" onClick={onAll}>عرض الكل</button>
    </div>
  );
}

export function PhoneTable({
  columns, rows,
}: {
  columns: string[];
  rows: Array<{ key: string; total?: boolean; cells: Array<{ text: string; sub?: string; num?: boolean }>; onClick?: () => void }>;
}) {
  if (!rows.length) return null;
  return (
    <div className="phone-table-wrap">
      <table className="phone-table">
        <thead>
          <tr>
            {columns.map(col => <th key={col}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className={[row.onClick ? 'is-link' : '', row.total ? 'is-total' : ''].filter(Boolean).join(' ')} onClick={row.onClick}>
              {row.cells.map((cell, i) => (
                <td key={i} className={cell.num ? 'num' : ''}>
                  <span className="cell-main">{cell.text}</span>
                  {cell.sub && <span className="cell-sub">{cell.sub}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MoveList({
  lines, onOpen, empty,
}: {
  lines: LineRow[];
  onOpen: (line: LineRow) => void;
  empty?: string;
}) {
  const [limit, setLimit] = useState(PAGE);
  if (!lines.length) return <Empty title={empty || 'لا حركات هذا الأسبوع'} hint="عند وجود فواتير تظهر المنتجات هنا" />;
  const shown = lines.slice(0, limit);
  return (
    <div className="bill-stack">
      <PhoneTable
        columns={['المنتج', 'الكمية', 'المبلغ']}
        rows={shown.map(l => ({
          key: String(l.id),
          onClick: () => onOpen(l),
          cells: [
            { text: l.productName, sub: [receiptLabel(l.receiptNumber), l.salesmanName, lineCashier(l)].filter(Boolean).join(' · ') },
            { text: String(l.quantity), num: true },
            { text: moneyIq(l.salesAmount), sub: stampLabel(l.occurredAt), num: true },
          ],
        }))}
      />
      <ShowMore shown={shown.length} total={lines.length} onMore={() => setLimit(n => n + PAGE)} onAll={() => setLimit(lines.length)} />
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
  const [limit, setLimit] = useState(PAGE);
  if (!groups.length) return <Empty title="لا فواتير هذا الأسبوع" hint="عندما تُحسب مبيعات تظهر الفواتير هنا" />;
  const shown = groups.slice(0, limit);
  return (
    <div className="bill-stack">
      {shown.map(g => {
        const open = openId === g.id;
        return (
          <article key={g.id} className={`bill ${open ? 'open' : ''}`}>
            <button type="button" className="bill-head" onClick={() => setOpenId(open ? null : g.id)}>
              <span>
                <strong>{receiptLabel(g.receiptNumber)}</strong>
                <span className="cell-sub">{stampLabel(g.at)}{g.cashierName ? ` · ${g.cashierName}` : ''}</span>
                <span className="cell-sub">{g.sellers.join(' · ') || 'بائع'} · {g.count} صنف</span>
              </span>
              <span className="num">
                <strong>{moneyIq(g.sales)}</strong>
                <span className="cell-sub">{pieces(g.qty)}</span>
              </span>
            </button>
            {open && (
              <PhoneTable
                columns={['المنتج', 'الكمية', 'المبلغ']}
                rows={[
                  ...g.lines.map(l => ({
                    key: String(l.id),
                    onClick: () => onOpen(l),
                    cells: [
                      { text: l.productName, sub: l.salesmanName },
                      { text: String(l.quantity), num: true },
                      { text: moneyIq(l.salesAmount), num: true },
                    ],
                  })),
                  {
                    key: 'total',
                    total: true,
                    cells: [
                      { text: 'المجموع' },
                      { text: String(g.qty), num: true },
                      { text: moneyIq(g.sales), num: true },
                    ],
                  },
                ]}
              />
            )}
          </article>
        );
      })}
      <ShowMore shown={shown.length} total={groups.length} onMore={() => setLimit(n => n + PAGE)} onAll={() => setLimit(groups.length)} />
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
            <p className="kicker">المبيعات</p>
            <p className="num mt-1 text-[28px] font-extrabold">{moneyIq(open.salesAmount)}</p>
          </div>
          <PhoneTable
            columns={['البند', 'القيمة']}
            rows={[
              { key: 'seller', cells: [{ text: 'البائع' }, { text: open.salesmanName }] },
              { key: 'cashier', cells: [{ text: 'الكاشير' }, { text: cashierLabel(open.cashierName) || cashierLabel(open.mallName) || '—' }] },
              { key: 'receipt', cells: [{ text: 'الفاتورة' }, { text: receiptLabel(open.receiptNumber) }] },
              { key: 'time', cells: [{ text: 'الوقت' }, { text: stampLabel(open.occurredAt) }] },
              { key: 'qty', cells: [{ text: 'القطع' }, { text: pieces(open.quantity), num: true }] },
              ...(open.groupName ? [{ key: 'group', cells: [{ text: 'المجموعة' }, { text: open.groupName }] }] : []),
            ]}
          />
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
