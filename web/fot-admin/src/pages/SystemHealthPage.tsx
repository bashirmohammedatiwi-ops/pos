import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDate, formatNum } from '@/api/client';
import type { ClientErrorDto, PosTerminalMonitorDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Alert, Badge, Btn, useConfirm } from '@/components/ui';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { SegmentedFilter, SummaryStrip, WorkspaceBody, WorkspacePage } from '@/components/listWorkspace';
import { IconAlert, IconCopy, IconDownload, IconExternal, IconMonitor, IconRefresh, IconTrash } from '@/components/icons';
import { PulseDot, looksLikeHwId, shortHwId, terminalTitle, timeAgo } from '@/components/system/systemUi';
import { Clip, CompactSearch, PaneHeader, StatusLine } from '@/components/operations/opsUi';
import { copyText } from '@/lib/clipboard';

type ErrorFilter = 'all' | 'admin' | 'pos';
type Status = 'ok' | 'warn' | 'danger';

function pingTone(ms: number | null): Status {
  if (ms == null) return 'warn';
  if (ms < 100) return 'ok';
  if (ms < 400) return 'warn';
  return 'danger';
}

function minutesShort(mins: number) {
  return mins >= 60 ? `${formatNum(Math.floor(mins / 60))} س` : `${formatNum(mins)} د`;
}

