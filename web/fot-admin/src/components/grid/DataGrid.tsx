import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatNum } from '@/api/client';
import { Loading } from '@/components/ui';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DataGrid — الجدول الموحد بمستوى إكسل لكل لوحة التحكم.
 *
 *   فرز فوري · تغيير عرض الأعمدة بالسحب (RTL) · تثبيت أعمدة بظل ·
 *   صف فلاتر سريعة · نسخ TSV للحافظة (لصق في إكسل) · تصدير CSV ·
 *   صف مجاميع ثابت (مجموع/عدد/متوسط/نص) · كثافة عرض · تلوين صفوف شرطي.
 *   بلا مكتبات خارجية — React + Tailwind فقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type GridAlign = 'start' | 'center' | 'end';

export interface GridColumn<T> {
  key: string;
  header: string;
  width?: number;
  align?: GridAlign;
  /** أرقام — خط أحادي المسافات بعرض ثابت. */
  mono?: boolean;
  sortable?: boolean;
  /** تثبيت العمود يمين (بداية RTL) أو يسار (نهاية). */
  pinned?: 'start' | 'end';
  /** مفتاح فرز بديل إن كانت الخلية كائناً/منسقة. */
  sortValue?: (row: T) => string | number;
  /** قيمة الفلتر السريع — افتراضياً String(row[key]). */
  filterValue?: (row: T) => string;
  render?: (row: T, index: number) => React.ReactNode;
  /** صف المجاميع: sum | count | avg | نص مخصص عبر footerText. */
  footer?: 'sum' | 'count' | 'avg' | 'text';
  footerText?: string;
  /** لا تُدرج في النسخ/التصدير (أزرار وأفعال). */
  exportable?: boolean;
  /** تحرير مباشر في الخلية (نقرة مزدوجة) — Enter يحفظ، Escape يلغي. */
  edit?: {
    getValue: (row: T) => string | number;
    onCommit: (row: T, raw: string) => void | Promise<void>;
    type?: 'number' | 'text';
  };
}

export type GridSortDir = 'asc' | 'desc' | null;
export interface GridSort { key: string; dir: Exclude<GridSortDir, null> }

interface GridStore {
  dense?: boolean;
  widths?: Record<string, number>;
  pinned?: string[];
  hidden?: string[];
  sort?: GridSort | null;
  filterTexts?: Record<string, string>;
  filtersOn?: boolean;
}

export interface DataGridProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  getRowId: (row: T, index: number) => string | number;
  loading?: boolean;
  emptyText?: string;
  maxHeight?: string;
  initialSort?: GridSort;
  /** أزرار/أدوات تُعرض في شريط الجدول الأيمن. */
  toolbar?: React.ReactNode;
  /** شارة تُعرض بجانب عدد الصفوف. */
  badge?: React.ReactNode;
  /** صف تلوين شرطي — أعد صنف tailwind للخلفية. */
  rowTone?: (row: T) => string | undefined;
  onRowClick?: (row: T, index: number) => void;
  onRowDoubleClick?: (row: T, index: number) => void;
  /** توسيع الصف داخل الجدول: سهم ↓ يفتح لوحة تفاصيل تحت الصف — بلا صفحة أو نافذة. */
  expansion?: {
    isExpanded: (row: T, index: number) => boolean;
    onToggle: (row: T, index: number) => void;
    render: (row: T, index: number) => React.ReactNode;
  };
  /** اسم ملف التصدير (بدون امتداد). */
  exportName?: string;
  /** إظهار صف الفلاتر السريعة افتراضياً. */
  filters?: boolean;
  /** إظهار أزرار النسخ/التصدير. */
  exportButtons?: boolean;
  /** نص عمود العدّاد في المجاميع. */
  counterLabel?: string;
  dense?: boolean;
  onDensityChange?: (d: boolean) => void;
  /** قيمة مفتاح الفرز الخارجي (فرز خادم). */
  sort?: GridSort | null;
  onSortChange?: (s: GridSort | null) => void;
  /** مفتاح حفظ تخصيصات الجدول (عرض الأعمدة/تثبيتها/إظهارها/الفرز/الفلاتر/الكثافة) — تُستعاد تلقائياً. */
  storageKey?: string;
  /** معرّف الصف المحدد — يظلل الصف ويدعم ↑↓ + Enter. */
  selectedId?: string | number;
  onSelect?: (row: T, index: number) => void;
  /** Enter على الصف المحدد (فتح تحرير/تفاصيل). */
  onEnter?: (row: T, index: number) => void;
  /** داخل ListPageShell — بلا إطار خارجي، يملأ الارتفاع المتاح. */
  embedded?: boolean;
  /** مع embedded: منطقة الجدول تتمدد بدل maxHeight ثابت. */
  fillHeight?: boolean;
  /** شبكة بحدود خلايا كاملة مثل ورقة إكسل. */
  variant?: 'default' | 'sheet';
}

