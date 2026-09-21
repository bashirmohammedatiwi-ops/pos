import { useSearchParams } from 'react-router-dom';
import { IconBanknote, IconChart, IconCoins, IconPackage, IconTarget } from '@/components/icons';
import { CommissionReportApp } from '@/components/reports/CommissionReportApp';
import { TargetReportApp } from '@/components/reports/TargetReportApp';
import { WeeklySettlementApp } from '@/components/reports/WeeklySettlementApp';
import { ProductInquiryApp } from '@/components/reports/ProductInquiryApp';
import { ReportAppWindow } from '@/components/reports/ReportAppWindow';
import { SalesReportsPanel } from '@/components/reports/SalesReportsPanel';

type ReportAppId = 'commissions' | 'targets' | 'settlement' | 'sales' | 'product-inquiry';

const APPS: Array<{
  id: ReportAppId;
  label: string;
  hint: string;
  from: string;
  to: string;
}> = [
  {
    id: 'commissions',
    label: 'تقرير العمولات',
    hint: 'إكسل البائعين المثبتين',
    from: '#34d399',
    to: '#0b7d5d',
  },
  {
    id: 'targets',
    label: 'تقرير الأهداف',
    hint: 'صف لكل هدف وبائع',
    from: '#fbbf24',
    to: '#c2410c',
  },
  {
    id: 'settlement',
    label: 'كشف التسليم',
    hint: 'عمولة وأهداف وتسليم أسبوعي',
    from: '#c4b5fd',
    to: '#6d28d9',
  },
  {
    id: 'sales',
    label: 'تقرير المبيعات',
    hint: 'حركة المواد والصندوق',
    from: '#38bdf8',
    to: '#0369a1',
  },
  {
    id: 'product-inquiry',
    label: 'استعلام مادة',
    hint: 'مبيعات وعمولات منتج أو مجموعة',
    from: '#818cf8',
    to: '#4338ca',
  },
];

function AppGlyph({ id }: { id: ReportAppId }) {
  if (id === 'commissions') return <IconCoins size={38} />;
  if (id === 'targets') return <IconTarget size={38} />;
  if (id === 'settlement') return <IconBanknote size={38} />;
  if (id === 'product-inquiry') return <IconPackage size={38} />;
  return <IconChart size={38} />;
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const app = (params.get('app') as ReportAppId | null)
    ?? (params.get('tab') != null ? 'sales' : null);

  function openApp(id: ReportAppId) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('app', id);
      return next;
    }, { replace: true });
  }

  function closeApp() {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('app');
      next.delete('tab');
      return next;
    }, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-4" dir="rtl">
      <p className="mb-8 max-w-xl text-[13.5px] leading-6 text-slate-500">
        اختر تقريراً كالتطبيق. العمولات والأهداف تثبت البائعين على هذا الجهاز. كشف التسليم يُحفظ على السيرفر لكل الأجهزة.
      </p>

      <div className="flex flex-wrap gap-8">
        {APPS.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => openApp(a.id)}
            className="group flex w-[118px] flex-col items-center gap-3"
          >
            <span
              className="flex h-[92px] w-[92px] items-center justify-center rounded-[26px] text-white shadow-lg ring-1 ring-black/5 transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl group-active:translate-y-0"
              style={{ background: `linear-gradient(145deg, ${a.from}, ${a.to})` }}
            >
              <AppGlyph id={a.id} />
            </span>
            <span className="text-center">
              <span className="block text-[13.5px] font-extrabold text-header">{a.label}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">{a.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {app === 'commissions' && <CommissionReportApp onClose={closeApp} />}
      {app === 'targets' && <TargetReportApp onClose={closeApp} />}
      {app === 'settlement' && <WeeklySettlementApp onClose={closeApp} />}
      {app === 'product-inquiry' && <ProductInquiryApp onClose={closeApp} />}
      {app === 'sales' && (
        <ReportAppWindow
          title="تقرير المبيعات"
          subtitle="حركة المواد · يومي · مندوب · صندوق"
          icon={<IconChart size={20} />}
          accent="linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)"
          onClose={closeApp}
        >
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <SalesReportsPanel />
          </div>
        </ReportAppWindow>
      )}
    </div>
  );
}