/** معرّف جهاز قصير بسطر واحد — المعرّف الكامل في التلميح. */
function DeviceLabel({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>;
  if (looksLikeHwId(value)) {
    return <span className="font-mono text-[11.5px] text-slate-600" title={value} dir="ltr">{shortHwId(value)}</span>;
  }
  return <Clip text={value} dir="ltr" className="font-mono text-[11.5px] text-slate-600" />;
}

const terminalColumns: GridColumn<PosTerminalMonitorDto>[] = [
  {
    key: 'isOnline',
    header: 'الاتصال',
    width: 100,
    sortValue: t => (t.isOnline ? 'متصل' : 'غير متصل'),
    filterValue: t => (t.isOnline ? 'متصل' : 'غير متصل'),
    render: t => (
      <span className="inline-flex items-center gap-1.5">
        <PulseDot online={t.isOnline} size="sm" tone={(t.deadOffline ?? 0) > 0 ? 'danger' : undefined} />
        <span className={t.isOnline ? 'font-semibold text-emerald-700' : 'text-slate-500'}>{t.isOnline ? 'متصل' : 'غير متصل'}</span>
      </span>
    ),
  },
  {
    key: 'name',
    header: 'نقطة البيع',
    width: 190,
    sortValue: t => terminalTitle(t),
    filterValue: t => `${terminalTitle(t)} ${t.hwId ?? ''}`,
    render: t => (
      <span className="block truncate font-semibold text-header" title={t.hwId ? `${terminalTitle(t)} — ${t.hwId}` : terminalTitle(t)}>
        {terminalTitle(t)}
      </span>
    ),
  },
  { key: 'sectionName', header: 'القسم', width: 130, render: t => <Clip text={t.sectionName} /> },
  {
    key: 'lastConnection',
    header: 'آخر ظهور',
    width: 100,
    sortValue: t => t.lastConnection ?? '',
    filterValue: t => timeAgo(t.lastConnection),
    render: t => <span className="text-[12px]" title={t.lastConnection ? formatDate(t.lastConnection) : ''}>{timeAgo(t.lastConnection)}</span>,
  },
  { key: 'exeVersion', header: 'الإصدار', width: 90, render: t => (t.exeVersion ? <span className="num text-[12px]">v{t.exeVersion}</span> : <span className="text-slate-300">—</span>) },
  {
    key: 'pendingOffline',
    header: 'بانتظار الرفع',
    width: 100,
    mono: true,
    footer: 'sum',
    sortValue: t => t.pendingOffline ?? 0,
    render: t => ((t.pendingOffline ?? 0) > 0 ? <span className="text-sky-700">{formatNum(t.pendingOffline ?? 0)}</span> : <span className="text-slate-300">0</span>),
  },
  {
    key: 'deadOffline',
    header: 'متوقفة',
    width: 80,
    mono: true,
    footer: 'sum',
    sortValue: t => t.deadOffline ?? 0,
    render: t => ((t.deadOffline ?? 0) > 0 ? <span className="font-bold text-red-700">{formatNum(t.deadOffline ?? 0)}</span> : <span className="text-slate-300">0</span>),
  },
  {
    key: 'active',
    header: 'الجهاز',
    width: 80,
    align: 'center',
    sortValue: t => (t.active ? 'نشط' : 'موقوف'),
    filterValue: t => (t.active ? 'نشط' : 'موقوف'),
    render: t => (t.active ? <span className="text-slate-500">نشط</span> : <Badge>موقوف</Badge>),
  },
];

function errorColumns(onCopy: (e: ClientErrorDto) => void): GridColumn<ClientErrorDto>[] {
  return [
    {
      key: 'createdAt',
      header: 'الوقت',
      width: 100,
      sortValue: e => e.createdAt,
      filterValue: e => formatDate(e.createdAt),
      render: e => <span className="text-[12px]" title={formatDate(e.createdAt)}>{timeAgo(e.createdAt)}</span>,
    },
    {
      key: 'source',
      header: 'المصدر',
      width: 100,
      filterValue: e => (e.source === 'pos' ? 'نقطة بيع' : 'لوحة التحكم'),
      render: e => <Badge tone={e.source === 'pos' ? 'info' : 'brand'}>{e.source === 'pos' ? 'نقطة بيع' : 'لوحة التحكم'}</Badge>,
    },
    { key: 'terminal', header: 'الجهاز', width: 110, render: e => <DeviceLabel value={e.terminal} /> },
    { key: 'appVersion', header: 'الإصدار', width: 80, render: e => (e.appVersion ? <span className="num text-[12px] text-slate-500">v{e.appVersion}</span> : <span className="text-slate-300">—</span>) },
    { key: 'message', header: 'الرسالة', width: 380, render: e => <Clip text={e.message} className="font-semibold text-header" /> },
    { key: 'context', header: 'السياق', width: 240, render: e => <Clip text={e.context} className="text-[12px] text-slate-500" /> },
    {
      key: 'copy',
      header: 'نسخ',
      width: 64,
      align: 'center',
      sortable: false,
      exportable: false,
      render: e => (
        <button
          type="button"
          title="نسخ تفاصيل الخطأ"
          aria-label="نسخ تفاصيل الخطأ"
          onClick={ev => {
            ev.stopPropagation();
            onCopy(e);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <IconCopy size={13} />
        </button>
      ),
    },
  ];
}

export function SystemHealthPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('all');
  const [errorQuery, setErrorQuery] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  // زمن استجابة SQL: ‎/health يلمس قاعدة البيانات في الخادم ونقيس الذهاب والعودة.
  const sqlPing = useQuery({
    queryKey: ['system-health-ping'],
    queryFn: async () => {
      const start = performance.now();
      const ok = await api.health();
      return { ok: ok === true, ms: performance.now() - start };
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const edariQ = useQuery({
    queryKey: ['edari-status'],
    queryFn: api.edariStatus,
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const terminalsQ = useQuery({
    queryKey: ['terminal-monitor'],
    queryFn: api.terminalMonitor,
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const deadLettersQ = useQuery({
    queryKey: ['edari-dead-letters'],
    queryFn: api.edariDeadLetters,
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const clientErrorsQ = useQuery({
    queryKey: ['client-errors', errorFilter],
    queryFn: () => api.clientErrors(60, errorFilter === 'all' ? undefined : errorFilter),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const backupSettingsQ = useQuery({
    queryKey: ['system-backup-settings'],
    queryFn: api.backupSettings,
    staleTime: 60_000,
    retry: 0,
  });

  const retryAllDead = useMutation({
    mutationFn: api.retryAllEdariDeadLetters,
    onSuccess: res => {
      void qc.invalidateQueries({ queryKey: ['edari-dead-letters'] });
      void qc.invalidateQueries({ queryKey: ['edari-status'] });
      toast.success(res.message || `تمت إعادة ${formatNum(res.count)} فاتورة للطابور`);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذرت إعادة المحاولة'),
  });

  const purgeErrors = useMutation({
    mutationFn: (days: number) => api.purgeClientErrors(days),
    onSuccess: res => {
      void qc.invalidateQueries({ queryKey: ['client-errors'] });
      toast.success(`تم تنظيف ${formatNum(res.purged)} خطأ من السجل`);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر تنظيف السجل'),
  });

  const refreshing = sqlPing.isFetching || edariQ.isFetching || terminalsQ.isFetching || deadLettersQ.isFetching || clientErrorsQ.isFetching;

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['system-health-ping'] }),
      qc.invalidateQueries({ queryKey: ['edari-status'] }),
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] }),
      qc.invalidateQueries({ queryKey: ['edari-dead-letters'] }),
      qc.invalidateQueries({ queryKey: ['client-errors'] }),
      qc.invalidateQueries({ queryKey: ['system-backup-settings'] }),
    ]);
    toast.success('تم تحديث صحة النظام');
  }

  async function handlePurgeErrors() {
    const ok = await confirm({
      title: 'مسح سجل أخطاء الواجهات؟',
      message: 'سيتم حذف جميع الأخطاء المسجلة حتى الآن لبدء متابعة نظيفة.',
      confirmLabel: 'مسح السجل',
      danger: true,
    });
    if (ok) purgeErrors.mutate(0);
  }

  function exportDiagnosticBundle() {
    const payload = {
      exportedAt: new Date().toISOString(),
      sql: { ok: sqlOk, latencyMs: sqlMs != null ? Math.round(sqlMs) : null },
      edari: edari ?? null,
      backups: backupSettingsQ.data ?? null,
      terminals: sortedTerminals,
      deadLetters: deadLettersQ.data ?? [],
      clientErrors: errors,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fot-diagnostic-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('تم تنزيل تقرير التشخيص');
  }

  async function copyError(e: ClientErrorDto) {
    try {
      await copyText([e.message, e.context, e.stack].filter(Boolean).join('\n\n'));
      toast.success('تم نسخ تفاصيل الخطأ');
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  const sqlMs = sqlPing.data?.ms ?? null;
  const sqlOk = sqlPing.data?.ok === true;
  const sqlStatus: Status = sqlPing.isError || (sqlPing.data && !sqlOk) ? 'danger' : pingTone(sqlMs);
  const edari = edariQ.data;
  const edariOk = !!edari && edari.connectionOk !== false && !edari.circuitOpen;
  const edariStatus: Status = !edari ? 'warn' : edari.circuitOpen ? 'warn' : edari.connectionOk === false ? 'danger' : 'ok';
  const deadCount = deadLettersQ.data?.length ?? 0;
  const unsynced = edari?.unsyncedCount ?? 0;
  const oldestMin = edari?.oldestUnsyncedMinutes ?? 0;

  const allTerminals = useMemo(() => (terminalsQ.data ?? []).flatMap(g => g.terminals), [terminalsQ.data]);
  const activeTerminals = allTerminals.filter(t => t.active);
  const onlineTerminals = allTerminals.filter(t => t.isOnline);
  const offlineActive = activeTerminals.filter(t => !t.isOnline);
  const posDead = allTerminals.reduce((a, t) => a + (t.deadOffline ?? 0), 0);
  const posPending = allTerminals.reduce((a, t) => a + (t.pendingOffline ?? 0), 0);
  const sortedTerminals = useMemo(
    () => [...allTerminals].sort((a, b) => (b.deadOffline ?? 0) - (a.deadOffline ?? 0) || Number(a.isOnline) - Number(b.isOnline)),
    [allTerminals],
  );

  const errors = useMemo(() => clientErrorsQ.data ?? [], [clientErrorsQ.data]);
  const filteredErrors = useMemo(() => {
    const q = errorQuery.trim().toLowerCase();
    if (!q) return errors;
    return errors.filter(e => `${e.message} ${e.context ?? ''} ${e.terminal ?? ''} ${e.appVersion ?? ''}`.toLowerCase().includes(q));
  }, [errors, errorQuery]);

  // قائمة المشاكل الحالية لعرضها في الرأس
  const issues: { text: string; tone: Status; to?: string }[] = [];
  if (sqlStatus === 'danger') issues.push({ text: 'قاعدة البيانات لا تستجيب', tone: 'danger' });
  if (edariStatus === 'danger') issues.push({ text: 'الاتصال بالأداري مقطوع', tone: 'danger', to: '/edari' });
  if (edari?.circuitOpen) issues.push({ text: `الأداري متوقف مؤقتاً — يُستأنف خلال ${edari.circuitRetryInSeconds ?? 0} ث`, tone: 'warn', to: '/edari' });
  if (deadCount > 0) issues.push({ text: `${formatNum(deadCount)} فاتورة متوقفة عن الترحيل`, tone: 'danger', to: '/edari' });
  if (oldestMin >= 60) issues.push({ text: `فواتير معلّقة منذ ${formatNum(Math.floor(oldestMin / 60))} ساعة`, tone: 'warn', to: '/edari' });
  if (posDead > 0) issues.push({ text: `${formatNum(posDead)} فاتورة أوفلاين متوقفة على نقاط البيع`, tone: 'danger', to: '/terminals' });
  if (offlineActive.length > 0) issues.push({ text: `${formatNum(offlineActive.length)} نقطة بيع نشطة غير متصلة`, tone: 'warn', to: '/terminals' });

  const initialLoading = sqlPing.isLoading && edariQ.isLoading;
  const overall: Status = issues.some(i => i.tone === 'danger') ? 'danger' : issues.length ? 'warn' : 'ok';
  const overallTitle = {
    ok: 'كل الأنظمة تعمل بشكل طبيعي',
    warn: 'النظام يعمل مع بعض التنبيهات',
    danger: 'توجد مشاكل تحتاج تدخلاً',
  }[overall];

  const errCols = errorColumns(e => void copyError(e));
  const lastBackupAt = backupSettingsQ.data?.lastBackupAt ?? null;
  const backupAgeHrs = lastBackupAt ? (Date.now() - new Date(lastBackupAt).getTime()) / 3_600_000 : null;
  const backupTone: Status = backupAgeHrs == null ? 'warn' : backupAgeHrs >= 48 ? 'danger' : backupAgeHrs >= 24 ? 'warn' : 'ok';

  return (
    <WorkspacePage>
      {/* ── الحالة العامة + المؤشرات ── */}
      <section className="card shrink-0 overflow-hidden">
        <StatusLine
          tone={initialLoading ? 'off' : overall}
          dot={<PulseDot online={!initialLoading && overall === 'ok'} tone={initialLoading ? 'off' : overall} />}
          title={initialLoading ? 'جاري فحص النظام…' : overallTitle}
          detail="تحديث تلقائي كل دقيقة · الخادم، الأداري، نقاط البيع، النسخ الاحتياطي، أخطاء الواجهات"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              {deadCount > 0 && (
                <Btn
                  variant="secondary"
                  size="sm"
                  icon={<IconRefresh size={13} />}
                  loading={retryAllDead.isPending}
                  onClick={() => retryAllDead.mutate()}
                >
                  إعادة محاولة الفواتير المتوقفة ({formatNum(deadCount)})
                </Btn>
              )}
              <Btn
                variant="ghost"
                size="sm"
                icon={<IconDownload size={13} />}
                onClick={exportDiagnosticBundle}
                title="تنزيل حزمة تشخيص JSON للدعم الفني"
              >
                حزمة التشخيص
              </Btn>
              <Btn variant="secondary" size="sm" icon={<IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} />} onClick={() => void refreshAll()}>
                فحص الآن
              </Btn>
            </div>
          }
        />
        {!initialLoading && issues.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5">
            {issues.map(i => (
              <li key={i.text}>
                {i.to ? (
                  <Link to={i.to} className="inline-flex">
                    <Badge tone={i.tone === 'danger' ? 'danger' : 'warn'} dot className="hover:brightness-95">{i.text} ←</Badge>
                  </Link>
                ) : (
                  <Badge tone={i.tone === 'danger' ? 'danger' : 'warn'} dot>{i.text}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        <SummaryStrip
          loading={initialLoading}
          cells={[
            {
              label: 'قاعدة البيانات',
              value: sqlPing.isError ? 'لا تستجيب' : sqlOk ? 'متصلة' : sqlPing.data ? 'غير متصلة' : '—',
              hint: sqlMs != null ? `زمن الاستجابة ${formatNum(Math.round(sqlMs))} م.ث` : 'لم يُقَس',
              tone: sqlStatus,
            },
            {
              label: `الأداري${edari?.databaseAlias ? ` · ${edari.databaseAlias}` : ''}`,
              value: edari?.circuitOpen ? 'متوقف مؤقتاً' : edariOk ? 'متصل' : edari ? 'منقطع' : '—',
              hint: edari?.circuitOpen
                ? `إعادة المحاولة خلال ${edari.circuitRetryInSeconds ?? 0} ث`
                : edari?.lastHeartbeatAt ? `آخر نبضة ${timeAgo(edari.lastHeartbeatAt)}` : undefined,
              tone: edariStatus,
              onClick: () => navigate('/edari'),
            },
            {
              label: 'طابور الترحيل',
              value: `${formatNum(unsynced)} بانتظار`,
              hint: oldestMin ? `أقدمها منذ ${minutesShort(oldestMin)}` : 'لا تراكم',
              tone: unsynced && oldestMin >= 60 ? 'warn' : 'ok',
              onClick: () => navigate('/edari'),
            },
            {
              label: 'متوقفة نهائياً',
              value: formatNum(deadCount),
              hint: deadCount ? 'تحتاج إجراءً من صفحة الأداري' : 'لا شيء',
              tone: deadCount ? 'danger' : 'ok',
              onClick: () => navigate('/edari'),
            },
            {
              label: 'آخر جلب من الأداري',
              value: <span title={edari?.lastDataPullAt ? formatDate(edari.lastDataPullAt) : undefined}>{timeAgo(edari?.lastDataPullAt)}</span>,
              hint: edari?.liveMessage ?? undefined,
            },
            {
              label: 'نقاط البيع المتصلة',
              value: `${formatNum(onlineTerminals.length)} / ${formatNum(allTerminals.length)}`,
              hint: posPending ? `${formatNum(posPending)} فاتورة أوفلاين بانتظار الرفع` : offlineActive.length ? `${formatNum(offlineActive.length)} نشطة غير متصلة` : 'كل الأجهزة النشطة متصلة',
              tone: posDead ? 'danger' : offlineActive.length ? 'warn' : 'ok',
              onClick: () => navigate('/terminals'),
            },
            {
              label: 'النسخ الاحتياطي',
              value: lastBackupAt ? timeAgo(lastBackupAt) : 'لا توجد نسخة',
              hint: backupSettingsQ.data
                ? `${formatNum(backupSettingsQ.data.storedBackupsCount)} نسخة · ${backupSettingsQ.data.autoBackupEnabled ? `تلقائي كل ${formatNum(backupSettingsQ.data.intervalHours)} س` : 'يدوي'}`
                : 'إدارة النسخ الاحتياطي',
              tone: backupTone,
              onClick: () => navigate('/backups'),
            },
          ]}
        />
      </section>

      {/* ── الجدولان ── */}
      <div className="grid min-h-[820px] flex-1 grid-rows-[minmax(320px,2fr)_minmax(420px,3fr)] gap-2 xl:min-h-[360px] xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-rows-1">
        {/* ── نقاط البيع ── */}
        <section className="card flex min-h-0 min-w-0 flex-col overflow-hidden">
          <PaneHeader
            icon={<IconMonitor size={15} />}
            title="نقاط البيع"
            meta={`${formatNum(onlineTerminals.length)} متصل من ${formatNum(allTerminals.length)}`}
          >
            <Link to="/terminals">
              <Btn size="xs" variant="ghost" icon={<IconExternal size={12} />}>إدارة الأجهزة</Btn>
            </Link>
          </PaneHeader>
          {terminalsQ.isError && <div className="shrink-0 p-2"><Alert>تعذر تحميل حالة نقاط البيع.</Alert></div>}
          <WorkspaceBody>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              columns={terminalColumns}
              rows={sortedTerminals}
              loading={terminalsQ.isLoading}
              getRowId={t => t.id}
              storageKey="system-terminals"
              exportName="حالة-نقاط-البيع"
              counterLabel="جهاز"
              emptyText="لا نقاط بيع مسجلة"
              rowTone={t => ((t.deadOffline ?? 0) > 0 ? 'bg-red-50/50' : t.active && !t.isOnline ? 'bg-amber-50/40' : undefined)}
            />
          </WorkspaceBody>
        </section>

        {/* ── أخطاء الواجهات ── */}
        <section className="card flex min-h-0 min-w-0 flex-col overflow-hidden">
          <PaneHeader icon={<IconAlert size={15} />} title="أخطاء الواجهات" meta="لوحة التحكم ونقاط البيع — تُرسل فور حدوثها">
            <SegmentedFilter
              label="مصدر الخطأ"
              value={errorFilter}
              onChange={setErrorFilter}
              items={[
                { id: 'all', label: 'الكل' },
                { id: 'admin', label: 'لوحة التحكم' },
                { id: 'pos', label: 'نقاط البيع' },
              ]}
            />
            <div className="w-52 max-w-full">
              <CompactSearch value={errorQuery} onChange={setErrorQuery} placeholder="الرسالة، الجهاز، الإصدار…" />
            </div>
            {errors.length > 0 && (
              <Btn
                size="xs"
                variant="ghost"
                icon={<IconTrash size={12} />}
                loading={purgeErrors.isPending}
                onClick={() => void handlePurgeErrors()}
                title="مسح سجل الأخطاء"
              >
                مسح السجل
              </Btn>
            )}
          </PaneHeader>
          {clientErrorsQ.isError && (
            <div className="shrink-0 p-2">
              <Alert title="تعذر تحميل الأخطاء">
                <Btn size="xs" variant="secondary" onClick={() => clientErrorsQ.refetch()}>إعادة المحاولة</Btn>
              </Alert>
            </div>
          )}
          <WorkspaceBody>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              columns={errCols}
              rows={filteredErrors}
              loading={clientErrorsQ.isLoading}
              getRowId={e => e.id}
              storageKey="system-client-errors"
              exportName="أخطاء-الواجهات"
              counterLabel="خطأ"
              initialSort={{ key: 'createdAt', dir: 'desc' }}
              emptyText={errors.length ? 'لا أخطاء مطابقة للبحث' : 'لا أخطاء مسجلة — كل الواجهات تعمل بسلاسة'}
              badge={<span className="hidden text-[11px] text-slate-400 md:inline">انقر الصف لعرض التفاصيل</span>}
              expansion={{
                isExpanded: e => expanded === e.id,
                onToggle: e => setExpanded(x => (x === e.id ? null : e.id)),
                render: e => (
                  <div className="space-y-2 whitespace-normal">
                    <p dir="auto" className="break-words text-[13px] font-semibold text-header">{e.message}</p>
                    {e.context && <pre dir="ltr" className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2.5 text-[11.5px] text-slate-700 ring-1 ring-slate-200">{e.context}</pre>}
                    {e.stack && <pre dir="ltr" className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2.5 text-[11px] leading-5 text-slate-200">{e.stack}</pre>}
                    {!e.context && !e.stack && <p className="text-[12px] text-slate-500">لا تفاصيل إضافية.</p>}
                    <Btn size="xs" variant="secondary" icon={<IconCopy size={12} />} onClick={() => void copyError(e)}>نسخ التفاصيل</Btn>
                  </div>
                ),
              }}
            />
          </WorkspaceBody>
        </section>
      </div>
    </WorkspacePage>
  );
}
