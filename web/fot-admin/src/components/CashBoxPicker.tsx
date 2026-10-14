import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { AccountSummaryDto, SectionCashBoxAssignment, SectionCashBoxDto } from '@/api/types';
import { Badge, Btn, Field } from '@/components/ui';
import { IconCheckCircle, IconRefresh, IconSearch, IconWallet } from '@/components/icons';
import { SearchBox } from '@/components/system/systemUi';

function formatAccount(a: AccountSummaryDto) {
  return a.num ? `${a.num} — ${a.name ?? ''}` : `${a.name ?? ''} (#${a.id})`;
}

/**
 * Cash box list. An empty search browses every cash box in Edari instead of showing nothing,
 * because a box added in Edari minutes ago cannot be found by typing its Arabic name — Arabic
 * only became searchable once the server started mirroring accounts locally.
 */
function useCashBoxSearch(debounced: string) {
  return useQuery({
    queryKey: ['cashbox-accounts-edari', debounced],
    queryFn: () => api.cashBoxAccountsEdari(debounced || undefined),
    staleTime: 0,
  });
}

function useDebouncedSearch() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  const reset = () => {
    setSearch('');
    setDebounced('');
  };
  return { search, setSearch, debounced, reset };
}

type Props = {
  label: string;
  hint?: string;
  value?: number | null;
  displayName?: string | null;
  displayNum?: string | null;
  emptyHint?: string;
  onChange: (account: AccountSummaryDto | null) => void;
};

export function CashBoxPicker({ label, hint, value, displayName, displayNum, emptyHint, onChange }: Props) {
  const { search, setSearch, debounced, reset } = useDebouncedSearch();
  const q = useCashBoxSearch(debounced);

  const selectedLabel =
    value && value > 0
      ? displayNum || displayName
        ? displayNum
          ? `${displayNum} — ${displayName ?? ''}`
          : displayName ?? `#${value}`
        : `#${value}`
      : null;

  return (
    <Field label={label}>
      {hint && <p className="mb-2 text-[12px] leading-5 text-slate-500">{hint}</p>}
      {selectedLabel ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2">
          <span className="text-emerald-600"><IconCheckCircle size={16} /></span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">{selectedLabel}</span>
          <Btn size="sm" variant="ghost" onClick={() => onChange(null)}>
            إزالة
          </Btn>
        </div>
      ) : (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">{emptyHint ?? 'لم يُحدد صندوق بعد.'}</p>
      )}

      <CashBoxSearchResults
        search={search}
        onSearch={setSearch}
        loading={q.isLoading}
        results={q.data ?? []}
        onPick={a => {
          onChange(a);
          reset();
        }}
      />
    </Field>
  );
}

export type AssignedSectionCashBox = {
  masterAccount: number;
  masterAccountBank: number;
  name?: string | null;
  num?: string | null;
  isDefault: boolean;
};

export function fromSectionCashBoxes(boxes: SectionCashBoxDto[] | undefined | null): AssignedSectionCashBox[] {
  return (boxes ?? []).map(b => ({
    masterAccount: b.masterAccount,
    masterAccountBank: b.masterAccountBank ?? 0,
    name: b.masterAccountName,
    num: b.masterAccountNum,
    isDefault: b.isDefault,
  }));
}

export function toCashBoxAssignments(boxes: AssignedSectionCashBox[]): SectionCashBoxAssignment[] {
  return boxes
    .filter(b => b.masterAccount > 0)
    .map(b => ({
      masterAccount: b.masterAccount,
      masterAccountBank: b.masterAccountBank || 0,
      isDefault: b.isDefault,
    }));
}

