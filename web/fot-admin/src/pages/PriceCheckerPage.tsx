import { PRICE_CHECKER_SETTINGS_QR } from '@fot/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { Alert, Badge, Btn, Skeleton } from '@/components/ui';
import { IconCopy, IconInfo, IconPrinter, IconQr, IconWifi } from '@/components/icons';
import { SettingsCard } from '@/components/system/systemUi';
import { copyText } from '@/lib/clipboard';
import { printPriceCheckerSettingsQr, qrDataUrl } from '@/lib/qrPng';

const SERVER_IP = '192.168.75.1';
const SERVER_PORT = '5000';

export function PriceCheckerPage() {
  const toast = useToast();
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    qrDataUrl(PRICE_CHECKER_SETTINGS_QR, 360)
      .then(src => {
        if (!cancelled) setQrSrc(src);
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => { cancelled = true; };
  }, []);

  async function copy(text: string, label: string) {
    try {
      await copyText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  async function print() {
    setPrinting(true);
    try {
      await printPriceCheckerSettingsQr();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-2">
      <div className="grid items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── رمز الإعدادات ── */}
        <SettingsCard title="رمز فتح الإعدادات" description="امسحه بأي جهاز لفتح شاشة IP والمنفذ." icon={<IconQr size={16} />}>
          <div className="flex flex-col items-center text-center">
            <div className="flex h-[220px] w-[220px] items-center justify-center rounded-xl border border-slate-100 bg-white p-2">
              {qrSrc ? (
                <img src={qrSrc} alt={PRICE_CHECKER_SETTINGS_QR} className="h-full w-full" />
              ) : qrError ? (
                <p className="text-[12px] text-red-600">تعذر توليد الرمز</p>
              ) : (
                <Skeleton className="h-full w-full rounded-lg" />
              )}
            </div>
            <button
              type="button"
              onClick={() => void copy(PRICE_CHECKER_SETTINGS_QR, 'نص الرمز')}
              className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[12px] tracking-wide text-slate-500 hover:bg-slate-100"
              dir="ltr"
              title="نسخ"
            >
              {PRICE_CHECKER_SETTINGS_QR} <IconCopy size={12} />
            </button>
            <Btn className="mt-3 w-full" icon={<IconPrinter size={15} />} loading={printing} onClick={() => void print()}>
              طباعة الرمز لكل الأجهزة
            </Btn>
          </div>
        </SettingsCard>

        <div className="grid items-start gap-3 xl:grid-cols-2">
          {/* ── بيانات الاتصال ── */}
          <SettingsCard
            title="كاشف السعر — أندرويد"
            description="يأخذ التطبيق الكتالوج والعروض من هذه اللوحة بنفس بيانات نقطة البيع، ويعمل دون اتصال بعد أول مزامنة."
            icon={<IconWifi size={16} />}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <CopyField label="عنوان الخادم (IP)" value={SERVER_IP} onCopy={() => void copy(SERVER_IP, 'العنوان')} />
              <CopyField label="المنفذ" value={SERVER_PORT} onCopy={() => void copy(SERVER_PORT, 'المنفذ')} />
            </div>
            <div className="mt-3">
              <Alert type="info">
                شبكة الإيثرنت الخاصة بالأسعار منفصلة — لا تستخدم عنوان الواي فاي. الخادم بدون DHCP، لذا يحتاج كل جهاز IP ثابتاً.
              </Alert>
            </div>
          </SettingsCard>

          {/* ── خطوات التشغيل ── */}
          <SettingsCard title="خطوات التشغيل" description="مرة واحدة لكل جهاز جديد." icon={<IconInfo size={16} />}>
            <ol className="space-y-2">
              <Step n={1}>
                وصّل الجهاز بشبكة الإيثرنت الخاصة بالأسعار. الخادم على{' '}
                <Ltr>{SERVER_IP}</Ltr> والمنفذ <Ltr>{SERVER_PORT}</Ltr>.
              </Step>
              <Step n={2}>
                من إعدادات Android: Ethernet ← IP ثابت لكل جهاز:{' '}
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  <Badge>192.168.75.10</Badge>
                  <Badge>.11</Badge>
                  <Badge>.12</Badge>
                  <span className="text-slate-400">…</span>
                </span>
              </Step>
              <Step n={3}>
                في التطبيق أدخل IP الخادم <Ltr>{SERVER_IP}</Ltr> والمنفذ <Ltr>{SERVER_PORT}</Ltr>.
              </Step>
              <Step n={4}>لفتح الإعدادات لاحقاً امسح رمز QR، أو اضغط مطولاً على شعار FOT.</Step>
            </ol>
            <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] leading-5 text-slate-500">
              ملف التثبيت للأندرويد يُبنى من مجلد <span className="font-mono" dir="ltr">android/price-checker</span>. الواجهة تُنشر أيضاً مع الخادم على المسار{' '}
              <span className="font-mono" dir="ltr">/price/</span>.
            </p>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}

function Ltr({ children }: { children: ReactNode }) {
  return <span dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-slate-800">{children}</span>;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[13px] leading-6 text-slate-700">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[12px] font-bold text-white">{n}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function CopyField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className="font-mono text-[15px] font-bold text-header" dir="ltr">{value}</p>
      </div>
      <Btn size="xs" variant="ghost" icon={<IconCopy size={12} />} onClick={onCopy}>نسخ</Btn>
    </div>
  );
}

export default PriceCheckerPage;
