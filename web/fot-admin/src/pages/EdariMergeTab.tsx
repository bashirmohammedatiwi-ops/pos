import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, formatDate, formatNum } from '@/api/client';
import type { PendingStockCashierDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Alert, Badge, Btn, Select, Switch, useConfirm } from '@/components/ui';
import { IconAlert, IconPackage, IconRefresh } from '@/components/icons';
import { InfoTile, SettingsCard, shortHwId, looksLikeHwId, timeAgo } from '@/components/system/systemUi';

/**
 * «بانتظار الدمج»: العدد المعروض في كل مكان = عدد الإداري − ما بيع ولم يُدمج بعد.
 * السيرفر يعرف وحده أي فاتورة دمجها الإداري (فاتورتها في الإداري صارت مغلقة)، والزر يفحص فوراً.
 */

const MAX_HOURS = [24, 48, 72, 120, 168];

function posName(c: PendingStockCashierDto) {
  const n = c.posName?.trim();
  if (!n) return `كاشير ${c.posId}`;
  return looksLikeHwId(n) ? `كاشير ${c.posId} · ${shortHwId(n)}` : n;
}

export function usePendingStockStatus() {
  return useQuery({ queryKey: ['pending-stock'], queryFn: api.pendingStockStatus, refetchInterval: 15_000 });
}

