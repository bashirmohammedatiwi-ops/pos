import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { api, formatCurrency, formatDate, formatNum } from '@/api/client';

import type { EdariDeadLetterDto, EdariSyncLogDto, ReceiptSummary, UpdateEdariSettingsRequest } from '@/api/types';

import { useToast } from '@/components/Toast';

import { Alert, Badge, Btn, Field, IconButton, Input, Select, Skeleton, Switch, Tabs, useConfirm, type Tone } from '@/components/ui';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { NumberDraftInput } from '@/components/NumberDraftInput';
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
import {
  IconAlert,
  IconClock,
  IconDatabase,
  IconFolder,
  IconHistory,
  IconLayers,
  IconPackage,
  IconRefresh,
  IconSend,
  IconSliders,
  IconTag,
  IconUsers,
  IconWallet,
  IconZap,
} from '@/components/icons';
import {
  InfoTile,
  PulseDot,
  SettingsCard,
  StickySaveBar,
  looksLikeHwId,
  readLocal,
  shortHwId,
  timeAgo,
  writeLocal,
} from '@/components/system/systemUi';
import { Clip, CompactSearch, FieldBox, StatusLine } from '@/components/operations/opsUi';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';

type EdariTab = 'queue' | 'dead' | 'logs' | 'sync' | 'settings';
const EDARI_TABS: EdariTab[] = ['queue', 'dead', 'logs', 'sync', 'settings'];
/** v2: التبويبات تغيّرت (الطابور صار تبويباً مستقلاً بجدول كامل). */
const TAB_KEY = 'fot_admin_edari_tab_v2';

/* ── أعمدة الجداول ── */

function posLabel(name?: string | null) {
  if (!name) return <span className="text-slate-300">—</span>;
  if (looksLikeHwId(name)) {
    return <span className="font-mono text-[11.5px] text-slate-600" title={name} dir="ltr">{shortHwId(name)}</span>;
  }
  return <Clip text={name} />;
}

const unsyncedColumns: GridColumn<ReceiptSummary>[] = [
  {
    key: 'number',
    header: 'الفاتورة',
    width: 110,
    pinned: 'start',
    sortValue: r => r.number,
    filterValue: r => String(r.displayNumber ?? r.number),
    render: r => (
      <Link to={`/receipts?highlight=${r.id}`} className="font-semibold text-brand-700 hover:underline num">
        {r.displayNumber ?? r.number}
      </Link>
    ),
  },
  { key: 'creationDate', header: 'التاريخ', width: 160, sortValue: r => r.creationDate, filterValue: r => formatDate(r.creationDate), render: r => <span className="num text-[12px]">{formatDate(r.creationDate)}</span> },
  { key: 'sectionName', header: 'القسم', width: 140, render: r => <Clip text={r.sectionName} /> },
  { key: 'posName', header: 'نقطة البيع', width: 140, exportValue: r => (!r.posName ? '—' : looksLikeHwId(r.posName) ? shortHwId(r.posName) : r.posName), render: r => posLabel(r.posName) },
  { key: 'cashierName', header: 'الكاشير', width: 140, render: r => <Clip text={r.cashierName} /> },
  { key: 'salesmanName', header: 'البائع', width: 140, render: r => <Clip text={r.salesmanName} /> },
  { key: 'itemCount', header: 'الأصناف', width: 80, mono: true, align: 'center', footer: 'sum' },
  { key: 'netAmount', header: 'المبلغ', width: 140, mono: true, footer: 'sum', sortValue: r => r.netAmount ?? r.totalAmount, render: r => <span className="font-bold">{formatCurrency(r.netAmount ?? r.totalAmount)}</span> },
];

function deadColumns(retry: (id: number) => void, pendingId: number | null): GridColumn<EdariDeadLetterDto>[] {
  return [
    {
      key: 'number',
      header: 'الفاتورة',
      width: 110,
      pinned: 'start',
      render: d => (
        <Link to={`/receipts?highlight=${d.id}`} className="font-semibold text-brand-700 hover:underline num">
          {d.number}
        </Link>
      ),
    },
    { key: 'creationDate', header: 'التاريخ', width: 160, sortValue: d => d.creationDate, filterValue: d => formatDate(d.creationDate), render: d => <span className="num text-[12px]">{formatDate(d.creationDate)}</span> },
    { key: 'totalAmount', header: 'المبلغ', width: 130, mono: true, footer: 'sum', render: d => formatCurrency(d.totalAmount) },
    { key: 'syncAttempts', header: 'المحاولات', width: 90, mono: true, align: 'center' },
    { key: 'lastAttemptAt', header: 'آخر محاولة', width: 110, sortValue: d => d.lastAttemptAt ?? '', render: d => <span className="text-[12px]" title={d.lastAttemptAt ? formatDate(d.lastAttemptAt) : ''}>{timeAgo(d.lastAttemptAt)}</span> },
    { key: 'reason', header: 'السبب', width: 420, filterValue: d => d.reason ?? '', render: d => <Clip text={d.reason} className="text-[12px] text-red-700" /> },
    {
      key: 'actions',
      header: 'إجراء',
      width: 140,
      align: 'center',
      sortable: false,
      exportable: false,
      render: d => (
        <Btn size="xs" variant="outline" icon={<IconRefresh size={12} />} onClick={() => retry(d.id)} loading={pendingId === d.id} disabled={pendingId != null && pendingId !== d.id}>
          إعادة للطابور
        </Btn>
      ),
    },
  ];
}

