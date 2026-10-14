import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { CashierCreditAccountDto, PosCreditAccountDto } from '@/api/types';
import { Input } from '@/components/ui';
import { IconCheck, IconSearch, IconX } from '@/components/icons';

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
  const globalExtras = (globalQ.data ?? []).filter(a => !selectedSet.has(a.edariSeq)).length;

  return (
    <div className="space-y-2">
      <div className="flex max-h-28 min-h-[32px] flex-wrap items-center gap-1.5 overflow-y-auto">
        {selected.length === 0 ? (
          <span className="rounded-md bg-slate-100 px-2 py-1 text-[11.5px] text-slate-600">
            لا اختيار خاص — يُستخدم حسابات نقطة البيع العامة
          </span>
        ) : (
          selected.map(a => (
            <span
              key={a.edariSeq}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-0.5 pe-1 ps-2.5 text-[11.5px] font-medium text-brand-800 ring-1 ring-inset ring-brand-200"
            >
              <span className="max-w-[240px] truncate" title={label(a)}>{label(a)}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-brand-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => upsert(a)}
                title="إزالة"
                aria-label={`إزالة ${label(a)}`}
              >
                <IconX size={11} />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
          {searchQ.isFetching ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          ) : (
            <IconSearch size={14} />
          )}
        </span>
        <Input
          data-keep-escape
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && q) {
              e.preventDefault();
              setQ('');
            }
          }}
          placeholder="ابحث برقم أو اسم الحساب في Edari…"
          className="ps-8 pe-8"
        />
        {q && (
          <button
            type="button"
            className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700"
            aria-label="مسح البحث"
            onClick={() => setQ('')}
          >
            <IconX size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11.5px]">
        <button
          type="button"
          className="font-semibold text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          onClick={addFromGlobal}
          disabled={!globalExtras}
        >
          إضافة الحسابات العامة ({formatNum(globalQ.data?.length ?? 0)})
        </button>
        {selected.length > 0 && (
          <button type="button" className="text-slate-500 hover:text-red-600 hover:underline" onClick={() => onChange([])}>
            مسح اختيار الكاشير ({formatNum(selected.length)})
          </button>
        )}
      </div>

      {debounced.length >= 1 && (
        <ul className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1">
          {searchQ.isLoading && <li className="px-3 py-3 text-[12px] text-slate-400">جاري البحث…</li>}
          {searchQ.isError && (
            <li className="px-3 py-3 text-center text-[12px] text-red-600">تعذر البحث — تحقق من اتصال Edari</li>
          )}
          {!searchQ.isLoading && !searchQ.isError && hits.length === 0 && (
            <li className="px-3 py-3 text-center text-[12px] text-slate-400">لا نتائج مطابقة</li>
          )}
          {hits.map(a => {
            const on = selectedSet.has(a.edariSeq);
            return (
              <li key={a.edariSeq}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => upsert(a)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-right text-[13px] transition ${on ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-transparent'
                    }`}
                  >
                    <IconCheck size={11} />
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={label(a)}>{label(a)}</span>
                  <span className={`shrink-0 text-[11.5px] num ${a.balance < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {formatCurrency(a.balance)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
