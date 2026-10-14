import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IconActivity,
  IconAlert,
  IconBanknote,
  IconChart,
  IconChevronLeft,
  IconClock,
  IconCoins,
  IconPackage,
  IconPercent,
  IconReceipt,
  IconSearch,
  IconTarget,
  IconTrendUp,
  IconUsers,
  IconX,
} from '@/components/icons';
import { Badge, EmptyState, Input, Kbd } from '@/components/ui';
import { OfferSalesReportApp } from '@/components/reports/OfferSalesReportApp';
import { CommissionReportApp } from '@/components/reports/CommissionReportApp';
import { TargetReportApp } from '@/components/reports/TargetReportApp';
import { WeeklySettlementApp } from '@/components/reports/WeeklySettlementApp';
import { ProductInquiryApp } from '@/components/reports/ProductInquiryApp';
import { SellerReceiptsApp } from '@/components/reports/SellerReceiptsApp';
import { CashierVoidsApp } from '@/components/reports/CashierVoidsApp';
import { SalesReportsPanel } from '@/components/reports/SalesReportsPanel';
import { SlowMoversApp } from '@/components/reports/SlowMoversApp';
import { PeakHoursApp } from '@/components/reports/PeakHoursApp';
import { ComparePeriodsApp } from '@/components/reports/ComparePeriodsApp';
import { DailyCloseApp } from '@/components/reports/DailyCloseApp';
import { ReorderApp } from '@/components/reports/ReorderApp';
import { CashierPerformanceApp } from '@/components/reports/CashierPerformanceApp';

type ReportAppId = 'commissions' | 'targets' | 'settlement' | 'sales' | 'product-inquiry' | 'seller-receipts' | 'cashier-voids' | 'offer-sales' | 'slow-movers' | 'peak-hours' | 'cashier-performance' | 'compare' | 'daily-close' | 'reorder';
type GroupId = 'sales' | 'team' | 'offers' | 'audit';

type ReportDef = {
  id: ReportAppId;
  group: GroupId;
  label: string;
  description: string;
  icon: ReactNode;
  tags: string[];
  keywords: string;
};

const GROUPS: { id: GroupId; label: string; hint: string }[] = [
  { id: 'sales', label: 'المبيعات', hint: 'حركة المواد والفواتير والصندوق' },
  { id: 'team', label: 'الفريق والعمولات', hint: 'عمولات البائعين وأهدافهم والتسليم الأسبوعي' },
  { id: 'offers', label: 'العروض', hint: 'أداء العروض المنتهية' },
  { id: 'audit', label: 'الرقابة', hint: 'عمليات الحذف والإلغاء على نقاط البيع' },
];

