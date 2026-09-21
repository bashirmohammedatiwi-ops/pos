import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountSummaryDto } from '@/api/types';
import { formatIqd, formatNum } from '@/lib/money';
import { focusInputVisualRight, onInputClickVisualRight, onInputFocusVisualRight } from '@/lib/focusInput';

export function CreditAccountPicker({
  accounts,
  value,
  onChange,
  disabled = false,
  onOpenChange,
}: {
  accounts: AccountSummaryDto[];
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = accounts.find(a => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, 120);
    return accounts.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.num || '').toLowerCase().includes(q) ||
      String(a.id).includes(q),
    ).slice(0, 80);
  }, [accounts, query]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => focusInputVisualRight(searchRef.current), 40);
    return () => window.clearTimeout(t);
  }, [open]);

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

  function pick(id: number) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  function toggle() {
    if (disabled) return;
    setOpen(v => !v);
    if (open) setQuery('');
  }

  return (
    <div ref={rootRef} className={`pos-credit-picker ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`pos-credit-trigger ${selected ? 'has-account' : ''} ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="pos-credit-trigger-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {selected ? (
              <path d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
            ) : (
              <>
                <rect x="3" y="6" width="18" height="12" rx="2" />
                <path d="M3 10h18" />
              </>
            )}
          </svg>
        </span>
        <span className="pos-credit-trigger-body">
          <span className="pos-credit-trigger-label">
            {selected ? (selected.name || selected.num || `#${selected.id}`) : 'نقدي — بدون آجل'}
          </span>
          {selected && (
            <span className="pos-credit-trigger-meta num">
              {selected.num ? `${selected.num} · ` : ''}{formatIqd(selected.balance)}
            </span>
          )}
        </span>
        <span className="pos-credit-trigger-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="pos-credit-panel" role="listbox">
          <div className="pos-credit-panel-head">
            <div className="pos-credit-search-wrap">
              <svg className="pos-credit-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={onInputFocusVisualRight}
                onClick={onInputClickVisualRight}
                placeholder="ابحث بالاسم أو الرقم…"
                className="pos-credit-search"
                dir="rtl"
              />
              {query && (
                <button type="button" className="pos-credit-search-clear" onClick={() => setQuery('')} aria-label="مسح">
                  ×
                </button>
              )}
            </div>
            <div className="pos-credit-panel-meta">
              {formatNum(filtered.length)} من {formatNum(accounts.length)}
            </div>
          </div>

          <div className="pos-credit-list">
            <button
              type="button"
              role="option"
              aria-selected={value === 0}
              onClick={() => pick(0)}
              className={`pos-credit-item pos-credit-item-cash ${value === 0 ? 'is-selected' : ''}`}
            >
              <span className="pos-credit-item-icon" aria-hidden>💵</span>
              <span className="pos-credit-item-body">
                <span className="pos-credit-item-name">بيع نقدي</span>
                <span className="pos-credit-item-sub">بدون حساب آجل</span>
              </span>
              {value === 0 && <span className="pos-credit-item-check" aria-hidden>✓</span>}
            </button>

            {filtered.map(a => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={value === a.id}
                onClick={() => pick(a.id)}
                className={`pos-credit-item ${value === a.id ? 'is-selected' : ''}`}
              >
                <span className="pos-credit-item-avatar" aria-hidden>
                  {(a.name || a.num || '?').slice(0, 1)}
                </span>
                <span className="pos-credit-item-body">
                  <span className="pos-credit-item-name">{a.name || a.num || `#${a.id}`}</span>
                  <span className="pos-credit-item-sub num">
                    {a.num ? `${a.num} · ` : ''}رصيد {formatIqd(a.balance)}
                  </span>
                </span>
                {value === a.id && <span className="pos-credit-item-check" aria-hidden>✓</span>}
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="pos-credit-empty">لا توجد نتائج لـ «{query}»</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
