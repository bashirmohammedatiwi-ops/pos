import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCurrency } from '@/api/client';
import type { CashierCreditAccountDto, PosCreditAccountDto } from '@/api/types';
import { Input } from '@/components/ui';

export type CreditPick = CashierCreditAccountDto;

function label(a: { num?: string | null; name?: string | null; edariSeq: number }) {
  if (a.num && a.name) return `${a.num} — ${a.name}`;
  return a.name || a.num || `#${a.edariSeq}`;
}

export function CreditAccountMultiSelect({
  selected,
  onChange,
}: {
  selected: CreditPick[];
  onChange: (next: CreditPick[]) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ['credit-accounts-edari', debounced],
    queryFn: () => api.creditAccountsEdari(debounced || undefined),
    enabled: debounced.length >= 1,
  });
  const globalQ = useQuery({
    queryKey: ['credit-accounts-selected'],
    queryFn: api.creditAccountsSelected,
    staleTime: 60_000,
  });

  const selectedSet = useMemo(() => new Set(selected.map(a => a.edariSeq)), [selected]);

  function upsert(a: { edariSeq: number; num?: string | null; name?: string | null; balance?: number }) {
    if (selectedSet.has(a.edariSeq)) {
      onChange(selected.filter(x => x.edariSeq !== a.edariSeq));
      return;
    }
    onChange([...selected, { edariSeq: a.edariSeq, num: a.num, name: a.name, balance: a.balance ?? 0 }]);
  }

  function addFromGlobal() {
    const extras = (globalQ.data ?? []).filter(a => !selectedSet.has(a.edariSeq));
    if (!extras.length) return;
    onChange([
      ...selected,
      ...extras.map(a => ({ edariSeq: a.edariSeq, num: a.num, name: a.name, balance: a.balance })),
    ]);
  }

  const hits: PosCreditAccountDto[] = searchQ.data ?? [];

  return (
    <div className="space-y-2">
      <div className="flex min-h-[32px] flex-wrap gap-1.5">
        {selected.length === 0 ? (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            فارغ = حسابات نقطة البيع العامة
          </span>
        ) : (
          selected.map(a => (
            <button
              key={a.edariSeq}
              type="button"
              className="max-w-full rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 hover:bg-brand-100"
              onClick={() => upsert(a)}
              title="إزالة"
            >
              <span className="truncate">{label(a)}</span> ×
            </button>
          ))
        )}
      </div>

      <Input
        data-keep-escape
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="ابحث برقم أو اسم الحساب في Edari…"
      />

      <div className="flex flex-wrap gap-3 text-[11px]">
        <button type="button" className="text-brand-700 hover:underline" onClick={addFromGlobal} disabled={!globalQ.data?.length}>
          إضافة الحسابات العامة ({globalQ.data?.length ?? 0})
        </button>
        {selected.length > 0 && (
          <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange([])}>
            مسح اختيار الكاشير
          </button>
        )}
      </div>

      {debounced.length >= 1 && (
        <ul className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {searchQ.isLoading && <li className="px-3 py-3 text-[12px] text-slate-400">جاري البحث…</li>}
          {!searchQ.isLoading && hits.length === 0 && (
            <li className="px-3 py-3 text-center text-[12px] text-slate-400">لا نتائج — تحقق من اتصال Edari</li>
          )}
          {hits.map(a => (
            <li key={a.edariSeq}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-brand-600"
                  checked={selectedSet.has(a.edariSeq)}
                  onChange={() => upsert(a)}
                />
                <span className="min-w-0 flex-1 truncate">{label(a)}</span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{formatCurrency(a.balance)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