const REPORTS: ReportDef[] = [
  {
    id: 'sales',
    group: 'sales',
    label: 'تقرير المبيعات',
    description: 'حركة المواد، المبيعات اليومية، حسب البائع، وملخص الصندوق مع مقارنة بالفترة السابقة.',
    icon: <IconChart size={20} />,
    tags: ['رسم يومي', 'Excel'],
    keywords: 'مبيعات حركة مواد يومي صندوق مندوب بائع',
  },
  {
    id: 'product-inquiry',
    group: 'sales',
    label: 'استعلام مادة',
    description: 'مبيعات وعمولات منتج أو شجرة أو مجموعة عمولة، مع البائعين والفواتير.',
    icon: <IconPackage size={20} />,
    tags: ['تفاصيل الفواتير', 'Excel'],
    keywords: 'مادة منتج باركود شجرة مجموعة استعلام',
  },
  {
    id: 'daily-close',
    group: 'sales',
    label: 'تقرير نهاية اليوم',
    description: 'صفحة واحدة لليوم: الصافي، النقدي والبطاقة، المرتجعات، الأقسام والكاشيرات والبائعون، الساعات وأكثر المواد — للطباعة A4.',
    icon: <IconReceipt size={20} />,
    tags: ['طباعة A4', 'يومي'],
    keywords: 'نهاية اليوم إغلاق يومي ملخص اليوم صندوق جرد',
  },
  {
    id: 'compare',
    group: 'sales',
    label: 'مقارنة فترتين',
    description: 'هذا الأسبوع مع الماضي، الشهر مع الشهر، أو أي مدتين: المؤشرات مع الفرق، والمواد التي نمت أو تراجعت أو توقفت.',
    icon: <IconTrendUp size={20} />,
    tags: ['نمو وتراجع', 'Excel'],
    keywords: 'مقارنة فترة اسبوع شهر نمو تراجع فرق توقف',
  },
  {
    id: 'peak-hours',
    group: 'sales',
    label: 'أوقات الذروة',
    description: 'خريطة حرارية لمتوسط المبيعات والفواتير حسب يوم الأسبوع والساعة — لتنظيم الدوام والعروض.',
    icon: <IconClock size={20} />,
    tags: ['خريطة حرارية', 'Excel'],
    keywords: 'ذروة ساعة ساعات زحمة ازدحام يوم أسبوع دوام',
  },
  {
    id: 'reorder',
    group: 'sales',
    label: 'مواد ستنفد قريباً',
    description: 'معدل البيع اليومي مقابل الرصيد: كم يوماً يكفي كل صنف، مع كمية طلب مقترحة والأرصدة السالبة.',
    icon: <IconAlert size={20} />,
    tags: ['مخزون', 'طلب شراء', 'Excel'],
    keywords: 'نفاد نفد تنفد طلب شراء مخزون رصيد سالب تغطية',
  },
  {
    id: 'slow-movers',
    group: 'sales',
    label: 'المواد الراكدة',
    description: 'مواد في المخزن بلا بيع منذ مدة تختارها، مرتبة حسب قيمة المخزون المجمَّد مع تاريخ آخر بيع.',
    icon: <IconPackage size={20} />,
    tags: ['مخزون', 'Excel'],
    keywords: 'راكد راكدة مخزون بطيء لم تبع جرد مجمد',
  },
  {
    id: 'seller-receipts',
    group: 'sales',
    label: 'فواتير البائع',
    description: 'عدد فواتير بائع وقيمة مبيعاته في يوم أو مدة.',
    icon: <IconReceipt size={20} />,
    tags: ['سريع'],
    keywords: 'فواتير بائع عدد مندوب',
  },
  {
    id: 'commissions',
    group: 'team',
    label: 'تقرير العمولات',
    description: 'عمولة كل بائع مثبت في الفترة، المدفوع، والمستحق للصرف.',
    icon: <IconCoins size={20} />,
    tags: ['بائعون مثبتون', 'Excel'],
    keywords: 'عمولات عمولة مستحق صرف بائع',
  },
  {
    id: 'targets',
    group: 'team',
    label: 'تقرير الأهداف',
    description: 'صف لكل بائع وهدف: المتحقق والمطلوب والمتبقي ونسبة الإنجاز.',
    icon: <IconTarget size={20} />,
    tags: ['بائعون مثبتون', 'Excel'],
    keywords: 'أهداف هدف إنجاز بائع',
  },
  {
    id: 'settlement',
    group: 'team',
    label: 'كشف التسليم',
    description: 'كشف أسبوعي بالعمولة والأهداف ومبلغ التسليم مع تأشير الاستلام.',
    icon: <IconBanknote size={20} />,
    tags: ['يُحفظ على السيرفر', 'Excel'],
    keywords: 'تسليم كشف أسبوعي استلام تخفيض',
  },
  {
    id: 'offer-sales',
    group: 'offers',
    label: 'مبيعات العروض',
    description: 'تحليل كامل لكل عرض منتهٍ: مؤشرات، منحنى يومي، المواد وغير المبيعة.',
    icon: <IconPercent size={20} />,
    tags: ['إكسل تنفيذي'],
    keywords: 'عروض عرض خصم مبيعات',
  },
  {
    id: 'cashier-performance',
    group: 'audit',
    label: 'أداء الكاشير',
    description: 'مقارنة الكاشيرات: صافي المبيعات، الفواتير، المتوسط، المرتجعات، الخصم اليدوي، البطاقة وأيام العمل.',
    icon: <IconUsers size={20} />,
    tags: ['مقارنة', 'Excel'],
    keywords: 'كاشير أداء مقارنة صندوق مرتجعات خصم يدوي',
  },
  {
    id: 'cashier-voids',
    group: 'audit',
    label: 'حذف وإلغاء',
    description: 'بنود محذوفة وفواتير ملغاة لكل كاشير مع التفاصيل يوماً بيوم.',
    icon: <IconActivity size={20} />,
    tags: ['رقابة', 'Excel'],
    keywords: 'حذف إلغاء كاشير ملغاة محذوف رقابة',
  },
];

