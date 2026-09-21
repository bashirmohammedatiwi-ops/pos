import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, formatNum } from '@/api/client';
import type { SectionDetailDto, SectionSummaryDto, UpdateSectionRequest } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Btn,
  Checkbox,
  Field,
  Input,
  Loading,
  Modal,
  Select,
} from '@/components/ui';
import {
  AssignedCashBoxesEditor,
  fromSectionCashBoxes,
  toCashBoxAssignments,
  type AssignedSectionCashBox,
} from '@/components/CashBoxPicker';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  ClassicTabBar,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { downloadCsv } from '@/utils/exportCsv';

type Tab = 'overview' | 'sections' | 'table';

const SECTIONS_KEY = 'fot_admin_sections';

function loadSectionsUi() {
  try {
    return JSON.parse(sessionStorage.getItem(SECTIONS_KEY) || 'null') as {
      tab?: Tab;
      selectedId?: number | null;
      query?: string;
    } | null;
  } catch {
    return null;
  }
}

function sectionFormFromDetail(d: SectionDetailDto): UpdateSectionRequest {
  return {
    name: d.name,
    state: d.state,
    sellPrice: d.sellPrice,
    edariBranchId: d.edariBranchId,
    edariWarehouseNumber: d.edariWarehouseNumber,
    groupsColumnsCount: d.groupsColumnsCount,
    groupsItemSize: d.groupsItemSize,
    roundTotalTo: d.roundTotalTo,
    roundItemTo: d.roundItemTo,
    fastSaving: d.fastSaving,
    collectivePrinting: d.collectivePrinting,
    displayArticleQuantity: d.displayArticleQuantity,
    cashBoxes: toCashBoxAssignments(fromSectionCashBoxes(d.cashBoxes)),
  };
}

/* أعمدة الأقسام — DataGrid موحد */
const sectionColumns: GridColumn<SectionSummaryDto>[] = [
  { key: 'name', header: 'القسم', width: 170, render: s => <span className="font-semibold text-header">{s.name}</span> },
  { key: 'branchName', header: 'الفرع', width: 140, render: s => s.branchName ?? s.branchId },
  { key: 'edari', header: 'Edari', width: 110, align: 'center', sortValue: s => s.edariBranchId, render: s => `${s.edariBranchId} / ${s.edariWarehouseNumber}` },
  { key: 'cashBoxCount', header: 'صناديق', width: 90, mono: true, align: 'center', render: s => s.cashBoxCount ?? 0 },
  { key: 'masterAccount', header: 'الحساب', width: 110, mono: true },
  { key: 'terminalCount', header: 'أجهزة', width: 90, mono: true },
  { key: 'onlineTerminals', header: 'متصل', width: 90, mono: true },
  { key: 'todaySales', header: 'مبيعات اليوم', width: 130, mono: true },
  { key: 'state', header: 'الحالة', width: 100, align: 'center', render: s => (s.state ? 'نشط' : 'متوقف') },
];

