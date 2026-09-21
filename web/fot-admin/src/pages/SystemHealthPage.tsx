import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, formatDate, formatNum } from '@/api/client';
import { useToast } from '@/components/Toast';
import { Btn, Loading } from '@/components/ui';
import { CompactStatsBar, DashCard, FilterStrip, ListPageFooter, ListPageShell } from '@/components/workspace';
import {
  IconActivity,
  IconAlert,
  IconCheckCircle,
  IconClock,
  IconCloud,
  IconDatabase,
  IconMonitor,
  IconRefresh,
  IconShield,
  IconWifi,
} from '@/components/icons';

type ErrorFilter = 'all' | 'admin' | 'pos';

function pingLabel(ms: number | null) {
  if (ms == null) return { text: '—', tone: 'text-slate-400' };
  if (ms < 100) return { text: `${Math.round(ms)} م.ث`, tone: 'text-emerald-600' };
  if (ms < 400) return { text: `${Math.round(ms)} م.ث`, tone: 'text-amber-600' };
  return { text: `${Math.round(ms)} م.ث`, tone: 'text-red-600' };
}

function ageMinutes(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

export function SystemHealthPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('all');

  // Measured SQL ping: /health touches the DB server-side; we time the round-trip.
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

  async function refreshAll() {
    await qc.invalidateQueries({ queryKey: ['system-health-ping'] });
    await qc.invalidateQueries({ queryKey: ['edari-status'] });
    await qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
    await qc.invalidateQueries({ queryKey: ['edari-dead-letters'] });
    await qc.invalidateQueries({ queryKey: ['client-errors'] });
    toast.success('تم تحديث صحة النظام');
  }

  const sql = pingLabel(sqlPing.data?.ms ?? null);
  const edariAge = ageMinutes(edariQ.data?.lastHeartbeatAt);
  const edariOk = edariQ.data?.connectionOk !== false && !edariQ.data?.circuitOpen;
  const circuit = edariQ.data?.circuitOpen
    ? `القاطع مفتوح — إعادة محاولة خلال ${edariQ.data?.circuitRetryInSeconds ?? 0}ث`
    : 'يعمل';

  const allTerminals = (terminalsQ.data ?? []).flatMap(g => g.terminals);
  const onlineTerminals = allTerminals.filter(t => t.isOnline || t.active);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListPageShell
        filter={
          <FilterStrip>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10.5px] text-slate-500">
                تشخيص الخادم · الإداري · نقاط البيع · أخطاء الواجهات
              </p>
              <Btn variant="secondary" size="sm" onClick={() => void refreshAll()}>
                تحديث
              </Btn>
            </div>
          </FilterStrip>
        }
        footer={
          <ListPageFooter
            stats={
              <CompactStatsBar
                items={[
                  { label: 'SQL', value: sql.text, tone: sqlPing.data?.ok ? 'ok' : 'warn' },
                  { label: 'Edari', value: edariOk ? 'متصل' : 'منقطع', tone: edariOk ? 'ok' : 'warn' },
                  ...(edariAge != null ? [{ label: 'نبضة', value: `${formatNum(edariAge)}د` }] : []),
                  { label: 'POS', value: `${formatNum(onlineTerminals.length)}/${formatNum(allTerminals.length)}`, tone: onlineTerminals.length === allTerminals.length && allTerminals.length > 0 ? 'ok' : 'warn' },
                  { label: 'أخطاء 24س', value: formatNum(clientErrorsQ.data?.length ?? 0), tone: (clientErrorsQ.data?.length ?? 0) > 0 ? 'warn' : 'ok' },
                ]}
              />
            }
          />
        }
      >
      <div className="space-y-2 overflow-auto p-2">
      <div className="grid gap-2 xl:grid-cols-2">
        {/* Server + Edari health */}
        <DashCard title="الخادم والإداري" icon={<IconShield size={14} />}>
          <div className="space-y-3 p-4 text-[13px]">
            <HealthRow
              icon={<IconDatabase size={15} />}
              label="قاعدة البيانات FOT_POS_V2"
              value={sqlPing.isLoading ? 'جاري الفحص…' : sqlPing.data?.ok ? 'متصل' : 'غير متصل'}
              ok={sqlPing.data?.ok === true}
              detail={sqlPing.data ? `زمن الاستجابة ${sql.text}` : undefined}
            />
            <HealthRow
              icon={<IconCloud size={15} />}
              label={`الإداري — نسخة ${edariQ.data?.databaseAlias ?? '—'}`}
              value={edariOk ? 'متصل' : 'منقطع'}
              ok={edariOk}
              detail={circuit}
            />
            <HealthRow
              icon={<IconRefresh size={15} />}
              label="طابور الترحيل"
              value={`${formatNum(edariQ.data?.unsyncedCount ?? 0)} بانتظار`}
              ok={(edariQ.data?.unsyncedCount ?? 0) === 0}
              detail={
                edariQ.data?.oldestUnsyncedMinutes
                  ? `أقدم فاتورة ${formatNum(Math.floor(edariQ.data.oldestUnsyncedMinutes / 60))} ساعة`
                  : 'لا تراكم'
              }
            />
            <HealthRow
              icon={<IconAlert size={15} />}
              label="فواتير متوقفة نهائياً (dead-letter)"
              value={`${formatNum(deadLettersQ.data?.length ?? 0)}`}
              ok={(deadLettersQ.data?.length ?? 0) === 0}
              detail="تحتاج إجراءً يدوياً — راجع صفحة الإداري"
            />
            <HealthRow
              icon={<IconClock size={15} />}
              label="آخر سحب للكتالوج من الإداري"
              value={edariQ.data?.lastDataPullAt ? formatDate(edariQ.data.lastDataPullAt) : '—'}
              ok={true}
            />
          </div>
        </DashCard>

        {/* Terminals */}
        <DashCard title="نقاط البيع" icon={<IconMonitor size={14} />}>
          <div className="max-h-[340px] overflow-y-auto">
            {terminalsQ.isLoading && <Loading />}
            {!terminalsQ.isLoading && allTerminals.length === 0 && (
              <p className="p-6 text-center text-[13px] text-muted">لا نقاط بيع مسجلة</p>
            )}
            {allTerminals.map(t => {
              const online = t.isOnline || t.active;
              const stuck = (t.deadOffline ?? 0) > 0;
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-[13px] last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-header">{t.name ?? t.hwId ?? t.id}</p>
                      {t.lastConnection && (
                        <p className="text-[11px] text-slate-400">آخر ظهور {formatDate(t.lastConnection)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(t.pendingOffline ?? 0) > 0 && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-200/60">
                        {formatNum(t.pendingOffline!)} بانتظار الرفع
                      </span>
                    )}
                    {stuck && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 ring-1 ring-red-200/60">
                        {formatNum(t.deadOffline!)} متوقفة
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ${
                        online
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60'
                          : 'bg-slate-100 text-slate-500 ring-slate-200/60'
                      }`}
                    >
                      {online ? 'متصل' : 'منقطع'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </DashCard>
      </div>

      {/* Client errors */}
      <DashCard
        title="أخطاء الواجهات (لوحة التحكم ونقاط البيع)"
        icon={<IconAlert size={14} />}
        action={
          <div className="flex gap-1.5">
            {(['all', 'admin', 'pos'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setErrorFilter(f)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                  errorFilter === f ? 'bg-header text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f === 'all' ? 'الكل' : f === 'admin' ? 'لوحة التحكم' : 'نقاط البيع'}
              </button>
            ))}
          </div>
        }
      >
        <div className="max-h-[420px] overflow-y-auto">
          {clientErrorsQ.isLoading && <Loading />}
          {!clientErrorsQ.isLoading && (clientErrorsQ.data?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <span className="icon-tile h-11 w-11 bg-emerald-50 text-emerald-600">
                <IconCheckCircle size={20} />
              </span>
              <p className="text-[13px] text-slate-500">لا أخطاء مسجلة — كل الواجهات تعمل بسلاسة</p>
            </div>
          )}
          {(clientErrorsQ.data ?? []).map(e => (
            <div key={e.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    e.source === 'pos' ? 'bg-sky-50 text-sky-700' : 'bg-brand-50 text-brand-700'
                  }`}
                >
                  {e.source === 'pos' ? 'نقطة بيع' : 'لوحة التحكم'}
                </span>
                {e.terminal && <span className="font-mono text-[10px] text-slate-400">{e.terminal}</span>}
                <span className="text-[11px] text-slate-400">{formatDate(e.createdAt)}</span>
              </div>
              <p dir="auto" className="mt-1 break-words text-[13px] font-semibold text-header">
                {e.message}
              </p>
              {e.context && (
                <p dir="auto" className="mt-0.5 truncate text-[11px] text-slate-400" title={e.context}>
                  {e.context}
                </p>
              )}
            </div>
          ))}
        </div>
      </DashCard>

      {/* Live activity note */}
      <div className="flex items-center gap-2 rounded-xl bg-slate-100/70 px-4 py-2.5 text-[11.5px] text-slate-500">
        <IconActivity size={14} className="shrink-0 text-slate-400" />
        تُحدَّث هذه الصفحة كل دقيقة تلقائياً — الأخطاء تُرسل من الواجهات فور حدوثها وتظهر خلال دقيقة
      </div>
      </div>
      </ListPageShell>
    </div>
  );
}

function HealthRow({
  icon,
  label,
  value,
  ok,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`icon-tile h-8 w-8 ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-header">{label}</p>
          {detail && <p className="truncate text-[11px] text-slate-400">{detail}</p>}
        </div>
      </div>
      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
          ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60' : 'bg-red-50 text-red-700 ring-red-200/60'
        }`}
      >
        <IconWifi size={11} />
        {value}
      </span>
    </div>
  );
}
