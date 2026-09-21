import { Link } from 'react-router-dom';
import { Btn } from '@/components/ui';
import { useLanConnection } from '@/hooks/useLanConnection';
import { useHomeStatus } from '@/hooks/useHomeStatus';
import { ProductOfferSearch } from '@/components/offers/ProductOfferSearch';

function fmtTime(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
}

const QUICK_LINKS: Array<{ to: string; label: string }> = [
  { to: '/receipts', label: 'الفواتير' },
  { to: '/products', label: 'المنتجات' },
  { to: '/reports', label: 'التقارير' },
  { to: '/cashiers', label: 'الكاشيرون' },
  { to: '/edari', label: 'الأداري' },
  { to: '/settings', label: 'الإعدادات' },
];

/**
 * الصفحة الرئيسية: بحث منتج→عرض + مؤشرات الربط + بطاقتا تكامل (الأداري، نقاط البيع).
 */
export function DashboardPage() {
  const { online } = useLanConnection();
  const { edariQ, terminalsQ, pullFromEdari, syncReceipts, pushToPos } = useHomeStatus();

  const edari = edariQ.data ?? null;
  const terminals = terminalsQ.data ?? [];
  const activeTerminals = terminals.filter(t => t.active);
  const onlineTerminals = activeTerminals.filter(t => t.isOnline).length;

  const edariOk = edari?.connectionOk === true && edari?.circuitOpen !== true;
  const edariAuto = edari?.autoSyncEnabled === true;
  const unsynced = edari?.unsyncedCount ?? 0;
  const dead = edari?.deadLetterCount ?? 0;

  const lastPull = fmtTime(edari?.lastDataPullAt);
  const terminalsWithPending = activeTerminals.filter(t => (t.pendingOffline ?? 0) > 0).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-2 py-8" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-header">لوحة التحكم</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {new Date().toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[12px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <StatusDot tone={online ? 'ok' : 'bad'} />
            الخادم
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot tone={edariOk ? 'ok' : edari ? 'bad' : 'warn'} />
            الأداري
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot tone={onlineTerminals > 0 ? 'ok' : activeTerminals.length > 0 ? 'warn' : 'bad'} />
            نقاط البيع ({onlineTerminals}/{activeTerminals.length})
          </span>
        </div>
      </header>

      <ProductOfferSearch />

      <div className="grid gap-5 md:grid-cols-2">
        {/* بطاقة الأداري — الجلب والترحيل */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-[15px] font-bold text-header">الأداري</h2>
          <div className="mt-2 min-h-[64px] space-y-1 text-[12.5px] text-slate-600">
            <p>
              {edariOk ? 'متصل' : edari ? 'غير متصل' : 'جاري قراءة الحالة…'}
              {edari?.databaseAlias ? ` · نسخة ${edari.databaseAlias}` : ''}
            </p>
            <p>آخر جلب: {lastPull ?? '—'}</p>
            <p className={edariAuto ? 'text-emerald-700' : 'text-amber-700'}>
              {edariAuto ? 'الترحيل والتزامن التلقائي يعملان ✓' : 'التزامن التلقائي متوقف'}
            </p>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Btn loading={pullFromEdari.isPending} disabled={pullFromEdari.isPending} onClick={() => pullFromEdari.mutate()}>
              جلب من الأداري
            </Btn>
            <Btn
              variant="secondary"
              loading={syncReceipts.isPending}
              disabled={syncReceipts.isPending}
              onClick={() => syncReceipts.mutate()}
            >
              ترحيل الفواتير{unsynced > 0 ? ` (${unsynced})` : ''}
            </Btn>
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px]">
            <span className={dead > 0 ? 'font-semibold text-red-600' : 'text-slate-500'}>
              بانتظار الترحيل: {unsynced} · متوقفة: {dead}
            </span>
            <Link to="/edari" className="font-medium text-brand-600 hover:underline">تفاصيل الأداري ←</Link>
          </div>
        </section>

        {/* بطاقة نقاط البيع — رفع التحديثات */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-[15px] font-bold text-header">نقاط البيع</h2>
          <div className="mt-2 min-h-[64px] space-y-1 text-[12.5px] text-slate-600">
            <p>{onlineTerminals} من {activeTerminals.length} جهاز متصل الآن</p>
            <p>تعديلات المنتجات والعروض والحسابات تصل النقاط فوراً وتلقائياً.</p>
            <p className="text-emerald-700">دفع تلقائي مفعّل ✓</p>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Btn loading={pushToPos.isPending} disabled={pushToPos.isPending || !online} onClick={() => pushToPos.mutate()}>
              رفع التحديثات للنقاط الآن
            </Btn>
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px]">
            <span className="text-slate-500">
              {terminalsWithPending > 0
                ? `${terminalsWithPending} جهاز فيه فواتير لم تُرفع بعد`
                : 'كل الأجهزة خالية من الفواتير المعلّقة'}
            </span>
            <Link to="/terminals" className="font-medium text-brand-600 hover:underline">الأجهزة ←</Link>
          </div>
        </section>
      </div>

      <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-slate-100 pt-5 text-[13px] text-slate-600">
        {QUICK_LINKS.map(l => (
          <Link key={l.to} to={l.to} className="hover:text-brand-700 hover:underline">{l.label}</Link>
        ))}
      </nav>
    </div>
  );
}
