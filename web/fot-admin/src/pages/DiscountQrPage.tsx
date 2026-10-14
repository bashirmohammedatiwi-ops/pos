import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatDateOnly, formatNum } from '@/api/client';
import type { DiscountQrPersonDto, DiscountQrReceiptDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import {
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
  IconCheckCircle,
  IconCopy,
  IconDownload,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconQr,
  IconReceipt,
  IconRefresh,
} from '@/components/icons';
import { Badge, Btn, EmptyState, Field, IconButton, Input, Modal, TableSkeleton, useConfirm } from '@/components/ui';
import {
  ErrorBlock,
  IconPower,
  RowIconButton,
  RowMenu,
  SearchBox,
  usePersistentState,
  useCopy,
} from '@/components/people/PeopleKit';
import { discountQrDataUrl, printDiscountQr } from '@/lib/qrPng';
import { downloadCsv } from '@/utils/exportCsv';

type StatusFilter = 'all' | 'active' | 'off';
type ViewMode = 'table' | 'cards';

const VIEW_KEY = 'fot_admin_discount_qr_view';

function Money({ value }: { value: number }) {
  return (
    <span className="num">
      {formatNum(value)} <span className="text-[10.5px] font-medium text-slate-400">IQD</span>
    </span>
  );
}

/** صورة QR تُولَّد محلياً مع هيكل تحميل. */
function QrImage({ code, size, dim }: { code: string; size: number; dim?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    void discountQrDataUrl(code, size * 2).then(s => {
      if (!cancelled) setSrc(s);
    });
    return () => { cancelled = true; };
  }, [code, size]);
  if (!src) return <div className="skeleton rounded-lg" style={{ width: size, height: size }} />;
  return (
    <img
      src={src}
      alt={code}
      width={size}
      height={size}
      className={`rounded-lg transition ${dim ? 'opacity-30 grayscale' : ''}`}
      style={{ width: size, height: size }}
    />
  );
}

