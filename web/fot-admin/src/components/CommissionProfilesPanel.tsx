import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatCurrency,
  formatDate,
  formatNum,
  todayIso,
} from '@/api/client';
import type { CommissionPayoutDto, SalesmanCommissionProfileDto, SalesmanCommissionSummaryDto } from '@/api/types';
import { DatePresets } from '@/components/DatePresets';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { useClientSort } from '@/components/grid/DataGrid';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import {
  Btn,
  Field,
  Input,
  Loading,
  Select,
} from '@/components/ui';
import {
  EmptyWorkspace,
  FilterChip,
  FilterFields,
  InfoNote,
  RailCard,
  RailItem,
  RailList,
  RailTools,
  SegmentedTabs,
  SettingsStrip,
  SoftChip,
  SplitWorkspace,
  UnsavedBar,
  WorkspacePanel,
} from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';

const CURRENCIES = ['IQD', 'USD', 'EUR', 'SAR', 'AED', 'TRY'];

type ProfileTab = 0 | 1 | 2;

export function CommissionProfilesPanel({
  from,
  to,
  onFromChange,
  onToChange,
  focusSalesmanId,
  onFocusHandled,
  embedded,
}: {
  from: string;
  to: string;
  onFromChange?: (v: string) => void;
  onToChange?: (v: string) => void;
  focusSalesmanId?: number | null;
  onFocusHandled?: () => void;
  embedded?: boolean;
}) {
  const { settings: periodSettings } = useBusinessPeriod();
  const qc = useQueryClient();
  const toast = useToast();
  const [subTab, setSubTab] = useState<ProfileTab>(0);
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<'all' | 'due' | 'clear'>('all');
  const [editProfile, setEditProfile] = useState<SalesmanCommissionProfileDto | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileCurrency, setProfileCurrency] = useState('IQD');
  const [profileOpening, setProfileOpening] = useState('0');
  const [profilePaid, setProfilePaid] = useState('0');
  const [profileNotes, setProfileNotes] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutNote, setPayoutNote] = useState('');
  const [payoutDate, setPayoutDate] = useState(todayIso());

  const profilesQ = useQuery({ queryKey: ['commission-profiles'], queryFn: api.commissionProfiles });
  const summaryQ = useQuery({
    queryKey: ['commission-summary', from, to],
    queryFn: () => api.commissionSummary(from, to),
  });
  const payoutsQ = useQuery({
    queryKey: ['commission-payouts', from, to],
    queryFn: () => api.commissionPayouts(from, to, undefined, 200),
    enabled: true,
  });
  const salesmanPayoutsQ = useQuery({
    queryKey: ['commission-payouts', editProfile?.salesmanId],
    queryFn: () => api.commissionPayouts(undefined, undefined, editProfile!.salesmanId, 50),
    enabled: !!editProfile,
  });

  const summary = summaryQ.data ?? [];
  const withDue = summary.filter(s => s.balanceDue > 0).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summary.filter(s => {
      const hasActivity = s.transactionCount > 0 || s.balanceDue !== 0 || s.paidOutTotal !== 0 || s.openingBalance !== 0;
      if (hasActivity === false && !search) return false;
      if (dueFilter === 'due' && s.balanceDue <= 0) return false;
      if (dueFilter === 'clear' && s.balanceDue !== 0) return false;
      if (!q) return true;
      return (s.salesmanName ?? '').toLowerCase().includes(q) || String(s.salesmanId).includes(q);
    });
  }, [summary, search, dueFilter]);

  const dueRows = useMemo(() => rows.filter(s => s.balanceDue > 0), [rows]);

  const railRows = subTab === 1 ? dueRows : rows;

  const accessors = useMemo(() => ({
    name: (s: SalesmanCommissionSummaryDto) => s.salesmanName ?? '',
    opening: (s: SalesmanCommissionSummaryDto) => s.openingBalance,
    earned: (s: SalesmanCommissionSummaryDto) => s.totalCommission,
    paid: (s: SalesmanCommissionSummaryDto) => s.paidOutTotal,
    due: (s: SalesmanCommissionSummaryDto) => s.balanceDue,
  }), []);
  const sort = useClientSort(railRows, accessors, 'due', 'desc');

  const activeSummary = editProfile
    ? summary.find(s => s.salesmanId === editProfile.salesmanId)
    : null;

  function markProfile(next: () => void) {
    next();
    setProfileDirty(true);
  }

  function confirmLeave() {
    if (!profileDirty) return true;
    return confirm('هناك تغييرات غير محفوظة. المتابعة بدون حفظ؟');
  }

  function loadProfile(s: SalesmanCommissionSummaryDto) {
    const p = profilesQ.data?.find(x => x.salesmanId === s.salesmanId);
    setEditProfile(p ?? {
      salesmanId: s.salesmanId,
      salesmanName: s.salesmanName,
      currencyCode: s.currencyCode,
      openingBalance: s.openingBalance,
      paidOutTotal: s.paidOutTotal,
      notes: s.notes,
    });
    setProfileCurrency(s.currencyCode);
    setProfileOpening(String(s.openingBalance));
    setProfilePaid(String(s.paidOutTotal));
    setProfileNotes(s.notes ?? '');
    setPayoutAmount(s.balanceDue > 0 ? String(s.balanceDue) : '');
    setPayoutNote('');
    setPayoutDate(todayIso());
    setProfileDirty(false);
  }

  function openProfile(s: SalesmanCommissionSummaryDto) {
    if (editProfile?.salesmanId === s.salesmanId) return;
    if (!confirmLeave()) return;
    loadProfile(s);
  }

  useEffect(() => {
    if (!focusSalesmanId || !summary.length) return;
    const s = summary.find(x => x.salesmanId === focusSalesmanId);
    if (!s) return;
    if (s.balanceDue > 0) setSubTab(1);
    else setSubTab(0);
    loadProfile(s);
    onFocusHandled?.();
  }, [focusSalesmanId, summary]);

  useEffect(() => {
    if (subTab === 2 || profileDirty || !sort.sorted.length) return;
    if (editProfile && sort.sorted.some(s => s.salesmanId === editProfile.salesmanId)) return;
    loadProfile(sort.sorted[0]);
  }, [subTab, sort.sorted, editProfile, profileDirty]);

  const saveProfile = useMutation({
    mutationFn: () =>
      api.saveCommissionProfile(editProfile!.salesmanId, {
        currencyCode: profileCurrency,
        openingBalance: Number(profileOpening),
        paidOutTotal: Number(profilePaid),
        notes: profileNotes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-profiles'] });
      qc.invalidateQueries({ queryKey: ['commission-summary'] });
      setProfileDirty(false);
      toast.success('تم الحفظ');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const recordPayout = useMutation({
    mutationFn: () =>
      api.recordCommissionPayout(editProfile!.salesmanId, {
        amount: Number(payoutAmount),
        paidAt: payoutDate || undefined,
        note: payoutNote.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-payouts'] });
      qc.invalidateQueries({ queryKey: ['commission-summary'] });
      qc.invalidateQueries({ queryKey: ['commission-profiles'] });
      setPayoutAmount('');
      setPayoutNote('');
      toast.success('تم تسجيل الصرف');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الصرف'),
  });

  const voidPayout = useMutation({
    mutationFn: (id: number) => api.voidCommissionPayout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-payouts'] });
      qc.invalidateQueries({ queryKey: ['commission-summary'] });
      qc.invalidateQueries({ queryKey: ['commission-profiles'] });
      toast.success('أُلغي الصرف');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الإلغاء'),
  });

  function exportCsv() {
    downloadCsv(
      `commission-profiles_${from}_${to}.csv`,
      ['البائع', 'العملة', 'افتتاحي', 'عمولة الفترة', 'مدفوع', 'مستحق', 'ملاحظات'],
      sort.sorted.map(s => [
        s.salesmanName ?? s.salesmanId,
        s.currencyCode,
        s.openingBalance,
        s.totalCommission,
        s.paidOutTotal,
        s.balanceDue,
        s.notes ?? '',
      ]),
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${embedded ? '' : 'space-y-4'}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-2 py-1.5">
        <SegmentedTabs
          compact
          value={subTab}
          onChange={id => {
            if (!confirmLeave()) return;
            setSubTab(id);
            setEditProfile(null);
          }}
          items={[
            { id: 0 as ProfileTab, label: 'الحسابات' },
            { id: 1 as ProfileTab, label: 'دليل الصرف', count: withDue || undefined },
            { id: 2 as ProfileTab, label: 'الدفعات' },
          ]}
        />
        <div className="flex-1" />
        {subTab !== 2 && <Btn size="sm" variant="secondary" onClick={exportCsv} disabled={!sort.sorted.length}>CSV</Btn>}
        {!embedded && onFromChange && onToChange && (
          <FilterFields>
            <Field label="من">
              <Input type="date" value={from} onChange={e => onFromChange(e.target.value)} className="min-w-[130px]" />
            </Field>
            <Field label="إلى">
              <Input type="date" value={to} onChange={e => onToChange(e.target.value)} className="min-w-[130px]" />
            </Field>
            <DatePresets mode="commissions" periodSettings={periodSettings} onPick={(a, b) => { onFromChange(a); onToChange(b); }} />
          </FilterFields>
        )}
      </div>

      {summaryQ.isLoading && subTab !== 2 && <Loading />}

      {(subTab === 0 || subTab === 1) && !summaryQ.isLoading && (
        <>
          {!sort.sorted.length && (
            <EmptyWorkspace
              title={subTab === 1 ? 'لا مستحقات' : 'لا حسابات'}
              hint={subTab === 1 ? 'جميع الحسابات مسدّدة في هذه الفترة.' : 'لا نشاط عمولة — تحقق من الفترة أو فعّل المجاميع.'}
            />
          )}

          {!!sort.sorted.length && (
            <SplitWorkspace
              compact
              rail={
                <RailCard compact title={`${subTab === 1 ? 'مستحقات' : 'حسابات'} (${formatNum(sort.sorted.length)})`}>
                  <RailTools>
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث…" />
                    {subTab === 0 && (
                      <div className="flex flex-wrap gap-1">
                        <FilterChip active={dueFilter === 'all'} onClick={() => setDueFilter('all')}>الكل</FilterChip>
                        <FilterChip active={dueFilter === 'due'} onClick={() => setDueFilter('due')}>بمستحقات</FilterChip>
                        <FilterChip active={dueFilter === 'clear'} onClick={() => setDueFilter('clear')}>مسدّد</FilterChip>
                      </div>
                    )}
                  </RailTools>
                  <RailList>
                    {sort.sorted.map(s => (
                      <li key={s.salesmanId}>
                        <RailItem
                          active={editProfile?.salesmanId === s.salesmanId}
                          title={s.salesmanName ?? `#${s.salesmanId}`}
                          meta={`عمولة ${formatCurrency(s.totalCommission, s.currencyCode)} · مدفوع ${formatCurrency(s.paidOutTotal, s.currencyCode)}`}
                          badge={
                            s.balanceDue > 0
                              ? <SoftChip tone="ok">{formatCurrency(s.balanceDue, s.currencyCode)}</SoftChip>
                              : undefined
                          }
                          onClick={() => openProfile(s)}
                        />
                      </li>
                    ))}
                  </RailList>
                </RailCard>
              }
            >
              {!editProfile ? (
                <EmptyWorkspace title="اختر بائعاً" hint="من القائمة اليمنى لفتح حسابه وتسجيل الصرف." />
              ) : (
                <WorkspacePanel
                  flush
                  title={editProfile.salesmanName ?? `#${editProfile.salesmanId}`}
                  subtitle={
                    <span className="flex flex-wrap items-center gap-2">
                      {activeSummary && (
                        <>
                          <span className="font-semibold text-emerald-700">{formatCurrency(activeSummary.balanceDue, activeSummary.currencyCode)} مستحق</span>
                          <span>·</span>
                          <span>عمولة الفترة {formatCurrency(activeSummary.totalCommission, activeSummary.currencyCode)}</span>
                        </>
                      )}
                      {profileDirty && <SoftChip tone="brand">غير محفوظ</SoftChip>}
                    </span>
                  }
                  actions={
                    <>
                      <Link to="/reports" className="text-[12px] font-semibold text-brand-700 hover:underline">
                        التقرير
                      </Link>
                      <Btn size="sm" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending || !profileDirty}>
                        {saveProfile.isPending ? 'جاري…' : 'حفظ الحساب'}
                      </Btn>
                    </>
                  }
                >
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <SettingsStrip>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="العملة">
                          <Select value={profileCurrency} onChange={e => markProfile(() => setProfileCurrency(e.target.value))}>
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </Select>
                        </Field>
                        <Field label="رصيد افتتاحي">
                          <Input type="number" value={profileOpening} onChange={e => markProfile(() => setProfileOpening(e.target.value))} />
                        </Field>
                        <Field label="مدفوع للموظف (إجمالي)">
                          <Input type="number" value={profilePaid} onChange={e => markProfile(() => setProfilePaid(e.target.value))} />
                        </Field>
                        <Field label="ملاحظات الحساب">
                          <Input value={profileNotes} onChange={e => markProfile(() => setProfileNotes(e.target.value))} placeholder="مرجع عام…" />
                        </Field>
                      </div>
                    </SettingsStrip>

                    <div className="space-y-3 p-4">
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                        <p className="mb-2 text-[12px] font-semibold text-emerald-900">تسجيل دفعة — يُضاف للمدفوع ويُحدّث المستحق</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Field label="المبلغ">
                            <Input type="number" min={0} value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)} />
                          </Field>
                          <Field label="تاريخ الصرف">
                            <Input type="date" value={payoutDate} onChange={e => setPayoutDate(e.target.value)} />
                          </Field>
                          <Field label="ملاحظة">
                            <Input value={payoutNote} onChange={e => setPayoutNote(e.target.value)} placeholder="نقداً / تحويل…" />
                          </Field>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Btn size="sm" disabled={recordPayout.isPending || !Number(payoutAmount)} onClick={() => recordPayout.mutate()}>
                            {recordPayout.isPending ? 'جاري…' : 'تسجيل صرف'}
                          </Btn>
                          {activeSummary && activeSummary.balanceDue > 0 && (
                            <Btn size="sm" variant="secondary" onClick={() => setPayoutAmount(String(activeSummary.balanceDue))}>
                              المستحق كاملاً ({formatCurrency(activeSummary.balanceDue, activeSummary.currencyCode)})
                            </Btn>
                          )}
                        </div>
                      </div>

                    {(salesmanPayoutsQ.data?.length ?? 0) > 0 && (
                      <div>
                        <p className="mb-2 text-[13px] font-bold text-header">آخر الدفعات</p>
                        <DataGrid
                          columns={lastPayoutsColumns}
                          rows={salesmanPayoutsQ.data!.slice(0, 10)}
                          getRowId={p => p.id}
                          maxHeight="240px"
                          exportName="آخر-الدفعات"
                          counterLabel="دفعة"
                          rowTone={p => (p.voided ? 'opacity-40' : undefined)}
                        />
                      </div>
                    )}
                    </div>

                    {profileDirty && (
                      <div className="shrink-0 px-4 pb-3">
                        <UnsavedBar text="تغييرات الحساب غير محفوظة" onSave={() => saveProfile.mutate()} pending={saveProfile.isPending} />
                      </div>
                    )}
                  </div>
                </WorkspacePanel>
              )}
            </SplitWorkspace>
          )}
        </>
      )}

      {subTab === 2 && (
        <div className="space-y-3">
          {payoutsQ.isLoading && <Loading />}
          {!payoutsQ.isLoading && (
            <>
              <InfoNote>سجلّ الدفعات في الفترة المحددة. لإلغاء دفعة استخدم زر «إلغاء» — يُحدَّث المستحق تلقائياً.</InfoNote>
              <DataGrid
                columns={payoutsLedgerColumns(summary, s => {
                  setSubTab(0);
                  loadProfile(s);
                }, voidPayout.mutate)}
                rows={payoutsQ.data ?? []}
                getRowId={p => p.id}
                maxHeight="calc(100vh - 320px)"
                storageKey="commission-payouts"
                exportName={`سجل-الصرف-${from}_${to}`}
                counterLabel="دفعة"
                emptyText="لا دفعات في الفترة — سجّل صرفاً من حساب البائع"
                rowTone={p => (p.voided ? 'opacity-50' : undefined)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* أعمدة الدفعات — DataGrid موحد */
const lastPayoutsColumns: GridColumn<CommissionPayoutDto>[] = [
  { key: 'paidAt', header: 'التاريخ', width: 140, sortValue: p => p.paidAt, render: p => <span className="text-[11px] text-slate-500">{formatDate(p.paidAt)}</span> },
  { key: 'amount', header: 'المبلغ', width: 130, mono: true, footer: 'sum', render: p => <span className="font-bold text-emerald-700">{formatCurrency(p.amount)}</span> },
  { key: 'note', header: 'ملاحظة', width: 180, render: p => <span className="block max-w-[140px] truncate text-[12px] text-slate-500">{p.note ?? '—'}</span> },
  { key: 'status', header: 'الحالة', width: 100, align: 'center', render: p => <span className="text-[11px]">{p.voided ? 'ملغاة' : 'مسجّلة'}</span> },
];

function payoutsLedgerColumns(
  summary: SalesmanCommissionSummaryDto[],
  openProfile: (s: SalesmanCommissionSummaryDto) => void,
  voidPayout: (id: number) => void,
): GridColumn<CommissionPayoutDto>[] {
  return [
    { key: 'paidAt', header: 'التاريخ', width: 150, sortValue: p => p.paidAt, render: p => <span className="text-[11px] text-slate-500">{formatDate(p.paidAt)}</span> },
    {
      key: 'salesmanName',
      header: 'البائع',
      width: 160,
      render: p => (
        <button
          type="button"
          className="font-semibold text-brand-700 hover:underline"
          onClick={() => {
            const s = summary.find(x => x.salesmanId === p.salesmanId);
            if (s) openProfile(s);
          }}
        >
          {p.salesmanName ?? `#${p.salesmanId}`}
        </button>
      ),
    },
    { key: 'amount', header: 'المبلغ', width: 140, mono: true, footer: 'sum', render: p => <span className="font-bold text-emerald-700">{formatCurrency(p.amount)}</span> },
    { key: 'note', header: 'ملاحظة', width: 200, render: p => <span className="block max-w-[180px] truncate text-[12px] text-slate-500">{p.note ?? '—'}</span> },
    { key: 'status', header: 'الحالة', width: 100, align: 'center', render: p => (p.voided ? 'ملغاة' : 'مسجّلة') },
    {
      key: 'actions',
      header: 'إجراء',
      width: 90,
      align: 'center',
      sortable: false,
      exportable: false,
      render: p =>
        !p.voided ? (
          <button
            type="button"
            className="text-[12px] font-semibold text-red-500 hover:underline"
            onClick={() => window.confirm('إلغاء هذه الدفعة؟') && voidPayout(p.id)}
          >
            إلغاء
          </button>
        ) : null,
    },
  ];
}
