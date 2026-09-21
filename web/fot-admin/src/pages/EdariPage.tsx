import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, formatCurrency, formatDate, formatNum } from '@/api/client';

import type { EdariDeadLetterDto, EdariSyncLogDto, ReceiptSummary, UpdateEdariSettingsRequest } from '@/api/types';

import { useToast } from '@/components/Toast';

import { Alert, Btn, Checkbox, Field, FieldRow, Input, Loading, Select } from '@/components/ui';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { CompactStatsBar, DashCard, FormSection, ListPageFooter, ListPageShell, UnsavedBar } from '@/components/workspace';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';

/* أعمدة جداول Edari — DataGrid موحد */
const unsyncedColumns: GridColumn<ReceiptSummary>[] = [
  {
    key: 'number',
    header: 'رقم',
    width: 120,
    render: r => (
      <Link to={`/receipts?highlight=${r.id}`} className="font-semibold text-brand-600 hover:underline">
        {r.displayNumber ?? r.number}
      </Link>
    ),
  },
  { key: 'cashierName', header: 'الكاشير', width: 150 },
  { key: 'netAmount', header: 'المبلغ', width: 140, mono: true, footer: 'sum', sortValue: r => r.netAmount ?? r.totalAmount, render: r => <span className="font-bold">{formatCurrency(r.netAmount ?? r.totalAmount)}</span> },
];

function deadColumns(retry: (id: number) => void, pending: boolean): GridColumn<EdariDeadLetterDto>[] {
  return [
    {
      key: 'number',
      header: 'رقم',
      width: 110,
      render: d => (
        <Link to={`/receipts?highlight=${d.id}`} className="font-semibold text-brand-600 hover:underline">
          {d.number}
        </Link>
      ),
    },
    { key: 'totalAmount', header: 'المبلغ', width: 130, mono: true, render: d => formatCurrency(d.totalAmount) },
    { key: 'syncAttempts', header: 'المحاولات', width: 100, mono: true },
    { key: 'reason', header: 'السبب', width: 300, render: d => <span className="line-clamp-2 text-xs text-red-700" title={d.reason ?? ''}>{d.reason ?? '—'}</span> },
    {
      key: 'actions',
      header: 'إجراء',
      width: 130,
      align: 'center',
      sortable: false,
      exportable: false,
      render: d => (
        <Btn size="sm" variant="secondary" onClick={() => retry(d.id)} disabled={pending}>
          إعادة المحاولة
        </Btn>
      ),
    },
  ];
}

