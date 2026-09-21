import { PRICE_CHECKER_SETTINGS_QR } from '@fot/shared';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Btn } from '@/components/ui';
import { printPriceCheckerSettingsQr, qrDataUrl } from '@/lib/qrPng';

export function PriceCheckerPage() {
  const toast = useToast();
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void qrDataUrl(PRICE_CHECKER_SETTINGS_QR, 360).then(src => {
      if (!cancelled) setQrSrc(src);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-[18px] font-bold text-header">كاشف السعر — أندرويد</h2>
        <p className="mt-2 text-[13px] leading-7 text-slate-600">
          التطبيق على أجهزة فحص السعر يأخذ الكتالوج والعروض من هذه اللوحة بنفس بيانات نقطة البيع.
          بعد أول مزامنة يعمل أوفلاين. لمس الرمز أدناه على أي جهاز يفتح شاشة IP والمنفذ.
        </p>

        <div className="mt-5 grid gap-5 md:grid-cols-[280px_1fr]">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
            {qrSrc && <img src={qrSrc} alt={PRICE_CHECKER_SETTINGS_QR} className="mx-auto h-[240px] w-[240px]" />}
            <code className="mt-2 block text-[12px] tracking-wide text-slate-500" dir="ltr">{PRICE_CHECKER_SETTINGS_QR}</code>
            <Btn
              className="mt-3"
              onClick={() => {
                void printPriceCheckerSettingsQr().catch(e => {
                  toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
                });
              }}
            >
              طباعة الرمز لجميع الأجهزة
            </Btn>
          </div>
          <div className="text-[13px] leading-7 text-slate-600">
            <p className="font-bold text-header">التشغيل</p>
            <ol className="mt-2 list-decimal pr-5">
              <li>شبكة الإيثرnet للأسعار منفصلة: الخادم <span dir="ltr" className="font-bold">192.168.75.1</span> — المنفذ <span dir="ltr">5000</span> (لا تستخدم IP الواي فاي).</li>
              <li>من إعدادات Android على كل جهاز: Ethernet → IP ثابت <span dir="ltr">192.168.75.10</span>، <span dir="ltr">.11</span>، <span dir="ltr">.12</span> … (السيرفر بدون DHCP).</li>
              <li>في التطبيق أدخل IP الخادم <span dir="ltr">192.168.75.1</span> والمنفذ 5000.</li>
              <li>لفتح الإعدادات لاحقاً امسح رمز QR هذا، أو اضغط مطولاً على شعار FOT.</li>
            </ol>
            <p className="mt-4 text-[12px] text-slate-500">
              ملف التثبيت للأندرويد يُبنى من مجلد android/price-checker. الواجهة تُنشر أيضاً مع الخادم على المسار /price/.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PriceCheckerPage;
