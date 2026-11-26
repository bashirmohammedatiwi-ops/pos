import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { I } from './kit';
import { getThemePref, haptic, setThemePref } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * البحث السريع في الموقع (الحاسبة): Ctrl+K أو «/» يفتح نافذة تكتب فيها اسم أي صفحة
 * وتنتقل إليها بـ Enter. يفهم العربية بلا همزات أو تشكيل (اسعار = أسعار، تقرير = تقارير).
 * ───────────────────────────────────────────────────────────────────────────── */

export type PaletteItem = { id: string; label: string; group: string; icon: ReactNode; to?: string; run?: () => void; hint?: string; keys?: string };

/** توحيد الكتابة العربية للبحث: بلا تشكيل ولا تطويل، والهمزات والتاء المربوطة والياء موحّدة */
export function normAr(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/^ال|\sال/g, m => m.replace('ال', ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function score(item: PaletteItem, q: string) {
  if (!q) return 1;
  const hay = normAr(`${item.label} ${item.keys ?? ''} ${item.group}`);
  const words = normAr(q).split(' ').filter(Boolean);
  let total = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) {
      // جذر قريب: «تقرير» تطابق «تقارير» بحذف حروف المد
      const loose = w.replace(/[اوي]/g, '');
      if (loose.length < 2 || !hay.replace(/[اوي]/g, '').includes(loose)) return 0;
      total += 1;
    } else total += i === 0 || hay[i - 1] === ' ' ? 4 : 2;
  }
  return total;
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** يفتح النافذة بـ Ctrl/⌘+K أو «/» (خارج حقول الكتابة) */
export function usePaletteHotkey(open: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !isTyping(e.target)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, enabled]);
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function Palette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  // أوامر عامة بعد الصفحات
  const all = useMemo<PaletteItem[]>(() => {
    const dark = (document.documentElement.dataset.theme ?? 'dark') === 'dark';
    return [
      ...items,
      {
        id: 'theme',
        label: dark ? 'المظهر الفاتح' : 'المظهر الداكن',
        group: 'أوامر',
        keys: 'ثيم لون مظهر وضع ليلي نهاري dark light',
        icon: <I.sun size={18} />,
        run: () => setThemePref(dark ? 'light' : 'dark'),
      },
      ...(getThemePref() !== 'system'
        ? [{ id: 'theme-sys', label: 'المظهر حسب الجهاز', group: 'أوامر', keys: 'تلقائي نظام', icon: <I.sun size={18} />, run: () => setThemePref('system') }]
        : []),
      { id: 'reload', label: 'تحديث الصفحة', group: 'أوامر', keys: 'اعادة تحميل refresh', icon: <I.refresh size={18} />, run: () => location.reload() },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, open]);

  const shown = useMemo(
    () =>
      all
        .map((it, i) => ({ it, s: score(it, q), i }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map(x => x.it)
        .slice(0, 12),
    [all, q],
  );

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    setQ('');
    setSel(0);
    const id = window.setTimeout(() => input.current?.focus(), 10);
    return () => {
      window.clearTimeout(id);
      back.current?.focus?.();
    };
  }, [open]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  function go(it: PaletteItem | undefined) {
    if (!it) return;
    haptic('select');
    onClose();
    if (it.to) nav(it.to);
    else it.run?.();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(s => (shown.length ? (s + 1) % shown.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(s => (shown.length ? (s - 1 + shown.length) % shown.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(shown[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') e.preventDefault();
  }

  let lastGroup = '';
  return createPortal(
    <div className="pk-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="pk" role="dialog" aria-modal="true" aria-label="البحث السريع" onKeyDown={onKey}>
        <div className="pk-field">
          <I.search size={19} />
          <input
            ref={input}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="اكتب اسم صفحة أو أمر…"
            aria-label="ابحث"
            role="combobox"
            aria-expanded="true"
            aria-controls="pk-list"
            aria-activedescendant={shown[sel] ? `pk-${shown[sel].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="pk-list" id="pk-list" role="listbox" ref={list}>
          {shown.length === 0 && <p className="pk-empty">لا توجد صفحة بهذا الاسم</p>}
          {shown.map((it, i) => {
            const head = !q && it.group !== lastGroup ? it.group : '';
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head && <p className="pk-group">{head}</p>}
                <button
                  type="button"
                  id={`pk-${it.id}`}
                  role="option"
                  aria-selected={i === sel}
                  data-i={i}
                  className={`pk-item ${i === sel ? 'on' : ''}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => go(it)}
                  tabIndex={-1}
                >
                  <span className="pk-ico">{it.icon}</span>
                  <span className="pk-lbl">{it.label}</span>
                  {q && <span className="pk-grp">{it.group}</span>}
                  {it.hint && <span className="pk-hint num">{it.hint}</span>}
                  <span className="pk-enter" aria-hidden>
                    ↵
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="pk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> للتنقل
          </span>
          <span>
            <kbd>Enter</kbd> للفتح
          </span>
          <span>
            <kbd>{isMac() ? '⌘' : 'Ctrl'}</kbd>
            <kbd>K</kbd> في أي وقت
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