const RECENT_KEY = 'fot_reports_recent';

function loadRecent(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveRecent(v: Record<string, number>) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(v));
  } catch { /* تجاهل */ }
}

function agoLabel(ts?: number) {
  if (!ts) return null;
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'أمس';
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(ts).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const app = (params.get('app') as ReportAppId | null)
    ?? (params.get('tab') != null ? 'sales' : null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Record<string, number>>(loadRecent);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  function openApp(id: ReportAppId) {
    const next = { ...recent, [id]: Date.now() };
    setRecent(next);
    saveRecent(next);
    setParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('app', id);
      return p;
    }, { replace: true });
  }

  function closeApp() {
    setParams(prev => {
      const p = new URLSearchParams(prev);
      p.delete('app');
      p.delete('tab');
      return p;
    }, { replace: true });
  }

  // "/" يركّز البحث
  useEffect(() => {
    if (app) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const q = normalize(query);
  const filtered = useMemo(
    () => (q ? REPORTS.filter(r => normalize(`${r.label} ${r.description} ${r.keywords}`).includes(q)) : REPORTS),
    [q],
  );

  const recentList = useMemo(
    () => REPORTS.filter(r => recent[r.id]).sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0)).slice(0, 3),
    [recent],
  );

  // تنقل بالأسهم بين البطاقات
  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-report-card]') ?? []);
    if (!cards.length) return;
    const idx = cards.indexOf(document.activeElement as HTMLButtonElement);
    let next = idx;
    // RTL: السهم الأيسر = التالي
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(cards.length - 1, idx + 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = idx <= 0 ? 0 : idx - 1;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = cards.length - 1;
    e.preventDefault();
    cards[next]?.focus();
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      openApp(filtered[0].id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      gridRef.current?.querySelector<HTMLButtonElement>('[data-report-card]')?.focus();
    }
  }

  return (
    <div className="w-full py-1" dir="rtl">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-3 pb-2.5 pt-2">
          <label className="block min-w-[220px] flex-[1_1_260px] sm:max-w-[420px]">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">بحث في التقارير</span>
            <span className="relative block">
              <IconSearch size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="عمولات، أهداف، كاشير، عرض…"
                aria-label="بحث في التقارير"
                className="!h-8 !ps-8 !pe-10 text-[12.5px]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                  className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="مسح البحث"
                >
                  <IconX size={13} />
                </button>
              ) : (
                <span className="pointer-events-none absolute end-2 top-1/2 flex -translate-y-1/2 items-center">
                  <Kbd>/</Kbd>
                </span>
              )}
            </span>
          </label>
          <p className="pb-1.5 text-[11.5px] text-slate-500">
            <span className="num font-semibold text-slate-700">{filtered.length}</span> تقرير
            <span className="mx-2 text-slate-300">·</span>
            الأسهم للتنقل و <Kbd>Enter</Kbd> للفتح
          </p>

          {!q && recentList.length > 0 && (
            <div className="ms-auto flex flex-wrap items-center gap-1.5 pb-0.5">
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-500">
                <IconClock size={13} /> آخر ما فتحت:
              </span>
              {recentList.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openApp(r.id)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-[12px] font-semibold text-slate-700 transition hover:border-brand-200 hover:text-brand-800"
                >
                  <span className="text-brand-700 [&>svg]:h-3.5 [&>svg]:w-3.5">{r.icon}</span>
                  {r.label}
                  <span className="text-[10.5px] font-normal text-slate-400">{agoLabel(recent[r.id])}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={gridRef} onKeyDown={onGridKey}>
          {filtered.length === 0 && (
            <EmptyState
              title="لا يوجد تقرير مطابق"
              description={`لم نجد تقريراً يطابق «${query}». جرّب كلمة أخرى مثل: مبيعات، عمولات، أهداف، كاشير.`}
              icon={<IconSearch size={22} />}
            />
          )}
          {GROUPS.map(g => {
            const items = filtered.filter(r => r.group === g.id);
            if (!items.length) return null;
            return (
              <section key={g.id} aria-labelledby={`rg-${g.id}`} className="border-b border-slate-100 last:border-b-0">
                <div className="flex items-baseline gap-2 px-3 pb-1 pt-2.5">
                  <h2 id={`rg-${g.id}`} className="text-[12.5px] font-bold text-header">{g.label}</h2>
                  <span className="truncate text-[11.5px] text-slate-400">{g.hint}</span>
                  <span className="ms-auto text-[11px] text-slate-400 num">{items.length}</span>
                </div>
                <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {items.map(r => (
                    <ReportCard key={r.id} report={r} lastOpened={recent[r.id]} onOpen={() => openApp(r.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-400">
          العمولات والأهداف تحفظ البائعين المثبتين على هذا الجهاز · كشف التسليم يُحفظ على السيرفر لكل الأجهزة · التقارير تفتح بملء الشاشة و <Kbd>Esc</Kbd> يغلقها
        </p>
      </section>

      {app === 'commissions' && <CommissionReportApp onClose={closeApp} />}
      {app === 'targets' && <TargetReportApp onClose={closeApp} />}
      {app === 'settlement' && <WeeklySettlementApp onClose={closeApp} />}
      {app === 'product-inquiry' && <ProductInquiryApp onClose={closeApp} />}
      {app === 'seller-receipts' && <SellerReceiptsApp onClose={closeApp} />}
      {app === 'cashier-voids' && <CashierVoidsApp onClose={closeApp} />}
      {app === 'offer-sales' && <OfferSalesReportApp onClose={closeApp} />}
      {app === 'sales' && <SalesReportsPanel onClose={closeApp} />}
      {app === 'slow-movers' && <SlowMoversApp onClose={closeApp} />}
      {app === 'peak-hours' && <PeakHoursApp onClose={closeApp} />}
      {app === 'compare' && <ComparePeriodsApp onClose={closeApp} />}
      {app === 'daily-close' && <DailyCloseApp onClose={closeApp} />}
      {app === 'reorder' && <ReorderApp onClose={closeApp} />}
      {app === 'cashier-performance' && <CashierPerformanceApp onClose={closeApp} />}
    </div>
  );
}

function ReportCard({ report, lastOpened, onOpen }: { report: ReportDef; lastOpened?: number; onOpen: () => void }) {
  const ago = agoLabel(lastOpened);
  return (
    <button
      type="button"
      data-report-card
      onClick={onOpen}
      title={report.description}
      className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-right transition hover:border-brand-300 hover:bg-brand-50/40 focus-visible:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/25"
    >
      <span className="icon-tile h-8 w-8 shrink-0 rounded-lg bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white [&>svg]:h-4 [&>svg]:w-4">
        {report.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-bold text-header">{report.label}</span>
          <span className="hidden shrink-0 items-center gap-1 xl:inline-flex">
            {report.tags.slice(0, 2).map(t => (
              <Badge key={t} tone="default" className="!px-1.5 !py-0 !text-[10px] !font-medium">{t}</Badge>
            ))}
          </span>
        </span>
        <span className="block truncate text-[11.5px] leading-5 text-slate-500">{report.description}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <IconChevronLeft size={15} className="text-slate-300 transition group-hover:-translate-x-0.5 group-hover:text-brand-600" />
        {ago && <span className="text-[10.5px] text-slate-400">{ago}</span>}
      </span>
    </button>
  );
}
