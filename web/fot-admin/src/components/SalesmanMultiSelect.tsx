import { useMemo, useState } from 'react';
import { formatNum } from '@/api/client';
import { IconCheck, IconSearch, IconX } from '@/components/icons';

type Salesman = { id: number; name: string };

export function SalesmanMultiSelect({
  salesmen,
  selectedIds,
  onChange,
  emptyLabel = 'كل المندوبين',
}: {
  salesmen: Salesman[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  emptyLabel?: string;
}) {
  const [q, setQ] = useState('');
  const [selectedFirst, setSelectedFirst] = useState(true);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  // ترتيب «المحدد أولاً» يُثبَّت عند الفتح/تغيير البحث فقط — كي لا تقفز الصفوف تحت المؤشر عند النقر
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pinned = useMemo(() => new Set(selectedIds), [q, selectedFirst, salesmen]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = s ? salesmen.filter(m => m.name.toLowerCase().includes(s) || String(m.id).includes(s)) : salesmen;
    if (!selectedFirst) return rows;
    return [...rows].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
  }, [salesmen, q, pinned, selectedFirst]);

  function toggle(id: number) {
    if (selected.has(id)) onChange(selectedIds.filter(x => x !== id));
    else onChange([...selectedIds, id]);
  }

  function selectAllVisible() {
    const next = new Set(selectedIds);
    for (const m of filtered) next.add(m.id);
    onChange([...next]);
  }

  const chosen = salesmen.filter(m => selected.has(m.id));

  return (
    <div className="space-y-2">
      <div className="flex min-h-[28px] flex-wrap gap-1.5">
        {selectedIds.length === 0 ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11.5px] font-medium text-slate-600">{emptyLabel}</span>
        ) : (
          chosen.map(m => (
            <button
              key={m.id}
              type="button"
              title="إزالة"
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 ps-2.5 pe-1.5 text-[11.5px] font-semibold text-brand-800 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100"
              onClick={() => toggle(m.id)}
            >
              {m.name}
              <IconX size={11} />
            </button>
          ))
        )}
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
          <IconSearch size={14} />
        </span>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            // Enter يؤشّر أول نتيجة بدل إرسال النموذج
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = filtered.find(m => !selected.has(m.id));
              if (first) toggle(first.id);
            }
          }}
          placeholder="بحث بالاسم أو الرقم… (Enter لإضافة أول نتيجة)"
          className="h-9 w-full rounded-lg border border-slate-200 bg-white ps-8 pe-3 text-[13px] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <span className="text-slate-500">
          محدد <b className="num text-slate-700">{formatNum(selectedIds.length)}</b> من <span className="num">{formatNum(salesmen.length)}</span>
        </span>
        <span className="flex-1" />
        <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={selectAllVisible} disabled={!filtered.length}>
          تأشير المعروض
        </button>
        {selectedIds.length > 0 && (
          <button type="button" className="font-semibold text-slate-500 hover:text-red-600 hover:underline" onClick={() => onChange([])}>
            مسح الكل
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-1 text-slate-500">
          <input type="checkbox" className="accent-brand-600" checked={selectedFirst} onChange={e => setSelectedFirst(e.target.checked)} />
          المحدد أولاً
        </label>
      </div>

      <ul className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white" role="listbox" aria-multiselectable>
        {filtered.map(m => {
          const on = selected.has(m.id);
          return (
            <li key={m.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => toggle(m.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-[13px] transition ${on ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}
              >
                <span
                  className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border transition ${
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {on && <IconCheck size={11} strokeWidth={3} />}
                </span>
                <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold text-header' : 'text-slate-700'}`}>{m.name}</span>
                <span className="text-[11px] text-slate-400 num">#{m.id}</span>
              </button>
            </li>
          );
        })}
        {!filtered.length && <li className="px-3 py-5 text-center text-[12px] text-slate-400">لا مندوبين مطابقين</li>}
      </ul>
    </div>
  );
}
