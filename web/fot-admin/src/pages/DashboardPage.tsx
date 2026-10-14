import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { StatCard } from '@/components/ui';
import { useLanConnection } from '@/hooks/useLanConnection';
import { useHomeStatus } from '@/hooks/useHomeStatus';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { ProductOfferSearch } from '@/components/offers/ProductOfferSearch';
import {
  forecastDay,
  forecastPeriod,
  greeting,
  healthLabel,
  pctChange,
  todayLabel,
} from '@/components/dashboard/dashboardUtils';
import {
  CardLink,
  HealthRing,
  HomeCard,
  HourBarsChart,
  prettyPos,
  RankList,
  RecentReceiptsList,
  ShareList,
  StatusLine,
  WeekBarsChart,
} from '@/components/dashboard/HomeWidgets';
import {
  AttentionCenter,
  CommissionDueList,
  DashboardHero,
  DashSection,
  HoldsList,
  MonthDailyBars,
  PaymentMix,
  PeriodProgress,
  SectionNav,
  SyncTile,
  TargetRiskList,
  TerminalGrid,
  type AttentionItem,
} from '@/components/dashboard/DashboardPanels';
import {
  IconAlert,
  IconBanknote,
  IconBarcode,
  IconCalendar,
  IconChart,
  IconClock,
  IconCloud,
  IconDownload,
  IconInfo,
  IconMonitor,
  IconPackage,
  IconPercent,
  IconReceipt,
  IconReturn,
  IconSend,
  IconTarget,
  IconTrendUp,
  IconUpload,
  IconUsers,
  IconWallet,
  IconZap,
} from '@/components/icons';
import { fixEdariName, userDisplayLabel } from '@/lib/text';

