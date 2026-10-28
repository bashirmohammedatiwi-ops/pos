import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatNum } from '@/api/client';
import type { BackupFileItemDto, BackupManifestDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Badge, Btn, Checkbox, EmptyState, Input, Modal, Skeleton, Switch, useConfirm } from '@/components/ui';
import {
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconDatabase,
  IconDownload,
  IconEye,
  IconFolder,
  IconInfo,
  IconRefresh,
  IconShield,
  IconTrash,
  IconUpload,
} from '@/components/icons';
import { timeAgo } from '@/components/dashboard/dashboardUtils';

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type InspectTarget =
  | { kind: 'stored'; fileName: string; manifest: BackupManifestDto }
  | { kind: 'upload'; file: File; manifest: BackupManifestDto };

export function BackupCenterPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [label, setLabel] = useState('');
  const [includeCatalog, setIncludeCatalog] = useState(false);
  const [autoDownload, setAutoDownload] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [saveUploadedToVault, setSaveUploadedToVault] = useState(true);
  const [showTables, setShowTables] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const backupsQ = useQuery({
    queryKey: ['system-backups'],
    queryFn: api.backups,
    staleTime: 30_000,
    retry: 0,
  });

  const settingsQ = useQuery({
    queryKey: ['system-backup-settings'],
    queryFn: api.backupSettings,
    staleTime: 60_000,
    retry: 0,
  });

  const backups = backupsQ.data ?? [];
  const settings = settingsQ.data;
  const latest = backups[0] ?? null;

  async function invalidateAllAfterRestore() {
    await qc.invalidateQueries();
  }

  const createMut = useMutation({
    mutationFn: () =>
      api.createBackup({
        label: label.trim() || undefined,
        includeCatalog,
      }),
    onSuccess: async created => {
      setLabel('');
      await qc.invalidateQueries({ queryKey: ['system-backups'] });
      await qc.invalidateQueries({ queryKey: ['system-backup-settings'] });
      toast.success(`تم إنشاء النسخة الاحتياطية (${formatBytes(created.sizeBytes)})`);
      if (autoDownload) {
        try {
          await api.downloadBackup(created.fileName);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'تعذر تنزيل الملف تلقائياً');
        }
      }
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر إنشاء النسخة الاحتياطية'),
  });

  const inspectStoredMut = useMutation({
    mutationFn: async (fileName: string) => {
      const manifest = await api.inspectBackup(fileName);
      return { fileName, manifest };
    },
    onSuccess: ({ fileName, manifest }) => {
      setSelectedSections(new Set(manifest.sections.map(s => s.id)));
      setSafetyBackup(true);
      setShowTables(false);
      setInspectTarget({ kind: 'stored', fileName, manifest });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر قراءة تفاصيل النسخة الاحتياطية'),
  });

  const inspectUploadMut = useMutation({
    mutationFn: async (file: File) => {
      const manifest = await api.inspectUploadedBackup(file);
      return { file, manifest };
    },
    onSuccess: ({ file, manifest }) => {
      setSelectedSections(new Set(manifest.sections.map(s => s.id)));
      setSafetyBackup(true);
      setSaveUploadedToVault(true);
      setShowTables(false);
      setInspectTarget({ kind: 'upload', file, manifest });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'ملف النسخة الاحتياطية غير صالح'),
  });

  const restoreMut = useMutation({
    mutationFn: async () => {
      if (!inspectTarget) throw new Error('لا توجد نسخة محددة');
      const secs = [...selectedSections];
      if (secs.length === 0) throw new Error('اختر قسماً واحداً على الأقل للاستعادة');
      if (inspectTarget.kind === 'stored') {
        return api.restoreBackup(inspectTarget.fileName, {
          sections: secs,
          createSafetyBackup: safetyBackup,
        });
      }
      return api.uploadAndRestoreBackup(inspectTarget.file, {
        sections: secs,
        safety: safetyBackup,
        saveToVault: saveUploadedToVault,
      });
    },
    onSuccess: async res => {
      if (res.ok) {
        toast.success(res.message);
        setInspectTarget(null);
        await invalidateAllAfterRestore();
      } else {
        toast.error(res.message);
      }
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشلت عملية الاستعادة'),
  });

  const deleteMut = useMutation({
    mutationFn: (fileName: string) => api.deleteBackup(fileName),
    onSuccess: async () => {
      toast.success('تم حذف النسخة الاحتياطية');
      await qc.invalidateQueries({ queryKey: ['system-backups'] });
      await qc.invalidateQueries({ queryKey: ['system-backup-settings'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  const saveSettingsMut = useMutation({
    mutationFn: api.saveBackupSettings,
    onSuccess: async () => {
      toast.success('تم حفظ إعدادات النسخ الاحتياطي التلقائي');
      await qc.invalidateQueries({ queryKey: ['system-backup-settings'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر حفظ الإعدادات'),
  });

  async function handleDownload(fileName: string) {
    setDownloadingFile(fileName);
    try {
      await api.downloadBackup(fileName);
      toast.success('تم بدء تحميل ملف النسخة الاحتياطية');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل الملف');
    } finally {
      setDownloadingFile(null);
    }
  }

  async function handleDelete(item: BackupFileItemDto) {
    const ok = await confirm({
      title: 'حذف النسخة الاحتياطية؟',
      message: `سيتم حذف الملف «${item.fileName}» (${item.label}) نهائياً من الخادم.`,
      confirmLabel: 'حذف الملف',
      danger: true,
    });
    if (ok) deleteMut.mutate(item.fileName);
  }

  function handleFileChosen(file?: File | null) {
    if (!file) return;
    inspectUploadMut.mutate(file);
  }

  function toggleSection(id: string) {
    setSelectedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const shownBackups = compact ? backups.slice(0, 5) : backups;

  return (
    <div className="space-y-4" dir="rtl">
      {/* شريط الحالة السريع */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card flex items-center gap-3 p-3.5">
          <span className="icon-tile h-10 w-10 rounded-xl bg-emerald-50 text-emerald-700">
            <IconDatabase size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-400">آخر نسخة احتياطية</p>
            <p className="truncate text-[14px] font-bold text-header">
              {latest ? timeAgo(latest.createdAt) : 'لم تُنشأ بعد'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {latest ? `${latest.label} · ${formatBytes(latest.sizeBytes)}` : 'أنشئ أول نسخة احتياطية الآن'}
            </p>
          </div>
        </div>

        <div className="card flex items-center gap-3 p-3.5">
          <span className="icon-tile h-10 w-10 rounded-xl bg-sky-50 text-sky-700">
            <IconClock size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-400">النسخ التلقائي المجدول</p>
            <p className="truncate text-[14px] font-bold text-header">
              {settings?.autoBackupEnabled ? `مفعّل · كل ${formatNum(settings.intervalHours)} ساعة` : 'متوقف'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {settings ? `يحتفظ بآخر ${formatNum(settings.retainCount)} نسخة` : 'جاري القراءة…'}
            </p>
          </div>
        </div>

        <div className="card flex items-center gap-3 p-3.5">
          <span className="icon-tile h-10 w-10 rounded-xl bg-violet-50 text-violet-700">
            <IconFolder size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-400">خزنة الخادم</p>
            <p className="truncate text-[14px] font-bold text-header num">
              {formatNum(backups.length)} نسخة محفوظة
            </p>
            <p className="truncate text-[11px] text-slate-500 num">
              الحجم الكلي {formatBytes(settings?.totalStorageBytes ?? backups.reduce((n, b) => n + b.sizeBytes, 0))}
            </p>
          </div>
        </div>

        <div className="card flex items-center gap-3 p-3.5">
          <span className="icon-tile h-10 w-10 rounded-xl bg-amber-50 text-amber-700">
            <IconShield size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-400">حماية الاستعادة</p>
            <p className="truncate text-[14px] font-bold text-header">نسخة أمان تلقائية</p>
            <p className="truncate text-[11px] text-slate-500">تُؤخذ قبل أي استعادة لمنع فقدان البيانات</p>
          </div>
        </div>
      </div>

      {/* بطاقتا الإنشاء والرفع للاستعادة */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. إنشاء وتنزيل نسخة احتياطية */}
        <section className="card flex flex-col justify-between p-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="icon-tile h-10 w-10 rounded-xl bg-brand-600 text-white shadow-[var(--shadow-glow-brand)]">
                  <IconDownload size={19} />
                </span>
                <div>
                  <h3 className="text-[14.5px] font-bold text-header">إنشاء نسخة احتياطية جديدة</h3>
                  <p className="text-[11.5px] text-slate-500">
                    تحفظ كل العروض والعمولات والأهداف والكاشيرات والبائعين والإعدادات والفواتير في ملف واحد قابل للرفع
                  </p>
                </div>
              </div>
              <Badge tone="brand">.fotbackup</Badge>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">
                  تسمية أو ملاحظة على النسخة (اختياري)
                </label>
                <Input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="مثال: قبل تعديل العروض والأسعار…"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <Checkbox
                  label="تنزيل الملف فوراً إلى جهازي بعد الإنشاء"
                  checked={autoDownload}
                  onChange={setAutoDownload}
                />
                <Checkbox
                  label="تضمين كاش كتالوج المواد من الإداري (أكبر حجماً)"
                  checked={includeCatalog}
                  onChange={setIncludeCatalog}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <span className="text-[11px] text-slate-400">
              تُحفظ نسخة دائماً في خزنة الخادم بالإضافة إلى التنزيل لجهازك
            </span>
            <Btn
              size="md"
              variant="primary"
              icon={<IconDownload size={15} />}
              loading={createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {autoDownload ? 'إنشاء وتنزيل النسخة الآن' : 'إنشاء وحفظ في الخادم'}
            </Btn>
          </div>
        </section>

        {/* 2. رفع ملف نسخة احتياطية من الجهاز وفحصه واستعادته */}
        <section className="card flex flex-col justify-between p-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="icon-tile h-10 w-10 rounded-xl bg-slate-900 text-white">
                <IconUpload size={19} />
              </span>
              <div>
                <h3 className="text-[14.5px] font-bold text-header">رفع واستعادة ملف نسخة احتياطية</h3>
                <p className="text-[11.5px] text-slate-500">
                  اختر ملف <span className="font-mono font-semibold">.fotbackup</span> من جهازك لمعاينة محتوياته واختيار ما تريد استعادته بأمان
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".fotbackup,.zip"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = '';
                handleFileChosen(f);
              }}
            />

            <div
              onDragOver={e => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                handleFileChosen(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                dragOver
                  ? 'border-brand-500 bg-brand-50/60'
                  : 'border-slate-200 bg-slate-50/50 hover:border-brand-300 hover:bg-slate-50'
              }`}
            >
              <span className="icon-tile h-11 w-11 rounded-2xl bg-white text-brand-700 shadow-sm ring-1 ring-slate-200">
                <IconUpload size={20} />
              </span>
              <p className="mt-2 text-[13px] font-bold text-header">
                {inspectUploadMut.isPending ? 'جاري فحص وقراءة ملف النسخة الاحتياطية…' : 'اضغط لاختيار ملف النسخة الاحتياطية أو اسحبه إلى هنا'}
              </p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">
                سيتم عرض معاينة كاملة لمحتويات الملف (العروض، العمولات، الفواتير، الإعدادات) قبل تطبيق أي استعادة
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <span className="text-[11px] text-slate-400">
              يدعم الاستعادة الكاملة أو استعادة قسم محدد فقط (مثل العروض فقط أو العمولات فقط)
            </span>
            <Btn
              size="md"
              variant="secondary"
              icon={<IconUpload size={15} />}
              loading={inspectUploadMut.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              اختيار ملف من الجهاز…
            </Btn>
          </div>
        </section>
      </div>

      {/* إعدادات الجدولة التلقائية (تظهر كاملة في صفحة النسخ الاحتياطي) */}
      {!compact && settings && (
        <BackupScheduleSettingsCard
          settings={settings}
          saving={saveSettingsMut.isPending}
          onSave={req => saveSettingsMut.mutate(req)}
        />
      )}

      {/* جدول النسخ المحفوظة في خزنة الخادم */}
      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-[14px] font-bold text-header">
              النسخ الاحتياطية المحفوظة على الخادم ({formatNum(backups.length)})
            </h3>
            {settings?.backupFolder && (
              <p className="text-[11px] text-slate-400">
                مسار الحفظ على الخادم: <span className="font-mono" dir="ltr">{settings.backupFolder}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {compact && (
              <Link
                to="/backups"
                className="rounded-lg bg-brand-50 px-2.5 py-1 text-[11.5px] font-bold text-brand-700 transition hover:bg-brand-100"
              >
                فتح صفحة النسخ الاحتياطي الكاملة ←
              </Link>
            )}
            <Btn
              size="xs"
              variant="ghost"
              icon={<IconRefresh size={13} className={backupsQ.isFetching ? 'animate-spin' : ''} />}
              onClick={() => {
                void backupsQ.refetch();
                void settingsQ.refetch();
              }}
            >
              تحديث
            </Btn>
          </div>
        </header>

        {backupsQ.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : backups.length === 0 ? (
          <EmptyState
            compact
            icon={<IconDatabase size={20} />}
            title="لا توجد نسخ احتياطية محفوظة بعد"
            description="اضغط «إنشاء وتنزيل النسخة الآن» لإنشاء أول نسخة احتياطية شاملة للنظام."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] text-slate-500">
                  <th className="px-3 py-2 text-right font-semibold">الوصف / الملف</th>
                  <th className="px-3 py-2 text-right font-semibold">النوع</th>
                  <th className="px-3 py-2 text-right font-semibold">المحتويات</th>
                  <th className="px-3 py-2 text-right font-semibold">الحجم</th>
                  <th className="px-3 py-2 text-right font-semibold">التاريخ</th>
                  <th className="px-3 py-2 text-left font-semibold">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownBackups.map(b => {
                  const s = b.summary;
                  return (
                    <tr key={b.fileName} className="transition hover:bg-slate-50/80">
                      <td className="px-3 py-2.5">
                        <p className="font-bold text-header">{b.label}</p>
                        <p className="font-mono text-[11px] text-slate-400" dir="ltr">{b.fileName}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tone={b.isAuto ? 'info' : 'brand'}>{b.isAuto ? 'تلقائية' : 'يدوية'}</Badge>
                          {b.includeCatalog && <Badge tone="ok">+ الكتالوج</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11.5px] text-slate-600">
                        {s ? (
                          <span className="num">
                            عروض <b>{formatNum(s.offersCount)}</b> · عمولات <b>{formatNum(s.commissionGroupsCount)}</b> · أهداف{' '}
                            <b>{formatNum(s.targetsCount)}</b> · فواتير <b>{formatNum(s.receiptsCount)}</b>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-700 num">{formatBytes(b.sizeBytes)}</td>
                      <td className="px-3 py-2.5 text-[11.5px] text-slate-500">
                        <div>{timeAgo(b.createdAt)}</div>
                        <div className="text-[10.5px] text-slate-400 num">{formatDate(b.createdAt)}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn
                            size="xs"
                            variant="secondary"
                            icon={<IconDownload size={13} />}
                            loading={downloadingFile === b.fileName}
                            onClick={() => void handleDownload(b.fileName)}
                          >
                            تنزيل
                          </Btn>
                          <Btn
                            size="xs"
                            variant="soft"
                            icon={<IconEye size={13} />}
                            loading={inspectStoredMut.isPending && inspectStoredMut.variables === b.fileName}
                            onClick={() => inspectStoredMut.mutate(b.fileName)}
                          >
                            معاينة واستعادة
                          </Btn>
                          <Btn
                            size="xs"
                            variant="ghost"
                            className="!text-red-600 hover:!bg-red-50"
                            icon={<IconTrash size={13} />}
                            onClick={() => void handleDelete(b)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* نافذة معاينة النسخة الاحتياطية وتحديد أقسام الاستعادة */}
      <Modal
        open={inspectTarget != null}
        title={
          inspectTarget?.kind === 'upload'
            ? `معاينة واستعادة ملف مرفوع: ${inspectTarget.file.name}`
            : `معاينة واستعادة النسخة: ${inspectTarget?.manifest.label ?? ''}`
        }
        subtitle={
          inspectTarget
            ? `تاريخ الإنشاء: ${formatDate(inspectTarget.manifest.createdAt)} · الإصدار v${inspectTarget.manifest.appVersion}`
            : undefined
        }
        icon={<IconDatabase size={18} />}
        size="xl"
        onClose={() => !restoreMut.isPending && setInspectTarget(null)}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] text-slate-500">
              {safetyBackup
                ? '✓ سيتم إنشاء نسخة أمان تلقائية لبياناتك الحالية قبل بدء الاستعادة'
                : 'تنبيه: سيتم استبدال البيانات في الأقسام المحددة مباشرةً'}
            </span>
            <div className="flex items-center gap-2">
              <Btn variant="secondary" disabled={restoreMut.isPending} onClick={() => setInspectTarget(null)}>
                إلغاء
              </Btn>
              <Btn
                variant="primary"
                icon={<IconCheckCircle size={15} />}
                loading={restoreMut.isPending}
                disabled={selectedSections.size === 0}
                onClick={() => restoreMut.mutate()}
              >
                تأكيد استعادة الأقسام المحددة ({formatNum(selectedSections.size)})
              </Btn>
            </div>
          </div>
        }
      >
        {inspectTarget && (
          <div className="space-y-4" dir="rtl">
            {/* إحصائيات محتوى النسخة */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="العروض" value={inspectTarget.manifest.summary.offersCount} />
              <MiniStat label="مجموعات العمولة" value={inspectTarget.manifest.summary.commissionGroupsCount} />
              <MiniStat label="الأهداف" value={inspectTarget.manifest.summary.targetsCount} />
              <MiniStat label="الفواتير" value={inspectTarget.manifest.summary.receiptsCount} />
              <MiniStat label="الكاشيرات" value={inspectTarget.manifest.summary.cashiersCount} />
              <MiniStat label="البائعون" value={inspectTarget.manifest.summary.salesmenCount} />
              <MiniStat label="الأقسام" value={inspectTarget.manifest.summary.sectionsCount} />
              <MiniStat label="إجمالي السجلات" value={inspectTarget.manifest.summary.totalRows} />
            </div>

            {/* اختيار الأقسام المراد استعادتها */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-[13px] font-bold text-header">اختر الأقسام التي تريد استعادتها من هذه النسخة</h4>
                  <p className="text-[11px] text-slate-500">
                    يمكنك استعادة النظام بالكامل أو اختيار قسم بعينه (مثلاً استعادة العروض فقط دون المساس بالفواتير)
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setSelectedSections(new Set(inspectTarget.manifest.sections.map(s => s.id)))}
                    className="text-brand-700 hover:underline"
                  >
                    تحديد الكل
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedSections(new Set())}
                    className="text-slate-500 hover:underline"
                  >
                    إلغاء الكل
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {inspectTarget.manifest.sections.map(sec => {
                  const checked = selectedSections.has(sec.id);
                  return (
                    <label
                      key={sec.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition ${
                        checked ? 'border-brand-400 bg-white shadow-sm' : 'border-slate-200 bg-white/50 opacity-75'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSection(sec.id)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <div>
                          <p className="text-[12.5px] font-bold text-header">{sec.label}</p>
                          <p className="text-[11px] text-slate-500 num">
                            {formatNum(sec.tableCount)} جدول · {formatNum(sec.rowCount)} سجل
                          </p>
                        </div>
                      </div>
                      {checked && <Badge tone="brand">سيُستعاد</Badge>}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* خيارات الأمان */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-2.5">
              <Checkbox
                label="إنشاء نسخة أمان احتياطية للبيانات الحالية قبل الاستعادة (موصى به جداً)"
                checked={safetyBackup}
                onChange={setSafetyBackup}
              />
              {inspectTarget.kind === 'upload' && (
                <Checkbox
                  label="حفظ نسخة من هذا الملف المرفوع في خزنة الخادم أيضاً"
                  checked={saveUploadedToVault}
                  onChange={setSaveUploadedToVault}
                />
              )}
            </div>

            {/* عرض تفاصيل الجداول */}
            <div>
              <button
                type="button"
                onClick={() => setShowTables(v => !v)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:underline"
              >
                <IconInfo size={14} />
                {showTables
                  ? 'إخفاء تفاصيل الجداول'
                  : `عرض تفاصيل جميع الجداول في النسخة (${formatNum(inspectTarget.manifest.tables.length)} جدول)`}
              </button>
              {showTables && (
                <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500">
                        <th className="px-3 py-1.5 text-right font-semibold">اسم الجدول</th>
                        <th className="px-3 py-1.5 text-right font-semibold">القسم</th>
                        <th className="px-3 py-1.5 text-left font-semibold">عدد السجلات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inspectTarget.manifest.tables.map(t => (
                        <tr key={t.name}>
                          <td className="px-3 py-1 font-mono text-slate-700" dir="ltr">{t.name}</td>
                          <td className="px-3 py-1 text-slate-500">{t.section}</td>
                          <td className="px-3 py-1 text-left font-bold text-header num">{formatNum(t.rowCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[16px] font-bold text-header num">{formatNum(value)}</p>
    </div>
  );
}

function BackupScheduleSettingsCard({
  settings,
  saving,
  onSave,
}: {
  settings: {
    autoBackupEnabled: boolean;
    intervalHours: number;
    retainCount: number;
    includeCatalogInAuto: boolean;
  };
  saving: boolean;
  onSave: (req: {
    autoBackupEnabled: boolean;
    intervalHours: number;
    retainCount: number;
    includeCatalogInAuto: boolean;
  }) => void;
}) {
  const [enabled, setEnabled] = useState(settings.autoBackupEnabled);
  const [hours, setHours] = useState(String(settings.intervalHours));
  const [retain, setRetain] = useState(String(settings.retainCount));
  const [includeCat, setIncludeCat] = useState(settings.includeCatalogInAuto);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-bold text-header">إعدادات النسخ الاحتياطي التلقائي</h3>
          <p className="text-[11.5px] text-slate-500">
            يعمل الخادم في الخلفية وينشئ نسخاً احتياطية دورية تلقائياً ويحذف الأقدم حسب العدد المحدد
          </p>
        </div>
        <Switch label="تفعيل النسخ التلقائي" checked={enabled} onChange={setEnabled} />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3">
        <label className="w-36">
          <span className="mb-1 block text-[11.5px] font-semibold text-slate-600">كل (ساعات)</span>
          <Input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={e => setHours(e.target.value)}
            className="num text-center font-bold"
          />
        </label>
        <label className="w-40">
          <span className="mb-1 block text-[11.5px] font-semibold text-slate-600">الاحتفاظ بآخر (نسخة)</span>
          <Input
            type="number"
            min={2}
            max={100}
            value={retain}
            onChange={e => setRetain(e.target.value)}
            className="num text-center font-bold"
          />
        </label>
        <div className="pb-1.5">
          <Checkbox
            label="تضمين كتالوج الإداري في النسخ التلقائية"
            checked={includeCat}
            onChange={setIncludeCat}
          />
        </div>
        <div className="flex-1" />
        <Btn
          size="sm"
          variant="outline"
          icon={<IconCheck size={14} />}
          loading={saving}
          onClick={() =>
            onSave({
              autoBackupEnabled: enabled,
              intervalHours: Math.max(1, Number(hours) || 12),
              retainCount: Math.max(2, Number(retain) || 14),
              includeCatalogInAuto: includeCat,
            })
          }
        >
          حفظ إعدادات الجدولة
        </Btn>
      </div>
    </section>
  );
}
