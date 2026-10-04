import { useEffect, useMemo, useRef, useState } from 'react';
import type { SalesmanDto } from '@/api/types';
import { formatNum } from '@/lib/money';
import { fixEdariName } from '@/lib/text';
import { focusInputVisualRight, onInputClickVisualRight, onInputFocusVisualRight } from '@/lib/focusInput';
import { speakSalesmanName } from '@/lib/speakName';

export function SalesmanPicker({
  title,
  subtitle,
  salesmen,
  onPick,
  onClear,
  onClose,
  idHint = 'اكتب رقم البائع واضغط Enter',
}: {
  title: string;
  subtitle?: string;
  salesmen: SalesmanDto[];
  onPick: (s: SalesmanDto) => void;
  onClear?: () => void;
  onClose: () => void;
  idHint?: string;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const showNone = Boolean(onClear);

  const filtered = useMemo(() => {
    if (!q) return salesmen.slice(0, 80);
    return salesmen.filter(s =>
      s.name.toLowerCase().includes(q) || String(s.id).includes(q),
    ).slice(0, 60);
  }, [q, salesmen]);

  useEffect(() => {
    const t = window.setTimeout(() => focusInputVisualRight(searchRef.current), 40);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pickSalesman(s: SalesmanDto) {
    if (s.id !== 0) speakSalesmanName(s.name);
    onPick(s);
  }

  function tryPickById() {
    const raw = query.trim();
    if (!/^\d+$/.test(raw)) return false;
    const id = Number(raw);
    if (id === 0) {
      onClear?.();
      onClose();
      return true;
    }
    const hit = salesmen.find(s => s.id === id);
    if (!hit) return false;
    pickSalesman(hit);
    return true;
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (tryPickById()) return;
    if (filtered.length === 1) {
      pickSalesman(filtered[0]!);
    }
  }

  return (
    <div className="pos-overlay" onClick={onClose}>
      <div className="pos-salesman-dialog" dir="rtl" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pos-salesman-head">
          <div>
            <h2 className="pos-salesman-title">{title}</h2>
            {subtitle && <p className="pos-salesman-sub">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="pos-salesman-close" aria-label="إغلاق">×</button>
        </div>

        <div className="pos-salesman-search-wrap">
          <svg className="pos-salesman-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={onInputFocusVisualRight}
            onClick={onInputClickVisualRight}
            placeholder={idHint}
            className="pos-salesman-search"
            dir="rtl"
            inputMode="search"
          />
          {query && (
            <button type="button" className="pos-salesman-search-clear" onClick={() => setQuery('')} aria-label="مسح">
              ×
            </button>
          )}
        </div>

        <div className="pos-salesman-meta num">
          {formatNum(filtered.length)} من {formatNum(salesmen.length)} · Enter للرقم
        </div>

        <div className={`pos-salesman-body ${showNone ? 'has-none' : ''}`}>
          <div className="pos-salesman-list">
            {filtered.map(s => {
              const name = fixEdariName(s.name) || `#${s.id}`;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSalesman(s)}
                  className="pos-salesman-item"
                >
                  <span className="pos-salesman-avatar" aria-hidden>{name.slice(0, 1)}</span>
                  <span className="pos-salesman-item-name" title={name}>{name}</span>
                  <span className="pos-salesman-item-id num">#{s.id}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="pos-salesman-empty">
                {salesmen.length === 0 ? 'لا يوجد بائعون — زامن الكتالوج' : `لا نتائج لـ «${query}»`}
              </div>
            )}
          </div>
          {showNone && (
            <button
              type="button"
              onClick={() => { onClear?.(); onClose(); }}
              className="pos-salesman-none"
            >
              <span className="pos-salesman-none-mark" aria-hidden>0</span>
              <span className="pos-salesman-none-label">بدون بائع</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
