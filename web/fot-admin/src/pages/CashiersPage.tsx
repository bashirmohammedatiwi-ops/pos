import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatNum, todayIso } from '@/api/client';
import type { CashierDto, SectionSummaryDto } from '@/api/types';
import { DataGrid, type GridColumn, type GridSort } from '@/components/grid/DataGrid';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
} from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import {
  IconActivity,
  IconAlert,
  IconCheckCircle,
  IconCopy,
  IconKeyboard,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconShield,
} from '@/components/icons';
import { Badge, Btn, EmptyState, IconButton, Kbd, Select, TableSkeleton, useConfirm } from '@/components/ui';
import { CashierEditor } from '@/components/people/CashierEditor';
import {
  ErrorBlock,
  IconDuplicate,
  IconPower,
  RowIconButton,
  RowMenu,
  SearchBox,
  useCopy,
  useHotkey,
} from '@/components/people/PeopleKit';

const CASHIER_FILTERS_KEY = 'fot_admin_cashiers';

type StatusFilter = 'all' | 'active' | 'off';

/** مفاتيح الفرز القديمة (name/section/perm/status) تُحوَّل لأعمدة الجدول. */
const LEGACY_SORT_KEYS: Record<string, string> = { name: 'name', section: 'sectionName', perm: 'permissionsName', status: 'active' };

function loadCashierFilters() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CASHIER_FILTERS_KEY) || 'null') as {
      search?: string;
      status?: StatusFilter;
      sectionFilter?: number;
      sort?: { key: string; dir: 1 | -1 | 'asc' | 'desc' } | null;
    } | null;
    if (!raw) return null;
    let sort: GridSort | null = { key: 'name', dir: 'asc' };
    if (raw.sort === null) sort = null;
    else if (raw.sort?.key) {
      const dir = raw.sort.dir === -1 || raw.sort.dir === 'desc' ? 'desc' : 'asc';
      sort = { key: LEGACY_SORT_KEYS[raw.sort.key] ?? raw.sort.key, dir };
    }
    return { search: raw.search, status: raw.status, sectionFilter: raw.sectionFilter, sort };
  } catch {
    return null;
  }
}

const displayName = (c: CashierDto) => c.accountName?.trim() || c.username;