export function SectionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const saved = loadSectionsUi();
  const [tab, setTab] = useState<Tab>(saved?.tab ?? 'overview');
  const [selectedId, setSelectedId] = useState<number | null>(saved?.selectedId ?? null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState(saved?.query ?? '');
  const [form, setForm] = useState<UpdateSectionRequest | null>(null);
  const [newName, setNewName] = useState('');
  const [newWh, setNewWh] = useState('1');
  const [newBranch, setNewBranch] = useState('');
  const [newPrice, setNewPrice] = useState('1');
  const [newActive, setNewActive] = useState(true);
  const [newBoxes, setNewBoxes] = useState<AssignedSectionCashBox[]>([]);
  const [editBoxes, setEditBoxes] = useState<AssignedSectionCashBox[]>([]);

  useEffect(() => {
    sessionStorage.setItem(SECTIONS_KEY, JSON.stringify({ tab, selectedId, query }));
  }, [tab, selectedId, query]);

  const listQ = useQuery({ queryKey: ['sections-summary'], queryFn: () => api.sections(true) });
  const branchesQ = useQuery({ queryKey: ['edari-branches'], queryFn: api.edariBranches });
  const detailQ = useQuery({
    queryKey: ['section-detail', selectedId],
    queryFn: () => api.sectionDetail(selectedId!),
    enabled: selectedId != null,
  });

  const allSections = (listQ.data ?? []) as SectionSummaryDto[];
  const sections = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return allSections;
    return allSections.filter(x =>
      x.name.toLowerCase().includes(s) || String(x.edariBranchId).includes(s) || String(x.id).includes(s),
    );
  }, [allSections, query]);

  const stats = useMemo(() => {
    const active = allSections.filter(s => s.state).length;
    const terminals = allSections.reduce((a, s) => a + s.terminalCount, 0);
    const online = allSections.reduce((a, s) => a + s.onlineTerminals, 0);
    const sales = allSections.reduce((a, s) => a + s.todaySales, 0);
    const receipts = allSections.reduce((a, s) => a + s.todayReceipts, 0);
    return { active, terminals, online, sales, receipts, total: allSections.length };
  }, [allSections]);

  const save = useMutation({
    mutationFn: () => {
      const cashBoxes = toCashBoxAssignments(editBoxes);
      if (cashBoxes.length === 0) throw new Error('أضف صندوقاً واحداً على الأقل');
      return api.updateSection(selectedId!, { ...form!, cashBoxes });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['section-detail', selectedId] });
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
      qc.invalidateQueries({ queryKey: ['pos-terminals'] });
      setEditOpen(false);
      toast.success('تم حفظ إعدادات القسم');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const create = useMutation({
    mutationFn: () => {
      if (!newName.trim()) throw new Error('اسم القسم مطلوب');
      const cashBoxes = toCashBoxAssignments(newBoxes);
      if (cashBoxes.length === 0) throw new Error('أضف صندوقاً واحداً على الأقل');
      return api.createSection({
        name: newName.trim(),
        edariWarehouseNumber: Number(newWh) || 1,
        edariBranchId: newBranch ? Number(newBranch) : null,
        state: newActive,
        sellPrice: Number(newPrice) || 1,
        cashBoxes,
      });
    },
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setCreateOpen(false);
      setNewName('');
      setNewBoxes([]);
      setSelectedId(r.id);
      setTab('sections');
      toast.success(r.edariMessage || 'تم إنشاء القسم');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الإنشاء'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteSection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['section-detail'] });
      setSelectedId(null);
      setEditOpen(false);
      toast.success('تم حذف القسم');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحذف'),
  });

  function openEdit(d: SectionDetailDto) {
    setForm(sectionFormFromDetail(d));
    setEditBoxes(fromSectionCashBoxes(d.cashBoxes));
    setEditOpen(true);
  }

  function openSection(id: number) {
    setSelectedId(id);
    setTab('sections');
  }

  const loading = listQ.isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        filters={
          <FilterField label="بحث">
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="بحث عن قسم…" />
          </FilterField>
        }
        tabs={
          <ClassicTabBar
            items={[
              { id: 'overview', label: 'نظرة', count: sections.length },
              { id: 'sections', label: 'تفاصيل' },
              { id: 'table', label: 'جدول' },
            ]}
            value={tab}
            onChange={id => setTab(id as Tab)}
          />
        }
        header={{
          title: 'الأقسام',
          hint: 'ربط Edari ونقاط البيع',
          actions: (
            <>
              <Btn
                size="sm"
                variant="secondary"
                disabled={!sections.length}
                onClick={() =>
                  downloadCsv(
                    'sections.csv',
                    ['القسم', 'الفرع', 'Edari', 'مخزن', 'صناديق', 'حساب', 'أجهزة', 'متصل', 'مبيعات اليوم', 'الحالة'],
                    sections.map(s => [
                      s.name,
                      s.branchName ?? s.branchId ?? '',
                      s.edariBranchId,
                      s.edariWarehouseNumber,
                      s.cashBoxCount ?? 0,
                      s.masterAccount,
                      s.terminalCount,
                      s.onlineTerminals,
                      s.todaySales,
                      s.state ? 'نشط' : 'متوقف',
                    ]),
                  )
                }
              >
                CSV
              </Btn>
              <Btn size="sm" onClick={() => { setNewBoxes([]); setCreateOpen(true); }}>+ قسم</Btn>
              <Link to="/terminals"><Btn size="sm" variant="secondary">POS</Btn></Link>
            </>
          ),
        }}
        onRefresh={() => listQ.refetch()}
        refreshing={listQ.isFetching}
        footer={
          <ClassicSummaryFooter
            total={stats.total}
            totalLabel="أقسام"
            items={[
              { label: 'نشطة', value: formatNum(stats.active), accent: true },
              { label: 'POS متصل', value: `${formatNum(stats.online)}/${formatNum(stats.terminals)}` },
              { label: 'مبيعات اليوم', value: formatNum(stats.sales) },
            ]}
          />
        }
      >
        {loading && <Loading />}

        {!loading && tab === 'overview' && (
          <div className="grid gap-2 overflow-auto p-2 lg:grid-cols-2 xl:grid-cols-3">
            {sections.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSection(s.id)}
                className="group rounded-lg border border-slate-200 bg-white p-2.5 text-right shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-[12px] font-bold text-slate-900 group-hover:text-teal-700">{s.name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.state ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {s.state ? 'نشط' : 'متوقف'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      فرع {s.branchName ?? s.branchId} · سعر {s.sellPrice}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-teal-600">
                      {s.onlineTerminals}/{s.terminalCount}
                    </p>
                    <p className="text-xs text-muted">متصل</p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-lg bg-indigo-50 px-2 py-1 text-xs text-indigo-800">
                    Edari فرع {s.edariBranchId}
                  </span>
                  <span className="rounded-lg bg-violet-50 px-2 py-1 text-xs text-violet-800">
                    مخزن {s.edariWarehouseNumber}
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    حساب {s.masterAccount > 0 ? s.masterAccount : '—'}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-1 text-xs ${
                      (s.cashBoxCount ?? 0) > 0
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {(s.cashBoxCount ?? 0) > 0 ? `${s.cashBoxCount} صندوق` : 'بلا صندوق'}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-emerald-50 p-2">
                    <p className="text-muted">فواتير اليوم</p>
                    <p className="font-bold text-emerald-800">{formatNum(s.todayReceipts)}</p>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-2">
                    <p className="text-muted">مبيعات اليوم</p>
                    <p className="font-bold text-sky-800">{formatNum(s.todaySales)}</p>
                  </div>
                </div>
              </button>
            ))}
            {sections.length === 0 && (
              <div className="col-span-full py-12 text-center text-[13px] text-slate-400">لا توجد أقسام</div>
            )}
          </div>
        )}

        {!loading && tab === 'sections' && (
          <div className="grid min-h-0 flex-1 gap-2 overflow-hidden p-2 lg:grid-cols-5">
            <div className="space-y-1 overflow-y-auto lg:col-span-2">
              <p className="text-[10.5px] font-medium text-muted">اختر قسماً</p>
              {sections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-lg border p-2 text-right transition ${
                    selectedId === s.id ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-[11px] font-semibold">{s.name}</p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {s.terminalCount} جهاز · {s.onlineTerminals} متصل · {formatNum(s.todaySales)} اليوم
                  </p>
                </button>
              ))}
            </div>

            <div className="min-h-0 overflow-y-auto lg:col-span-3">
              {!selectedId && (
                <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/50 text-[11px] text-slate-400">
                  اختر قسماً لعرض التفاصيل
                </div>
              )}
              {selectedId && detailQ.isLoading && <Loading />}
              {selectedId && detailQ.data && (
                <SectionDetailPanel
                  detail={detailQ.data}
                  onEdit={() => openEdit(detailQ.data)}
                  onRefresh={() => detailQ.refetch()}
                  onDelete={() => {
                    if (confirm(`حذف القسم «${detailQ.data.name}»؟`)) remove.mutate(detailQ.data.id);
                  }}
                />
              )}
            </div>
          </div>
        )}

        {!loading && tab === 'table' && (
          <DataGrid
            embedded
            fillHeight
            columns={sectionColumns}
            rows={sections}
            getRowId={s => s.id}
            exportName="الأقسام"
            counterLabel="قسم"
            emptyText="لا أقسام — أنشئ قسماً واربطه بصندوق"
            onRowClick={s => openSection(s.id)}
            storageKey="sections"
          />
        )}
      </ClassicListShell>

      <Modal open={createOpen} title="قسم جديد" onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <Field label="اسم القسم">
            <Input value={newName} onChange={e => setNewName(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مستودع Edari">
              <Input type="number" value={newWh} onChange={e => setNewWh(e.target.value)} />
            </Field>
            <Field label="سعر البيع">
              <Input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
            </Field>
          </div>
          <Field label="فرع Edari (اختياري)">
            <Select value={newBranch} onChange={e => setNewBranch(e.target.value)}>
              <option value="">إنشاء/افتراضي</option>
              {(branchesQ.data ?? []).map(b => (
                <option key={b.seq} value={b.seq}>{b.name ?? b.seq}</option>
              ))}
            </Select>
          </Field>
          <Field label="صناديق القسم">
            <AssignedCashBoxesEditor
              boxes={newBoxes}
              onChange={setNewBoxes}
              hint="ابحث في حسابات Edari وأضف صندوق الكاشير. الصندوق الافتراضي يُستخدم عند الدخول لنقطة البيع."
            />
          </Field>
          <Checkbox label="قسم نشط" checked={newActive} onChange={setNewActive} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Btn>
            <Btn onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? 'جاري الإنشاء…' : 'إنشاء'}</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={editOpen} title="تعديل القسم" onClose={() => setEditOpen(false)} wide>
        {form && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم القسم">
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="سعر البيع">
                <Input
                  type="number"
                  value={form.sellPrice}
                  onChange={e => setForm({ ...form, sellPrice: Number(e.target.value) })}
                />
              </Field>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
              <p className="mb-3 text-sm font-semibold text-indigo-900">ربط Edari (ترحيل الفواتير)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="فرع Edari">
                  <Input
                    type="number"
                    value={form.edariBranchId}
                    onChange={e => setForm({ ...form, edariBranchId: Number(e.target.value) })}
                  />
                </Field>
                <Field label="رقم المستودع">
                  <Input
                    type="number"
                    value={form.edariWarehouseNumber}
                    onChange={e => setForm({ ...form, edariWarehouseNumber: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <p className="mb-3 text-sm font-semibold text-amber-950">صناديق الكاشير</p>
              <AssignedCashBoxesEditor
                boxes={editBoxes}
                onChange={setEditBoxes}
                hint="بدون صندوق مرتبط لا يمكن الدخول إلى نقطة البيع. الصندوق الافتراضي يظهر أولاً للكاشير."
              />
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="mb-3 text-sm font-semibold">واجهة POS</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="أعمدة المجموعات">
                  <Input
                    type="number"
                    value={form.groupsColumnsCount}
                    onChange={e => setForm({ ...form, groupsColumnsCount: Number(e.target.value) })}
                  />
                </Field>
                <Field label="حجم الزر">
                  <Input
                    type="number"
                    value={form.groupsItemSize}
                    onChange={e => setForm({ ...form, groupsItemSize: Number(e.target.value) })}
                  />
                </Field>
                <Field label="تقريب الإجمالي">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.roundTotalTo}
                    onChange={e => setForm({ ...form, roundTotalTo: Number(e.target.value) })}
                  />
                </Field>
                <Field label="تقريب السطر">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.roundItemTo}
                    onChange={e => setForm({ ...form, roundItemTo: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                <Checkbox label="حفظ سريع" checked={form.fastSaving} onChange={v => setForm({ ...form, fastSaving: v })} />
                <Checkbox
                  label="طباعة جماعية"
                  checked={form.collectivePrinting}
                  onChange={v => setForm({ ...form, collectivePrinting: v })}
                />
                <Checkbox
                  label="عرض كمية المادة"
                  checked={form.displayArticleQuantity}
                  onChange={v => setForm({ ...form, displayArticleQuantity: v })}
                />
                <Checkbox label="قسم نشط" checked={form.state} onChange={v => setForm({ ...form, state: v })} />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Btn variant="secondary" onClick={() => setEditOpen(false)}>
                إلغاء
              </Btn>
              <Btn onClick={() => save.mutate()} disabled={save.isPending}>
                حفظ
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SectionDetailPanel({
  detail: d,
  onEdit,
  onRefresh,
  onDelete,
}: {
  detail: SectionDetailDto;
  onEdit: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-bold">{d.name}</h3>
          <p className="text-sm text-muted">
            {d.branchName ?? `فرع #${d.branchId}`} · سعر {d.sellPrice}
          </p>
        </div>
        <div className="flex gap-2">
          <Btn size="sm" variant="secondary" onClick={onRefresh}>
            ↻
          </Btn>
          <Btn size="sm" onClick={onEdit}>
            تعديل
          </Btn>
          <Btn size="sm" variant="danger" onClick={onDelete}>
            حذف
          </Btn>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatBox label="فواتير اليوم" value={formatNum(d.todayReceipts)} />
        <StatBox label="مبيعات اليوم" value={formatNum(d.todaySales)} accent="text-emerald-600" />
        <StatBox label="أجهزة متصلة" value={`${d.onlineTerminals}/${d.terminalCount}`} accent="text-sky-600" />
        <StatBox label="الحالة" value={d.state ? 'نشط' : 'متوقف'} />
      </div>

      <div className="rounded-xl bg-indigo-50/60 p-4 text-sm">
        <p className="font-medium text-indigo-900">Edari</p>
        <p className="mt-1 text-indigo-800">
          فرع {d.edariBranchId} · مستودع {d.edariWarehouseNumber}
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">صناديق القسم</p>
        {(d.cashBoxes?.length ?? 0) === 0 ? (
          <Alert type="warning">
            لا صناديق مرتبطة — الكاشير في هذا القسم لا يستطيع الدخول إلى نقطة البيع حتى تضيف صندوقاً من «تعديل».
          </Alert>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {d.cashBoxes.map(b => (
              <li key={b.masterAccount} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {b.masterAccountNum ? `${b.masterAccountNum} — ${b.masterAccountName ?? ''}` : b.masterAccountName || `#${b.masterAccount}`}
                  </p>
                  <p className="text-xs text-muted">Seq {b.masterAccount}</p>
                </div>
                {b.isDefault && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    افتراضي
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">نقاط البيع في هذا القسم</p>
        {d.terminals.length === 0 ? (
          <Alert type="info">لا توجد أجهزة مسجّلة في هذا القسم</Alert>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {d.terminals.map(t => {
              const online =
                t.lastConnection && Date.now() - new Date(t.lastConnection).getTime() < 5 * 60 * 1000;
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.name ?? t.hwId}</p>
                    <p className="text-xs text-muted">{t.hwId} · v{t.exeVersion ?? '—'}</p>
                  </div>
                  <Link to="/terminals" className="text-xs text-brand-600 hover:underline">
                    مراقبة
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent ?? 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