function logTone(status: string): Tone {
  const s = (status ?? '').toLowerCase();
  if (/(fail|error|dead|خطأ|فشل)/.test(s)) return 'danger';
  if (/(warn|skip|retry|pending)/.test(s)) return 'warn';
  if (/(ok|success|synced|done|نجاح|تم)/.test(s)) return 'ok';
  return 'default';
}

const logsColumns: GridColumn<EdariSyncLogDto>[] = [
  { key: 'attemptedAt', header: 'الوقت', width: 160, sortValue: l => l.attemptedAt, filterValue: l => formatDate(l.attemptedAt), render: l => <span className="num text-[12px]" title={timeAgo(l.attemptedAt)}>{formatDate(l.attemptedAt)}</span> },
  { key: 'operation', header: 'العملية', width: 170, render: l => <Clip text={l.operation} className="font-semibold text-slate-700" /> },
  { key: 'status', header: 'الحالة', width: 110, align: 'center', render: l => <Badge tone={logTone(l.status)}>{l.status}</Badge> },
  {
    key: 'receiptId',
    header: 'الفاتورة',
    width: 100,
    sortValue: l => l.receiptId ?? 0,
    render: l => l.receiptId ? <Link to={`/receipts?highlight=${l.receiptId}`} className="text-brand-700 hover:underline num">{l.receiptId}</Link> : <span className="text-slate-300">—</span>,
  },
  { key: 'edrNum', header: 'رقم الأداري', width: 100, mono: true, render: l => l.edrNum ?? '—' },
  {
    key: 'errorMessage',
    header: 'التفاصيل',
    width: 480,
    filterValue: l => `${l.errorMessage ?? ''} ${l.details ?? ''}`,
    sortValue: l => l.errorMessage ?? l.details ?? '',
    render: l => <Clip text={l.errorMessage ?? l.details} className={`text-[12px] ${l.errorMessage ? 'text-red-700' : 'text-slate-500'}`} />,
  },
];

function normalizeSettings(s: UpdateEdariSettingsRequest) {
  return {
    dataRoot: s.dataRoot,
    databaseAlias: s.databaseAlias,
    server: s.server,
    port: s.port,
    connectionMode: s.connectionMode ?? 'Ado',
    odbcDriver: s.odbcDriver,
    adoProviderPath: s.adoProviderPath ?? null,
    adoConnectorDirectory: s.adoConnectorDirectory ?? null,
    enabled: s.enabled,
    autoSyncEnabled: s.autoSyncEnabled,
    autoSyncIntervalSeconds: s.autoSyncIntervalSeconds,
    catalogSyncEnabled: s.catalogSyncEnabled,
    dataPullIntervalSeconds: s.dataPullIntervalSeconds || 240,
  };
}

function minutesLabel(mins: number) {
  return mins >= 60 ? `${formatNum(Math.floor(mins / 60))} ساعة` : `${formatNum(mins)} دقيقة`;
}