export function CashiersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const copy = useCopy();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const highlight = Number(params.get('highlight') || 0) || null;
  const [saved] = useState(loadCashierFilters);
  const [search, setSearch] = useState(saved?.search ?? '');
  const [status, setStatus] = useState<StatusFilter>(saved?.status ?? 'all');
  const [sectionFilter, setSectionFilter] = useState(saved?.sectionFilter ?? 0);
  const [noBoxOnly, setNoBoxOnly] = useState(false);
  const [sort, setSort] = useState<GridSort | null>(saved ? saved.sort : { key: 'name', dir: 'asc' });
  const [selectedId, setSelectedId] = useState<number | null>(highlight);
  const [editor, setEditor] = useState<{ id: number | 'new'; copyFrom?: number } | null>(null);

  const q = useQuery({ queryKey: ['cashiers'], queryFn: () => api.cashiers() });
  const sectionsQ = useQuery({ queryKey: ['sections'], queryFn: () => api.sections(true) });
  // تحميل مسبق لما يحتاجه محرر الكاشير
  useQuery({ queryKey: ['permissions'], queryFn: api.permissions, staleTime: 120_000 });
  useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen(true), staleTime: 120_000 });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const sections = (sectionsQ.data ?? []) as SectionSummaryDto[];
  const sectionById = useMemo(() => new Map(sections.map(s => [s.id, s])), [sections]);
  const lacksBox = (c: CashierDto) => {
    if (!c.sectionId) return sectionsQ.isSuccess;
    const s = sectionById.get(c.sectionId);
    return !!s && (s.cashBoxCount ?? 0) === 0;
  };

  const activeCount = items.filter(c => c.active).length;
  const offCount = items.length - activeCount;
  const noBoxCount = items.filter(c => c.active && lacksBox(c)).length;
  const templateCount = new Set(items.map(c => c.permissionsName || `#${c.permissionsId}`)).size;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter(c => {
      if (status === 'active' && !c.active) return false;
      if (status === 'off' && c.active) return false;
      if (sectionFilter && c.sectionId !== sectionFilter) return false;
      if (noBoxOnly && !(c.active && lacksBox(c))) return false;
      if (!s) return true;
      return c.username.toLowerCase().includes(s)
        || (c.accountName || '').toLowerCase().includes(s)
        || (c.sectionName || '').toLowerCase().includes(s)
        || (c.permissionsName || '').toLowerCase().includes(s);
    });
  }, [items, search, status, sectionFilter, noBoxOnly, sectionById]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      sessionStorage.setItem(CASHIER_FILTERS_KEY, JSON.stringify({ search, status, sectionFilter, sort }));
    } catch { /* تجاهل */ }
  }, [search, status, sectionFilter, sort]);

  // ?highlight=ID — تمييز الصف والتمرير إليه
  useEffect(() => {
    if (!highlight) return;
    setSelectedId(highlight);
    const id = window.setTimeout(() => {
      document.querySelector('.cashier-row-hi')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [highlight, filtered.length]);

  const openNew = () => setEditor({ id: 'new' });
  useHotkey('n', openNew, editor == null);

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      active ? api.updateCashier(id, { active: true }) : api.deactivateCashier(id),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['cashiers'] });
      qc.invalidateQueries({ queryKey: ['cashier'] });
      toast.success(v.active ? 'تم تفعيل الكاشير' : 'تم تعطيل الكاشير');
    },
    onError: (e, v) => toast.error(e instanceof Error ? e.message : v.active ? 'فشل التفعيل' : 'فشل التعطيل'),
  });

  async function toggleActive(c: CashierDto) {
    if (c.active) {
      const ok = await confirm({
        title: `تعطيل ${displayName(c)}؟`,
        message: 'لن يتمكن هذا الكاشير من الدخول إلى نقطة البيع حتى تعيد تفعيله. فواتيره السابقة تبقى كما هي.',
        confirmLabel: 'تعطيل',
        danger: true,
      });
      if (!ok) return;
    }
    setActive.mutate({ id: c.id, active: !c.active });
  }

  function clearFilters() {
    setSearch('');
    setStatus('all');
    setSectionFilter(0);
    setNoBoxOnly(false);
  }

  const hasFilters = !!search.trim() || status !== 'all' || !!sectionFilter || noBoxOnly;

  const columns: GridColumn<CashierDto>[] = [
    {
      key: 'name',
      header: 'الكاشير',
      width: 200,
      sortValue: c => displayName(c),
      filterValue: c => `${displayName(c)} ${c.username}`,
      render: c => (
        <span className={`block truncate font-semibold ${c.active ? 'text-header' : 'text-slate-500'}`} title={displayName(c)}>
          {displayName(c)}
        </span>
      ),
    },
    {
      key: 'username',
      header: 'اسم المستخدم',
      width: 150,
      render: c => (
        <span className="block truncate font-mono text-[12px] text-slate-600" dir="ltr" style={{ textAlign: 'right' }} title={c.username}>
          @{c.username}
        </span>
      ),
    },
    {
      key: 'sectionName',
      header: 'القسم',
      width: 190,
      sortValue: c => c.sectionName || '',
      filterValue: c => `${c.sectionName ?? ''} ${lacksBox(c) && c.active ? 'بلا صندوق' : ''}`,
      render: c => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{c.sectionName || <span className="text-slate-400">بلا قسم</span>}</span>
          {c.active && lacksBox(c) && (
            <span title="القسم بلا صندوق — سيُرفض الدخول لنقطة البيع" className="shrink-0">
              <Badge tone="warn"><IconAlert size={11} />بلا صندوق</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'permissionsName',
      header: 'قالب الصلاحيات',
      width: 170,
      sortValue: c => c.permissionsName || '',
      filterValue: c => c.permissionsName || 'مخصّصة',
      render: c => (c.permissionsName
        ? <Badge tone="info"><IconShield size={11} />{c.permissionsName}</Badge>
        : <Badge>مخصّصة</Badge>),
    },
    {
      key: 'active',
      header: 'الحالة',
      width: 96,
      sortValue: c => (c.active ? 'نشط' : 'معطّل'),
      filterValue: c => (c.active ? 'نشط' : 'معطّل'),
      render: c => (c.active ? <Badge tone="ok" dot>نشط</Badge> : <Badge dot>معطّل</Badge>),
    },
    {
      key: 'actions',
      header: '',
      width: 130,
      align: 'end',
      sortable: false,
      exportable: false,
      render: c => (
        <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
          <RowIconButton
            label="فواتير اليوم"
            onClick={() => navigate(`/receipts?cashierId=${c.id}&from=${todayIso()}&to=${todayIso()}`)}
          >
            <IconReceipt size={15} />
          </RowIconButton>
          <RowIconButton label="تعديل الإعدادات والصلاحيات" tone="brand" onClick={() => setEditor({ id: c.id })}>
            <IconPencil size={15} />
          </RowIconButton>
          <RowMenu
            items={[
              { label: 'سجل الحركات', icon: <IconActivity size={15} />, onClick: () => navigate(`/activity?cashierId=${c.id}`) },
              { label: 'نسخ اسم المستخدم', icon: <IconCopy size={15} />, onClick: () => void copy(c.username, 'اسم المستخدم') },
              { label: 'كاشير جديد بنفس الإعدادات', icon: <IconDuplicate size={15} />, onClick: () => setEditor({ id: 'new', copyFrom: c.id }) },
              c.active
                ? { label: 'تعطيل الحساب', icon: <IconPower size={15} />, danger: true, onClick: () => void toggleActive(c), disabled: setActive.isPending }
                : { label: 'تفعيل الحساب', icon: <IconCheckCircle size={15} />, onClick: () => void toggleActive(c), disabled: setActive.isPending },
            ]}
          />
        </div>
      ),
    },
  ];

  const stripLoading = q.isLoading;

  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar
          footer={
            <>
              <SegmentedFilter<StatusFilter>
                label="حالة الحساب"
                value={status}
                onChange={id => { setStatus(id); setNoBoxOnly(false); }}
                items={[
                  { id: 'all', label: 'الكل', count: items.length },
                  { id: 'active', label: 'نشط', count: activeCount },
                  { id: 'off', label: 'معطّل', count: offCount },
                ]}
              />
              {noBoxOnly && (
                <button type="button" onClick={() => setNoBoxOnly(false)} title="إزالة الفلتر">
                  <Badge tone="warn">بلا صندوق فقط ✕</Badge>
                </button>
              )}
              {hasFilters && (
                <Btn size="xs" variant="ghost" onClick={clearFilters}>مسح الفلاتر</Btn>
              )}
              <span className="ms-auto hidden items-center gap-1.5 text-[11px] text-slate-400 md:flex">
                انقر الصف للتعديل <span className="text-slate-300">·</span> <Kbd>/</Kbd> بحث <span className="text-slate-300">·</span> <Kbd>N</Kbd> كاشير جديد
              </span>
            </>
          }
        >
          <FilterLabel label="بحث بالاسم أو المستخدم أو القسم أو الصلاحية" grow>
            <SearchBox value={search} onChange={setSearch} placeholder="اكتب للبحث…" />
          </FilterLabel>
          <FilterLabel label="القسم" className={sectionFilter ? '[&_select]:border-brand-300 [&_select]:bg-brand-50/40 [&_select]:font-semibold' : ''}>
            <Select value={String(sectionFilter)} onChange={e => setSectionFilter(Number(e.target.value))} aria-label="القسم">
              <option value="0">كل الأقسام</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>{(s.cashBoxCount ?? 0) > 0 ? s.name : `${s.name} — بلا صندوق`}</option>
              ))}
            </Select>
          </FilterLabel>
          <FilterActions>
            <IconButton label="تحديث" onClick={() => { void q.refetch(); void sectionsQ.refetch(); }}>
              <IconRefresh size={15} className={q.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn icon={<IconPlus size={15} />} onClick={openNew} title="اختصار: N">
              كاشير جديد
            </Btn>
          </FilterActions>
        </FilterBar>

        <SummaryStrip
          loading={stripLoading}
          cells={[
            {
              label: 'كل الحسابات',
              value: formatNum(items.length),
              hint: `${formatNum(templateCount)} قالب صلاحيات`,
              tone: 'brand',
              onClick: clearFilters,
              active: !hasFilters,
            },
            {
              label: 'نشط',
              value: formatNum(activeCount),
              hint: 'يستطيع الدخول لنقطة البيع',
              tone: 'ok',
              onClick: () => { setStatus('active'); setNoBoxOnly(false); },
              active: status === 'active' && !noBoxOnly,
            },
            {
              label: 'معطّل',
              value: formatNum(offCount),
              hint: 'لا يستطيع الدخول',
              onClick: () => { setStatus('off'); setNoBoxOnly(false); },
              active: status === 'off' && !noBoxOnly,
            },
            {
              label: 'أقسام بلا صندوق',
              value: sectionsQ.isLoading ? '…' : formatNum(noBoxCount),
              hint: noBoxCount ? 'كاشير نشط سيُرفض دخوله' : 'كل الأقسام مربوطة بصندوق',
              tone: noBoxCount ? 'warn' : undefined,
              onClick: noBoxCount ? () => { setNoBoxOnly(v => !v); setStatus('all'); } : undefined,
              active: noBoxOnly,
            },
            {
              label: 'المعروض',
              value: formatNum(filtered.length),
              hint: hasFilters ? `من ${formatNum(items.length)}` : 'بلا فلاتر',
            },
          ]}
        />

        <WorkspaceBody>
          {q.isLoading ? (
            <div className="p-3"><TableSkeleton rows={8} cols={6} /></div>
          ) : q.isError ? (
            <ErrorBlock error={q.error} title="تعذّر تحميل الكاشير" onRetry={() => q.refetch()} />
          ) : !items.length ? (
            <EmptyState
              icon={<IconKeyboard size={24} />}
              title="لا يوجد كاشير بعد"
              description="أضف حساب كاشير ليتمكن موظفوك من الدخول إلى نقطة البيع."
              action={<Btn icon={<IconPlus size={15} />} onClick={openNew}>إضافة كاشير</Btn>}
            />
          ) : !filtered.length ? (
            <EmptyState
              compact
              title="لا نتائج مطابقة"
              description="جرّب كلمة بحث أخرى أو امسح الفلاتر."
              action={<Btn size="sm" variant="secondary" onClick={clearFilters}>مسح الفلاتر</Btn>}
            />
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              columns={columns}
              rows={filtered}
              getRowId={c => c.id}
              sort={sort}
              onSortChange={setSort}
              storageKey="cashiers"
              exportName="الكاشير"
              counterLabel="كاشير"
              emptyText="لا كاشير يطابق فلتر الأعمدة"
              selectedId={selectedId ?? undefined}
              onSelect={c => setSelectedId(c.id)}
              onRowClick={c => setEditor({ id: c.id })}
              onEnter={c => setEditor({ id: c.id })}
              rowTone={c => {
                const hi = highlight === c.id ? 'cashier-row-hi bg-brand-50/70' : '';
                return `${hi} ${c.active ? '' : 'text-slate-500'}`.trim() || undefined;
              }}
              badge={noBoxCount > 0 && !noBoxOnly ? (
                <button type="button" onClick={() => { setNoBoxOnly(true); setStatus('all'); }} title="عرض الكاشير النشط في أقسام بلا صندوق">
                  <Badge tone="warn" dot>{formatNum(noBoxCount)} بلا صندوق</Badge>
                </button>
              ) : undefined}
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      {editor && (
        <CashierEditor
          key={`${editor.id}-${editor.copyFrom ?? ''}`}
          editingId={editor.id}
          copyFromId={editor.copyFrom ?? null}
          cashiers={items}
          sections={sections}
          onClose={() => setEditor(null)}
        />
      )}
    </WorkspacePage>
  );
}
