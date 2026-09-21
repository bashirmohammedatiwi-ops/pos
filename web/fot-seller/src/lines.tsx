import { useMemo, useState } from 'react';
import { clockLabel, dayLabel, moneyIq, receiptLabel, stampLabel } from './api';
import type { CommissionLine, GoalLine } from './api';
import { lineText, type ReceiptGroup } from './insights';
import { Empty, Sheet, useToast } from './ui';

export function LineCard({
  name, amount, receipt, at, onClick,
}: {
  name: string; amount?: string; receipt?: number | null; at: string; onClick: () => void;
}) {
  return (
    <button type="button" className="line-card" onClick={onClick}>
      <span className="line-mark">{(name || 'م').trim().charAt(0)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-extrabold leading-6">{name}</span>
        <span className="line-meta">
          <span className="chip-soft">{receiptLabel(receipt)}</span>
          <span className="chip-soft">{stampLabel(at)}</span>
        </span>
      </span>
      {amount && <span className="num text-[15px] font-extrabold text-gold">{amount}</span>}
    </button>
  );
}

export function CommissionList({
  lines, onOpen, empty,
}: {
  lines: CommissionLine[];
  onOpen: (line: CommissionLine) => void;
  empty?: string;
}) {
  if (!lines.length) return <Empty title={empty || 'لا عمولة هذا الأسبوع'} hint="ستظهر هنا كل المنتجات التي أخذت عليها عمولة" />;
  return (
    <div className="line-stack">
      {lines.map(l => (
        <LineCard
          key={l.id}
          name={l.productName}
          amount={moneyIq(l.commissionAmount)}
          receipt={l.receiptNumber}
          at={l.occurredAt}
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
  onOpen: (line: CommissionLine) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!groups.length) return <Empty title="لا فواتير هذا الأسبوع" hint="عندما تُحسب عمولة تظهر الفواتير هنا" />;
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
                  <span className="chip-soft">{stampLabel(g.at)}</span>
                  <span className="chip-soft">{g.count} منتج</span>
                </span>
              </span>
              <span className="num text-[15px] font-extrabold text-gold">{moneyIq(g.commission)}</span>
            </button>
            {open && (
              <div className="receipt-lines">
                {g.lines.map(l => (
                  <LineCard
                    key={l.id}
                    name={l.productName}
                    amount={moneyIq(l.commissionAmount)}
                    receipt={l.receiptNumber}
                    at={l.occurredAt}
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

export function GoalLineList({
  lines, onOpen,
}: {
  lines: GoalLine[];
  onOpen: (line: GoalLine) => void;
}) {
  if (!lines.length) return <Empty title="لا حركة على هذا الهدف" hint="عندما تُحسب كمية أو مبلغ الهدف تظهر المنتجات هنا" />;
  return (
    <div className="line-stack">
      {lines.map((l, i) => (
        <LineCard
          key={`${l.receiptNumber ?? 'x'}-${l.occurredAt}-${i}`}
          name={l.productName}
          amount={`${l.quantity}`}
          receipt={l.receiptNumber}
          at={l.occurredAt}
          onClick={() => onOpen(l)}
        />
      ))}
    </div>
  );
}

export function CommissionSheet({
  line, lines = [], onClose, onOpen,
}: {
  line: CommissionLine | null;
  lines?: CommissionLine[];
  onClose: () => void;
  onOpen?: (line: CommissionLine) => void;
}) {
  const toast = useToast();
  const related = useMemo(
    () => line ? lines.filter(l => l.id !== line.id && l.productName === line.productName).slice(0, 6) : [],
    [line, lines],
  );
  const invoice = useMemo(
    () => line?.receiptNumber != null
      ? lines.filter(l => l.id !== line.id && l.receiptNumber === line.receiptNumber).slice(0, 8)
      : [],
    [line, lines],
  );
  async function copy() {
    if (!line) return;
    try {
      await navigator.clipboard.writeText(lineText(line));
      toast('تم نسخ التفاصيل');
    } catch {
      toast('تعذر النسخ');
    }
  }
  return (
    <Sheet open={!!line} title={line?.productName || 'تفاصيل العمولة'} onClose={onClose}>
      {line && (
        <div className="detail-grid">
          <div className="detail-hero">
            <p className="kicker">عمولتك من هذا المنتج</p>
            <p className="num mt-1 text-[32px] font-extrabold text-gold">{moneyIq(line.commissionAmount)}</p>
          </div>
          <Detail label="المنتج" value={line.productName} />
          <Detail label="رقم الفاتورة" value={receiptLabel(line.receiptNumber)} />
          <Detail label="التاريخ" value={dayLabel(line.occurredAt)} />
          <Detail label="الوقت" value={clockLabel(line.occurredAt) || '—'} />
          {line.groupName && <Detail label="المجموعة" value={line.groupName} />}
          <Detail label="الكمية" value={String(line.quantity)} />
          <button type="button" className="copy-btn" onClick={() => void copy()}>نسخ تفاصيل الحركة</button>
          {invoice.length > 0 && (
            <div>
              <p className="kicker">باقي منتجات نفس الفاتورة</p>
              <div className="mt-2 space-y-2">
                {invoice.map(l => (
                  <LineCard
                    key={l.id}
                    name={l.productName}
                    amount={moneyIq(l.commissionAmount)}
                    receipt={l.receiptNumber}
                    at={l.occurredAt}
                    onClick={() => onOpen?.(l)}
                  />
                ))}
              </div>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <p className="kicker">حركات أخرى لنفس المنتج</p>
              <div className="mt-2 space-y-2">
                {related.map(l => (
                  <LineCard
                    key={l.id}
                    name={stampLabel(l.occurredAt)}
                    amount={moneyIq(l.commissionAmount)}
                    receipt={l.receiptNumber}
                    at={l.occurredAt}
                    onClick={() => onOpen?.(l)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function GoalLineSheet({
  line, onClose,
}: {
  line: GoalLine | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!line} title={line?.productName || 'تفاصيل الهدف'} onClose={onClose}>
      {line && (
        <div className="detail-grid">
          <div className="detail-hero goal">
            <p className="kicker">حركة الهدف</p>
            <p className="num mt-1 text-[32px] font-extrabold text-goal">{line.quantity}</p>
          </div>
          <Detail label="المنتج" value={line.productName} />
          <Detail label="رقم الفاتورة" value={receiptLabel(line.receiptNumber)} />
          <Detail label="التاريخ" value={dayLabel(line.occurredAt)} />
          <Detail label="الوقت" value={clockLabel(line.occurredAt) || '—'} />
        </div>
      )}
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-cell">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