export function EdariPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<UpdateEdariSettingsRequest | null>(null);
  const [years, setYears] = useState<string[]>([]);
  const [tab, setTabState] = useState<EdariTab>(() => {
    const saved = readLocal<EdariTab>(TAB_KEY);
    return saved && EDARI_TABS.includes(saved) ? saved : 'queue';
  });
  const [logFilter, setLogFilter] = useState<'all' | 'ok' | 'danger'>('all');
  const [logQuery, setLogQuery] = useState('');
  const [queueQuery, setQueueQuery] = useState('');
  const [deadQuery, setDeadQuery] = useState('');
  const [retryingId, setRetryingId] = useState<number | null>(null);

  function setTab(t: EdariTab) {
    setTabState(t);
    writeLocal(TAB_KEY, t);
  }

  const settingsQ = useQuery({ queryKey: ['edari-settings'], queryFn: api.edariSettings, refetchInterval: 15_000 });
  const statusQ = useQuery({ queryKey: ['edari-status'], queryFn: api.edariStatus, refetchInterval: 15_000 });
  const logsQ = useQuery({ queryKey: ['edari-logs'], queryFn: api.edariLogs, refetchInterval: 20_000 });
  const unsyncedQ = useQuery({ queryKey: ['edari-unsynced'], queryFn: api.edariUnsynced, refetchInterval: 20_000 });
  const deadQ = useQuery({ queryKey: ['edari-dead-letters'], queryFn: api.edariDeadLetters, refetchInterval: 30_000 });

  const retryDead = useMutation({
    mutationFn: (id: number) => {
      setRetryingId(id);
      return api.retryEdariDeadLetter(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edari-dead-letters'] });
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      toast.success('أُعيدت الفاتورة إلى طابور الترحيل');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
    onSettled: () => setRetryingId(null),
  });

  const retryAllDead = useMutation({
    mutationFn: api.retryAllEdariDeadLetters,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['edari-dead-letters'] });
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      toast.success(r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const formRef = useRef(form);
  const skipHydrate = useRef(false);
  formRef.current = form;

  function hydrate() {
    const d = settingsQ.data;
    if (!d) return;
    setYears(d.availableYears ?? []);
    setForm({
      dataRoot: d.dataRoot,
      databaseAlias: d.databaseAlias,
      server: d.server,
      port: d.port,
      connectionMode: d.connectionMode ?? 'Ado',
      odbcDriver: d.odbcDriver,
      adoProviderPath: d.adoProviderPath,
      adoConnectorDirectory: d.adoConnectorDirectory,
      enabled: d.enabled,
      autoSyncEnabled: d.autoSyncEnabled,
      autoSyncIntervalSeconds: d.autoSyncIntervalSeconds,
      catalogSyncEnabled: d.catalogSyncEnabled,
      dataPullIntervalSeconds: d.dataPullIntervalSeconds || 240,
    });
  }

  useEffect(() => {
    if (!settingsQ.data || skipHydrate.current) return;
    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: () => api.saveEdariSettings(formRef.current!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edari-settings'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('تم حفظ إعدادات الأداري');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const test = useMutation({
    mutationFn: api.testEdariConnection,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['edari-settings'] });
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      toast[r.ok ? 'success' : 'error'](r.ok ? `اتصال ناجح: ${r.message}` : r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const syncPull = useMutation({
    mutationFn: () => api.syncEdariPull(form?.catalogSyncEnabled ?? false),
    onSuccess: async r => {
      qc.invalidateQueries({ queryKey: ['edari-settings'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      await qc.invalidateQueries({ queryKey: ['salesmen'] });
      await qc.refetchQueries({ queryKey: ['salesmen'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['edari-branches'] });
      toast[r.ok ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل جلب البيانات'),
  });

  const syncArticles = useMutation({
    mutationFn: api.syncEdariArticles,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      toast[r.success ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل مزامنة المنتجات'),
  });

  const syncBranches = useMutation({
    mutationFn: api.syncEdariBranches,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['edari-branches'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      toast[r.success ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل مزامنة الفروع'),
  });

  const syncAccounts = useMutation({
    mutationFn: api.syncEdariAccounts,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['cashbox-accounts-edari'] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      toast[r.success ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل مزامنة الحسابات'),
  });

  const syncCatalog = useMutation({
    mutationFn: api.syncEdariCatalog,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['edari-settings'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      toast.success(`${r.message} — عروض: ${r.offersImported}`);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const syncFull = useMutation({
    mutationFn: () => api.syncEdariFull(form?.catalogSyncEnabled ?? false),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      qc.invalidateQueries({ queryKey: ['edari-unsynced'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['salesmen'] });
      toast[r.ok ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل المزامنة الكاملة'),
  });

  const resetReceipts = useMutation({
    mutationFn: () => api.resetEdariReceipts(undefined, undefined, undefined),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      qc.invalidateQueries({ queryKey: ['edari-unsynced'] });
      toast.success(r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل إعادة التجهيز'),
  });

  const syncArabic = useMutation({
    mutationFn: api.syncEdariArabicNames,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['salesmen'] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      toast[r.success ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل تصحيح الأسماء'),
  });

  const refreshYears = useMutation({
    mutationFn: api.edariYears,
    onSuccess: list => {
      setYears(list);
      toast.success(list.length ? `وُجدت ${list.length} سنة` : 'لا سنوات في المسار الحالي');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل اكتشاف السنوات'),
  });

  const syncReceipts = useMutation({
    mutationFn: () => api.syncEdariReceipts(true, 50),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      qc.invalidateQueries({ queryKey: ['edari-logs'] });
      qc.invalidateQueries({ queryKey: ['edari-unsynced'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast[r.ok ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const settings = settingsQ.data;
  const dirty = !!(
    form &&
    settings &&
    JSON.stringify(normalizeSettings(form)) !== JSON.stringify(normalizeSettings(settings))
  );
  skipHydrate.current = dirty || save.isPending;
  useUnsavedWarning(dirty);
  useSaveShortcut(() => { if (dirty && formRef.current) save.mutate(); }, dirty);

  const logs = useMemo(() => logsQ.data ?? [], [logsQ.data]);
  const filteredLogs = useMemo(() => {
    let list = logs;
    if (logFilter !== 'all') list = list.filter(l => (logFilter === 'danger' ? logTone(l.status) === 'danger' : logTone(l.status) === 'ok'));
    const q = logQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(l =>
        `${l.operation ?? ''} ${l.status} ${l.errorMessage ?? ''} ${l.details ?? ''} ${l.receiptId ?? ''} ${l.edrNum ?? ''}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [logs, logFilter, logQuery]);
  const failedLogs = useMemo(() => logs.filter(l => logTone(l.status) === 'danger').length, [logs]);
  const okLogs = useMemo(() => logs.filter(l => logTone(l.status) === 'ok').length, [logs]);

  const unsyncedRows = useMemo(() => unsyncedQ.data ?? [], [unsyncedQ.data]);
  const unsyncedAmount = useMemo(
    () => unsyncedRows.reduce((s, r) => s + (r.netAmount ?? r.totalAmount ?? 0), 0),
    [unsyncedRows],
  );
  const filteredUnsynced = useMemo(() => {
    const q = queueQuery.trim().toLowerCase();
    if (!q) return unsyncedRows;
    return unsyncedRows.filter(r =>
      `${r.displayNumber ?? ''} ${r.number} ${r.cashierName ?? ''} ${r.salesmanName ?? ''} ${r.sectionName ?? ''} ${r.posName ?? ''}`.toLowerCase().includes(q),
    );
  }, [unsyncedRows, queueQuery]);

  const deadRows = useMemo(() => deadQ.data ?? [], [deadQ.data]);
  const filteredDead = useMemo(() => {
    const q = deadQuery.trim().toLowerCase();
    if (!q) return deadRows;
    return deadRows.filter(d => `${d.number} ${d.reason ?? ''}`.toLowerCase().includes(q));
  }, [deadRows, deadQuery]);

  const deadCols = deadColumns((id: number) => retryDead.mutate(id), retryingId);

  if (settingsQ.isError && !settings) {
    return (
      <Alert title="تعذر تحميل إعدادات الأداري">
        <div className="flex flex-wrap items-center gap-2">
          <span>{settingsQ.error instanceof Error ? settingsQ.error.message : 'خطأ غير معروف'}</span>
          <Btn size="xs" variant="secondary" onClick={() => settingsQ.refetch()}>إعادة المحاولة</Btn>
        </div>
      </Alert>
    );
  }

  if (settingsQ.isLoading || !form) {
    return (
      <WorkspacePage>
        <WorkspaceCard>
          <div className="space-y-2 p-3">
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-9 w-1/2 rounded-lg" />
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-md" />)}
          </div>
        </WorkspaceCard>
      </WorkspacePage>
    );
  }

  const set = <K extends keyof UpdateEdariSettingsRequest>(k: K, v: UpdateEdariSettingsRequest[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const live = statusQ.data;
  const unsyncedCount = live?.unsyncedCount ?? unsyncedQ.data?.length ?? 0;
  const deadCount = live?.deadLetterCount ?? deadQ.data?.length ?? 0;
  const enabled = !!settings?.enabled;
  const connected = live?.connectionOk ?? settings?.lastConnectionOk;

  const conn: { label: string; tone: 'ok' | 'warn' | 'danger' | 'off'; detail: string } = !enabled
    ? { label: 'الربط معطّل', tone: 'off', detail: 'فعّل الربط من تبويب الإعدادات لبدء المزامنة' }
    : live?.circuitOpen
      ? { label: 'متوقف مؤقتاً', tone: 'warn', detail: `تكرر فشل الاتصال — تُستأنف المحاولة خلال ${live.circuitRetryInSeconds ?? 0} ثانية` }
      : connected === true
        ? { label: 'متصل بالأداري', tone: 'ok', detail: live?.liveMessage ?? 'تغييرات الأداري تصل تلقائياً' }
        : connected === false
          ? { label: 'غير متصل', tone: 'danger', detail: settings?.lastConnectionMessage ?? 'تحقق من الخادم ومسار البيانات' }
          : { label: 'جاري التحقق', tone: 'warn', detail: 'لم يُختبر الاتصال بعد' };

  const busyAny = syncPull.isPending || syncFull.isPending;
  const oldest = live?.oldestUnsyncedMinutes ?? 0;
  const autoLabel = settings?.autoSyncEnabled ? `تلقائي كل ${Math.round((settings.dataPullIntervalSeconds || 240) / 60)} د` : 'التحديث التلقائي متوقف';

  /* العمليات اليدوية — جدول بسطر لكل عملية */
  const ops: {
    key: string;
    title: string;
    description: string;
    icon: ReactNode;
    last?: string | null;
    loading: boolean;
    disabled: boolean;
    primary?: boolean;
    run: () => void;
  }[] = [
    {
      key: 'full',
      title: 'مزامنة كاملة',
      description: 'جلب كل البيانات ثم ترحيل الفواتير المعلقة.',
      icon: <IconZap size={15} />,
      loading: syncFull.isPending,
      disabled: !enabled || syncPull.isPending,
      primary: true,
      run: () => syncFull.mutate(),
    },
    {
      key: 'pull',
      title: 'جلب البيانات',
      description: 'البائعون والمنتجات والفروع من الأداري.',
      icon: <IconRefresh size={15} />,
      last: settings?.lastDataPullAt,
      loading: syncPull.isPending,
      disabled: !enabled || syncFull.isPending,
      run: () => syncPull.mutate(),
    },
    {
      key: 'receipts',
      title: 'ترحيل الفواتير',
      description: `إرسال ${formatNum(unsyncedCount)} فاتورة معلّقة إلى الأداري.`,
      icon: <IconSend size={15} />,
      last: settings?.lastReceiptSyncAt,
      loading: syncReceipts.isPending,
      disabled: !enabled,
      run: () => syncReceipts.mutate(),
    },
    {
      key: 'articles',
      title: 'المنتجات',
      description: 'تحديث الأصناف والأسعار (File13n).',
      icon: <IconPackage size={15} />,
      loading: syncArticles.isPending,
      disabled: !enabled || busyAny,
      run: () => syncArticles.mutate(),
    },
    {
      key: 'branches',
      title: 'الفروع والأقسام',
      description: 'ربط الأقسام بفروع الأداري (FileBrch).',
      icon: <IconLayers size={15} />,
      loading: syncBranches.isPending,
      disabled: !enabled || busyAny,
      run: () => syncBranches.mutate(),
    },
    {
      key: 'accounts',
      title: 'الحسابات والصناديق',
      description: 'الصناديق المتاحة للأقسام (File11n).',
      icon: <IconWallet size={15} />,
      loading: syncAccounts.isPending,
      disabled: !enabled || busyAny,
      run: () => syncAccounts.mutate(),
    },
    {
      key: 'catalog',
      title: 'العروض (Catalog)',
      description: 'استيراد عروض الأداري.',
      icon: <IconTag size={15} />,
      last: settings?.lastCatalogSyncAt,
      loading: syncCatalog.isPending,
      disabled: busyAny,
      run: () => syncCatalog.mutate(),
    },
    {
      key: 'arabic',
      title: 'تصحيح الأسماء العربية',
      description: 'إعادة قراءة أسماء الأصناف والبائعين والفروع.',
      icon: <IconUsers size={15} />,
      loading: syncArabic.isPending,
      disabled: !enabled || busyAny,
      run: () => syncArabic.mutate(),
    },
  ];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        {/* ── شريط الحالة ── */}
        <StatusLine
          tone={conn.tone}
          dot={<PulseDot online={conn.tone === 'ok'} tone={conn.tone} />}
          title={conn.label}
          badges={
            <>
              {settings?.databaseAlias && <Badge tone="brand">سنة {settings.databaseAlias}</Badge>}
              {live?.liveWatching && <Badge tone="info">مراقبة حيّة</Badge>}
            </>
          }
          detail={conn.detail}
          actions={
            <>
              <Btn variant="secondary" size="sm" icon={<IconZap size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
                اختبار الاتصال
              </Btn>
              <Btn
                variant="secondary"
                size="sm"
                icon={<IconSend size={14} />}
                loading={syncReceipts.isPending}
                disabled={!enabled}
                onClick={() => syncReceipts.mutate()}
              >
                ترحيل الفواتير{unsyncedCount ? ` (${formatNum(unsyncedCount)})` : ''}
              </Btn>
              <Btn size="sm" icon={<IconRefresh size={14} />} loading={syncPull.isPending} disabled={!enabled || syncFull.isPending} onClick={() => syncPull.mutate()}>
                جلب البيانات الآن
              </Btn>
            </>
          }
        />

        {/* ── المجاميع ── */}
        <SummaryStrip
          loading={statusQ.isLoading}
          cells={[
            {
              label: 'بانتظار الترحيل',
              value: formatNum(unsyncedCount),
              hint: unsyncedAmount > 0
                ? `${formatCurrency(unsyncedAmount)}${oldest > 0 ? ` · منذ ${minutesLabel(oldest)}` : ''}`
                : oldest > 0 ? `أقدمها منذ ${minutesLabel(oldest)}` : 'لا تراكم',
              tone: unsyncedCount ? 'warn' : 'ok',
              onClick: () => setTab('queue'),
              active: tab === 'queue',
            },
            { label: 'فواتير مُرحّلة', value: formatNum(live?.syncedCount ?? 0), tone: 'ok' },
            {
              label: 'متوقفة — تحتاج تدخلاً',
              value: formatNum(deadCount),
              hint: deadCount ? 'اضغط لعرضها ومعالجتها' : 'لا شيء',
              tone: deadCount ? 'danger' : undefined,
              onClick: () => setTab('dead'),
              active: tab === 'dead',
            },
            {
              label: 'أخطاء في السجل',
              value: formatNum(failedLogs),
              hint: `من آخر ${formatNum(logs.length)} عملية`,
              tone: failedLogs ? 'warn' : undefined,
              onClick: () => {
                setLogFilter(failedLogs ? 'danger' : 'all');
                setTab('logs');
              },
              active: tab === 'logs',
            },
            {
              label: 'آخر جلب للبيانات',
              value: <span title={settings?.lastDataPullAt ? formatDate(settings.lastDataPullAt) : undefined}>{timeAgo(settings?.lastDataPullAt)}</span>,
              hint: autoLabel,
              tone: settings?.autoSyncEnabled ? undefined : 'warn',
            },
            {
              label: 'آخر ترحيل للفواتير',
              value: <span title={settings?.lastReceiptSyncAt ? formatDate(settings.lastReceiptSyncAt) : undefined}>{timeAgo(settings?.lastReceiptSyncAt)}</span>,
              hint: `آخر فحص للاتصال ${timeAgo(settings?.lastHeartbeatAt)}`,
            },
          ]}
        />

        <Tabs<EdariTab>
          className="shrink-0 bg-white px-2"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'queue', label: 'بانتظار الترحيل', icon: <IconClock size={14} />, count: unsyncedCount },
            { id: 'dead', label: 'الفواتير المتوقفة', icon: <IconAlert size={14} />, count: deadCount },
            { id: 'logs', label: 'سجل العمليات', icon: <IconHistory size={14} />, count: logs.length },
            { id: 'sync', label: 'المزامنة اليدوية', icon: <IconRefresh size={14} /> },
            { id: 'settings', label: dirty ? 'الإعدادات •' : 'الإعدادات', icon: <IconSliders size={14} /> },
          ]}
        />

        {!enabled && tab !== 'settings' && (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[12px] text-amber-900">
            الربط مع الأداري معطّل — عمليات المزامنة متوقفة. فعّله من{' '}
            <button type="button" className="font-bold underline" onClick={() => setTab('settings')}>تبويب الإعدادات</button>.
          </div>
        )}

        {/* ── بانتظار الترحيل ── */}
        {tab === 'queue' && (
          <>
            <FilterBar>
              <FilterLabel label="بحث في الطابور" grow>
                <CompactSearch value={queueQuery} onChange={setQueueQuery} placeholder="رقم الفاتورة، الكاشير، البائع، القسم…" />
              </FilterLabel>
              <FilterActions>
                <Link to="/receipts?synced=false">
                  <Btn variant="secondary" size="md" icon={<IconHistory size={14} />}>
                    فتح في صفحة الفواتير
                  </Btn>
                </Link>
                <Btn size="md" icon={<IconSend size={14} />} loading={syncReceipts.isPending} disabled={!enabled || !unsyncedCount} onClick={() => syncReceipts.mutate()}>
                  ترحيل الآن
                </Btn>
              </FilterActions>
            </FilterBar>
            {unsyncedQ.isError && (
              <div className="shrink-0 p-2"><Alert>تعذر تحميل الفواتير بانتظار الترحيل.</Alert></div>
            )}
            <WorkspaceBody>
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                filters
                dense
                columns={unsyncedColumns}
                rows={filteredUnsynced}
                loading={unsyncedQ.isLoading}
                getRowId={r => r.id}
                storageKey="edari-queue"
                exportName="فواتير-بانتظار-الترحيل"
                counterLabel="فاتورة"
                emptyText={unsyncedRows.length ? 'لا فواتير مطابقة' : 'لا فواتير معلّقة — كل الفواتير مرحّلة'}
                badge={oldest > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                    أقدمها منذ {minutesLabel(oldest)}
                  </span>
                ) : undefined}
                toolbar={
                  <IconButton label="تحديث" className="!h-7 !w-7" onClick={() => void unsyncedQ.refetch()}>
                    <IconRefresh size={14} className={unsyncedQ.isFetching ? 'animate-spin' : ''} />
                  </IconButton>
                }
              />
            </WorkspaceBody>
          </>
        )}

        {/* ── الفواتير المتوقفة ── */}
        {tab === 'dead' && (
          <>
            <FilterBar
              footer={
                <span className="text-[11.5px] text-slate-500">
                  فواتير توقف ترحيلها التلقائي بعد فشل متكرر أو خطأ بنيوي (صنف مفقود في الأداري، قسم غير مربوط بفرع…). عالج السبب الظاهر في عمود «السبب» ثم أعدها للطابور.
                </span>
              }
            >
              <FilterLabel label="بحث" grow>
                <CompactSearch value={deadQuery} onChange={setDeadQuery} placeholder="رقم الفاتورة أو نص السبب…" />
              </FilterLabel>
              <FilterActions>
                <Btn
                  icon={<IconRefresh size={14} />}
                  loading={retryAllDead.isPending}
                  disabled={(deadQ.data?.length ?? 0) === 0}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'إعادة كل الفواتير المتوقفة للطابور؟',
                      message: `ستُعاد ${formatNum(deadQ.data?.length ?? 0)} فاتورة لمحاولة الترحيل من جديد. إن لم يُعالَج السبب ستعود متوقفة.`,
                      confirmLabel: 'إعادة الكل',
                    });
                    if (ok) retryAllDead.mutate();
                  }}
                >
                  إعادة الكل للطابور
                </Btn>
              </FilterActions>
            </FilterBar>
            {deadQ.isError && <div className="shrink-0 p-2"><Alert>تعذر تحميل الفواتير المتوقفة.</Alert></div>}
            <WorkspaceBody>
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                filters
                dense
                columns={deadCols}
                rows={filteredDead}
                loading={deadQ.isLoading}
                getRowId={d => d.id}
                storageKey="edari-dead"
                exportName="فواتير-متوقفة"
                counterLabel="فاتورة"
                emptyText={deadRows.length ? 'لا فواتير مطابقة' : 'لا فواتير متوقفة — كل شيء يعمل'}
                rowTone={() => 'bg-red-50/30'}
                toolbar={
                  <IconButton label="تحديث" className="!h-7 !w-7" onClick={() => void deadQ.refetch()}>
                    <IconRefresh size={14} className={deadQ.isFetching ? 'animate-spin' : ''} />
                  </IconButton>
                }
              />
            </WorkspaceBody>
          </>
        )}

        {/* ── سجل العمليات ── */}
        {tab === 'logs' && (
          <>
            <FilterBar>
              <FilterLabel label="بحث في السجل" grow>
                <CompactSearch value={logQuery} onChange={setLogQuery} placeholder="العملية، الحالة، رسالة الخطأ، رقم الفاتورة…" />
              </FilterLabel>
              <FieldBox label="الحالة">
                <SegmentedFilter
                  label="حالة العملية"
                  value={logFilter}
                  onChange={setLogFilter}
                  items={[
                    { id: 'all', label: 'الكل', count: logs.length },
                    { id: 'ok', label: 'ناجحة', count: okLogs },
                    { id: 'danger', label: 'فاشلة', count: failedLogs, tone: 'danger' },
                  ]}
                />
              </FieldBox>
              <FilterActions>
                <Btn variant="secondary" icon={<IconRefresh size={14} className={logsQ.isFetching ? 'animate-spin' : ''} />} onClick={() => logsQ.refetch()}>
                  تحديث
                </Btn>
              </FilterActions>
            </FilterBar>
            {logsQ.isError && <div className="shrink-0 p-2"><Alert>تعذر تحميل السجل.</Alert></div>}
            <WorkspaceBody>
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                filters
                dense
                columns={logsColumns}
                rows={filteredLogs}
                loading={logsQ.isLoading}
                getRowId={l => l.id}
                storageKey="edari-logs"
                exportName="سجل-عمليات-الأداري"
                counterLabel="عملية"
                emptyText={logs.length ? 'لا عمليات مطابقة' : 'لا عمليات مسجلة'}
                rowTone={l => (logTone(l.status) === 'danger' ? 'bg-red-50/40' : undefined)}
                initialSort={{ key: 'attemptedAt', dir: 'desc' }}
              />
            </WorkspaceBody>
          </>
        )}

        {/* ── المزامنة اليدوية ── */}
        {tab === 'sync' && (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr className="text-[11.5px] text-slate-600">
                  <th className="sticky top-0 border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">العملية</th>
                  <th className="sticky top-0 border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">ماذا تفعل</th>
                  <th className="sticky top-0 w-36 border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">آخر تنفيذ</th>
                  <th className="sticky top-0 w-40 border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-center font-bold">تشغيل</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((op, i) => (
                  <tr key={op.key} className={`${i % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-brand-50/40`}>
                    <td className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5">
                      <span className="inline-flex items-center gap-2 font-bold text-header">
                        <span className={op.primary ? 'text-brand-700' : 'text-slate-500'}>{op.icon}</span>
                        {op.title}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-1.5 text-slate-600">{op.description}</td>
                    <td className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-slate-500" title={op.last ? formatDate(op.last) : undefined}>
                      {op.last !== undefined ? timeAgo(op.last) : '—'}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-1.5 text-center">
                      <Btn size="xs" variant={op.primary ? 'primary' : 'secondary'} loading={op.loading} disabled={op.disabled} onClick={op.run} className="min-w-[96px]">
                        {op.loading ? 'جارٍ…' : 'تشغيل'}
                      </Btn>
                    </td>
                  </tr>
                ))}
                <tr className="bg-amber-50/50">
                  <td className="whitespace-nowrap border-b border-amber-200 px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-bold text-amber-900">
                      <IconAlert size={15} className="text-amber-600" />
                      إعادة تجهيز الفواتير للترحيل
                    </span>
                  </td>
                  <td className="border-b border-amber-200 px-3 py-2 text-[12px] leading-5 text-amber-800" colSpan={2}>
                    يعيد الفواتير المرحّلة إلى حالة «بانتظار الترحيل» لترحيلها من جديد. استخدمه فقط عند حذفها من الأداري أو تغيير السنة.
                  </td>
                  <td className="border-b border-amber-200 px-3 py-2 text-center">
                    <Btn
                      size="xs"
                      variant="secondary"
                      className="min-w-[96px]"
                      loading={resetReceipts.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'إعادة تجهيز الفواتير للترحيل؟',
                          message: 'ستُعلَّم الفواتير المرحّلة كغير مرحّلة وتُرسل مجدداً إلى الأداري في الدورة القادمة. قد ينتج عن ذلك فواتير مكررة إذا كانت ما تزال موجودة في الأداري.',
                          confirmLabel: 'إعادة التجهيز',
                          danger: true,
                        });
                        if (ok) resetReceipts.mutate();
                      }}
                    >
                      إعادة التجهيز
                    </Btn>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="max-w-5xl px-3 py-2.5 text-[11.5px] leading-5 text-slate-500">
              الجلب من الأداري فقط: المنتجات (File13n) والفروع (FileBrch) والحسابات (File11n) والبائعون من سجل أسماء البائعين (1–250، نفس أرقام FilePOS5.SaleMan).
              {form.catalogSyncEnabled && ' يتضمن الجلب استيراد العروض لأن مزامنة Catalog مفعّلة.'}
            </p>
          </div>
        )}

        {/* ── الإعدادات ── */}
        {tab === 'settings' && (
          <div className="min-h-0 flex-1 overflow-auto bg-slate-50/40 p-3">
            <div className="grid gap-3 xl:grid-cols-2">
              <SettingsCard
                title="الاتصال بقاعدة الأداري"
                description="مسار بيانات NexusDB والسنة المالية وطريقة الاتصال."
                icon={<IconDatabase size={16} />}
                actions={
                  <Btn size="sm" variant="secondary" icon={<IconZap size={13} />} loading={test.isPending} onClick={() => test.mutate()}>
                    اختبار الاتصال
                  </Btn>
                }
              >
                <div className="space-y-4">
                  <Switch
                    label="تفعيل الربط مع الأداري"
                    description="عند الإيقاف لا يُجلب شيء ولا تُرحَّل الفواتير."
                    checked={form.enabled}
                    onChange={v => set('enabled', v)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="مسار البيانات (Data Root)" hint="المجلد الذي يحوي سنوات الأداري.">
                      <Input dir="ltr" value={form.dataRoot} onChange={e => set('dataRoot', e.target.value)} />
                    </Field>
                    <Field label="السنة المالية (Alias)">
                      <div className="flex gap-2">
                        <div className="min-w-0 flex-1">
                          <Select value={form.databaseAlias} onChange={e => set('databaseAlias', e.target.value)}>
                            {Array.from(new Set([form.databaseAlias, ...(years.length ? years : settings?.availableYears ?? [])])).map(y => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </Select>
                        </div>
                        <Btn variant="secondary" icon={<IconFolder size={14} />} loading={refreshYears.isPending} onClick={() => refreshYears.mutate()} title="اكتشاف السنوات من مسار البيانات">
                          اكتشاف
                        </Btn>
                      </div>
                    </Field>
                    <Field label="الخادم (Server)">
                      <Input dir="ltr" value={form.server} onChange={e => set('server', e.target.value)} />
                    </Field>
                    <Field label="المنفذ (Port)">
                      <NumberDraftInput dir="ltr" min={1} max={65535} integer value={form.port} onValueChange={p => set('port', p)} />
                    </Field>
                    <Field label="وضع الاتصال">
                      <Select value={form.connectionMode} onChange={e => set('connectionMode', e.target.value)}>
                        <option value="Ado">ADO — موفر NexusDB الأصلي (موصى)</option>
                        <option value="Auto">تلقائي — ADO ثم ODBC</option>
                        <option value="Odbc">ODBC — Devart (يتطلب ترخيص)</option>
                      </Select>
                    </Field>
                    {form.connectionMode === 'Odbc' && (
                      <Field label="مشغّل ODBC">
                        <Input dir="ltr" value={form.odbcDriver} onChange={e => set('odbcDriver', e.target.value)} />
                      </Field>
                    )}
                  </div>
                  {form.connectionMode !== 'Odbc' && (
                    <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                      <Field label="مسار ADO Provider" hint="اختياري — اتركه فارغاً للافتراضي.">
                        <Input
                          dir="ltr"
                          value={form.adoProviderPath ?? ''}
                          onChange={e => set('adoProviderPath', e.target.value || undefined)}
                          placeholder="NexusDB.ADOProvider.dll"
                        />
                      </Field>
                      <Field label="مجلد ADO Connector" hint="اختياري.">
                        <Input
                          dir="ltr"
                          value={form.adoConnectorDirectory ?? ''}
                          onChange={e => set('adoConnectorDirectory', e.target.value || undefined)}
                          placeholder="AdoServerConnectorV4_64.dll"
                        />
                      </Field>
                    </div>
                  )}
                  {settings?.lastConnectionMessage && (
                    <Alert type={settings.lastConnectionOk ? 'success' : 'warning'} title={`آخر اختبار ${settings.lastConnectionTestAt ? `· ${timeAgo(settings.lastConnectionTestAt)}` : ''}`}>
                      <span dir="auto">{settings.lastConnectionMessage}</span>
                    </Alert>
                  )}
                </div>
              </SettingsCard>

              <SettingsCard
                title="المزامنة التلقائية"
                description="كم مرة تُجلب بيانات الأداري وتُرحَّل فواتير نقاط البيع."
                icon={<IconRefresh size={16} />}
              >
                <div className="space-y-4">
                  <Switch
                    label="تحديث تلقائي من الأداري"
                    description="جلب البائعين والمنتجات والفروع دورياً وترحيل الفواتير تلقائياً."
                    checked={form.autoSyncEnabled}
                    onChange={v => set('autoSyncEnabled', v)}
                  />
                  <Switch
                    label="مزامنة العروض (Catalog)"
                    description="استيراد عروض الأداري ضمن كل عملية جلب."
                    checked={form.catalogSyncEnabled}
                    onChange={v => set('catalogSyncEnabled', v)}
                  />
                  <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                    <Field label="جلب البيانات كل (دقيقة)" hint="من 1 إلى 60 دقيقة. الافتراضي 4.">
                      <NumberDraftInput
                        min={1}
                        max={60}
                        integer
                        value={Math.round((form.dataPullIntervalSeconds || 240) / 60)}
                        onValueChange={m => set('dataPullIntervalSeconds', m * 60)}
                      />
                    </Field>
                    <Field label="ترحيل الفواتير كل (ثانية)" hint="من 15 إلى 3600 ثانية.">
                      <NumberDraftInput
                        min={15}
                        max={3600}
                        integer
                        value={form.autoSyncIntervalSeconds}
                        onValueChange={s => set('autoSyncIntervalSeconds', s)}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <InfoTile label="آخر جلب" value={timeAgo(settings?.lastDataPullAt)} title={settings?.lastDataPullAt ? formatDate(settings.lastDataPullAt) : undefined} />
                    <InfoTile label="آخر تغيير رُصد في الأداري" value={timeAgo(settings?.lastChangeDetectedAt)} title={settings?.lastChangeDetectedAt ? formatDate(settings.lastChangeDetectedAt) : undefined} />
                  </div>
                </div>
              </SettingsCard>
            </div>
          </div>
        )}
      </WorkspaceCard>

      <StickySaveBar
        count={dirty ? 1 : 0}
        labels={['إعدادات الأداري']}
        onSave={() => save.mutate()}
        onDiscard={hydrate}
        saving={save.isPending}
      />
    </WorkspacePage>
  );
}
