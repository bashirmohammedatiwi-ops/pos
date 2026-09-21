import { useMemo, useState } from 'react';
import { Input } from '@/components/ui';

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
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return salesmen;
    return salesmen.filter(m => m.name.toLowerCase().includes(s) || String(m.id).includes(s));
  }, [salesmen, q]);

  function toggle(id: number) {
    if (selected.has(id)) onChange(selectedIds.filter(x => x !== id));
    else onChange([...selectedIds, id]);
  }

  function selectAllVisible() {
    const next = new Set(selectedIds);
    for (const m of filtered) next.add(m.id);
    onChange([...next]);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {selectedIds.length === 0 ? (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{emptyLabel}</span>
        ) : (
          salesmen.filter(m => selected.has(m.id)).map(m => (
            <button
              key={m.id}
              type="button"
              className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 hover:bg-brand-100"
              onClick={() => toggle(m.id)}
            >
              {m.name} ×
            </button>
          ))
        )}
      </div>
      <Input data-keep-escape value={q} onChange={e => setQ(e.target.value)} placeholder="بحث لإضافة مندوب…" />
      <div className="flex gap-2 text-[11px]">
        <button type="button" className="text-brand-700 hover:underline" onClick={selectAllVisible}>
          تأشير المعروض
        </button>
        {selectedIds.length > 0 && (
          <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange([])}>
            مسح الكل
          </button>
        )}
      </div>
      <ul className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        {filtered.map(m => (
          <li key={m.id}>
            <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-slate-50">
              <input type="checkbox" className="rounded border-slate-300 text-brand-600" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-[11px] text-slate-400">#{m.id}</span>
            </label>
          </li>
        ))}
        {!filtered.length && <li className="px-3 py-4 text-center text-[12px] text-slate-400">لا مندوبين مطابقين</li>}
      </ul>
    </div>
  );
}