function fmtTime(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const QUICK_ACTIONS = [
  { to: '/receipts', label: 'الفواتير', icon: IconReceipt, tone: 'bg-sky-50 text-sky-700' },
  { to: '/offers', label: 'العروض', icon: IconPercent, tone: 'bg-violet-50 text-violet-700' },
  { to: '/barcode-labels', label: 'طباعة باركود', icon: IconBarcode, tone: 'bg-amber-50 text-amber-700' },
  { to: '/products', label: 'المنتجات', icon: IconPackage, tone: 'bg-brand-50 text-brand-700' },
  { to: '/reports?app=daily-close', label: 'نهاية اليوم', icon: IconReceipt, tone: 'bg-cyan-50 text-cyan-700' },
  { to: '/reports?app=compare', label: 'مقارنة فترتين', icon: IconTrendUp, tone: 'bg-indigo-50 text-indigo-700' },
  { to: '/reports?app=peak-hours', label: 'أوقات الذروة', icon: IconClock, tone: 'bg-emerald-50 text-emerald-700' },
  { to: '/reports?app=reorder', label: 'ستنفد قريباً', icon: IconAlert, tone: 'bg-rose-50 text-rose-700' },
  { to: '/reports?app=slow-movers', label: 'المواد الراكدة', icon: IconPackage, tone: 'bg-orange-50 text-orange-700' },
];

type BreakdownTab = 'section' | 'pos' | 'cashier';
type SellersRange = 'today' | 'week';

/**
 * الرئيسية مرتبة في أقسام قابلة للطي:
 * الرأس (صافي اليوم والتوقع) · يحتاج انتباهك · اليوم · الأسبوع والشهر · الفريق · الأجهزة والمزامنة · الفواتير.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const { online } = useLanConnection();
  const d = useDashboardData();
  const hubConnected = useSyncStatus();
  const { edariQ, pullFromEdari, syncReceipts, pushToPos } = useHomeStatus();
  const [serverHost, setServerHost] = useState(false);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('section');
  const [sellersRange, setSellersRange] = useState<SellersRange>('today');

  useEffect(() => {
    let cancelled = false;
    void window.fotDesktop?.info?.().then(info => {
      if (!cancelled) setServerHost(Boolean(info?.isServerEdition));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // تفصيل اليوم (بالساعة/القسم/نقطة البيع/الكاشير/البطاقة) — خادم أقدم بلا الخدمة يُخفي هذه الأجزاء
  const dayQ = useQuery({
    queryKey: ['day-breakdown', d.today],
    queryFn: () => api.dayBreakdown(d.today),
    staleTime: 30_000,
    refetchInterval: hubConnected ? 120_000 : 45_000,
    retry: 0,
    placeholderData: prev => prev,
  });
  const day = dayQ.data;
  const edariSettingsQ = useQuery({ queryKey: ['edari-settings'], queryFn: api.edariSettings, staleTime: 60_000 });
  const pullMinutes = Math.max(1, Math.round((edariSettingsQ.data?.dataPullIntervalSeconds || 240) / 60));
  const hasDay = Boolean(day);

  const name = userDisplayLabel(user);
  const edari = edariQ.data ?? null;
  const edariOk = edari?.connectionOk === true && edari?.circuitOpen !== true;
  const lastPull = fmtTime(edari?.lastDataPullAt);
  const dead = edari?.deadLetterCount ?? 0;
  const cashLoading = d.loading;
  const cardTotal = day?.cardTotal ?? 0;
  const cashTotal = Math.max(0, d.sales - cardTotal);
  const cardShare = d.sales > 0 ? (cardTotal / d.sales) * 100 : 0;

  // مقارنة عادلة: مبيعات أمس حتى نفس الساعة
  const nowHour = new Date().getHours();
  const yToNow = (day?.prevHourly ?? []).filter(h => h.hour <= nowHour).reduce((n, h) => n + h.total, 0);
  const yHourlyTotal = (day?.prevHourly ?? []).reduce((n, h) => n + h.total, 0);
  const salesDelta = hasDay ? pctChange(d.sales, yToNow) : pctChange(d.sales, d.ySales);
  const dayForecast = hasDay ? forecastDay(d.sales, yToNow, yHourlyTotal || d.ySales) : null;
  const pace = hasDay ? (yToNow > 0 ? (d.sales / yToNow) * 100 : null) : d.ySales > 0 ? d.pace : null;

  const weekForecast = forecastPeriod(d.weekTotal, d.weekProgressInfo.elapsed, d.weekProgressInfo.total);
  const monthForecast = forecastPeriod(d.monthTotal, d.monthProgressInfo.elapsed, d.monthProgressInfo.total);
  const prevWeekToDate = d.prevDays.slice(0, d.weekProgressInfo.elapsed).reduce((n, x) => n + x.total, 0);

  const breakdownRows =
    breakdownTab === 'section' ? day?.bySection ?? [] : breakdownTab === 'pos' ? day?.byPos ?? [] : day?.byCashier ?? [];

  const offlineTerminals = d.terminals.filter(t => !(t.isOnline || t.active));
  const pendingOnTerminals = d.terminals.reduce((n, t) => n + (t.pendingOffline ?? 0), 0);
  const deadOnTerminals = d.terminals.reduce((n, t) => n + (t.deadOffline ?? 0), 0);

  const sellerRows = useMemo(() => {
    const src = sellersRange === 'today' ? d.topSalesmen : d.weekTopSalesmen;
    return [...src]
      .filter(s => s.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map(s => ({
        key: s.salesmanId,
        label: fixEdariName(s.name) || `بائع #${s.salesmanId}`,
        value: s.total,
        sub: `${formatNum(s.count ?? 0)} فاتورة`,
      }));
  }, [sellersRange, d.topSalesmen, d.weekTopSalesmen]);

  const attention = useMemo(() => {
    const items: AttentionItem[] = [];
    if (edari && !edariOk) {
      items.push({
        id: 'edari',
        tone: 'bad',
        icon: <IconCloud size={17} />,
        title: 'الأداري غير متصل',
        detail: edari.circuitOpen
          ? `إيقاف مؤقت بعد أخطاء متكررة${edari.circuitRetryInSeconds ? ` · إعادة المحاولة بعد ${formatNum(edari.circuitRetryInSeconds)} ث` : ''}`
          : edari.message || `آخر جلب ${lastPull ?? '—'}`,
        to: '/edari',
        action: 'فحص',
      });
    }
    if (d.failed > 0 || dead > 0) {
      items.push({
        id: 'failed',
        tone: 'bad',
        icon: <IconSend size={17} />,
        title: `${formatNum(d.failed + dead)} فاتورة فشل ترحيلها`,
        detail: d.failedLogs[0]?.errorMessage || 'راجع سجل الترحيل وأعد المحاولة',
        to: '/edari',
        action: 'السجل',
      });
    }
    if (deadOnTerminals > 0) {
      items.push({
        id: 'dead-pos',
        tone: 'bad',
        icon: <IconMonitor size={17} />,
        title: `${formatNum(deadOnTerminals)} فاتورة عالقة على الأجهزة`,
        detail: 'استنفدت محاولات الرفع من نقطة البيع',
        to: '/terminals',
      });
    }
    if (d.holdCount > 0) {
      items.push({
        id: 'holds',
        tone: 'warn',
        icon: <IconClock size={17} />,
        title: `${formatNum(d.holdCount)} فاتورة معلّقة`,
        detail: `بقيمة ${formatNum(d.holds.reduce((n, h) => n + h.totalAmount, 0))} IQD`,
        to: '/receipts?hold=1',
        action: 'إكمال',
      });
    }
    if (d.unsynced > 0) {
      items.push({
        id: 'unsynced',
        tone: d.unsynced > 20 || (edari?.oldestUnsyncedMinutes ?? 0) > 30 ? 'warn' : 'info',
        icon: <IconSend size={17} />,
        title: `${formatNum(d.unsynced)} فاتورة بانتظار الترحيل`,
        detail: edari?.oldestUnsyncedMinutes
          ? `أقدمها منذ ${formatNum(edari.oldestUnsyncedMinutes)} دقيقة`
          : 'تُرحَّل تلقائياً للأداري',
        to: '/edari',
      });
    }
    if (pendingOnTerminals > 0) {
      items.push({
        id: 'pending-pos',
        tone: 'info',
        icon: <IconUpload size={17} />,
        title: `${formatNum(pendingOnTerminals)} فاتورة لم تُرفع من الأجهزة`,
        detail: 'ستُرفع عند عودة الاتصال',
        to: '/terminals',
      });
    }
    if (d.terminals.length > 0 && offlineTerminals.length > 0) {
      items.push({
        id: 'offline',
        tone: offlineTerminals.length === d.terminals.length ? 'bad' : 'warn',
        icon: <IconMonitor size={17} />,
        title: `${formatNum(offlineTerminals.length)} نقطة بيع غير متصلة`,
        detail: offlineTerminals.slice(0, 3).map(t => prettyPos(t.name, t.sectionName)).join('، '),
        to: '/terminals',
      });
    }
    if (d.atRiskCount > 0) {
      items.push({
        id: 'targets',
        tone: 'warn',
        icon: <IconTarget size={17} />,
        title: `${formatNum(d.atRiskCount)} بائع دون 70% من الهدف`,
        detail: d.atRiskTargets.slice(0, 2).map(t => `${t.name} ${formatNum(t.pct, 0)}%`).join(' · '),
        to: '/reports?app=targets',
        action: 'التقرير',
      });
    }
    return items;
  }, [edari, edariOk, lastPull, d.failed, dead, d.failedLogs, deadOnTerminals, d.holdCount, d.holds, d.unsynced, pendingOnTerminals, d.terminals.length, offlineTerminals, d.atRiskCount, d.atRiskTargets]);

  const systemIssues = attention.filter(a => ['edari', 'failed', 'dead-pos', 'offline', 'pending-pos', 'unsynced'].includes(a.id)).length;

  const sections = useMemo(
    () => [
      { id: 'today', label: 'اليوم' },
      { id: 'period', label: 'الأسبوع والشهر' },
      { id: 'team', label: 'الفريق', badge: d.atRiskCount || undefined },
      { id: 'system', label: 'الأجهزة والمزامنة', badge: systemIssues || undefined },
      { id: 'receipts', label: 'الفواتير', badge: d.holdCount || undefined },
    ],
    [d.atRiskCount, systemIssues, d.holdCount],
  );

  function refreshAll() {
    void d.refetchAll();
    void dayQ.refetch();
  }

  return (
    <div className="space-y-5 pb-8" dir="rtl">
      <DashboardHero
        greeting={`${greeting()}${name ? `، ${name}` : ''}`}
        dateLabel={todayLabel()}
        updatedAt={d.updatedAt}
        live={hubConnected}
        sales={d.sales}
        salesDelta={salesDelta}
        salesDeltaLabel={
          salesDelta == null ? 'لا مبيعات أمس للمقارنة' : hasDay ? `عن أمس حتى نفس الساعة (${formatNum(yToNow)})` : `عن أمس (${formatNum(d.ySales)})`
        }
        receipts={d.receipts}
        average={d.average}
        forecast={dayForecast}
        yesterdayTotal={yHourlyTotal || d.ySales}
        pace={pace}
        loading={cashLoading}
        refreshing={d.isRefreshing || dayQ.isFetching}
        onRefresh={refreshAll}
      />

      <AttentionCenter items={attention} loading={cashLoading} />

      <SectionNav sections={sections} />

      {/* ═══ اليوم ═══ */}
      <DashSection id="today" title="اليوم" subtitle="المبيعات بالساعة · طرق الدفع · التوزيع" icon={<IconZap size={16} />}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="نقدي"
            value={hasDay ? <>{formatNum(cashTotal)} <span className="text-[12px] font-semibold text-slate-400">IQD</span></> : '—'}
            icon={<IconBanknote size={18} />}
            tone="ok"
            loading={cashLoading || (dayQ.isLoading && !day)}
            hint={hasDay ? `${formatNum(100 - cardShare, 0)}% من المبيعات` : 'يتطلب تحديث الخادم'}
          />
          <StatCard
            label="بطاقة"
            value={hasDay ? <>{formatNum(cardTotal)} <span className="text-[12px] font-semibold text-slate-400">IQD</span></> : '—'}
            icon={<IconWallet size={18} />}
            tone="info"
            loading={dayQ.isLoading && !day}
            hint={hasDay ? `${formatNum(day!.cardCount)} فاتورة · ${formatNum(cardShare, 0)}%` : 'يتطلب تحديث الخادم'}
          />
          <StatCard
            label="المرتجعات"
            value={d.returnsTotal != null ? <>{formatNum(d.returnsTotal)} <span className="text-[12px] font-semibold text-slate-400">IQD</span></> : '—'}
            icon={<IconReturn size={18} />}
            tone={d.returnRate > 5 ? 'danger' : 'warn'}
            loading={cashLoading}
            hint={d.returnsTotal != null ? `${formatNum(d.returnsCount)} فاتورة · ${formatNum(d.returnRate, 1)}% من الإجمالي` : 'يتطلب تحديث الخادم'}
          />
          <StatCard
            label="عدد الفواتير"
            value={formatNum(d.receipts)}
            icon={<IconReceipt size={18} />}
            tone="violet"
            loading={cashLoading}
            delta={pctChange(d.receipts, d.yReceipts) != null ? { value: pctChange(d.receipts, d.yReceipts)!, label: `أمس ${formatNum(d.yReceipts)}` } : null}
          />
        </div>

        {hasDay && (
          <div className="grid gap-4 xl:grid-cols-3">
            <HomeCard
              className="xl:col-span-2"
              title="المبيعات بالساعة"
              subtitle={<>الساعة الحالية مظللة · أمس حتى الآن <span className="font-semibold text-slate-700 num">{formatNum(yToNow)}</span> IQD</>}
              action={<CardLink to="/reports?app=peak-hours">أوقات الذروة</CardLink>}
            >
              <HourBarsChart today={day!.hourly} prev={day!.prevHourly} />
            </HomeCard>
            <HomeCard title="طرق الدفع" subtitle="نقدي مقابل بطاقة">
              <PaymentMix cash={cashTotal} card={cardTotal} returns={d.returnsTotal} cardCount={day!.cardCount} loading={cashLoading} />
            </HomeCard>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {hasDay && (
            <HomeCard
              title="توزيع مبيعات اليوم"
              action={
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  {([['section', 'القسم'], ['pos', 'نقطة البيع'], ['cashier', 'الكاشير']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBreakdownTab(id)}
                      className={`rounded-md px-2 py-1 text-[11.5px] font-semibold transition ${breakdownTab === id ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            >
              <ShareList
                rows={breakdownRows}
                empty="لا مبيعات اليوم بعد"
                prettyName={breakdownTab === 'pos' ? (n, sub) => prettyPos(n, sub ?? undefined) : undefined}
              />
            </HomeCard>
          )}
          <HomeCard title="الأكثر مبيعاً اليوم" subtitle="حسب قيمة المبيعات" action={<CardLink to="/reports?app=sales">حركة المواد</CardLink>}>
            <RankList
              loading={cashLoading}
              empty="لا توجد مبيعات اليوم بعد"
              unit="IQD"
              rows={d.topProducts.map(p => ({
                key: p.articleId,
                label: p.name || p.barcode || `#${p.articleId}`,
                value: p.soldAmount,
                sub: `${formatNum(p.soldQty)} قطعة`,
              }))}
            />
          </HomeCard>
        </div>
      </DashSection>

      {/* ═══ الأسبوع والشهر ═══ */}
      <DashSection
        id="period"
        title="الأسبوع والشهر"
        subtitle="الاتجاه والتوقع بنهاية الفترة"
        icon={<IconCalendar size={16} />}
        action={<CardLink to="/reports?app=compare">مقارنة فترتين</CardLink>}
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <HomeCard
            className="xl:col-span-2"
            title="مبيعات الأسبوع"
            subtitle="هذا الأسبوع مقابل الأسبوع السابق يوماً بيوم"
            action={<CardLink to="/reports?app=sales">تقرير المبيعات</CardLink>}
          >
            <WeekBarsChart days={d.weekDays} prev={d.prevDays} today={d.today} loading={cashLoading} />
          </HomeCard>
          <div className="grid gap-3">
            <PeriodProgress
              label="الأسبوع الحالي"
              total={d.weekTotal}
              receipts={d.weekReceipts}
              compareTotal={prevWeekToDate}
              compareLabel="عن نفس الأيام سابقاً"
              elapsed={d.weekProgressInfo.elapsed}
              days={d.weekProgressInfo.total}
              forecast={weekForecast}
              best={d.bestWeekDay}
              loading={cashLoading}
            />
            <PeriodProgress
              label="الشهر الحالي"
              total={d.monthTotal}
              receipts={d.monthReceipts}
              compareTotal={d.prevMonthToDate}
              compareLabel="عن الشهر السابق لنفس اليوم"
              elapsed={d.monthProgressInfo.elapsed}
              days={d.monthProgressInfo.total}
              forecast={monthForecast}
              loading={d.monthLoading}
            />
          </div>
        </div>
        <HomeCard title="أيام الشهر" subtitle="الخط المتقطع = متوسط اليوم في هذا الشهر · الأغمق فوق المتوسط">
          <MonthDailyBars days={d.monthDays} today={d.today} loading={d.monthLoading} />
        </HomeCard>
      </DashSection>

      {/* ═══ الفريق ═══ */}
      <DashSection
        id="team"
        title="الفريق والحوافز"
        subtitle="البائعون · الأهداف · العمولات"
        icon={<IconUsers size={16} />}
        action={<CardLink to="/salesmen">كل البائعين</CardLink>}
      >
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <HomeCard
            title="أفضل البائعين"
            subtitle="حسب قيمة المبيعات"
            action={
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {([['today', 'اليوم'], ['week', 'الأسبوع']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSellersRange(id)}
                    className={`rounded-md px-2 py-1 text-[11.5px] font-semibold transition ${sellersRange === id ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <RankList
              loading={cashLoading}
              empty={sellersRange === 'today' ? 'لم يسجّل أي بائع مبيعات اليوم' : 'لا مبيعات للبائعين هذا الأسبوع'}
              unit="IQD"
              rows={sellerRows}
            />
          </HomeCard>
          <HomeCard title="أهداف متعثرة" subtitle="دون 70% من هدف الأسبوع" action={<CardLink to="/reports?app=targets">تقرير الأهداف</CardLink>}>
            <TargetRiskList rows={d.atRiskTargets} onTrack={d.onTrackCount} loading={d.targetsLoading} />
          </HomeCard>
          <HomeCard
            title="العمولات"
            subtitle="الأسبوع الحالي"
            className="lg:col-span-2 xl:col-span-1"
            action={<CardLink to="/reports?app=settlement">كشف التسليم</CardLink>}
          >
            <CommissionDueList
              rows={d.topCommDue}
              total={d.commDue}
              count={d.commDueCount}
              weekCommission={d.weekCommission}
              loading={d.commLoading}
            />
          </HomeCard>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12px] text-slate-600">
          <IconPercent size={15} className="text-violet-600" />
          <span>
            العروض: <b className="num text-header">{formatNum(d.activeOffers)}</b> مفعّل
            {d.inactiveOffers > 0 && <> · <span className="num">{formatNum(d.inactiveOffers)}</span> متوقف</>}
          </span>
          <span className="flex-1" />
          <CardLink to="/reports?app=offer-sales">مبيعات العروض</CardLink>
          <CardLink to="/offers">إدارة العروض</CardLink>
        </div>
      </DashSection>

      {/* ═══ الأجهزة والمزامنة ═══ */}
      <DashSection
        id="system"
        title="الأجهزة والمزامنة"
        subtitle="الأداري · نقاط البيع · ترحيل الفواتير"
        icon={<IconMonitor size={16} />}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <SyncTile
            icon={<IconDownload size={18} />}
            title="جلب من الأداري"
            detail={
              edari
                ? <>آخر جلب <b className="num">{lastPull ?? '—'}</b> · {edari.autoSyncEnabled ? `تلقائي كل ${formatNum(pullMinutes)} د` : 'التلقائي متوقف'}</>
                : 'جاري قراءة الحالة…'
            }
            statusTone={edariOk ? 'ok' : edari ? 'bad' : 'idle'}
            statusText={edariOk ? 'متصل' : edari ? 'غير متصل' : '…'}
            actionLabel="جلب الآن"
            loading={pullFromEdari.isPending}
            onAction={() => pullFromEdari.mutate()}
          />
          <SyncTile
            icon={<IconUpload size={18} />}
            title="رفع لنقاط البيع"
            detail={<><b className="num">{formatNum(d.onlineTerminals)}</b> من <span className="num">{formatNum(d.terminals.length)}</span> نقطة متصلة</>}
            statusTone={d.onlineTerminals > 0 ? 'ok' : d.terminals.length ? 'bad' : 'idle'}
            statusText={d.onlineTerminals > 0 ? 'جاهز' : 'لا أجهزة متصلة'}
            actionLabel="رفع الآن"
            loading={pushToPos.isPending}
            disabled={!online}
            onAction={() => pushToPos.mutate()}
          />
          <SyncTile
            icon={<IconSend size={18} />}
            title="ترحيل الفواتير"
            detail={<>بانتظار <b className="num">{formatNum(d.unsynced)}</b> · فشل <b className="num">{formatNum(d.failed)}</b>{dead ? <> · متوقفة <b className="num">{formatNum(dead)}</b></> : null}</>}
            statusTone={d.failed > 0 || dead > 0 ? 'bad' : d.unsynced > 0 ? 'warn' : 'ok'}
            statusText={d.failed > 0 || dead > 0 ? 'يحتاج متابعة' : d.unsynced > 0 ? 'بانتظار' : 'مكتمل'}
            actionLabel={d.unsynced > 0 ? `ترحيل (${formatNum(d.unsynced)})` : 'ترحيل الآن'}
            loading={syncReceipts.isPending}
            onAction={() => syncReceipts.mutate()}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <HomeCard
            className="xl:col-span-2"
            title="نقاط البيع"
            subtitle={`${formatNum(d.onlineTerminals)} متصلة من ${formatNum(d.terminals.length)}`}
            action={<CardLink to="/terminals">إدارة الأجهزة</CardLink>}
          >
            <TerminalGrid terminals={d.terminals} loading={d.terminalsQ.isLoading && !d.terminalsQ.data} />
          </HomeCard>
          <HomeCard title="صحة النظام" subtitle="الربط والأجهزة والوتيرة">
            <div className="flex items-center gap-4 px-4 pb-2">
              <HealthRing score={d.health} label={healthLabel(d.health)} />
              <div className="min-w-0 flex-1 space-y-1.5">
                {d.healthItems.map(h => (
                  <div key={h.id}>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{h.label}</span>
                      <span className="num">{h.score}/{h.max}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${h.tone}`} style={{ width: `${(h.score / h.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-0.5 px-2 pb-2">
              <StatusLine
                to="/edari"
                icon={<IconCloud size={16} />}
                label="الأداري"
                tone={edariOk ? 'ok' : edari ? 'bad' : 'idle'}
                value={
                  edari
                    ? `${edariOk ? 'متصل' : 'غير متصل'}${edari.databaseAlias ? ` · ${edari.databaseAlias}` : ''} · آخر جلب ${lastPull ?? '—'}`
                    : 'جاري قراءة الحالة…'
                }
              />
              <StatusLine
                to="/system"
                icon={<IconChart size={16} />}
                label="تشخيص كامل"
                tone="idle"
                value="الأخطاء والسجلات وقاعدة البيانات"
              />
            </div>
          </HomeCard>
        </div>

        {serverHost && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12px] leading-6 text-slate-600">
            الخادم يعمل في الخلفية مع ويندوز حتى لو أغلقت هذه النافذة — افتح لوحة التحكم من الاختصار عندما تحتاجها.
          </p>
        )}
      </DashSection>

      {/* ═══ الفواتير ═══ */}
      <DashSection
        id="receipts"
        title="الفواتير والأدوات"
        subtitle={`بيع ${formatNum(d.kindCounts.sale)} · مرتجع ${formatNum(d.kindCounts.return)} · هدية ${formatNum(d.kindCounts.gift)} في آخر الفواتير`}
        icon={<IconReceipt size={16} />}
        action={<CardLink to="/receipts">كل الفواتير</CardLink>}
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <HomeCard className="xl:col-span-2" title="آخر الفواتير" action={<CardLink to="/receipts">بحث متقدم</CardLink>}>
            <RecentReceiptsList rows={d.recentQ.data ?? []} loading={d.recentQ.isLoading} />
          </HomeCard>
          <HomeCard
            title="الفواتير المعلّقة"
            subtitle={d.holdCount ? `${formatNum(d.holdCount)} بانتظار الإكمال` : 'لا شيء معلّق'}
            action={d.holdCount ? <CardLink to="/receipts?hold=1">إكمال</CardLink> : undefined}
          >
            <HoldsList rows={d.holds} />
          </HomeCard>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ProductOfferSearch />
          </div>
          <HomeCard title="وصول سريع">
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {QUICK_ACTIONS.map(a => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="group flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 p-2.5 text-center transition hover:-translate-y-px hover:border-brand-200 hover:shadow-[var(--shadow-lift)]"
                >
                  <span className={`icon-tile h-9 w-9 rounded-xl ${a.tone}`}><a.icon size={17} /></span>
                  <span className="text-[11px] font-semibold text-slate-700">{a.label}</span>
                </Link>
              ))}
            </div>
          </HomeCard>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <IconInfo size={12} /> اضغط عنوان أي قسم لطيّه — يُحفظ ترتيبك على هذا الجهاز
        </p>
      </DashSection>
    </div>
  );
}