const logsColumns: GridColumn<EdariSyncLogDto>[] = [
  { key: 'operation', header: 'العملية', width: 160, render: l => <span className="text-xs">{l.operation ?? '—'}</span> },
  { key: 'status', header: 'الحالة', width: 110, align: 'center', render: l => <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold">{l.status}</span> },
  { key: 'attemptedAt', header: 'الوقت', width: 160, sortValue: l => l.attemptedAt, render: l => <span className="text-xs">{formatDate(l.attemptedAt)}</span> },
  { key: 'errorMessage', header: 'تفاصيل', width: 300, render: l => <span className="block max-w-[300px] truncate text-xs text-muted" title={l.errorMessage ?? l.details ?? ''}>{l.errorMessage ?? l.details ?? '—'}</span> },
];

export function EdariPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<UpdateEdariSettingsRequest | null>(null);
  const [years, setYears] = useState<string[]>([]);

  const settingsQ = useQuery({ queryKey: ['edari-settings'], queryFn: api.edariSettings, refetchInterval: 15_000 });
  const statusQ = useQuery({ queryKey: ['edari-status'], queryFn: api.edariStatus, refetchInterval: 15_000 });
  const logsQ = useQuery({ queryKey: ['edari-logs'], queryFn: api.edariLogs, refetchInterval: 20_000 });
  const unsyncedQ = useQuery({ queryKey: ['edari-unsynced'], queryFn: api.edariUnsynced, refetchInterval: 20_000 });
  const deadQ = useQuery({ queryKey: ['edari-dead-letters'], queryFn: api.edariDeadLetters, refetchInterval: 30_000 });

  const retryDead = useMutation({
    mutationFn: (id: number) => api.retryEdariDeadLetter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edari-dead-letters'] });
      qc.invalidateQueries({ queryKey: ['edari-status'] });
      toast.success('أُعيدت الفاتورة إلى طابور الترحيل');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
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

  useEffect(() => {
    if (settingsQ.data) {
      setYears(settingsQ.data.availableYears ?? []);
      setForm({
        dataRoot: settingsQ.data.dataRoot,
        databaseAlias: settingsQ.data.databaseAlias,
        server: settingsQ.data.server,
        port: settingsQ.data.port,
        connectionMode: settingsQ.data.connectionMode ?? 'Ado',
        odbcDriver: settingsQ.data.odbcDriver,
        adoProviderPath: settingsQ.data.adoProviderPath,
        adoConnectorDirectory: settingsQ.data.adoConnectorDirectory,
        enabled: settingsQ.data.enabled,
        autoSyncEnabled: settingsQ.data.autoSyncEnabled,
        autoSyncIntervalSeconds: settingsQ.data.autoSyncIntervalSeconds,
        catalogSyncEnabled: settingsQ.data.catalogSyncEnabled,
        dataPullIntervalSeconds: settingsQ.data.dataPullIntervalSeconds || 240,
      });
    }
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: () => api.saveEdariSettings(form!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edari-settings'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('تم حفظ الإعدادات');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const test = useMutation({
    mutationFn: api.testEdariConnection,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
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
    JSON.stringify({
      dataRoot: form.dataRoot,
      databaseAlias: form.databaseAlias,
      server: form.server,
      port: form.port,
      connectionMode: form.connectionMode ?? 'Ado',
      odbcDriver: form.odbcDriver,
      adoProviderPath: form.adoProviderPath ?? null,
      adoConnectorDirectory: form.adoConnectorDirectory ?? null,
      enabled: form.enabled,
      autoSyncEnabled: form.autoSyncEnabled,
      autoSyncIntervalSeconds: form.autoSyncIntervalSeconds,
      catalogSyncEnabled: form.catalogSyncEnabled,
      dataPullIntervalSeconds: form.dataPullIntervalSeconds || 240,
    }) !==
      JSON.stringify({
        dataRoot: settings.dataRoot,
        databaseAlias: settings.databaseAlias,
        server: settings.server,
        port: settings.port,
        connectionMode: settings.connectionMode ?? 'Ado',
        odbcDriver: settings.odbcDriver,
        adoProviderPath: settings.adoProviderPath ?? null,
        adoConnectorDirectory: settings.adoConnectorDirectory ?? null,
        enabled: settings.enabled,
        autoSyncEnabled: settings.autoSyncEnabled,
        autoSyncIntervalSeconds: settings.autoSyncIntervalSeconds,
        catalogSyncEnabled: settings.catalogSyncEnabled,
        dataPullIntervalSeconds: settings.dataPullIntervalSeconds || 240,
      })
  );
  useUnsavedWarning(dirty);
  useSaveShortcut(() => { if (dirty && form) save.mutate(); }, dirty);

  if (settingsQ.isLoading || !form) return <Loading />;

  const set = <K extends keyof UpdateEdariSettingsRequest>(k: K, v: UpdateEdariSettingsRequest[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const live = statusQ.data;
  const liveOn = !!(form.enabled && form.autoSyncEnabled);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListPageShell
        banner={
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-1.5 text-[10.5px]">
            <div className="min-w-0">
              <span className="font-bold text-header">{liveOn ? 'ارتباط حي' : 'متوقف'}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="text-slate-600">
                {live?.liveMessage ?? (liveOn ? 'تغييرات الإداري تصل تلقائياً' : 'فعّل التحديث التلقائي')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-slate-600">
              <span className={`rounded px-1.5 py-0.5 ${live?.liveWatching ? 'bg-teal-50 text-teal-800' : 'bg-slate-100'}`}>
                {live?.liveWatching ? 'مراقبة' : '15ث'}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5">فحص: {settings?.lastHeartbeatAt ? formatDate(settings.lastHeartbeatAt) : '—'}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5">جلب: {settings?.lastDataPullAt ? formatDate(settings.lastDataPullAt) : '—'}</span>
            </div>
          </div>
        }
        footer={
          <ListPageFooter
            stats={
              <CompactStatsBar
                items={[
                  { label: 'بانتظار', value: formatNum(statusQ.data?.unsyncedCount ?? 0), tone: (statusQ.data?.unsyncedCount ?? 0) ? 'brand' : 'ok' },
                  { label: 'رُحّل', value: formatNum(statusQ.data?.syncedCount ?? 0), tone: 'ok' },
                  { label: 'متوقفة', value: formatNum(statusQ.data?.deadLetterCount ?? deadQ.data?.length ?? 0), tone: (statusQ.data?.deadLetterCount ?? 0) > 0 ? 'warn' : 'ok' },
                  { label: 'اتصال', value: statusQ.data?.circuitOpen ? `بعد ${statusQ.data?.circuitRetryInSeconds ?? 0}ث` : statusQ.data?.connectionOk || settings?.lastConnectionOk ? 'متصل' : 'تحقق', tone: statusQ.data?.circuitOpen ? 'warn' : 'default' },
                ]}
              />
            }
          />
        }
      >
      <div className="overflow-auto p-2">
      {statusQ.data?.circuitOpen && (
        <div className="mb-2 text-[11px]">
          <Alert type="warning">
            الخادم أوقف محاولات الاتصال مؤقتاً — تُستأنف خلال {statusQ.data.circuitRetryInSeconds} ثانية.
          </Alert>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
      <div className="space-y-4">
      <FormSection step={1} title="جلب البيانات من Edari" hint="مزامنة البائعين والمنتجات والفروع تلقائياً">
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-4">
            <Checkbox
              label="تحديث تلقائي من Edari"
              checked={form.autoSyncEnabled}
              onChange={v => set('autoSyncEnabled', v)}
            />
            <Checkbox label="مزامنة Catalog" checked={form.catalogSyncEnabled} onChange={v => set('catalogSyncEnabled', v)} />
          </div>

          <FieldRow>
            <Field label="جلب البيانات كل (دقيقة)">
              <Input
                type="number"
                min={1}
                max={60}
                value={Math.round((form.dataPullIntervalSeconds || 240) / 60)}
                onChange={e => set('dataPullIntervalSeconds', Math.min(3600, Math.max(60, (Number(e.target.value) || 4) * 60)))}
              />
            </Field>
            <Field label="ترحيل الفواتير كل (ثانية)">
              <Input
                type="number"
                min={15}
                max={3600}
                value={form.autoSyncIntervalSeconds}
                onChange={e => set('autoSyncIntervalSeconds', Math.min(3600, Math.max(15, Number(e.target.value) || 120)))}
              />
            </Field>
            <Field label="آخر جلب">
              <div className="flex h-10 items-center rounded-lg border border-border bg-slate-50 px-3 text-sm text-muted">
                {settings?.lastDataPullAt ? formatDate(settings.lastDataPullAt) : '—'}
              </div>
            </Field>
          </FieldRow>

          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => syncPull.mutate()} disabled={syncPull.isPending || !form.enabled}>
              {syncPull.isPending ? 'جاري الجلب…' : '↻ تحديث الآن من Edari'}
            </Btn>
            <Btn variant="secondary" onClick={() => syncArticles.mutate()} disabled={syncArticles.isPending || !form.enabled}>
              {syncArticles.isPending ? 'جاري المزامنة…' : 'مزامنة المنتجات'}
            </Btn>
            <Btn variant="secondary" onClick={() => syncBranches.mutate()} disabled={syncBranches.isPending || !form.enabled}>
              {syncBranches.isPending ? 'جاري المزامنة…' : 'مزامنة الفروع والأقسام'}
            </Btn>
            <Btn variant="secondary" onClick={() => syncAccounts.mutate()} disabled={syncAccounts.isPending || !form.enabled}>
              {syncAccounts.isPending ? 'جاري المزامنة…' : 'مزامنة الحسابات والصناديق'}
            </Btn>
            <Btn variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
              حفظ إعدادات التحديث
            </Btn>
            <Btn variant="secondary" onClick={() => syncFull.mutate()} disabled={syncFull.isPending || !form.enabled}>
              {syncFull.isPending ? 'مزامنة كاملة…' : 'مزامنة كاملة'}
            </Btn>
            <Btn variant="secondary" onClick={() => syncArabic.mutate()} disabled={syncArabic.isPending || !form.enabled}>
              {syncArabic.isPending ? 'تصحيح الأسماء…' : 'تصحيح الأسماء العربية'}
            </Btn>
            <Btn
              variant="secondary"
              disabled={resetReceipts.isPending}
              onClick={() => {
                if (confirm('تجهيز الفواتير المرحّلة لإعادة الترحيل إلى Edari؟')) resetReceipts.mutate();
              }}
            >
              {resetReceipts.isPending ? 'جاري التجهيز…' : 'إعادة تجهيز الفواتير للترحيل'}
            </Btn>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            الجلب من الإداري فقط: المنتجات (File13n) والفروع (FileBrch) والحسابات (File11n) والبائعون من سجل أسماء البائعين في الإداري (1–250، نفس أرقام FilePOS5.SaleMan).
            {form.catalogSyncEnabled && ' يتضمن استيراد عروض Edari عند تفعيل Catalog.'}
            {' '}فترة الثواني لترحيل فواتير نقطة البيع إلى الإداري.
          </p>
        </div>
      </FormSection>

      <FormSection step={2} title="إعدادات Edari" hint="اتصال NexusDB ومسار البيانات">
        <div className="space-y-3 p-3">
          <FieldRow>
            <Field label="Data Root">
              <Input value={form.dataRoot} onChange={e => set('dataRoot', e.target.value)} />
            </Field>
            <Field label="السنة / Alias">
              <div className="flex gap-2">
                <Select value={form.databaseAlias} onChange={e => set('databaseAlias', e.target.value)}>
                  {Array.from(new Set([form.databaseAlias, ...(years.length ? years : settings?.availableYears ?? [])])).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
                <Btn
                  variant="secondary"
                  disabled={refreshYears.isPending}
                  onClick={() => refreshYears.mutate()}
                >
                  {refreshYears.isPending ? '…' : 'تحديث السنوات'}
                </Btn>
              </div>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Server">
              <Input value={form.server} onChange={e => set('server', e.target.value)} />
            </Field>
            <Field label="Port">
              <Input type="number" value={form.port} onChange={e => set('port', Number(e.target.value))} />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="وضع الاتصال">
              <Select value={form.connectionMode} onChange={e => set('connectionMode', e.target.value)}>
                <option value="Ado">ADO — موفر NexusDB الأصلي (موصى)</option>
                <option value="Auto">تلقائي — ADO ثم ODBC</option>
                <option value="Odbc">ODBC — Devart (يتطلب ترخيص)</option>
              </Select>
            </Field>
            {form.connectionMode === 'Odbc' && (
              <Field label="ODBC Driver">
                <Input value={form.odbcDriver} onChange={e => set('odbcDriver', e.target.value)} />
              </Field>
            )}
          </FieldRow>

          {form.connectionMode !== 'Odbc' && (
            <FieldRow>
              <Field label="مسار ADO Provider (اختياري)">
                <Input
                  value={form.adoProviderPath ?? ''}
                  onChange={e => set('adoProviderPath', e.target.value || undefined)}
                  placeholder="NexusDB.ADOProvider.dll"
                />
              </Field>
              <Field label="مجلد ADO Connector (اختياري)">
                <Input
                  value={form.adoConnectorDirectory ?? ''}
                  onChange={e => set('adoConnectorDirectory', e.target.value || undefined)}
                  placeholder="AdoServerConnectorV4_64.dll"
                />
              </Field>
            </FieldRow>
          )}

          <div className="flex flex-wrap gap-4">
            <Checkbox label="مفعّل" checked={form.enabled} onChange={v => set('enabled', v)} />
          </div>

          {settings?.lastConnectionMessage && (
            <Alert type={settings.lastConnectionOk ? 'success' : 'info'}>
              آخر اختبار: {settings.lastConnectionMessage}
            </Alert>
          )}

          {settings?.lastCatalogSyncAt && (
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-muted">
              آخر مزامنة Catalog: {formatDate(settings.lastCatalogSyncAt)}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Btn>
            <Btn variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>اختبار اتصال</Btn>
            <Btn variant="secondary" onClick={() => syncReceipts.mutate()} disabled={syncReceipts.isPending}>
              {syncReceipts.isPending ? 'جاري الترحيل…' : `ترحيل الفواتير (${statusQ.data?.unsyncedCount ?? 0})`}
            </Btn>
            <Btn variant="secondary" onClick={() => syncCatalog.mutate()} disabled={syncCatalog.isPending}>
              مزامنة Catalog
            </Btn>
          </div>
        </div>
      </FormSection>
      </div>

      <div className="space-y-4">
      <DashCard
        title={`فواتير بانتظار الترحيل (${statusQ.data?.unsyncedCount ?? unsyncedQ.data?.length ?? 0})`}
        action={
          <Btn size="sm" onClick={() => syncReceipts.mutate()} disabled={syncReceipts.isPending}>
            {syncReceipts.isPending ? 'جاري الترحيل…' : 'ترحيل'}
          </Btn>
        }
      >
        <DataGrid
          columns={unsyncedColumns}
          rows={(unsyncedQ.data ?? []).slice(0, 12)}
          getRowId={r => r.id}
          maxHeight="320px"
          exportName="فواتير-بانتظار-الترحيل"
          counterLabel="فاتورة"
          emptyText="لا فواتير معلّقة"
        />
      </DashCard>

      <DashCard
        title={`متوقفة نهائياً — تحتاج تدخلاً (${deadQ.data?.length ?? 0})`}
        action={
          (deadQ.data?.length ?? 0) > 0 ? (
            <Btn
              size="sm"
              variant="secondary"
              onClick={() => retryAllDead.mutate()}
              disabled={retryAllDead.isPending}
            >
              {retryAllDead.isPending ? 'جاري…' : 'إعادة الكل للطابور'}
            </Btn>
          ) : undefined
        }
      >
        <p className="border-b border-slate-100 bg-amber-50/60 px-4 py-2 text-[11.5px] leading-5 text-amber-800">
          فواتير توقف ترحيلها التلقائي بعد فشل متكرر أو خطأ بنيوي (صنف مفقود في الإداري، قسم غير مربوط بفرع…) —
          عالج السبب ثم أعد الفاتورة للطابور.
        </p>
        <DataGrid
          columns={deadColumns((id: number) => retryDead.mutate(id), retryDead.isPending)}
          rows={deadQ.data ?? []}
          getRowId={d => d.id}
          maxHeight="360px"
          exportName="فواتير-متوقفة"
          counterLabel="فاتورة"
          emptyText="لا فواتير متوقفة"
        />
      </DashCard>

      <DashCard title="سجل العمليات">
        <DataGrid
          columns={logsColumns}
          rows={logsQ.data ?? []}
          getRowId={l => l.id}
          maxHeight="320px"
          exportName="سجل-العمليات"
          counterLabel="عملية"
          emptyText="لا عمليات مسجلة"
        />
      </DashCard>
      </div>
      </div>

      </div>
      </ListPageShell>

      {dirty && (
        <UnsavedBar
          text="تغييرات غير محفوظة في إعدادات Edari"
          onSave={() => save.mutate()}
          pending={save.isPending}
        />
      )}
    </div>
  );
}