async function downloadQrPng(name: string, code: string) {
  const src = await discountQrDataUrl(code, 720);
  const a = document.createElement('a');
  a.href = src;
  a.download = `رمز-خصم-${name.replace(/[\\/:*?"<>|]+/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function DiscountQrPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const copy = useCopy();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [view, setView] = usePersistentState<ViewMode>(VIEW_KEY, 'table');
  const [receiptsFor, setReceiptsFor] = useState<DiscountQrPersonDto | null>(null);
  const [qrForId, setQrForId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ person: DiscountQrPersonDto; value: string } | null>(null);
  const [freshId, setFreshId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const peopleQ = useQuery({
    queryKey: ['discount-qr-people'],
    queryFn: api.discountQrPeople,
  });
  const people = useMemo(() => peopleQ.data ?? [], [peopleQ.data]);
  // نافذة الرمز تقرأ أحدث نسخة (بعد إعادة التسمية/الإيقاف)
  const qrFor = qrForId != null ? people.find(p => p.id === qrForId) ?? null : null;

  const receiptsQ = useQuery({
    queryKey: ['discount-qr-receipts', receiptsFor?.id],
    queryFn: () => api.discountQrReceipts(receiptsFor!.id),
    enabled: !!receiptsFor,
  });

  const nameTaken = useMemo(
    () => !!name.trim() && people.some(p => p.name.trim() === name.trim()),
    [name, people],
  );

  const createM = useMutation({
    mutationFn: () => api.createDiscountQrPerson(name.trim()),
    onSuccess: created => {
      setName('');
      setFreshId(created.id);
      setSelectedId(created.id);
      toast.success(`تم توليد رمز لـ ${created.name}`);
      // عرض الرمز فوراً للطباعة/التنزيل
      qc.setQueryData<DiscountQrPersonDto[]>(['discount-qr-people'], old =>
        old && !old.some(p => p.id === created.id) ? [created, ...old] : old);
      setQrForId(created.id);
      void qc.invalidateQueries({ queryKey: ['discount-qr-people'] });
      window.setTimeout(() => {
        document.getElementById(`qr-${created.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        document.querySelector('.qr-row-fresh')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 300);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateM = useMutation({
    mutationFn: (req: { id: number; active?: boolean; name?: string }) =>
      api.updateDiscountQrPerson(req.id, { active: req.active, name: req.name }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['discount-qr-people'] });
      if (v.name != null) {
        toast.success('تم تغيير الاسم');
        setRenaming(null);
      } else if (v.active != null) {
        toast.success(v.active ? 'تم تفعيل الرمز' : 'تم إيقاف الرمز');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function create() {
    if (!name.trim() || createM.isPending) return;
    createM.mutate();
  }

  async function toggleActive(p: DiscountQrPersonDto) {
    if (p.active) {
      const ok = await confirm({
        title: `إيقاف رمز ${p.name}؟`,
        message: 'لن يفتح هذا الرمز الخصم في نقطة البيع حتى تعيد تفعيله. الفواتير السابقة تبقى مسجّلة.',
        confirmLabel: 'إيقاف الرمز',
        danger: true,
      });
      if (!ok) return;
    }
    updateM.mutate({ id: p.id, active: !p.active });
  }

  async function print(p: DiscountQrPersonDto) {
    try {
      await printDiscountQr(p.name, p.code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    }
  }

  async function download(p: DiscountQrPersonDto) {
    try {
      await downloadQrPng(p.name, p.code);
    } catch {
      toast.error('تعذّر تنزيل الصورة');
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return people.filter(p => {
      if (status === 'active' && !p.active) return false;
      if (status === 'off' && p.active) return false;
      return !s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s);
    });
  }, [people, search, status]);

  const activeCount = people.filter(p => p.active).length;
  const offCount = people.length - activeCount;
  const receiptTotal = people.reduce((s, p) => s + p.receiptCount, 0);
  const discountTotal = people.reduce((s, p) => s + p.totalDiscount, 0);
  const hasFilters = !!search.trim() || status !== 'all';

  function clearFilters() {
    setSearch('');
    setStatus('all');
  }

  const menuItems = (p: DiscountQrPersonDto) => [
    { label: 'عرض الرمز', icon: <IconQr size={15} />, onClick: () => setQrForId(p.id) },
    { label: 'تغيير الاسم', icon: <IconPencil size={15} />, onClick: () => setRenaming({ person: p, value: p.name }) },
    { label: 'نسخ الرمز', icon: <IconCopy size={15} />, onClick: () => void copy(p.code, 'الرمز') },
    { label: 'تنزيل صورة PNG', icon: <IconDownload size={15} />, onClick: () => void download(p) },
    { label: 'فواتير الخصم', icon: <IconReceipt size={15} />, onClick: () => setReceiptsFor(p) },
    p.active
      ? { label: 'إيقاف الرمز', icon: <IconPower size={15} />, danger: true, onClick: () => void toggleActive(p) }
      : { label: 'تفعيل الرمز', icon: <IconCheckCircle size={15} />, onClick: () => void toggleActive(p) },
  ];

  const peopleColumns: GridColumn<DiscountQrPersonDto>[] = [
    {
      key: 'name',
      header: 'الشخص',
      width: 220,
      render: p => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate font-semibold ${p.active ? 'text-header' : 'text-slate-500'}`} title={p.name}>{p.name}</span>
          {freshId === p.id && <Badge tone="brand">جديد</Badge>}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'الرمز',
      width: 190,
      sortable: false,
      render: p => (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); void copy(p.code, 'الرمز'); }}
          className="inline-flex max-w-full items-center gap-1 rounded px-1 font-mono text-[11.5px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          title={`${p.code} — انقر للنسخ`}
          dir="ltr"
        >
          <span className="truncate">{p.code}</span>
          <IconCopy size={11} className="shrink-0" />
        </button>
      ),
    },
    {
      key: 'active',
      header: 'الحالة',
      width: 96,
      sortValue: p => (p.active ? 'فعّال' : 'متوقف'),
      filterValue: p => (p.active ? 'فعّال' : 'متوقف'),
      render: p => (p.active ? <Badge tone="ok" dot>فعّال</Badge> : <Badge dot>متوقف</Badge>),
    },
    {
      key: 'receiptCount',
      header: 'فواتير بخصم',
      width: 110,
      mono: true,
      footer: 'sum',
      render: p => (p.receiptCount ? (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setReceiptsFor(p); }}
          className="font-semibold text-brand-700 hover:underline"
          title="عرض فواتير الخصم"
        >
          {formatNum(p.receiptCount)}
        </button>
      ) : <span className="text-slate-300">0</span>),
    },
    {
      key: 'totalDiscount',
      header: 'مجموع الخصم',
      width: 130,
      mono: true,
      footer: 'sum',
      render: p => (p.totalDiscount > 0 ? formatNum(p.totalDiscount) : <span className="text-slate-300">—</span>),
    },
    {
      key: 'createdAt',
      header: 'أُنشئ',
      width: 110,
      sortValue: p => p.createdAt,
      render: p => <span className="text-slate-500">{formatDateOnly(p.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 170,
      align: 'end',
      sortable: false,
      exportable: false,
      render: p => (
        <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
          <RowIconButton label="عرض الرمز" tone="brand" onClick={() => setQrForId(p.id)}>
            <IconQr size={15} />
          </RowIconButton>
          <RowIconButton label="طباعة" onClick={() => void print(p)}>
            <IconPrinter size={15} />
          </RowIconButton>
          <RowIconButton label="تنزيل صورة PNG" onClick={() => void download(p)}>
            <IconDownload size={15} />
          </RowIconButton>
          <RowIconButton label="فواتير الخصم" onClick={() => setReceiptsFor(p)}>
            <IconReceipt size={15} />
          </RowIconButton>
          <RowMenu items={menuItems(p)} />
        </div>
      ),
    },
  ];

  const receiptColumns = useMemo<GridColumn<DiscountQrReceiptDto>[]>(() => [
    { key: 'number', header: 'الفاتورة', width: 110, mono: true, render: r => <span className="font-bold">{r.number}</span> },
    { key: 'creationDate', header: 'التاريخ', width: 160, render: r => formatDate(r.creationDate) },
    { key: 'cashierName', header: 'الكاشير', width: 130, render: r => r.cashierName ?? '—' },
    { key: 'userDiscount', header: 'الخصم', width: 120, mono: true, footer: 'sum', render: r => <Money value={r.userDiscount} /> },
    { key: 'totalAmount', header: 'الصافي', width: 120, mono: true, footer: 'sum', render: r => <Money value={r.totalAmount} /> },
  ], []);

  let body;
  if (peopleQ.isLoading) {
    body = <div className="p-3"><TableSkeleton rows={8} cols={7} /></div>;
  } else if (peopleQ.isError) {
    body = <ErrorBlock error={peopleQ.error} title="تعذّر تحميل رموز الخصم" onRetry={() => peopleQ.refetch()} />;
  } else if (!people.length) {
    body = (
      <EmptyState
        icon={<IconQr size={24} />}
        title="لا رموز خصم بعد"
        description="اكتب اسم الشخص المخوّل بالخصم في الأعلى واضغط «توليد الرمز» ثم اطبعه وسلّمه له."
        action={<Btn icon={<IconPlus size={15} />} onClick={() => nameRef.current?.focus()}>إضافة شخص</Btn>}
      />
    );
  } else if (!filtered.length) {
    body = (
      <EmptyState
        compact
        title="لا نتائج مطابقة"
        action={<Btn size="sm" variant="secondary" onClick={clearFilters}>مسح الفلاتر</Btn>}
      />
    );
  } else if (view === 'table') {
    body = (
      <DataGrid
        variant="sheet"
        embedded
        fillHeight
        dense
        columns={peopleColumns}
        rows={filtered}
        getRowId={p => p.id}
        storageKey="discount-qr-people"
        exportName="رموز-الخصم"
        counterLabel="رمز"
        emptyText="لا رموز تطابق فلتر الأعمدة"
        selectedId={selectedId ?? undefined}
        onSelect={p => setSelectedId(p.id)}
        onRowDoubleClick={p => setQrForId(p.id)}
        onEnter={p => setQrForId(p.id)}
        rowTone={p => (freshId === p.id ? 'qr-row-fresh bg-brand-50/70' : p.active ? undefined : 'text-slate-500')}
        badge={<span className="hidden text-[11px] text-slate-400 md:inline">نقرة مزدوجة أو Enter لعرض الرمز</span>}
      />
    );
  } else {
    body = (
      <div className="min-h-0 flex-1 overflow-auto bg-canvas/40 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map(p => (
            <article
              key={p.id}
              id={`qr-${p.id}`}
              className={`card flex flex-col overflow-hidden transition ${freshId === p.id ? 'ring-2 ring-brand-400' : ''}`}
            >
              <header className="flex items-start justify-between gap-2 px-3 pt-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[13.5px] font-bold text-header" title={p.name}>{p.name}</h3>
                  <p className="text-[11px] text-slate-500">أُنشئ {formatDateOnly(p.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.active ? <Badge tone="ok" dot>فعّال</Badge> : <Badge dot>متوقف</Badge>}
                  <RowMenu items={menuItems(p)} />
                </div>
              </header>

              <button
                type="button"
                onClick={() => setQrForId(p.id)}
                className="relative mx-auto my-2 rounded-xl border border-slate-100 bg-white p-2 transition hover:border-brand-200"
                title="تكبير الرمز"
              >
                <QrImage code={p.code} size={132} dim={!p.active} />
                {!p.active && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Badge>متوقف</Badge>
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setReceiptsFor(p)}
                className="mx-3 grid grid-cols-2 divide-x divide-x-reverse divide-slate-100 rounded-lg border border-slate-100 text-center transition hover:border-brand-200 hover:bg-brand-50/40"
                title="عرض فواتير الخصم"
              >
                <span className="px-2 py-1">
                  <span className="block text-[10.5px] text-slate-500">فواتير</span>
                  <span className="block text-[13px] font-bold text-header num">{formatNum(p.receiptCount)}</span>
                </span>
                <span className="px-2 py-1">
                  <span className="block text-[10.5px] text-slate-500">مجموع الخصم</span>
                  <span className="block text-[13px] font-bold text-header num">
                    {p.totalDiscount > 0 ? formatNum(p.totalDiscount) : '—'}
                  </span>
                </span>
              </button>

              <footer className="mt-2 flex items-center gap-1 border-t border-slate-100 bg-slate-50/60 px-2 py-1.5">
                <Btn size="sm" variant="secondary" icon={<IconPrinter size={14} />} className="flex-1" onClick={() => void print(p)}>
                  طباعة
                </Btn>
                <RowIconButton label="تنزيل صورة PNG" onClick={() => void download(p)}>
                  <IconDownload size={15} />
                </RowIconButton>
                <RowIconButton label="نسخ الرمز" onClick={() => void copy(p.code, 'الرمز')}>
                  <IconCopy size={15} />
                </RowIconButton>
              </footer>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar
          footer={
            <>
              <SegmentedFilter<StatusFilter>
                label="حالة الرمز"
                value={status}
                onChange={setStatus}
                items={[
                  { id: 'all', label: 'الكل', count: people.length },
                  { id: 'active', label: 'فعّال', count: activeCount },
                  { id: 'off', label: 'متوقف', count: offCount },
                ]}
              />
              <SegmentedFilter<ViewMode>
                label="طريقة العرض"
                value={view}
                onChange={setView}
                items={[
                  { id: 'table', label: 'جدول' },
                  { id: 'cards', label: 'بطاقات QR' },
                ]}
              />
              {hasFilters && <Btn size="xs" variant="ghost" onClick={clearFilters}>مسح الفلاتر</Btn>}
              {nameTaken ? (
                <span className="ms-auto text-[11.5px] font-semibold text-amber-700">الاسم موجود مسبقاً — سيُولَّد رمز آخر بنفس الاسم</span>
              ) : (
                <span className="ms-auto hidden text-[11.5px] text-slate-500 xl:inline">
                  يُمسح الرمز في نقطة البيع كمنتج لفتح خصم غير محدود على الفاتورة، وتُسجَّل الفاتورة باسم صاحبه.
                </span>
              )}
            </>
          }
        >
          <FilterLabel label="بحث بالاسم أو الرمز" grow>
            <SearchBox value={search} onChange={setSearch} placeholder="اكتب للبحث…" />
          </FilterLabel>
          <div className="ms-auto flex flex-wrap items-end gap-2">
            <FilterLabel label="شخص جديد — يُولَّد له رمز QR" className="sm:min-w-[240px]">
              <Input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="مثال: أحمد — المدير"
                maxLength={80}
                className={nameTaken ? '!border-amber-300' : ''}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    create();
                  }
                }}
              />
            </FilterLabel>
            <Btn icon={<IconQr size={15} />} loading={createM.isPending} disabled={!name.trim()} onClick={create}>
              توليد الرمز
            </Btn>
            <IconButton label="تحديث" onClick={() => void peopleQ.refetch()}>
              <IconRefresh size={15} className={peopleQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            {view === 'cards' && (
              <IconButton
                label="تصدير CSV"
                disabled={!filtered.length}
                onClick={() => downloadCsv(
                  'discount-qr-people.csv',
                  ['الشخص', 'الرمز', 'الحالة', 'فواتير', 'مجموع الخصم', 'أُنشئ'],
                  filtered.map(p => [p.name, p.code, p.active ? 'فعال' : 'متوقف', p.receiptCount, p.totalDiscount, formatDateOnly(p.createdAt)]),
                )}
              >
                <IconDownload size={15} />
              </IconButton>
            )}
          </div>
        </FilterBar>

        <SummaryStrip
          loading={peopleQ.isLoading}
          cells={[
            { label: 'الأشخاص', value: formatNum(people.length), tone: 'brand', onClick: () => setStatus('all'), active: status === 'all' },
            { label: 'رموز فعّالة', value: formatNum(activeCount), tone: 'ok', onClick: () => setStatus('active'), active: status === 'active' },
            { label: 'متوقفة', value: formatNum(offCount), onClick: () => setStatus('off'), active: status === 'off' },
            { label: 'فواتير بخصم', value: formatNum(receiptTotal) },
            { label: 'مجموع الخصم', value: formatNum(discountTotal), hint: 'IQD', tone: discountTotal > 0 ? 'warn' : undefined },
          ]}
        />

        <WorkspaceBody>{body}</WorkspaceBody>
      </WorkspaceCard>

      {qrFor && (
        <Modal
          open
          size="sm"
          icon={<IconQr size={18} />}
          title={qrFor.name}
          subtitle={`أُنشئ ${formatDateOnly(qrFor.createdAt)} · ${formatNum(qrFor.receiptCount)} فاتورة بخصم`}
          onClose={() => setQrForId(null)}
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Btn variant="ghost" icon={<IconReceipt size={14} />} onClick={() => { setReceiptsFor(qrFor); setQrForId(null); }}>
                فواتير الخصم
              </Btn>
              <div className="flex gap-2">
                <Btn variant="secondary" icon={<IconDownload size={14} />} onClick={() => void download(qrFor)}>تنزيل PNG</Btn>
                <Btn icon={<IconPrinter size={14} />} onClick={() => void print(qrFor)}>طباعة</Btn>
              </div>
            </div>
          }
        >
          <div className="flex flex-col items-center gap-3">
            <div className="relative rounded-xl border border-slate-200 bg-white p-3">
              <QrImage code={qrFor.code} size={240} dim={!qrFor.active} />
              {!qrFor.active && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Badge>متوقف</Badge>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {qrFor.active ? <Badge tone="ok" dot>فعّال</Badge> : <Badge dot>متوقف</Badge>}
              {qrFor.totalDiscount > 0 && (
                <span className="text-[12px] text-slate-500">مجموع الخصم <b className="text-header"><Money value={qrFor.totalDiscount} /></b></span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void copy(qrFor.code, 'الرمز')}
              className="flex max-w-full items-center justify-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-[12px] text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
              title="نسخ الرمز"
              dir="ltr"
            >
              <span className="truncate">{qrFor.code}</span>
              <IconCopy size={12} className="shrink-0" />
            </button>
          </div>
        </Modal>
      )}

      {receiptsFor && (
        <Modal
          open
          size="lg"
          icon={<IconReceipt size={18} />}
          title={`فواتير خُصمت بواسطة ${receiptsFor.name}`}
          subtitle={`${formatNum(receiptsFor.receiptCount)} فاتورة · مجموع الخصم ${formatNum(receiptsFor.totalDiscount)} IQD`}
          onClose={() => setReceiptsFor(null)}
        >
          {receiptsQ.isError ? (
            <ErrorBlock error={receiptsQ.error} title="تعذّر تحميل الفواتير" onRetry={() => receiptsQ.refetch()} />
          ) : (
            <DataGrid
              columns={receiptColumns}
              rows={receiptsQ.data ?? []}
              loading={receiptsQ.isLoading}
              getRowId={r => r.id}
              maxHeight="60vh"
              counterLabel="فاتورة"
              emptyText="لا فواتير خصم بعد لهذا الشخص"
              exportName={`خصم-${receiptsFor.name}`}
            />
          )}
        </Modal>
      )}

      {renaming && (
        <Modal
          open
          size="sm"
          icon={<IconPencil size={18} />}
          title="تغيير الاسم"
          subtitle="الرمز نفسه لا يتغير — يتغير الاسم في التقارير والطباعة فقط."
          onClose={() => setRenaming(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Btn variant="secondary" onClick={() => setRenaming(null)}>إلغاء</Btn>
              <Btn
                type="submit"
                form="qr-rename-form"
                loading={updateM.isPending}
                disabled={!renaming.value.trim() || renaming.value.trim() === renaming.person.name}
              >
                حفظ
              </Btn>
            </div>
          }
        >
          <form
            id="qr-rename-form"
            onSubmit={e => {
              e.preventDefault();
              const v = renaming.value.trim();
              if (!v || v === renaming.person.name) return;
              updateM.mutate({ id: renaming.person.id, name: v });
            }}
          >
            <Field label="الاسم">
              <Input value={renaming.value} maxLength={80} onChange={e => setRenaming(r => (r ? { ...r, value: e.target.value } : r))} />
            </Field>
          </form>
        </Modal>
      )}
    </WorkspacePage>
  );
}

export default DiscountQrPage;