export function AssignedCashBoxesEditor({
  boxes,
  onChange,
  hint,
}: {
  boxes: AssignedSectionCashBox[];
  onChange: (next: AssignedSectionCashBox[]) => void;
  hint?: string;
}) {
  const { search, setSearch, debounced, reset } = useDebouncedSearch();
  const q = useCashBoxSearch(debounced);

  function add(account: AccountSummaryDto) {
    if (account.id <= 0) return;
    if (boxes.some(b => b.masterAccount === account.id)) return;
    onChange([
      ...boxes,
      {
        masterAccount: account.id,
        masterAccountBank: 0,
        name: account.name,
        num: account.num,
        isDefault: boxes.length === 0,
      },
    ]);
    reset();
  }

  function remove(masterAccount: number) {
    const next = boxes.filter(b => b.masterAccount !== masterAccount);
    if (next.length > 0 && !next.some(b => b.isDefault)) next[0] = { ...next[0], isDefault: true };
    onChange(next);
  }

  function setDefault(masterAccount: number) {
    onChange(boxes.map(b => ({ ...b, isDefault: b.masterAccount === masterAccount })));
  }

  return (
    <div className="space-y-3">
      {hint && <p className="text-[12.5px] leading-5 text-slate-500">{hint}</p>}
      {boxes.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          لم يُربط أي صندوق — نقطة البيع ترفض الدخول حتى تضيف صندوقاً واحداً على الأقل.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {boxes.map(b => (
            <li key={b.masterAccount} className="flex flex-wrap items-center gap-2 bg-white px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-header">
                  {b.num ? `${b.num} — ${b.name ?? ''}` : b.name || `#${b.masterAccount}`}
                </p>
                <p className="text-[11px] text-slate-400 num">Seq {b.masterAccount}</p>
              </div>
              {b.isDefault ? (
                <Badge tone="ok">افتراضي</Badge>
              ) : (
                <Btn size="xs" variant="ghost" onClick={() => setDefault(b.masterAccount)}>
                  جعله افتراضياً
                </Btn>
              )}
              <Btn size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => remove(b.masterAccount)}>
                إزالة
              </Btn>
            </li>
          ))}
        </ul>
      )}
      <CashBoxSearchResults
        search={search}
        onSearch={setSearch}
        loading={q.isLoading}
        results={(q.data ?? []).filter(a => !boxes.some(b => b.masterAccount === a.id))}
        onPick={add}
      />
    </div>
  );
}

function CashBoxSearchResults({
  search,
  onSearch,
  loading,
  results,
  onPick,
}: {
  search: string;
  onSearch: (v: string) => void;
  loading: boolean;
  results: AccountSummaryDto[];
  onPick: (a: AccountSummaryDto) => void;
}) {
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: api.syncEdariAccounts,
    onSettled: () => qc.invalidateQueries({ queryKey: ['cashbox-accounts-edari'] }),
  });

  return (
    <>
      <div className="flex items-center gap-2">
        <SearchBox
          value={search}
          onChange={onSearch}
          placeholder="ابحث برقم أو اسم الصندوق…"
          icon={<IconSearch size={15} />}
          className="min-w-0 flex-1"
        />
        <Btn
          size="sm"
          variant="secondary"
          onClick={() => refresh.mutate()}
          loading={refresh.isPending}
          icon={<IconRefresh size={13} />}
          title="اجلب الحسابات من الأداري الآن"
        >
          جلب من الأداري
        </Btn>
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {!loading && results.length > 0 && (
          <div className="sticky top-0 z-[1] grid grid-cols-[88px_minmax(0,1fr)_minmax(0,0.7fr)_56px] gap-2 border-b border-slate-200 bg-slate-100/95 px-3 py-1.5 text-[11px] font-bold text-slate-600">
            <span>الرقم</span>
            <span>الحساب</span>
            <span>المجموعة</span>
            <span />
          </div>
        )}
        {loading && (
          <div className="space-y-1.5 p-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-8" />)}
          </div>
        )}
        {!loading && results.length === 0 && (
          <p className="p-3 text-center text-[12.5px] text-slate-500">
            {search
              ? 'لا صندوق بهذا الاسم أو الرقم — اضغط «جلب من الأداري»'
              : 'لا صناديق بعد — اضغط «جلب من الأداري»'}
          </p>
        )}
        {results.map((a, i) => (
          <button
            key={a.id}
            type="button"
            title={formatAccount(a)}
            className={`grid w-full grid-cols-[88px_minmax(0,1fr)_minmax(0,0.7fr)_56px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-right text-[12.5px] transition last:border-b-0 hover:bg-brand-50/60 ${i % 2 ? 'bg-slate-50/50' : 'bg-white'}`}
            onClick={() => onPick(a)}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-slate-700 num">
              <IconWallet size={13} className="shrink-0 text-slate-400" />
              <span className="truncate">{a.num || `#${a.id}`}</span>
            </span>
            <span className="truncate text-slate-800">{a.name ?? '—'}</span>
            <span className="truncate text-[11.5px] text-slate-400">{a.group ?? ''}</span>
            <span className="text-end text-[11.5px] font-semibold text-brand-700">اختيار</span>
          </button>
        ))}
      </div>
      {!loading && results.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-400 num">{results.length} صندوق متاح</p>
      )}
      {refresh.data && (
        <p className="mt-1 text-[11.5px] text-emerald-700">{refresh.data.message}</p>
      )}
    </>
  );
}