const ALIGN_CLASS: Record<GridAlign, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

function cellText<T>(col: GridColumn<T>, row: T): string {
  const v = (row as Record<string, unknown>)[col.key];
  if (col.sortValue) {
    const sv = col.sortValue(row);
    return typeof sv === 'number' ? formatNum(sv) : String(sv);
  }
  if (v == null) return '';
  if (typeof v === 'number') return formatNum(v);
  return String(v);
}

export function DataGrid<T>({
  columns,
  rows,
  getRowId,
  loading,
  emptyText = 'لا بيانات',
  maxHeight = 'calc(100vh - 300px)',
  initialSort,
  toolbar,
  badge,
  rowTone,
  onRowClick,
  onRowDoubleClick,
  expansion,
  exportName = 'تصدير',
  filters = false,
  exportButtons = true,
  counterLabel = 'صف',
  dense: denseProp,
  onDensityChange,
  sort: sortProp,
  onSortChange,
  storageKey,
  selectedId,
  onSelect,
  onEnter,
  embedded = false,
  fillHeight = false,
  variant = 'default',
}: DataGridProps<T>) {
  const storeKey = storageKey ? `fot_grid_${storageKey}` : null;

  function loadStore(): Partial<GridStore> {
    if (!storeKey) return {};
    try {
      return JSON.parse(localStorage.getItem(storeKey) || '{}') as Partial<GridStore>;
    } catch {
      return {};
    }
  }

  const [denseState, setDenseState] = useState<boolean>(() => loadStore().dense ?? denseProp ?? true);
  const dense = denseProp ?? denseState;
  const [widths, setWidths] = useState<Record<string, number>>(() => loadStore().widths ?? {});
  const [pinnedSet, setPinnedSet] = useState<Set<string>>(() => new Set(loadStore().pinned ?? columns.filter(c => c.pinned).map(c => c.key)));
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(() => new Set(loadStore().hidden ?? []));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [internalSort, setInternalSort] = useState<GridSort | null>(() => (sortProp !== undefined ? null : loadStore().sort ?? initialSort ?? null));
  const sort = sortProp !== undefined ? sortProp : internalSort;
  const [filtersOn, setFiltersOn] = useState(() => loadStore().filtersOn ?? filters);
  const [filterTexts, setFilterTexts] = useState<Record<string, string>>(() => loadStore().filterTexts ?? {});
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<{ rowId: string | number; key: string; draft: string } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);

  const visibleColumns = useMemo(() => columns.filter(c => !hiddenSet.has(c.key)), [columns, hiddenSet]);

  // ── حفظ التخصيصات ──
  useEffect(() => {
    if (!storeKey) return;
    const data: GridStore = {
      dense,
      widths,
      pinned: [...pinnedSet],
      hidden: [...hiddenSet],
      sort: internalSort,
      filterTexts,
      filtersOn,
    };
    try {
      localStorage.setItem(storeKey, JSON.stringify(data));
    } catch { /* التخزين ممتلئ */ }
  }, [storeKey, dense, widths, pinnedSet, hiddenSet, internalSort, filterTexts, filtersOn]);

  // ── إغلاق قائمة الأعمدة عند النقر خارجها ──
  useEffect(() => {
    if (!columnsOpen) return;
    const close = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [columnsOpen]);

  const setDensity = (d: boolean) => {
    setDenseState(d);
    onDensityChange?.(d);
  };

  // ── الفلترة السريعة ──
  const filtered = useMemo(() => {
    const active = Object.entries(filterTexts).filter(([, v]) => v.trim());
    if (!active.length) return rows;
    return rows.filter(row =>
      active.every(([key, needle]) => {
        const col = columns.find(c => c.key === key);
        if (!col) return true;
        const hay = col.filterValue ? col.filterValue(row) : String((row as Record<string, unknown>)[key] ?? '');
        return hay.toLowerCase().includes(needle.trim().toLowerCase());
      }),
    );
  }, [rows, filterTexts, columns]);

  // ── الفرز ──
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return filtered;
    const get = (row: T): string | number => {
      if (col.sortValue) return col.sortValue(row);
      const v = (row as Record<string, unknown>)[col.key];
      return typeof v === 'number' ? v : String(v ?? '').toLowerCase();
    };
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      return String(va).localeCompare(String(vb), 'ar') * mul;
    });
  }, [filtered, sort, columns]);

  function toggleSort(key: string) {
    const next: GridSort | null =
      sort?.key !== key
        ? { key, dir: 'asc' }
        : sort!.dir === 'asc'
          ? { key, dir: 'desc' }
          : null;
    if (onSortChange) onSortChange(next);
    else setInternalSort(next);
  }

  // ── تغيير العرض بالسحب (يعمل مع RTL عبر اتجاه المستند) ──
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current) return;
      const { key, startX, startW } = resizing.current;
      const rtl = document.documentElement.dir === 'rtl';
      const delta = rtl ? startX - e.clientX : e.clientX - startX;
      setWidths(w => ({ ...w, [key]: Math.max(60, Math.min(560, startW + delta)) }));
    }
    function onUp() {
      resizing.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startResize(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW: widths[key] ?? columns.find(c => c.key === key)?.width ?? 140 };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // ── مواضع التثبيت (RTL: start = يمين) ──
  const pinnedOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let accStart = 0;
    for (const c of columns) {
      if (pinnedSet.has(c.key) && c.pinned === 'start') {
        offsets[c.key] = accStart;
        accStart += widths[c.key] ?? c.width ?? 140;
      }
    }
    let accEnd = 0;
    for (let i = columns.length - 1; i >= 0; i--) {
      const c = columns[i];
      if (pinnedSet.has(c.key) && c.pinned === 'end') {
        offsets[c.key] = accEnd;
        accEnd += widths[c.key] ?? c.width ?? 140;
      }
    }
    return offsets;
  }, [columns, pinnedSet, widths]);

  function togglePin(key: string) {
    setPinnedSet(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── المجاميع ──
  const footerCells = useMemo(() => {
    const out: Record<string, React.ReactNode> = {};
    for (const c of columns) {
      if (!c.footer) continue;
      if (c.footer === 'text') {
        out[c.key] = c.footerText ?? '';
        continue;
      }
      const nums = sorted
        .map(r => (r as Record<string, unknown>)[c.key])
        .filter((v): v is number => typeof v === 'number');
      if (c.footer === 'count') {
        out[c.key] = formatNum(sorted.length);
      } else if (c.footer === 'sum') {
        out[c.key] = formatNum(nums.reduce((s, v) => s + v, 0));
      } else {
        out[c.key] = nums.length ? formatNum(nums.reduce((s, v) => s + v, 0) / nums.length) : '—';
      }
    }
    return out;
  }, [columns, sorted]);

  // ── نسخ TSV / تصدير CSV (الأعمدة الظاهرة فقط — كما تراه هو ما تُصدّره) ──
  const exportColumns = useMemo(() => visibleColumns.filter(c => c.exportable !== false), [visibleColumns]);

  const tsv = useCallback(
    () =>
      [
        exportColumns.map(c => c.header).join('\t'),
        ...sorted.map(r => exportColumns.map(c => cellText(c, r)).join('\t')),
      ].join('\n'),
    [exportColumns, sorted],
  );

  async function copyTsv() {
    try {
      await navigator.clipboard.writeText(tsv());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* الحافظة غير متاحة */ }
  }

  function exportCsv() {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = '\uFEFF' + tsv().split('\n').map(line => line.split('\t').map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const hasPinned = pinnedSet.size > 0;
  const sheet = variant === 'sheet';
  const pad = sheet ? 'px-1.5 py-1' : embedded ? 'px-2 py-1' : dense ? 'px-2.5 py-1.5' : 'px-3 py-2.5';
  const headPad = sheet ? 'px-1.5 py-1' : embedded ? 'px-2 py-1.5' : dense ? 'px-2.5 py-2' : 'px-3 py-2.5';
  const tableText = sheet ? 'text-[12px] leading-4' : embedded ? 'text-[11.5px]' : 'text-[12.5px]';
  const thBase = sheet
    ? `sticky top-0 border border-[#b4b4b4] bg-[#ededed] ${headPad}`
    : `sticky top-0 border-b border-slate-200 bg-slate-50 ${headPad}`;
  const tdBase = sheet ? `border border-[#d0d0d0] ${pad}` : pad;
  const tfBase = sheet
    ? `sticky bottom-0 border border-[#b4b4b4] bg-[#e8e8e8] ${pad}`
    : `sticky bottom-0 border-t-2 border-slate-300 bg-slate-100/95 ${pad}`;

  // ── تحرير الخلية ──
  function startEdit(row: T, index: number, col: GridColumn<T>) {
    if (!col.edit) return;
    setEditing({ rowId: getRowId(row, index), key: col.key, draft: String(col.edit.getValue(row)) });
  }

  async function commitEdit(row: T, col: GridColumn<T>) {
    if (!editing || !col.edit) return;
    const raw = editing.draft;
    setEditing(null);
    const original = String(col.edit.getValue(row));
    if (raw === original.trim() || raw.trim() === '') return;
    await col.edit.onCommit(row, raw.trim());
  }

  function cancelEdit() {
    setEditing(null);
  }

  // ── لوحة المفاتيح: ↑↓ تحديد، Enter فتح ──
  function onTableKeyDown(e: React.KeyboardEvent) {
    if (editing || !onSelect || !sorted.length) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, button')) return;
    e.preventDefault();
    const currentIdx = sorted.findIndex((r, i) => String(getRowId(r, i)) === String(selectedId));
    if (e.key === 'ArrowDown') {
      const next = sorted[Math.min(sorted.length - 1, currentIdx + 1)];
      if (next) onSelect(next, currentIdx + 1);
    } else if (e.key === 'ArrowUp') {
      const prev = sorted[Math.max(0, currentIdx - 1)];
      if (prev) onSelect(prev, Math.max(0, currentIdx - 1));
    } else if (e.key === 'Enter' && currentIdx >= 0) {
      onEnter?.(sorted[currentIdx], currentIdx);
    }
  }

  const scrollClass = fillHeight ? 'min-h-0 flex-1 overflow-auto' : 'overflow-auto';

  return (
    <div
      className={
        embedded
          ? 'flex h-full min-h-0 flex-col overflow-hidden bg-white'
          : 'overflow-hidden rounded-lg border border-slate-200 bg-white'
      }
    >
      {/* ── شريط الأدوات ── */}
      <div
        className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-2 ${embedded ? 'py-1' : 'px-3 py-2'}`}
      >
        <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
          {loading ? '…' : formatNum(sorted.length)} {counterLabel}
        </span>
        {badge}
        <div className="flex-1" />
        {exportButtons && (
          <>
            <button
              type="button"
              onClick={copyTsv}
              title="نسخ الجدول — الصقه مباشرة في إكسل"
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                copied ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {copied ? '✓ نُسخ للحافظة' : 'نسخ'}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              title="تصدير CSV (يدعم العربية في إكسل)"
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            >
              CSV
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setFiltersOn(f => !f)}
          title="فلاتر سريعة"
          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
            filtersOn ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          فلترة
        </button>
        <div ref={columnsRef} className="relative">
          <button
            type="button"
            onClick={() => setColumnsOpen(o => !o)}
            title="إظهار/إخفاء الأعمدة"
            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
              columnsOpen ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            الأعمدة ▾
          </button>
          {columnsOpen && (
            <div className="absolute end-0 top-full z-30 mt-1 max-h-64 w-52 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lift">
              <p className="px-2 py-1 text-[10.5px] font-bold text-slate-400">إظهار الأعمدة</p>
              {columns.map(c => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenSet.has(c.key)}
                    onChange={e => {
                      const key = c.key;
                      setHiddenSet(prev => {
                        const next = new Set(prev);
                        // لا تُخفِ آخر عمود ظاهر
                        if (e.target.checked) next.delete(key);
                        else if (visibleColumns.length > 1) next.add(key);
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5 accent-[--color-brand-500]"
                  />
                  <span className="truncate">{c.header}</span>
                </label>
              ))}
              <button
                type="button"
                onClick={() => {
                  setHiddenSet(new Set());
                  setPinnedSet(new Set(columns.filter(c => c.pinned).map(c => c.key)));
                  setWidths({});
                  setFilterTexts({});
                  setInternalSort(null);
                }}
                className="mt-1 w-full rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100"
              >
                إعادة ضبط الجدول
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDensity(!dense)}
          title={dense ? 'عرض مريح' : 'عرض مدمج'}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100"
        >
          {dense ? '↕ مريح' : '↕ مدمج'}
        </button>
        {toolbar}
      </div>

      {/* ── الجدول ── */}
      <div className={scrollClass} style={fillHeight ? undefined : { maxHeight }}>
        <table ref={tableRef} tabIndex={onSelect ? 0 : undefined} onKeyDown={onTableKeyDown} className={`w-full border-separate border-spacing-0 ${tableText} ${onSelect ? 'outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20' : ''}`}>
          <thead>
            <tr>
              {expansion && (
                <th className={`${thBase} w-10 px-1`} />
              )}
              {visibleColumns.map((c, i) => {
                const w = widths[c.key] ?? c.width;
                const pinned = pinnedSet.has(c.key);
                const side = c.pinned === 'end' ? 'left' : 'right';
                const isSorted = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    style={{
                      width: w,
                      minWidth: w,
                      ...(pinned ? { [side === 'right' ? 'right' : 'left']: pinnedOffsets[c.key], zIndex: 12 } : {}),
                    }}
                    className={`group/th ${thBase} ${ALIGN_CLASS[c.align ?? (c.mono ? 'end' : 'start')]} ${
                      pinned ? 'sticky' : ''
                    }`}
                  >
                    <div className={`flex items-center gap-1 ${c.align === 'center' ? 'justify-center' : c.align === 'end' || c.mono ? 'justify-end' : ''}`}>
                      {c.sortable !== false ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={`flex min-w-0 items-center gap-1 font-bold transition hover:text-brand-700 ${
                            isSorted ? 'text-brand-700' : 'text-slate-600'
                          }`}
                          title="فرز"
                        >
                          <span className="truncate">{c.header}</span>
                          <span className={`shrink-0 text-[9px] ${isSorted ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40'}`}>
                            {isSorted ? (sort!.dir === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        </button>
                      ) : (
                        <span className="truncate font-bold text-slate-600">{c.header}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => togglePin(c.key)}
                        title={pinned ? 'إلغاء التثبيت' : 'تثبيت العمود'}
                        className={`shrink-0 rounded p-0.5 text-[9px] transition ${
                          pinned ? 'text-brand-600 opacity-100' : 'text-slate-300 opacity-0 hover:text-slate-500 group-hover/th:opacity-100'
                        }`}
                      >
                        ⚿
                      </button>
                    </div>
                    {/* مقبض تغيير العرض */}
                    <span
                      onMouseDown={e => startResize(e, c.key)}
                      className="absolute inset-y-0 -ms-1 w-2 cursor-col-resize transition hover:bg-brand-300/40"
                      style={{ [c.pinned === 'end' ? 'left' : 'right']: 0 } as React.CSSProperties}
                    />
                    {hasPinned && pinned && i !== visibleColumns.length - 1 && (
                      <span className="pointer-events-none absolute inset-y-0 shadow-[-4px_0_6px_-4px_rgba(15,23,42,0.12)]" style={{ [side === 'right' ? 'right' : 'left']: '100%', width: 4 } as React.CSSProperties} />
                    )}
                  </th>
                );
              })}
            </tr>
            {filtersOn && (
              <tr>
                {expansion && <th className={`${sheet ? 'border border-[#b4b4b4] bg-[#ededed]' : 'border-b border-slate-100 bg-slate-50/95'} sticky top-[34px] px-1 py-1`} />}
                {visibleColumns.map(c => (
                  <th
                    key={`f-${c.key}`}
                    style={{
                      ...(pinnedSet.has(c.key) ? {
                        [c.pinned === 'end' ? 'left' : 'right']: pinnedOffsets[c.key],
                        zIndex: 11,
                      } : {}),
                      width: widths[c.key] ?? c.width,
                      minWidth: widths[c.key] ?? c.width,
                    }}
                    className={`sticky top-[34px] px-1 py-1 ${sheet ? 'border border-[#b4b4b4] bg-[#ededed]' : 'border-b border-slate-100 bg-slate-50/95'} ${pinnedSet.has(c.key) ? 'sticky' : ''}`}
                  >
                    <input
                      value={filterTexts[c.key] ?? ''}
                      onChange={e => setFilterTexts(f => ({ ...f, [c.key]: e.target.value }))}
                      placeholder="…"
                      className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={visibleColumns.length + (expansion ? 1 : 0)} className="p-6"><Loading /></td>
              </tr>
            )}
            {!loading &&
              sorted.flatMap((row, idx) => {
                const id = getRowId(row, idx);
                const tone = rowTone?.(row);
                const isOpen = expansion ? expansion.isExpanded(row, idx) : false;
                const isSelected = selectedId !== undefined && String(id) === String(selectedId);
                const handleRowClick = expansion
                  ? () => expansion.onToggle(row, idx)
                  : onRowClick
                    ? () => onRowClick(row, idx)
                    : undefined;
                const mainRow = (
                  <tr
                    key={id}
                    onClick={e => {
                      onSelect?.(row, idx);
                      handleRowClick?.();
                      void e;
                    }}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row, idx) : undefined}
                    className={`${sheet ? '' : 'border-b border-slate-50'} ${idx % 2 ? (sheet ? 'bg-[#f7f7f7]' : 'bg-slate-50/40') : 'bg-white'} ${tone ?? ''} ${
                      handleRowClick || onSelect ? (sheet ? 'cursor-pointer hover:bg-[#ddebf7]' : 'cursor-pointer hover:bg-brand-50/50') : 'hover:bg-slate-50'
                    } ${isOpen ? (sheet ? '!bg-[#cfe2f3]' : '!bg-brand-50/70') : ''} ${isSelected ? (sheet ? '!bg-[#cfe2f3]' : '!bg-brand-100/80 outline outline-1 -outline-offset-1 outline-brand-300') : ''}`}
                  >
                    {expansion && (
                      <td className={`${tdBase} w-10 text-center text-[11px] text-slate-600`}>
                        <span className={`inline-block transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                      </td>
                    )}
                    {visibleColumns.map(c => {
                      const pinned = pinnedSet.has(c.key);
                      const side = c.pinned === 'end' ? 'left' : 'right';
                      const editingThis = editing && editing.rowId === id && editing.key === c.key;
                      return (
                        <td
                          key={c.key}
                          style={pinned ? { [side === 'right' ? 'right' : 'left']: pinnedOffsets[c.key], zIndex: 5 } : undefined}
                          onDoubleClick={c.edit ? e => { e.stopPropagation(); startEdit(row, idx, c); } : undefined}
                          className={`${tdBase} ${ALIGN_CLASS[c.align ?? (c.mono ? 'end' : 'start')]} ${
                            c.mono ? 'num font-semibold text-slate-800' : 'text-slate-700'
                          } ${pinned ? 'sticky bg-inherit' : ''} ${c.edit ? 'transition hover:bg-brand-100/40' : ''}`}
                        >
                          {editingThis ? (
                            <input
                              autoFocus
                              type={c.edit!.type === 'number' ? 'number' : 'text'}
                              value={editing.draft}
                              onChange={e => setEditing(ed => (ed ? { ...ed, draft: e.target.value } : ed))}
                              onKeyDown={e => {
                                e.stopPropagation();
                                if (e.key === 'Enter') void commitEdit(row, c);
                                else if (e.key === 'Escape') cancelEdit();
                              }}
                              onBlur={() => void commitEdit(row, c)}
                              className={`w-full rounded-md border-2 border-brand-400 bg-white px-1.5 py-0.5 text-[12.5px] font-bold tabular-nums outline-none ${ALIGN_CLASS[c.align ?? (c.mono ? 'end' : 'start')]}`}
                            />
                          ) : c.render ? (
                            c.render(row, idx)
                          ) : (
                            cellText(c, row)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
                if (!expansion || !isOpen) return [mainRow];
                return [
                  mainRow,
                  <tr key={`${id}-exp`} className={sheet ? 'bg-white' : 'bg-slate-50/60'}>
                    <td colSpan={visibleColumns.length + (expansion ? 1 : 0)} className={`${sheet ? 'border border-[#b4b4b4] bg-[#f3f3f3] p-2' : 'border-b border-slate-200 p-0'}`}>
                      <div style={{ animation: 'fade-up 0.22s cubic-bezier(0.21,1.02,0.73,1) both' }}>
                        {expansion.render(row, idx)}
                      </div>
                    </td>
                  </tr>,
                ];
              })}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + (expansion ? 1 : 0)} className="p-10 text-center text-[12.5px] font-semibold text-slate-400">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
          {Object.keys(footerCells).length > 0 && sorted.length > 0 && (
            <tfoot>
              <tr>
                {expansion && <td className={tfBase} />}
                {visibleColumns.map(c => (
                  <td
                    key={`ft-${c.key}`}
                    style={pinnedSet.has(c.key) ? { [c.pinned === 'end' ? 'left' : 'right']: pinnedOffsets[c.key], zIndex: 13 } : undefined}
                    className={`${tfBase} ${ALIGN_CLASS[c.align ?? (c.mono ? 'end' : 'start')]} ${
                      footerCells[c.key] !== undefined ? 'num text-[12px] font-extrabold text-header' : 'font-bold text-slate-500'
                    } ${pinnedSet.has(c.key) ? 'sticky' : ''}`}
                  >
                    {footerCells[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** فرز عميل قديم — مُدار هنا بعد إحالة ExcelTable للتقاعد (يبقى للمكوّنات التي تدير فرزها خارج الجدول). */
export type ClientSortDir = 'asc' | 'desc';

export function useClientSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => string | number | null | undefined>,
  defaultKey?: string,
  defaultDir: ClientSortDir = 'asc',
) {
  const [sortKey, setSortKey] = useState(defaultKey ?? '');
  const [sortDir, setSortDir] = useState<ClientSortDir>(defaultDir);

  const sorted = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return rows;
    const get = accessors[sortKey];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'en') * dir;
    });
  }, [rows, sortKey, sortDir, accessors]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return { sorted, sortKey, sortDir, setSortKey, setSortDir, toggleSort };
}
