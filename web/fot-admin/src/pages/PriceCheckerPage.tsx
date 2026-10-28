import { PRICE_CHECKER_SETTINGS_QR } from '@fot/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatNum } from '@/api/client';
import { useToast } from '@/components/Toast';
import { Alert, Badge, Btn, Input, Kbd, Skeleton } from '@/components/ui';
import {
  IconBarcode,
  IconCheckCircle,
  IconCopy,
  IconExternal,
  IconInfo,
  IconPackage,
  IconPercent,
  IconPrinter,
  IconQr,
  IconRefresh,
  IconSearch,
  IconTag,
  IconUpload,
  IconWifi,
  IconX,
} from '@/components/icons';
import { SettingsCard } from '@/components/system/systemUi';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';
import { getApiBase } from '@/lib/apiBase';
import { copyText } from '@/lib/clipboard';
import { printPriceCheckerSettingsQr, qrDataUrl } from '@/lib/qrPng';
import { offerTypeLabel } from '@/lib/offers';
import { fixEdariName } from '@/lib/text';

const DEFAULT_SERVER_IP = '192.168.75.1';
const DEFAULT_SERVER_PORT = '5000';

export function PriceCheckerPage() {
  const toast = useToast();
  const { push: pushToPos, pushing } = usePushPosUpdates();
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedTerm(searchTerm.trim()), 250);
    return () => window.clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const serverInfoQ = useQuery({
    queryKey: ['server-info'],
    queryFn: api.serverInfo,
    staleTime: 60_000,
  });

  const statsQ = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: api.dashboardStats,
    staleTime: 45_000,
  });

  const offerStatsQ = useQuery({
    queryKey: ['offer-stats'],
    queryFn: api.offersStats,
    staleTime: 45_000,
  });

  const lookupQ = useQuery({
    queryKey: ['price-checker-sim', debouncedTerm],
    queryFn: () => api.lookupProductOffers(debouncedTerm, 10),
    enabled: debouncedTerm.length >= 2,
    staleTime: 20_000,
  });

  const lanUrls = useMemo(() => {
    const port = serverInfoQ.data?.apiPort || Number(DEFAULT_SERVER_PORT);
    return (serverInfoQ.data?.lanAddresses ?? []).map(ip => `http://${ip}:${port}`);
  }, [serverInfoQ.data]);
  const priceWebUrl = useMemo(() => {
    const base = lanUrls[0] || getApiBase() || `http://${DEFAULT_SERVER_IP}:${DEFAULT_SERVER_PORT}`;
    return `${base.replace(/\/+$/, '')}/price/`;
  }, [lanUrls]);

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

  const hits = lookupQ.data ?? [];
  const topHit = hits[0] ?? null;
  const winningOffer = topHit
    ? topHit.offers.find(o => o.isWinning) ?? topHit.offers.find(o => o.enabled) ?? null
    : null;

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto pb-4" dir="rtl">
      {/* ── شريط جاهزية الكتالوج والعروض لكاشف السعر ── */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-brand-50/70 via-white to-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="icon-tile h-10 w-10 rounded-xl bg-brand-600 text-white shadow-sm">
              <IconTag size={19} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14.5px] font-extrabold text-header">بيانات كاشف السعر الحية</h2>
                <Badge tone="ok" dot>متصل بالخادم</Badge>
              </div>
              <p className="text-[12px] text-slate-500">
                أجهزة الأندرويد وصفحة الويب تقرأ الأسعار والعروض مباشرة من هذا الخادم، وتعمل دون اتصال بعد أول مزامنة.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={priceWebUrl} target="_blank" rel="noreferrer">
              <Btn size="sm" variant="secondary" icon={<IconExternal size={14} />}>
                فتح كاشف السعر في المتصفح
              </Btn>
            </a>
            <Btn
              size="sm"
              icon={<IconUpload size={14} />}
              loading={pushing}
              onClick={() => void pushToPos()}
            >
              دفع التحديثات للأجهزة
            </Btn>
          </div>
        </div>

        <div className="grid gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatPill
            icon={<IconPackage size={16} />}
            tone="brand"
            label="المنتجات في الكتالوج"
            value={statsQ.isLoading ? '…' : formatNum(statsQ.data?.localProducts ?? 0)}
            hint="جاهزة للمسح بالباركود"
          />
          <StatPill
            icon={<IconPercent size={16} />}
            tone="violet"
            label="العروض الفعّالة"
            value={offerStatsQ.isLoading ? '…' : formatNum(offerStatsQ.data?.enabled ?? statsQ.data?.activeOffers ?? 0)}
            hint={`${formatNum(offerStatsQ.data?.discountedItems ?? 0)} مادة مشمولة بخصم`}
          />
          <StatPill
            icon={<IconWifi size={16} />}
            tone="sky"
            label="عنوان شبكة الأسعار"
            value={`${DEFAULT_SERVER_IP}:${DEFAULT_SERVER_PORT}`}
            hint="Ethernet ثابت للأجهزة"
            ltr
          />
          <StatPill
            icon={<IconCheckCircle size={16} />}
            tone="emerald"
            label="رابط المتصفح المباشر"
            value="/price/"
            hint="يعمل على أي شاشة أو جهاز لوحي"
            ltr
          />
        </div>
      </section>

      {/* ── محاكي كاشف السعر الفوري ── */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="icon-tile h-7 w-7 rounded-lg bg-emerald-50 text-emerald-700">
              <IconBarcode size={15} />
            </span>
            <div>
              <h3 className="text-[13.5px] font-bold text-header">محاكي شاشة كاشف السعر</h3>
              <p className="text-[11.5px] text-slate-500">امسح باركود أو اكتب اسم منتج لترى تماماً ما سيظهر للزبون على جهاز كاشف السعر</p>
            </div>
          </div>
          <span className="hidden items-center gap-1 text-[11px] text-slate-400 sm:inline-flex">
            اختصار التركيز <Kbd>/</Kbd>
          </span>
        </div>

        <div className="grid gap-3 p-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-2.5">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
                {lookupQ.isFetching ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                ) : (
                  <IconSearch size={16} />
                )}
              </span>
              <Input
                ref={searchInputRef}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="امسح الباركود أو اكتب اسم المنتج للتحقق من سعره وعروضه…"
                className="!h-10 !ps-9 !pe-9 font-semibold"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
                  className="absolute inset-y-0 end-2.5 flex items-center text-slate-400 hover:text-slate-700"
                  aria-label="مسح"
                >
                  <IconX size={15} />
                </button>
              )}
            </div>

            {debouncedTerm.length < 2 ? (
              <div className="flex min-h-[150px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center">
                <IconBarcode size={26} className="text-slate-300" />
                <p className="mt-1.5 text-[12.5px] font-semibold text-slate-600">امسح أي باركود أو اكتب حرفين على الأقل</p>
                <p className="mt-0.5 text-[11.5px] text-slate-400">يعرض السعر الأصلي، السعر بعد العرض، والعرض الفائز كما يظهر على شاشة الزبون</p>
              </div>
            ) : hits.length === 0 && !lookupQ.isFetching ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-center text-[12.5px] font-semibold text-amber-900">
                لا يوجد منتج مطابق لـ «{debouncedTerm}»
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {hits.map(item => {
                  const win = item.offers.find(o => o.isWinning) ?? item.offers.find(o => o.enabled);
                  const hasDiscount = item.price < item.originalPrice && item.originalPrice > 0;
                  const pct = hasDiscount ? Math.round((1 - item.price / item.originalPrice) * 100) : 0;
                  return (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/products?search=${encodeURIComponent(item.barcode || item.name || '')}`}
                            className="truncate text-[13px] font-bold text-header hover:text-brand-700 hover:underline"
                          >
                            {fixEdariName(item.name) || item.name || `#${item.id}`}
                          </Link>
                          {win && (
                            <Link to={`/offers?id=${win.offerId}`}>
                              <Badge tone="ok">{offerTypeLabel(win.offerType)}: {win.offerName}</Badge>
                            </Link>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-[11.5px] text-slate-500" dir="ltr">
                          {item.barcode || 'بلا باركود'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-end">
                        {hasDiscount && (
                          <>
                            <Badge tone="ok" className="num">-{pct}%</Badge>
                            <span className="text-[12px] text-slate-400 line-through num">{formatCurrency(item.originalPrice)}</span>
                          </>
                        )}
                        <span className="text-[14px] font-extrabold text-emerald-700 num">{formatCurrency(item.price)}</span>
                        <Link
                          to={`/barcode-labels?barcode=${encodeURIComponent(item.barcode || '')}`}
                          title="طباعة ملصق باركود"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        >
                          <IconPrinter size={13} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* شاشة العرض للزبون */}
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 p-4 text-white shadow-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className="text-[11px] font-bold tracking-wider text-emerald-300">FOT PRICE CHECKER</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> شاشة الزبون
              </span>
            </div>
            {topHit ? (
              <div className="my-auto py-4 text-center">
                <p className="line-clamp-2 text-[15px] font-bold text-white">
                  {fixEdariName(topHit.name) || topHit.name || `#${topHit.id}`}
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-slate-400" dir="ltr">{topHit.barcode || '—'}</p>
                {topHit.price < topHit.originalPrice && topHit.originalPrice > 0 && (
                  <p className="mt-3 text-[13px] text-slate-400 line-through num">
                    {formatCurrency(topHit.originalPrice)}
                  </p>
                )}
                <p className="mt-1 text-[28px] font-extrabold tracking-tight text-emerald-300 num">
                  {formatCurrency(topHit.price)}
                </p>
                {winningOffer && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-0.5 text-[11.5px] font-semibold text-emerald-200 ring-1 ring-emerald-400/30">
                    <IconPercent size={12} /> {winningOffer.offerName}
                  </span>
                )}
              </div>
            ) : (
              <div className="my-auto py-8 text-center">
                <p className="text-[14px] font-bold text-slate-300">مرّر الباركود أمام القارئ</p>
                <p className="mt-1 text-[11.5px] text-slate-400">لمعاينة السعر والخصم الفوري</p>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[10.5px] text-slate-400">
              <span>تحديث تلقائي</span>
              <span dir="ltr">{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}</span>
            </div>
          </div>
        </div>
      </section>

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
            title="كاشف السعر — أندرويد والويب"
            description="يأخذ التطبيق الكتالوج والعروض من هذه اللوحة بنفس بيانات نقطة البيع، ويعمل دون اتصال بعد أول مزامنة."
            icon={<IconWifi size={16} />}
            actions={
              <Btn size="xs" variant="ghost" icon={<IconRefresh size={13} />} onClick={() => void serverInfoQ.refetch()}>
                تحديث العناوين
              </Btn>
            }
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <CopyField label="عنوان الخادم (Ethernet)" value={DEFAULT_SERVER_IP} onCopy={() => void copy(DEFAULT_SERVER_IP, 'العنوان')} />
              <CopyField label="المنفذ" value={DEFAULT_SERVER_PORT} onCopy={() => void copy(DEFAULT_SERVER_PORT, 'المنفذ')} />
            </div>

            <div className="mt-2.5">
              <CopyField label="رابط صفحة كاشف السعر المباشر" value={priceWebUrl} onCopy={() => void copy(priceWebUrl, 'رابط كاشف السعر')} />
            </div>

            {lanUrls.length > 0 && (
              <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <p className="mb-1.5 text-[11px] font-bold text-slate-500">عناوين الخادم المكتشفة على الشبكة</p>
                <div className="space-y-1">
                  {lanUrls.map(url => (
                    <div key={url} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1 text-[12px] ring-1 ring-slate-200/80">
                      <span className="truncate font-mono font-semibold text-header" dir="ltr">{url}</span>
                      <button
                        type="button"
                        onClick={() => void copy(url, 'عنوان الخادم')}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
                      >
                        <IconCopy size={11} /> نسخ
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                <Ltr>{DEFAULT_SERVER_IP}</Ltr> والمنفذ <Ltr>{DEFAULT_SERVER_PORT}</Ltr>.
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
                في التطبيق أدخل IP الخادم <Ltr>{DEFAULT_SERVER_IP}</Ltr> والمنفذ <Ltr>{DEFAULT_SERVER_PORT}</Ltr>.
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

function StatPill({
  icon,
  tone,
  label,
  value,
  hint,
  ltr,
}: {
  icon: ReactNode;
  tone: 'brand' | 'violet' | 'sky' | 'emerald';
  label: string;
  value: string;
  hint: string;
  ltr?: boolean;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    violet: 'bg-violet-50 text-violet-700',
    sky: 'bg-sky-50 text-sky-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3">
      <span className={`icon-tile h-9 w-9 shrink-0 rounded-lg ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold text-slate-500">{label}</p>
        <p className={`mt-0.5 truncate text-[16px] font-extrabold text-header ${ltr ? 'font-mono' : 'num'}`} dir={ltr ? 'ltr' : undefined}>
          {value}
        </p>
        <p className="truncate text-[11px] text-slate-400">{hint}</p>
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
        <p className="truncate font-mono text-[14px] font-bold text-header" dir="ltr">{value}</p>
      </div>
      <Btn size="xs" variant="ghost" icon={<IconCopy size={12} />} onClick={onCopy}>نسخ</Btn>
    </div>
  );
}

export default PriceCheckerPage;