export function EdariMergeTab({ edariEnabled }: { edariEnabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = usePendingStockStatus();
  const s = q.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pending-stock'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  const check = useMutation({
    mutationFn: api.checkPendingStock,
    onSuccess: r => {
      refresh();
      toast[r.ok ? 'success' : 'error'](r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الفحص'),
  });

  const settle = useMutation({
    mutationFn: (posId: number) => api.settlePendingStock(posId),
    onSuccess: r => {
      refresh();
      toast.success(r.settled ? `اعتُبرت ${formatNum(r.settled)} فاتورة مدموجة` : 'لا فواتير مرحّلة لهذا الكاشير');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const saveSettings = useMutation({
    mutationFn: (v: { enabled: boolean; maxHours: number }) => api.savePendingStockSettings(v.enabled, v.maxHours),
    onSuccess: r => {
      qc.setQueryData(['pending-stock'], r);
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(r.enabled ? 'خصم المبيعات غير المدموجة مفعّل' : 'أُوقف الخصم — العدد يُعرض كما في الإداري');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  if (q.isError && !s) {
    return (
      <div className="p-3">
        <Alert title="تعذر تحميل حالة الدمج">{q.error instanceof Error ? q.error.message : 'خطأ'}</Alert>
      </div>
    );
  }

  const cashiers = s?.cashiers ?? [];
  const totalReceipts = cashiers.reduce((n, c) => n + c.receipts, 0);
  const totalHeld = cashiers.reduce((n, c) => n + c.heldReceipts, 0);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50/40 p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SettingsCard
          title="مبيعات بانتظار الدمج في الإداري"
          description="الإداري لا يُنقص العدد إلا بعد «دمج الإيصالات». حتى ذلك الحين تُطرح هذه المبيعات من العدد في الكاشير والموقع وجهاز الأسعار. عند الدمج يعرف السيرفر ذلك وحده خلال أقل من دقيقة."
          icon={<IconPackage size={16} />}
          actions={
            <Btn
              size="sm"
              icon={<IconRefresh size={14} />}
              loading={check.isPending}
              disabled={!edariEnabled}
              onClick={() => check.mutate()}
            >
              دمجت الإيصالات — تحقق الآن
            </Btn>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <InfoTile label="فواتير لم تُدمج" value={formatNum(totalReceipts)} tone={totalReceipts ? 'warn' : 'ok'} />
              <InfoTile label="مواد مطروح منها" value={formatNum(s?.products ?? 0)} />
              <InfoTile label="قطع مطروحة" value={formatNum(s?.pieces ?? 0, 2)} />
              <InfoTile
                label="آخر فحص من الإداري"
                value={timeAgo(s?.lastCheckAt)}
                title={s?.lastCheckAt ? formatDate(s.lastCheckAt) : undefined}
              />
            </div>
            {s?.lastMessage && <p className="text-[12px] text-slate-600" dir="auto">{s.lastMessage}</p>}
            {s && !s.enabled && (
              <Alert type="warning" title="الخصم موقوف">العدد يُعرض الآن كما في الإداري تماماً، دون طرح المبيعات غير المدموجة.</Alert>
            )}
            {(s?.expiredLastWeek ?? 0) > 0 && (
              <Alert type="warning" title={`${formatNum(s!.expiredLastWeek)} فاتورة لم تُدمج خلال ${s!.maxHours} ساعة`}>
                توقف طرحها من العدد هذا الأسبوع. تأكد أنها موجودة ومدموجة في الإداري.
              </Alert>
            )}

            <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full border-separate border-spacing-0 text-[12.5px]">
                <thead>
                  <tr className="text-[11.5px] text-slate-600">
                    <th className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">الكاشير</th>
                    <th className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">فواتير لم تُدمج</th>
                    <th className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">قطع</th>
                    <th className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">أقدمها</th>
                    <th className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-start font-bold">مؤجلة على الجهاز</th>
                    <th className="border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-center font-bold">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {cashiers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        {q.isLoading ? 'جارٍ التحميل…' : 'كل المبيعات مدموجة في الإداري — العدد مطابق'}
                      </td>
                    </tr>
                  )}
                  {cashiers.map((c, i) => (
                    <tr key={c.posId} className={i % 2 ? 'bg-slate-50/50' : 'bg-white'}>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5 font-bold text-header">{posName(c)}</td>
                      <td className="border-b border-slate-100 px-3 py-1.5">
                        <span className="num font-semibold">{formatNum(c.receipts)}</span>
                        {c.notInEdari > 0 && (
                          <Badge tone="warn" className="ms-1.5">{formatNum(c.notInEdari)} لم تُرحّل بعد</Badge>
                        )}
                      </td>
                      <td className="num border-b border-slate-100 px-3 py-1.5">{formatNum(c.pieces, 2)}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-slate-500" title={c.oldest ? formatDate(c.oldest) : undefined}>
                        {c.oldest ? timeAgo(c.oldest) : '—'}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-1.5 text-slate-600">
                        {c.heldReceipts > 0 ? (
                          <span title={c.holdsReportedAt ? `آخر تحديث من الجهاز ${formatDate(c.holdsReportedAt)}` : undefined}>
                            {formatNum(c.heldReceipts)} فاتورة · {formatNum(c.heldPieces, 2)} قطعة
                          </span>
                        ) : '—'}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-1.5 text-center">
                        <Btn
                          size="xs"
                          variant="secondary"
                          disabled={c.inEdari === 0}
                          loading={settle.isPending && settle.variables === c.posId}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `اعتبار فواتير ${posName(c)} مدموجة؟`,
                              message: `سيتوقف طرح ${formatNum(c.inEdari)} فاتورة مرحّلة للإداري من العدد. استخدمه فقط إذا كان الفحص التلقائي لا يرى الدمج (مثلاً فاتورة حُذفت يدوياً من الإداري). إن لم تكن مدموجة فعلاً سيظهر العدد أعلى من الحقيقي حتى الدمج.`,
                              confirmLabel: 'اعتبرها مدموجة',
                              danger: true,
                            });
                            if (ok) settle.mutate(c.posId);
                          }}
                        >
                          اعتبرها مدموجة
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalHeld > 0 && (
              <p className="text-[11.5px] text-slate-500">
                «مؤجلة على الجهاز»: فواتير التحويل اليدوي التي لم يُضغط لها «تحويل» بعد. تُطرح من العدد من لحظة البيع.
              </p>
            )}
          </div>
        </SettingsCard>

        <SettingsCard
          title="إعدادات المخزون الحيّ"
          description="زر الطوارئ يعيد العدد كما في الإداري فوراً."
          icon={<IconAlert size={16} />}
        >
          <div className="space-y-4">
            <Switch
              label="طرح المبيعات غير المدموجة من العدد"
              description="عند الإيقاف يُعرض عدد الإداري كما هو."
              checked={s?.enabled ?? true}
              disabled={!s || saveSettings.isPending}
              onChange={v => s && saveSettings.mutate({ enabled: v, maxHours: s.maxHours })}
            />
            <div>
              <p className="mb-1 text-[12px] font-semibold text-slate-700">أقصى مدة انتظار للدمج</p>
              <Select
                value={String(s?.maxHours ?? 72)}
                disabled={!s || saveSettings.isPending}
                onChange={e => s && saveSettings.mutate({ enabled: s.enabled, maxHours: Number(e.target.value) })}
              >
                {MAX_HOURS.map(h => (
                  <option key={h} value={h}>{h < 48 ? `${h} ساعة` : `${h / 24} أيام`}</option>
                ))}
              </Select>
              <p className="mt-1 text-[11.5px] text-slate-500">
                فاتورة لم تُدمج خلال هذه المدة يتوقف طرحها، حتى لا يبقى العدد ناقصاً إلى الأبد.
              </p>
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
