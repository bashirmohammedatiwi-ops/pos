import { clockLabel, dayLabel, moneyIq, receiptLabel, stampLabel } from './api';
import type { CommissionLine, GoalLine } from './api';
import { lineText, type ReceiptGroup } from './insights';
import { Empty, Sheet, useToast } from './ui';

export function LineCard({
  name, amount, receipt, at, mall, onClick,
}: {
  name: string; amount?: string; receipt?: number | null; at: string; mall?: string | null; onClick: () => void;
}) {
  return (
    <button type="button" className="line-card" onClick={onClick}>
      <span className="line-mark">{(name || 'م').trim().charAt(0)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-extrabold leading-6">{name}</span>
        <span className="line-meta">
          <span className="chip-soft">{receiptLabel(receipt)}</span>
          <span className="chip-soft">{stampLabel(at)}</span>
          {mall && <span className="chip-soft">{mall}</span>}
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
          mall={l.mallName}
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
  if (!groups.length) return <Empty title="لا فواتير هذا الأسبوع" hint="عندما تُحسب عمولة تظهر الفواتير هنا" />;
  return (
    <div className="line-stack">
      {groups.map(g => (
        <button key={g.id} type="button" className="receipt-card" onClick={() => onOpen(g.lines[0])}>
          <span className="line-mark">#</span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-extrabold">{receiptLabel(g.receiptNumber)}</span>
            <span className="line-meta">
              <span className="chip-soft">{stampLabel(g.at)}</span>
              {g.mallName && <span className="chip-soft">{g.mallName}</span>}
              <span className="chip-soft">{g.count} منتج</span>
            </span>
          </span>
          <span className="num text-[15px] font-extrabold text-gold">{moneyIq(g.commission)}</span>
        </button>
      ))}
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
          mall={l.mallName}
          onClick={() => onOpen(l)}
        />
      ))}
    </div>
  );
}

export function CommissionSheet({
  line, onClose,
}: {
  line: CommissionLine | null;
  onClose: () => void;
}) {
  const toast = useToast();
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
          <Detail label="المول" value={line.mallName || '—'} />
          {line.groupName && <Detail label="المجموعة" value={line.groupName} />}
          <Detail label="الكمية" value={String(line.quantity)} />
          <button type="button" className="copy-btn" onClick={() => void copy()}>نسخ تفاصيل الحركة</button>
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
          <Detail label="المول" value={line.mallName || '—'} />
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
