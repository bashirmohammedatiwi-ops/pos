import { useEffect, useRef, useState } from 'react';
import type { SectionCashBoxDto } from '@/api/types';

export function cashBoxLabel(box: SectionCashBoxDto) {
  return box.masterAccountName || box.masterAccountNum || `صندوق ${box.masterAccount}`;
}

const boxLabel = cashBoxLabel;

export function CashBoxPicker({
  boxes,
  value,
  onChange,
}: {
  boxes: SectionCashBoxDto[];
  value: number;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = boxes.find(b => b.masterAccount === value) ?? null;
  const label = selected ? boxLabel(selected) : 'الصندوق الافتراضي';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (boxes.length <= 1) {
    return (
      <div className="pos-cashbox-static">
        <span className="pos-cashbox-static-icon" aria-hidden>🏦</span>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`pos-cashbox-picker ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`pos-cashbox-trigger ${open ? 'is-open' : ''}`}
        aria-expanded={open}
      >
        <span className="pos-cashbox-trigger-icon" aria-hidden>🏦</span>
        <span className="truncate">{label}</span>
        <span className="pos-cashbox-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="pos-cashbox-panel">
          {boxes.map(box => {
            const on = box.masterAccount === value;
            return (
              <button
                key={box.masterAccount}
                type="button"
                onClick={() => { onChange(box.masterAccount); setOpen(false); }}
                className={`pos-cashbox-item ${on ? 'is-selected' : ''}`}
              >
                <span className="pos-cashbox-item-name">{boxLabel(box)}</span>
                {box.isDefault && <span className="pos-cashbox-item-tag">افتراضي</span>}
                {on && <span className="pos-cashbox-item-check" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
