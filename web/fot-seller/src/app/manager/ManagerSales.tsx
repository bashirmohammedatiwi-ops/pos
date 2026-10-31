import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CountUp, Delta, Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, Switch, fmt, toast } from '../kit';
import { haptic } from '../native';
import { onLive, salesApi, type SalesAlerts, type SaleHour, type SaleNamed, type SalePack, type SaleReceipt, type SalesDay, type SalesRange, type SaleTerminal } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * مبيعات المحل للمدير:
 *   مباشر  — رقم اليوم يتحرك مع كل فاتورة، مقارنة بأمس وبنفس اليوم من الأسبوع الماضي في نفس الساعة،
 *            توقّع الإغلاق، الساعات، الدفع، الأقسام، نقاط البيع، الكاشيرية، البائعون، المنتجات، الفواتير.
 *   يوم    — أي يوم سابق بنفس التفصيل مع تقويم ملوّن بحجم المبيعات.
 *   فترات  — 7/30/90 يوماً، هذا الشهر، الشهر الماضي، السنة: الاتجاه، أيام الأسبوع، ساعات الذروة.
 * أوقات السيرفر محلية (بغداد) بلا منطقة زمنية.
 * ───────────────────────────────────────────────────────────────────────────── */

const LOC = 'ar-IQ-u-nu-latn';
const WD = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/** وقت محلي من السيرفر (بلا منطقة) ← بتوقيت بغداد */
const iraqMs = (s?: string | null) => (s ? Date.parse(/(?:[zZ]|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}+03:00`) : NaN);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 0 = السبت … 6 = الجمعة */
const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7;
const dayTitle = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(LOC, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};
const monthTitle = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(LOC, { timeZone: 'UTC', month: 'long', year: 'numeric' });
const clock = (s?: string | null) => {
  const t = iraqMs(s);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString(LOC, { timeZone: 'Asia/Baghdad', hour: 'numeric', minute: '2-digit', hour12: true });
};
const hourLabel = (h: number) => (h === 0 ? '12ص' : h < 12 ? `${h}ص` : h === 12 ? '12م' : `${h - 12}م`);
const hourRange = (h: number) => `${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`;
function ago(s?: string | null, nowMs = Date.now()) {
  const t = iraqMs(s);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 45) return 'الآن';
  const m = Math.round(sec / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  return h < 24 ? `قبل ${h} س${m % 60 ? ` ${m % 60} د` : ''}` : `قبل ${Math.round(h / 24)} يوم`;
}
/** مبلغ مختصر: 22.2 مليون · 850 ألف */
export function compact(n: number) {
  const a = Math.abs(n);
  const trim = (x: number, d: number) => x.toFixed(d).replace(/\.0+$/, '');
  if (a >= 1e9) return `${trim(n / 1e9, a >= 1e10 ? 0 : 1)} مليار`;
  if (a >= 1e6) return `${trim(n / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)} مليون`;
  if (a >= 1e3) return `${Math.round(n / 1e3)} ألف`;
  return fmt(n);
}
const share = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const pctText = (a: number, b: number) => `${Math.round(share(a, b))}%`;
/** نقطة البيع: الاسم التقني (win:…) يُستبدل برقم مقروء */
const posName = (name?: string | null, id?: number) => (!name || /^win:|^[0-9a-f-]{20,}$/i.test(name) || name === '—' ? `نقطة بيع ${id ?? ''}`.trim() : name);
const sellerName = (r: SaleNamed) => (r.id ? r.name.replace(/^\d+\s*-\s*/, '') : 'بلا بائع');

/** مجموع الساعات حتى ساعة/دقيقة معيّنة (لمقارنة «نفس الوقت») */
function cumUntil(hours: SaleHour[] | undefined, h: number, frac: number) {
  let t = 0;
  for (const x of hours || []) {
    if (x.h < h) t += x.t;
    else if (x.h === h) t += x.t * frac;
  }
  return t;
}
function cumCount(hours: SaleHour[] | undefined, h: number, frac: number) {
  let n = 0;
  for (const x of hours || []) {
    if (x.h < h) n += x.n;
    else if (x.h === h) n += x.n * frac;
  }
  return n;
}
function nowOf(v: SalesDay) {
  const t = iraqMs(v.at);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 3 * 3600_000);
  return { h: d.getUTCHours(), frac: d.getUTCMinutes() / 60 };
}

/* ═════════════ الشاشة ═════════════ */
type View = 'live' | 'day' | 'range';

export function MSales() {
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('v') as View) || 'live';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };
  const refresh = useRef<() => Promise<unknown>>(() => Promise.resolve());
  const [alerts, setAlerts] = useState(false);
  return (
    <Screen
      title="المبيعات"
      subtitle={view === 'live' ? <LiveTag /> : view === 'day' ? 'تفصيل يوم كامل' : 'الاتجاهات والمقارنات'}
      onRefresh={() => refresh.current()}
      end={
        <button type="button" className="t-icon-btn press" aria-label="تنبيهات المبيعات" onClick={() => (haptic('tap'), setAlerts(true))}>
          <I.bell size={20} />
        </button>
      }
    >
      <div className="s-switch">
        <Segmented
          items={[
            { id: 'live', label: 'اليوم' },
            { id: 'day', label: 'يوم سابق' },
            { id: 'range', label: 'فترات' },
          ]}
          value={view}
          onChange={v => set({ v })}
        />
      </div>
      {view === 'live' && <LiveView bindRefresh={f => (refresh.current = f)} />}
      {view === 'day' && <DayView day={sp.get('d')} onDay={d => set({ d })} bindRefresh={f => (refresh.current = f)} />}
      {view === 'range' && <RangeView preset={(sp.get('r') as Preset) || '30'} onPreset={r => set({ r })} onDay={d => set({ v: 'day', d })} bindRefresh={f => (refresh.current = f)} />}
      <AlertsSheet open={alerts} onClose={() => setAlerts(false)} />
    </Screen>
  );
}

/** إعدادات تنبيهات المتابعة (تصل لكل مدير يملك صلاحية المبيعات) */
function AlertsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<SalesAlerts | null>(null);
  useEffect(() => {
    if (open) void salesApi.alerts().then(setS).catch(e => toast(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, [open]);
  const toggle = (k: 'terminalOffline' | 'slowPace' | 'dailyClose', label: string, hint: string) =>
    s && (
      <div className="t-check" style={{ cursor: 'default' }}>
        <span style={{ flex: 1 }}>
          <b style={{ display: 'block', fontWeight: 600 }}>{label}</b>
          <small style={{ color: 'var(--ink-3)' }}>{hint}</small>
        </span>
        <Switch label={label} on={s[k]} onChange={v => setS({ ...s, [k]: v })} />
      </div>
    );
  return (
    <Sheet open={open} onClose={onClose} title="تنبيهات المبيعات" subtitle="تصل في «التبليغات» لكل من يملك صلاحية المبيعات">
      {!s ? (
        <Skeleton h={260} r={16} />
      ) : (
        <>
          <label className="t-field" style={{ marginBottom: 10 }}>
            <span>فاتورة كبيرة من (د.ع) — 0 للإيقاف</span>
            <input className="t-input sm num" inputMode="numeric" value={s.bigSale} onChange={e => setS({ ...s, bigSale: Number(e.target.value.replace(/\D/g, '')) })} />
          </label>
          <label className="t-field" style={{ marginBottom: 10 }}>
            <span>مرتجع كبير من (د.ع) — 0 للإيقاف</span>
            <input className="t-input sm num" inputMode="numeric" value={s.bigReturn} onChange={e => setS({ ...s, bigReturn: Number(e.target.value.replace(/\D/g, '')) })} />
          </label>
          {toggle('terminalOffline', 'انقطاع نقطة بيع', 'نقطة باعت اليوم وانقطعت أكثر من 15 دقيقة')}
          {toggle('slowPace', 'مبيعات أبطأ من المعتاد', 'أقل من 70% من معدل نفس اليوم والوقت (بعد 2 ظهراً)')}
          {toggle('dailyClose', 'ملخص إغلاق اليوم', 'مرة واحدة يومياً')}
          {s.dailyClose && (
            <label className="t-field" style={{ marginTop: 6 }}>
              <span>وقت ملخص الإغلاق</span>
              <input className="t-input sm" type="time" value={s.closeAt} onChange={e => e.target.value && setS({ ...s, closeAt: e.target.value })} />
            </label>
          )}
          <button
            type="button"
            className="t-btn block press"
            style={{ marginTop: 14 }}
            onClick={() =>
              void salesApi
                .saveAlerts(s)
                .then(() => {
                  haptic('success');
                  toast('حُفظت التنبيهات');
                  onClose();
                })
                .catch(e => toast(e instanceof Error ? e.message : 'تعذر الحفظ'))
            }
          >
            حفظ
          </button>
        </>
      )}
    </Sheet>
  );
}

/** كشف Excel ليوم أو فترة */
async function exportSales(title: string, d: { totals: SalePack['totals']; sections: SaleNamed[]; cashiers: SaleNamed[]; sellers: SaleNamed[]; products: SaleNamed[] }, days?: SalesRange['days']) {
  const { downloadXlsxFile } = await import('../../xlsx');
  const t = d.totals;
  const sheet = (name: string, head: string[], rows: (string | number)[][], widths: number[]) => ({
    name,
    rtl: true,
    columnWidths: widths,
    rows: [
      { height: 28, cells: [{ value: `${name} — ${title}`, style: 'title', mergeAcross: head.length - 1 }] },
      { height: 22, cells: head.map(value => ({ value, style: 'head' })) },
      ...rows.map(r => ({ cells: r.map(value => (typeof value === 'number' ? { value: Math.round(value), style: 'num', type: 'Number' as const } : { value, style: 'text' })) })),
    ],
  });
  const named = (rows: SaleNamed[], fn: (r: SaleNamed) => string = r => r.name) => rows.map(r => [fn(r), r.t, r.n, r.q]);
  downloadXlsxFile(
    `مبيعات-${title}`.replace(/[\\/:*?"<>|]+/g, '-'),
    [
      sheet(
        'الملخص',
        ['البند', 'القيمة'],
        [
          ['صافي المبيعات', t.net],
          ['المبيعات قبل المرتجعات', t.gross],
          ['الفواتير', t.receipts],
          ['القطع', t.pieces],
          ['نقداً', t.net - t.cardTotal],
          ['بطاقة', t.cardTotal],
          ['المرتجعات', t.returnsTotal],
          ['عدد المرتجعات', t.returnsCount],
          ['خصم العروض', t.offersDiscount],
          ['الخصم اليدوي', t.userDiscount],
          ['فواتير الهدايا', t.gifts],
        ],
        [220, 140],
      ),
      ...(days ? [sheet('الأيام', ['اليوم', 'الصافي', 'الفواتير', 'القطع', 'المرتجعات'], days.map(x => [x.day, x.net, x.receipts, x.pieces, x.returnsTotal]), [110, 120, 80, 80, 100])] : []),
      sheet('الأقسام', ['القسم', 'الصافي', 'الفواتير', '—'], named(d.sections), [200, 120, 80, 60]),
      sheet('الكاشيرية', ['الكاشير', 'الصافي', 'الفواتير', 'المرتجعات', 'الخصم اليدوي', 'عمليات الحذف', 'قيمة الحذف'], d.cashiers.map(r => [r.name, r.t, r.n, r.q, r.d ?? 0, r.v ?? 0, r.va ?? 0]), [160, 120, 80, 80, 100, 100, 100]),
      sheet('البائعون', ['البائع', 'الصافي', 'الفواتير', 'القطع'], named(d.sellers, sellerName), [200, 120, 80, 80]),
      sheet('المنتجات', ['المنتج', 'الباركود', 'الصافي', 'القطع', 'الفواتير'], d.products.map(r => [r.name, r.barcode ?? '', r.t, r.q, r.n]), [300, 130, 110, 70, 70]),
    ],
    [
      { id: 'title', fontSize: 14, bold: true, color: 'FFFFFF', bg: '4C2A85', align: 'center', valign: 'center' },
      { id: 'head', fontSize: 10, bold: true, color: 'FFFFFF', bg: '6D45C9', align: 'center', valign: 'center', wrap: true, border: 'thin' },
      { id: 'text', fontSize: 10, valign: 'center', border: 'thin' },
      { id: 'num', fontSize: 10, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
    ],
  );
}

function ExportBtn({ run }: { run: () => Promise<void> }) {
  return (
    <button
      type="button"
      className="t-btn soft block sm press"
      style={{ marginTop: 16 }}
      onClick={() => {
        haptic('tap');
        void run().catch(() => toast('تعذر تجهيز الكشف'));
      }}
    >
      <I.sheet size={18} /> مشاركة كشف Excel
    </button>
  );
}

function LiveTag() {
  return (
    <span className="s-live-tag">
      <i /> مباشر من الكاشيرية
    </span>
  );
}

/* ═════════════ اليوم مباشر ═════════════ */
/** بيانات اليوم مع تحديث حي: حدث «sales» من الخادم مع كل فاتورة + احتياط كل دقيقة */
function useLiveDay() {
  const [data, setData] = useState<SalesDay | null>(null);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const timer = useRef(0);
  const load = async () => {
    try {
      setData(await salesApi.live());
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    }
  };
  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 60_000);
    const off = onLive(m => {
      if (m.event !== 'sales') return;
      if (m.data.fresh?.length) {
        haptic('tap');
        setFresh(new Set(m.data.fresh.map(r => r.id)));
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(), 500);
    });
    return () => {
      off();
      window.clearInterval(poll);
      window.clearTimeout(timer.current);
    };
  }, []);
  return { data, err, reload: load, fresh };
}

function LiveView({ bindRefresh }: { bindRefresh: (f: () => Promise<unknown>) => void }) {
  const { data, err, reload, fresh } = useLiveDay();
  bindRefresh(reload);
  useTick(15_000);
  if (err && !data) return <ErrorLine text={err} onRetry={() => void reload()} />;
  if (!data) return <SalesSkeleton />;
  return <DayBody v={data} live fresh={fresh} />;
}

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set(x => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

function SalesSkeleton() {
  return (
    <>
      <Skeleton h={210} r={26} />
      <Skeleton h={92} r={20} mt={12} />
      <Skeleton h={190} r={20} mt={12} />
    </>
  );
}

/* ═════════════ يوم سابق ═════════════ */
function DayView({ day, onDay, bindRefresh }: { day: string | null; onDay: (d: string) => void; bindRefresh: (f: () => Promise<unknown>) => void }) {
  const [data, setData] = useState<SalesDay | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [cal, setCal] = useState(false);
  const target = day || '';
  const load = async () => {
    setLoading(true);
    try {
      // بلا تاريخ: أمس (اليوم الحالي في «اليوم»)
      const live = target ? null : await salesApi.live();
      const d = target || (live ? addDays(live.day, -1) : '');
      setData(await salesApi.day(d));
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  };
  bindRefresh(load);
  useEffect(() => {
    void load();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  // اليوم الحالي داخل «يوم سابق» يتحدث حياً أيضاً
  useEffect(() => {
    if (!data?.isToday) return;
    return onLive(m => m.event === 'sales' && void salesApi.day(data.day).then(setData).catch(() => undefined));
  }, [data?.isToday, data?.day]);

  const cur = data?.day || target;
  const max = data?.bounds.max;
  const min = data?.bounds.min;
  return (
    <>
      <div className="s-daynav">
        <button type="button" className="t-icon-btn press" aria-label="اليوم السابق" disabled={!cur || (!!min && cur <= min)} onClick={() => cur && onDay(addDays(cur, -1))}>
          <I.chevron size={20} />
        </button>
        <button type="button" className="s-daynav-date press" onClick={() => setCal(true)}>
          <I.calendar size={17} />
          <span>{cur ? dayTitle(cur) : '…'}</span>
        </button>
        <button type="button" className="t-icon-btn press" aria-label="اليوم التالي" style={{ transform: 'scaleX(-1)' }} disabled={!cur || !max || cur >= max} onClick={() => cur && onDay(addDays(cur, 1))}>
          <I.chevron size={20} />
        </button>
      </div>
      {err && !data && <ErrorLine text={err} onRetry={() => void load()} />}
      {loading && !data ? <SalesSkeleton /> : data ? <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}><DayBody v={data} live={data.isToday} /></div> : null}
      <CalendarSheet open={cal} onClose={() => setCal(false)} value={cur} max={max} min={min} onPick={d => (setCal(false), onDay(d))} />
    </>
  );
}

/* ═════════════ جسم اليوم (مشترك) ═════════════ */
function DayBody({ v, live, fresh }: { v: SalesDay; live?: boolean; fresh?: Set<number> }) {
  const p = v.pack;
  const nav = useNavigate();
  if (!p || (!p.totals.receipts && !p.totals.net)) {
    return (
      <Empty
        icon={<I.receipt size={30} />}
        title={live ? 'لا مبيعات بعد اليوم' : 'لا مبيعات مسجّلة لهذا اليوم'}
        text={live ? 'تظهر الأرقام هنا مع أول فاتورة من الكاشيرية.' : v.bounds.min && v.day < v.bounds.min ? 'هذا اليوم أقدم من بداية سجل المبيعات.' : 'المحل كان مغلقاً أو لم تُرفع مبيعاته بعد.'}
        action={!live ? <button type="button" className="t-btn sm press" onClick={() => nav('/m/sales?v=live', { replace: true })}>مبيعات اليوم</button> : undefined}
      />
    );
  }
  const t = p.totals;
  const now = live ? nowOf(v) : null;
  // مقارنة عادلة: اليوم حتى الآن مقابل نفس الوقت أمس/الأسبوع الماضي
  const prevNet = v.compare.prev ? (now ? cumUntil(v.compare.prev.hours, now.h, now.frac) : v.compare.prev.totals.net) : 0;
  const weekNet = v.compare.lastWeek ? (now ? cumUntil(v.compare.lastWeek.hours, now.h, now.frac) : v.compare.lastWeek.totals.net) : 0;
  const avg = v.compare.avg4;
  const avgSoFar = avg && now ? cumUntil(avg.hours, now.h, now.frac) : 0;
  const projected = avg && now && avgSoFar > avg.net * 0.12 ? (t.net / avgSoFar) * avg.net : null;
  const avgTicket = t.receipts ? t.net / t.receipts : 0;
  const prevT = v.compare.prev?.totals;
  // أثناء اليوم تُقارن الفواتير بأمس حتى الوقت نفسه؛ القطع لا تتوفر بالساعة فلا تُقارن
  const prevReceipts = v.compare.prev ? (now ? cumCount(v.compare.prev.hours, now.h, now.frac) : (prevT?.receipts ?? 0)) : 0;
  const cash = t.net - t.cardTotal;

  return (
    <>
      <section className="t-hero s-hero">
        <div className="t-hero-row">
          <p className="kicker">
            {live ? (
              <span className="s-pulse">
                <i /> مباشر · {clock(v.at)}
              </span>
            ) : (
              dayTitle(v.day)
            )}
          </p>
          {live && v.at && <span className="t-chip-glass">آخر فاتورة {ago(t.lastAt)}</span>}
        </div>
        <div className="amount">
          <CountUp value={t.net} />
          <small>د.ع</small>
        </div>
        <div className="s-hero-cmp">
          {v.compare.prev && (
            <span>
              <Delta now={t.net} prev={prevNet} glass /> {live ? 'عن أمس بنفس الوقت' : 'عن اليوم السابق'}
            </span>
          )}
          {v.compare.lastWeek && (
            <span>
              <Delta now={t.net} prev={weekNet} glass /> عن {WD[weekdayOf(v.day)]} الماضي{live ? ' بنفس الوقت' : ''}
            </span>
          )}
        </div>
        {projected != null && (
          <div className="s-forecast">
            <div className="s-forecast-top">
              <span>المتوقع حتى الإغلاق</span>
              <b className="num">≈ {compact(projected)}</b>
            </div>
            <div className="t-track" style={{ background: 'rgba(255,255,255,.16)' }}>
              <i style={{ width: `${Math.min(100, share(t.net, projected))}%`, background: '#F0B04F' }} />
            </div>
            <small>حسب شكل آخر {avg?.weeks} {WD[weekdayOf(v.day)]} · تحقق {pctText(t.net, projected)}</small>
          </div>
        )}
        {!live && t.firstAt && (
          <div className="meta">
            <span>
              أول فاتورة <b className="num">{clock(t.firstAt)}</b>
            </span>
            <span>
              آخر فاتورة <b className="num">{clock(t.lastAt)}</b>
            </span>
          </div>
        )}
      </section>

      <div className="s-kpis">
        <Kpi label="الفواتير" value={fmt(t.receipts)} cmp={prevT ? <Delta now={t.receipts} prev={prevReceipts} /> : null} />
        <Kpi label="متوسط الفاتورة" value={fmt(avgTicket)} unit="د.ع" cmp={prevT && prevT.receipts && !now ? <Delta now={avgTicket} prev={prevT.net / prevT.receipts} /> : null} />
        <Kpi label="القطع المباعة" value={fmt(t.pieces)} cmp={prevT && !now ? <Delta now={t.pieces} prev={prevT.pieces} /> : null} />
        <Kpi label="قطعة لكل فاتورة" value={t.receipts ? (t.pieces / t.receipts).toFixed(1) : '0'} />
      </div>

      <section className="t-section">
        <div className="t-section-head">
          <h2>سير اليوم بالساعة</h2>
          <small>{peakText(p.hours)}</small>
        </div>
        <div className="t-card pad">
          <HourChart hours={p.hours} compare={v.compare.prev?.hours} avg={avg?.hours} nowHour={now?.h} />
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>الدفع والتعديلات</h2>
        </div>
        <div className="t-card pad s-pay">
          <div className="s-split">
            <i className="cash" style={{ width: `${Math.max(0, share(cash, t.net))}%` }} />
            <i className="card" style={{ width: `${Math.max(0, share(t.cardTotal, t.net))}%` }} />
          </div>
          <div className="s-split-legend">
            <span>
              <i className="cash" /> نقداً <b className="num">{compact(cash)}</b> <small className="num">{pctText(cash, t.net)}</small>
            </span>
            <span>
              <i className="card" /> بطاقة <b className="num">{compact(t.cardTotal)}</b> <small className="num">{t.cardCount} فاتورة</small>
            </span>
          </div>
          <div className="s-adj">
            <Adj label="خصم العروض" value={t.offersDiscount} />
            <Adj label="خصم يدوي" value={t.userDiscount} warn={t.userDiscount > t.net * 0.01} />
            {t.itemsDiscount > 0 && <Adj label="خصم المواد" value={t.itemsDiscount} />}
            <Adj label={`المرتجعات (${t.returnsCount})`} value={t.returnsTotal} warn={t.returnsTotal > t.net * 0.02} />
            {t.gifts > 0 && <Adj label="فواتير هدايا" value={t.gifts} count />}
            <Adj label="المبيعات قبل المرتجعات" value={t.gross} plain />
          </div>
        </div>
      </section>

      {p.sections.length > 1 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>الأقسام</h2>
          </div>
          <RankList rows={p.sections} total={t.net} name={r => r.name} sub={r => `${fmt(r.n)} فاتورة`} />
        </section>
      )}

      {live && v.terminalsLive.length > 0 ? (
        <section className="t-section">
          <div className="t-section-head">
            <h2>نقاط البيع الآن</h2>
            <small>{v.terminalsLive.filter(x => isOnline(x, v.at)).length} متصلة</small>
          </div>
          <Terminals rows={v.terminalsLive} sales={p.terminals} at={v.at} />
        </section>
      ) : p.terminals.length > 1 ? (
        <section className="t-section">
          <div className="t-section-head">
            <h2>نقاط البيع</h2>
          </div>
          <RankList rows={p.terminals} total={t.net} name={r => posName(r.name, r.id)} sub={r => `${r.sub ? `${r.sub} · ` : ''}${fmt(r.n)} فاتورة`} />
        </section>
      ) : null}

      <section className="t-section">
        <div className="t-section-head">
          <h2>الكاشيرية</h2>
          <small>{p.cashiers.length}</small>
        </div>
        <RankList
          rows={p.cashiers}
          total={t.net}
          name={r => r.name}
          sub={r => cashierSub(r, live)}
        />
      </section>

      <section className="t-section">
        <SellersBlock rows={p.sellers} total={t.net} />
      </section>

      <section className="t-section">
        <ProductsBlock rows={p.products} />
      </section>

      {live && v.recent.length > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>آخر الفواتير</h2>
            <small className="s-pulse dark">
              <i /> تتحدث تلقائياً
            </small>
          </div>
          <ReceiptFeed rows={v.recent} fresh={fresh} />
        </section>
      )}

      <ExportBtn run={() => exportSales(dayTitle(v.day), p)} />

      <p className="s-foot">
        {live ? `آخر تحديث من المحل ${ago(v.at)} · ` : ''}الصافي = المبيعات − المرتجعات · الهدايا لا تدخل في المبيعات
      </p>
    </>
  );
}

/** سطر الكاشير: الفواتير والمرتجعات والخصم اليدوي وعمليات الحذف (للمتابعة) */
function cashierSub(r: SaleNamed, live?: boolean) {
  const parts = [`${fmt(r.n)} فاتورة`];
  if (r.q) parts.push(`${fmt(r.q)} مرتجع`);
  if (r.d) parts.push(`خصم يدوي ${compact(r.d)}`);
  if (r.v) parts.push(`${fmt(r.v)} حذف (${compact(r.va ?? 0)})`);
  if (r.days && r.days > 1) parts.push(`${r.days} يوم`);
  if (live && r.lastAt) parts.push(ago(r.lastAt));
  return parts.join(' · ');
}

function Kpi({ label, value, unit, cmp }: { label: string; value: string; unit?: string; cmp?: ReactNode }) {
  return (
    <div className="s-kpi">
      <span>{label}</span>
      <b className="num">
        {value}
        {unit && <small> {unit}</small>}
      </b>
      {cmp}
    </div>
  );
}

function Adj({ label, value, warn, count, plain }: { label: string; value: number; warn?: boolean; count?: boolean; plain?: boolean }) {
  return (
    <div className={`s-adj-row ${warn ? 'warn' : ''}`}>
      <span>{label}</span>
      <b className="num">{count ? fmt(value) : `${plain ? '' : value ? '−' : ''}${fmt(value)}`}</b>
    </div>
  );
}

function peakText(hours: SaleHour[]) {
  const top = [...hours].sort((a, b) => b.t - a.t)[0];
  return top && top.t > 0 ? `الذروة ${hourRange(top.h)}` : '';
}

/* ═════════════ مخطط الساعات ═════════════ */
function HourChart({ hours, compare, avg, nowHour }: { hours: SaleHour[]; compare?: SaleHour[]; avg?: SaleHour[]; nowHour?: number }) {
  const [pick, setPick] = useState<number | null>(null);
  const val = (list: SaleHour[] | undefined, h: number) => list?.find(x => x.h === h)?.t ?? 0;
  const cnt = (list: SaleHour[] | undefined, h: number) => list?.find(x => x.h === h)?.n ?? 0;
  const used = [...hours, ...(compare || []), ...(avg || [])].filter(x => x.t > 0).map(x => x.h);
  const lo = Math.min(9, ...used);
  const hi = Math.max(22, nowHour ?? 0, ...used);
  const span = hi - lo + 1;
  const max = Math.max(1, ...Array.from({ length: span }, (_, i) => Math.max(val(hours, lo + i), val(compare, lo + i), val(avg, lo + i)))) * 1.12;
  const W = 330;
  const H = 150;
  const top = 8;
  const base = H - 22;
  const slot = W / span;
  // من اليمين لليسار: أول ساعة على اليمين
  const xOf = (i: number) => W - (i + 0.5) * slot;
  const yOf = (t: number) => base - (t / max) * (base - top);
  const line = (list: SaleHour[] | undefined) =>
    list && list.some(x => x.t > 0)
      ? Array.from({ length: span }, (_, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(val(list, lo + i)).toFixed(1)}`).join(' ')
      : '';
  const sel = pick ?? (nowHour != null ? nowHour : [...hours].sort((a, b) => b.t - a.t)[0]?.h ?? null);
  return (
    <div className="s-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="المبيعات بالساعة">
        {[0.25, 0.5, 0.75, 1].map(k => (
          <line key={k} x1="0" x2={W} y1={yOf(max * k / 1.12)} y2={yOf(max * k / 1.12)} className="grid" />
        ))}
        {Array.from({ length: span }, (_, i) => {
          const h = lo + i;
          const t = val(hours, h);
          const bh = base - yOf(t);
          const bw = Math.max(4, slot * 0.58);
          return (
            <g key={h} onClick={() => (haptic('select'), setPick(h))} className="hit">
              <rect x={xOf(i) - slot / 2} y={0} width={slot} height={H} fill="transparent" />
              {t > 0 && <rect x={xOf(i) - bw / 2} y={yOf(t)} width={bw} height={Math.max(2, bh)} rx={Math.min(4, bw / 2)} className={`bar ${h === sel ? 'sel' : ''} ${h === nowHour ? 'now' : ''}`} />}
              {(i % (span > 9 ? 2 : 1) === 0 || h === sel) && (
                <text x={xOf(i)} y={H - 6} className={`tick ${h === sel ? 'on' : ''}`}>
                  {hourLabel(h)}
                </text>
              )}
            </g>
          );
        })}
        {avg && <path d={line(avg)} className="avg" />}
        {compare && <path d={line(compare)} className="cmp" />}
      </svg>
      {sel != null && (
        <div className="s-readout">
          <b>{hourRange(sel)}</b>
          <span className="num">
            {compact(val(hours, sel))} · {fmt(cnt(hours, sel))} فاتورة
          </span>
          {compare && <small className="num">السابق {compact(val(compare, sel))}</small>}
        </div>
      )}
      <div className="s-legend">
        <span>
          <i className="bar" /> المبيعات
        </span>
        {compare && (
          <span>
            <i className="cmp" /> اليوم السابق
          </span>
        )}
        {avg && (
          <span>
            <i className="avg" /> متوسط 4 أسابيع
          </span>
        )}
      </div>
    </div>
  );
}

/* ═════════════ القوائم المرتبة ═════════════ */
function RankList({ rows, total, name, sub, limit, onPick }: { rows: SaleNamed[]; total: number; name: (r: SaleNamed) => string; sub?: (r: SaleNamed) => string; limit?: number; onPick?: (r: SaleNamed) => void }) {
  const list = limit ? rows.slice(0, limit) : rows;
  const max = Math.max(1, ...rows.map(r => r.t));
  if (!rows.length) return <div className="t-card pad s-none">لا بيانات</div>;
  return (
    <div className="t-list s-rank">
      {list.map((r, i) => (
        <button key={`${r.id}-${i}`} type="button" className="t-row press-soft" onClick={() => onPick?.(r)} disabled={!onPick}>
          <span className={`s-pos ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
          <div className="body">
            <div className="s-rank-top">
              <span className="title">{name(r)}</span>
              <b className="num">{compact(r.t)}</b>
            </div>
            <div className="s-bar">
              <i style={{ width: `${Math.max(2, (r.t / max) * 100)}%` }} />
            </div>
            <div className="s-rank-sub">
              <span>{sub?.(r)}</span>
              <span className="num">{pctText(r.t, total)}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function SellersBlock({ rows, total }: { rows: SaleNamed[]; total: number }) {
  const [all, setAll] = useState(false);
  const [pick, setPick] = useState<SaleNamed | null>(null);
  const sub = (r: SaleNamed) => `${fmt(r.n)} فاتورة · ${fmt(r.q)} قطعة${r.days && r.days > 1 ? ` · ${r.days} يوم` : ''}`;
  return (
    <>
      <div className="t-section-head">
        <h2>البائعون</h2>
        {rows.length > 8 && (
          <button type="button" className="more" onClick={() => setAll(true)}>
            الكل ({rows.length})
          </button>
        )}
      </div>
      <RankList rows={rows} total={total} name={sellerName} sub={sub} limit={8} onPick={setPick} />
      <Sheet open={all} onClose={() => setAll(false)} title="كل البائعين" subtitle={`${rows.length} بائع`}>
        <RankList rows={rows} total={total} name={sellerName} sub={sub} onPick={r => (setAll(false), setPick(r))} />
      </Sheet>
      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick ? sellerName(pick) : ''} subtitle={pick && !pick.id ? 'فواتير بلا بائع محدد' : 'أداء البائع'}>
        {pick && (
          <div className="s-detail">
            <Stat label="المبيعات" value={fmt(pick.t)} unit="د.ع" />
            <Stat label="الحصة من المحل" value={pctText(pick.t, total)} />
            <Stat label="الفواتير" value={fmt(pick.n)} />
            <Stat label="القطع" value={fmt(pick.q)} />
            <Stat label="متوسط الفاتورة" value={fmt(pick.n ? pick.t / pick.n : 0)} unit="د.ع" />
            <Stat label="قطعة لكل فاتورة" value={pick.n ? (pick.q / pick.n).toFixed(1) : '0'} />
            {pick.lastAt && <Stat label="آخر بيع" value={clock(pick.lastAt)} />}
            {pick.days ? <Stat label="أيام البيع" value={fmt(pick.days)} /> : null}
          </div>
        )}
      </Sheet>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="s-stat">
      <span>{label}</span>
      <b className="num">
        {value}
        {unit && <small> {unit}</small>}
      </b>
    </div>
  );
}

function ProductsBlock({ rows }: { rows: SaleNamed[] }) {
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter(r => r.name.toLowerCase().includes(s) || (r.barcode || '').includes(s)) : rows;
  }, [rows, q]);
  const row = (r: SaleNamed, i: number) => (
    <div key={`${r.id}-${i}`} className="t-row s-prod">
      <span className={`s-pos ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
      <div className="body">
        <div className="title ltr-auto">{r.name}</div>
        <div className="sub num">
          {fmt(r.q)} قطعة · {fmt(r.n)} فاتورة{r.barcode ? ` · ${r.barcode}` : ''}
        </div>
      </div>
      <div className="end">
        <b className="num">{compact(r.t)}</b>
      </div>
    </div>
  );
  return (
    <>
      <div className="t-section-head">
        <h2>أكثر المنتجات مبيعاً</h2>
        {rows.length > 8 && (
          <button type="button" className="more" onClick={() => setAll(true)}>
            الكل ({rows.length})
          </button>
        )}
      </div>
      {rows.length ? <div className="t-list flat">{rows.slice(0, 8).map(row)}</div> : <div className="t-card pad s-none">لا بيانات</div>}
      <Sheet open={all} onClose={() => setAll(false)} title="المنتجات" subtitle="مرتبة حسب قيمة المبيعات">
        <input className="t-input s-search" placeholder="بحث بالاسم أو الباركود" value={q} onChange={e => setQ(e.target.value)} />
        <div className="t-list flat">{list.map(row)}</div>
      </Sheet>
    </>
  );
}

/* ═════════════ نقاط البيع الحية ═════════════ */
const isOnline = (x: SaleTerminal, at: string | null) => {
  const seen = iraqMs(x.lastSeen);
  const ref = iraqMs(at) || Date.now();
  return !Number.isNaN(seen) && ref - seen < 5 * 60_000;
};

function Terminals({ rows, sales, at }: { rows: SaleTerminal[]; sales: SaleNamed[]; at: string | null }) {
  const byId = new Map(sales.map(s => [s.id, s]));
  // النقاط النشطة اليوم أو المتصلة الآن أولاً؛ المتوقفة منذ زمن تُطوى
  const list = rows
    .map(r => ({ r, s: byId.get(r.id), on: isOnline(r, at) }))
    .filter(x => x.on || x.s || x.r.lastSaleAt)
    .sort((a, b) => (b.s?.t ?? 0) - (a.s?.t ?? 0));
  const idle = rows.length - list.length;
  return (
    <div className="t-list">
      {list.map(({ r, s, on }) => (
        <div key={r.id} className="t-row">
          <span className={`s-dot ${on ? 'on' : 'off'}`} />
          <div className="body">
            <div className="title">{posName(r.name, r.id)}</div>
            <div className="sub">
              {on ? 'متصلة' : `انقطعت ${ago(r.lastSeen, iraqMs(at) || Date.now())}`}
              {r.section ? ` · ${r.section}` : s?.sub ? ` · ${s.sub}` : ''}
              {r.lastSaleAt ? ` · آخر بيع ${clock(r.lastSaleAt)}` : ''}
            </div>
          </div>
          <div className="end">
            <b className="num">{compact(s?.t ?? 0)}</b>
            <small className="num">{fmt(s?.n ?? 0)} فاتورة</small>
          </div>
        </div>
      ))}
      {idle > 0 && <div className="s-idle">{idle} نقطة بيع أخرى غير مستخدمة اليوم</div>}
    </div>
  );
}

/* ═════════════ الفواتير الحية ═════════════ */
function ReceiptFeed({ rows, fresh }: { rows: SaleReceipt[]; fresh?: Set<number> }) {
  const [n, setN] = useState(12);
  return (
    <div className="t-list flat s-feed">
      {rows.slice(0, n).map(r => (
        <div key={r.id} className={`t-row ${fresh?.has(r.id) ? 'fresh' : ''}`}>
          <span className={`t-tile ${r.kind === 1 ? 'bad' : r.kind === 2 ? 'accent' : 'ok'}`}>
            {r.kind === 1 ? '↩' : r.kind === 2 ? '🎁' : <I.receipt size={17} />}
          </span>
          <div className="body">
            <div className="title">
              {r.kind === 1 ? 'مرتجع' : r.kind === 2 ? 'هدية' : 'بيع'} <span className="num s-muted">#{r.number}</span>
              {r.card && <span className="s-card-tag">بطاقة</span>}
            </div>
            <div className="sub">
              {clock(r.at)} · {r.cashier || '—'}
              {r.seller ? ` · ${r.seller.replace(/^\d+\s*-\s*/, '')}` : ''} · {fmt(r.items)} مادة
            </div>
          </div>
          <div className="end">
            <b className={`num ${r.kind === 1 ? 's-neg' : ''}`}>
              {r.kind === 1 ? '−' : ''}
              {fmt(r.total)}
            </b>
          </div>
        </div>
      ))}
      {rows.length > n && (
        <button type="button" className="s-more press" onClick={() => setN(rows.length)}>
          عرض {rows.length - n} فاتورة أخرى
        </button>
      )}
    </div>
  );
}

/* ═════════════ التقويم ═════════════ */
function CalendarSheet({ open, onClose, value, min, max, onPick }: { open: boolean; onClose: () => void; value?: string; min?: string | null; max?: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(() => (value || max || new Date().toISOString().slice(0, 10)).slice(0, 7));
  const [data, setData] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (open && value) setMonth(value.slice(0, 7));
  }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const from = `${month}-01`;
    const last = addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
    let alive = true;
    salesApi
      .range(from, last)
      .then(r => alive && setData(new Map(r.days.map(d => [d.day, d.net]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, month]);
  const first = `${month}-01`;
  const lead = weekdayOf(first);
  const daysIn = Number(addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1).slice(8));
  const peak = Math.max(1, ...data.values());
  const prevMonth = addDays(first, -1).slice(0, 7);
  const nextMonth = addDays(first, 32).slice(0, 7);
  const canPrev = !min || prevMonth >= min.slice(0, 7);
  const canNext = !max || nextMonth <= max.slice(0, 7);
  return (
    <Sheet open={open} onClose={onClose} title="اختر يوماً" subtitle="اللون الأغمق = مبيعات أعلى">
      <div className="s-cal-head">
        <button type="button" className="t-icon-btn press" disabled={!canPrev} onClick={() => setMonth(prevMonth)} aria-label="الشهر السابق">
          <I.chevron size={20} />
        </button>
        <b>{monthTitle(first)}</b>
        <button type="button" className="t-icon-btn press" style={{ transform: 'scaleX(-1)' }} disabled={!canNext} onClick={() => setMonth(nextMonth)} aria-label="الشهر التالي">
          <I.chevron size={20} />
        </button>
      </div>
      <div className="s-cal">
        {WD.map(w => (
          <span key={w} className="wd">
            {w.replace('ال', '').slice(0, 3)}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, '0')}`;
          const net = data.get(d) ?? 0;
          const off = (!!max && d > max) || (!!min && d < min);
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              className={`day press ${d === value ? 'on' : ''} ${d === max ? 'today' : ''}`}
              style={net > 0 ? { ['--k' as string]: (0.12 + (net / peak) * 0.88).toFixed(2) } : undefined}
              onClick={() => (haptic('select'), onPick(d))}
            >
              <b className="num">{i + 1}</b>
              {net > 0 && <small className="num">{compact(net).replace(' مليون', 'م').replace(' ألف', 'k')}</small>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ═════════════ الفترات ═════════════ */
type Preset = '7' | '30' | 'month' | 'lastMonth' | '90' | 'year';
const PRESETS: { id: Preset; label: string }[] = [
  { id: '7', label: '7 أيام' },
  { id: '30', label: '30 يوماً' },
  { id: 'month', label: 'هذا الشهر' },
  { id: 'lastMonth', label: 'الشهر الماضي' },
  { id: '90', label: '90 يوماً' },
  { id: 'year', label: 'سنة' },
];
function presetRange(p: Preset, today: string): [string, string] {
  const m1 = `${today.slice(0, 7)}-01`;
  switch (p) {
    case '7':
      return [addDays(today, -6), today];
    case 'month':
      return [m1, today];
    case 'lastMonth': {
      const end = addDays(m1, -1);
      return [`${end.slice(0, 7)}-01`, end];
    }
    case '90':
      return [addDays(today, -89), today];
    case 'year':
      return [addDays(today, -364), today];
    default:
      return [addDays(today, -29), today];
  }
}

function RangeView({ preset, onPreset, onDay, bindRefresh }: { preset: Preset; onPreset: (p: Preset) => void; onDay: (d: string) => void; bindRefresh: (f: () => Promise<unknown>) => void }) {
  const [data, setData] = useState<SalesRange | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const today = (await salesApi.live()).day;
      const [from, to] = presetRange(preset, today);
      setData(await salesApi.range(from, to));
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  };
  bindRefresh(load);
  useEffect(() => {
    void load();
  }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="t-chips s-presets">
        {PRESETS.map(x => (
          <button key={x.id} type="button" className={`t-chip press ${x.id === preset ? 'on' : ''}`} onClick={() => (haptic('select'), onPreset(x.id))}>
            {x.label}
          </button>
        ))}
      </div>
      {err && !data && <ErrorLine text={err} onRetry={() => void load()} />}
      {loading && !data ? <SalesSkeleton /> : data ? <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}><RangeBody r={data} onDay={onDay} /></div> : null}
    </>
  );
}

function RangeBody({ r, onDay }: { r: SalesRange; onDay: (d: string) => void }) {
  const open = r.days.filter(d => d.receipts > 0);
  if (!open.length) return <Empty icon={<I.chart size={30} />} title="لا مبيعات في هذه الفترة" text="جرّب فترة أخرى." />;
  const best = [...open].sort((a, b) => b.net - a.net)[0];
  const worst = [...open].sort((a, b) => a.net - b.net)[0];
  const perDay = r.sum.days ? r.sum.net / r.sum.days : 0;
  const prevPerDay = r.prev.sum.days ? r.prev.sum.net / r.prev.sum.days : 0;
  const avgTicket = r.sum.receipts ? r.sum.net / r.sum.receipts : 0;
  const d = r.detail;
  return (
    <>
      <section className="t-hero s-hero">
        <p className="kicker">
          {dayShort(r.from)} – {dayShort(r.to)} · {r.span} يوم
        </p>
        <div className="amount">
          <CountUp value={r.sum.net} />
          <small>د.ع</small>
        </div>
        <div className="s-hero-cmp">
          <span>
            <Delta now={r.sum.net} prev={r.prev.sum.net} glass /> عن الفترة السابقة ({compact(r.prev.sum.net)})
          </span>
          <span>
            <Delta now={perDay} prev={prevPerDay} glass /> في معدل اليوم
          </span>
        </div>
        <div className="meta">
          <span>
            معدل اليوم <b className="num">{compact(perDay)}</b>
          </span>
          <span>
            <b className="num">{fmt(r.sum.receipts)}</b> فاتورة
          </span>
          <span>
            متوسط الفاتورة <b className="num">{compact(avgTicket)}</b>
          </span>
          <span>
            <b className="num">{fmt(r.sum.days)}</b> يوم بيع
          </span>
        </div>
      </section>

      <div className="s-kpis">
        <button type="button" className="s-kpi press" onClick={() => onDay(best.day)}>
          <span>أفضل يوم</span>
          <b className="num">{compact(best.net)}</b>
          <small>{dayTitle(best.day)}</small>
        </button>
        <button type="button" className="s-kpi press" onClick={() => onDay(worst.day)}>
          <span>أضعف يوم</span>
          <b className="num">{compact(worst.net)}</b>
          <small>{dayTitle(worst.day)}</small>
        </button>
        <Kpi label="القطع" value={fmt(r.sum.pieces)} cmp={<Delta now={r.sum.pieces} prev={r.prev.sum.pieces} />} />
        <Kpi label="المرتجعات" value={compact(r.sum.returnsTotal)} cmp={<small className="s-muted">{pctText(r.sum.returnsTotal, r.sum.net + r.sum.returnsTotal)} من البيع</small>} />
      </div>

      <section className="t-section">
        <div className="t-section-head">
          <h2>المبيعات يوماً بيوم</h2>
          <small>اضغط يوماً لتفاصيله</small>
        </div>
        <div className="t-card pad">
          <DayBars days={r.days} from={r.from} to={r.to} avg={perDay} onDay={onDay} />
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>أيام الأسبوع</h2>
          <small>معدل اليوم</small>
        </div>
        <WeekdayBars rows={r.weekday} />
      </section>

      {d && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>ساعات الذروة</h2>
            <small>{heatPeak(r.heat)}</small>
          </div>
          <Heatmap heat={r.heat} />
        </section>
      )}

      {d ? (
        <>
          {d.sections.length > 1 && (
            <section className="t-section">
              <div className="t-section-head">
                <h2>الأقسام</h2>
              </div>
              <RankList rows={d.sections} total={d.totals.net} name={x => x.name} sub={x => `${fmt(x.n)} فاتورة`} />
            </section>
          )}
          <section className="t-section">
            <div className="t-section-head">
              <h2>الكاشيرية</h2>
            </div>
            <RankList rows={d.cashiers} total={d.totals.net} name={x => x.name} sub={x => cashierSub(x)} />
          </section>
          <section className="t-section">
            <SellersBlock rows={d.sellers} total={d.totals.net} />
          </section>
          <section className="t-section">
            <ProductsBlock rows={d.products} />
          </section>
          <section className="t-section">
            <div className="t-section-head">
              <h2>الدفع والتعديلات</h2>
            </div>
            <div className="t-card pad s-pay">
              <div className="s-adj">
                <Adj label="بطاقة" value={d.totals.cardTotal} plain />
                <Adj label="نقداً" value={d.totals.net - d.totals.cardTotal} plain />
                <Adj label="خصم العروض" value={d.totals.offersDiscount} />
                <Adj label="خصم يدوي" value={d.totals.userDiscount} warn={d.totals.userDiscount > d.totals.net * 0.01} />
                <Adj label={`المرتجعات (${fmt(d.totals.returnsCount)})`} value={d.totals.returnsTotal} />
                {d.totals.gifts > 0 && <Adj label="فواتير هدايا" value={d.totals.gifts} count />}
              </div>
            </div>
          </section>
        </>
      ) : (
        <p className="s-foot">التفصيل حسب الكاشيرية والبائعين والمنتجات متاح للفترات حتى 120 يوماً.</p>
      )}
      {d && <ExportBtn run={() => exportSales(`${r.from}_${r.to}`, d, r.days)} />}
      {d && d.dayCount < r.sum.days && <p className="s-foot">التفصيل يشمل {d.dayCount} يوماً من {r.sum.days} (الأيام الأقدم بإجمالياتها فقط).</p>}
    </>
  );
}

function DayBars({ days, from, to, avg, onDay }: { days: SalesRange['days']; from: string; to: string; avg: number; onDay: (d: string) => void }) {
  const map = new Map(days.map(d => [d.day, d]));
  const all: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) all.push(d);
  const [pick, setPick] = useState<string | null>(null);
  const max = Math.max(1, ...days.map(d => d.net)) * 1.1;
  const W = 330;
  const H = 150;
  const base = H - 20;
  const slot = W / all.length;
  const xOf = (i: number) => W - (i + 0.5) * slot;
  const yOf = (t: number) => base - (t / max) * (base - 8);
  const every = all.length > 60 ? 14 : all.length > 20 ? 7 : all.length > 10 ? 2 : 1;
  const sel = pick ?? all[all.length - 1];
  const sd = map.get(sel);
  return (
    <div className="s-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="المبيعات اليومية">
        <line x1="0" x2={W} y1={yOf(avg)} y2={yOf(avg)} className="avgline" />
        {all.map((d, i) => {
          const t = map.get(d)?.net ?? 0;
          const bw = Math.max(1.5, slot * 0.66);
          const fri = weekdayOf(d) === 6;
          return (
            <g key={d} className="hit" onClick={() => (haptic('select'), setPick(d))}>
              <rect x={xOf(i) - slot / 2} y={0} width={slot} height={H} fill="transparent" />
              {t > 0 && <rect x={xOf(i) - bw / 2} y={yOf(t)} width={bw} height={Math.max(2, base - yOf(t))} rx={Math.min(3, bw / 2)} className={`bar ${d === sel ? 'sel' : ''} ${fri ? 'fri' : ''}`} />}
              {i % every === 0 && (
                <text x={xOf(i)} y={H - 5} className="tick">
                  {dayShort(d)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="s-readout">
        <b>{dayTitle(sel)}</b>
        <span className="num">{sd ? `${compact(sd.net)} · ${fmt(sd.receipts)} فاتورة` : 'لا مبيعات'}</span>
        {sd && (
          <button type="button" className="s-open press" onClick={() => onDay(sel)}>
            التفاصيل
          </button>
        )}
      </div>
      <div className="s-legend">
        <span>
          <i className="bar" /> صافي اليوم
        </span>
        <span>
          <i className="avgl" /> المعدل
        </span>
        <span>
          <i className="fri" /> الجمعة
        </span>
      </div>
    </div>
  );
}

function WeekdayBars({ rows }: { rows: SalesRange['weekday'] }) {
  const avg = rows.map(r => (r.days ? r.net / r.days : 0));
  const max = Math.max(1, ...avg);
  const best = avg.indexOf(Math.max(...avg));
  return (
    <div className="t-card pad s-wd">
      {rows.map((r, i) => (
        <div key={r.w} className={`s-wd-row ${i === best ? 'best' : ''}`}>
          <span>{WD[r.w]}</span>
          <div className="s-bar">
            <i style={{ width: `${(avg[i] / max) * 100}%` }} />
          </div>
          <b className="num">{avg[i] ? compact(avg[i]) : '—'}</b>
        </div>
      ))}
    </div>
  );
}

function heatPeak(heat: number[][]) {
  let best = { w: 0, h: 0, t: 0 };
  heat.forEach((row, w) => row.forEach((t, h) => t > best.t && (best = { w, h, t })));
  return best.t ? `الأعلى ${WD[best.w]} ${hourLabel(best.h)}` : '';
}

function Heatmap({ heat }: { heat: number[][] }) {
  const used = heat.flatMap(row => row.map((t, h) => (t > 0 ? h : -1))).filter(h => h >= 0);
  const lo = used.length ? Math.min(...used) : 10;
  const hi = used.length ? Math.max(...used) : 22;
  const max = Math.max(1, ...heat.flat());
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className="t-card pad s-heat" style={{ ['--cols' as string]: hours.length }}>
      <span />
      {hours.map(h => (
        <span key={h} className="hh">
          {h % 2 === 0 ? hourLabel(h) : ''}
        </span>
      ))}
      {heat.map((row, w) => (
        <HeatRow key={w} label={WD[w]} cells={hours.map(h => row[h] / max)} />
      ))}
    </div>
  );
}
function HeatRow({ label, cells }: { label: string; cells: number[] }) {
  return (
    <>
      <span className="wd">{label.replace('ال', '')}</span>
      {cells.map((k, i) => (
        <i key={i} style={{ ['--k' as string]: k ? (0.08 + k * 0.92).toFixed(2) : 0 }} />
      ))}
    </>
  );
}

/* ═════════════ بطاقة الرئيسية ═════════════ */
/** بطاقة مبيعات اليوم في رئيسية المدير (تتحدث حياً) */
export function SalesHomeCard() {
  const { data } = useLiveDay();
  useTick(30_000);
  const p = data?.pack;
  const t = p?.totals;
  const now = data ? nowOf(data) : null;
  const prevNet = data?.compare.prev && now ? cumUntil(data.compare.prev.hours, now.h, now.frac) : 0;
  return (
    <Link to="/m/sales" className="t-hero s-hero s-home press" onClick={() => haptic('tap')}>
      <div className="t-hero-row">
        <p className="kicker">
          <span className="s-pulse">
            <i /> مبيعات اليوم
          </span>
        </p>
        {data && prevNet > 0 && t ? <Delta now={t.net} prev={prevNet} glass /> : null}
      </div>
      <div className="amount">
        {t ? <CountUp value={t.net} /> : <span className="num">—</span>}
        <small>د.ع</small>
      </div>
      <div className="meta">
        {t ? (
          <>
            <span>
              <b className="num">{fmt(t.receipts)}</b> فاتورة
            </span>
            <span>
              متوسط <b className="num">{compact(t.receipts ? t.net / t.receipts : 0)}</b>
            </span>
            {t.lastAt && <span>آخر فاتورة {ago(t.lastAt)}</span>}
          </>
        ) : (
          <span>{data ? 'لا مبيعات بعد اليوم' : 'جارٍ التحميل…'}</span>
        )}
      </div>
      {p && p.hours.length > 0 && <MiniHours hours={p.hours} compare={data?.compare.prev?.hours} />}
    </Link>
  );
}

function MiniHours({ hours, compare }: { hours: SaleHour[]; compare?: SaleHour[] }) {
  const lo = 10;
  const hi = 22;
  const val = (list: SaleHour[] | undefined, h: number) => list?.find(x => x.h === h)?.t ?? 0;
  const max = Math.max(1, ...Array.from({ length: hi - lo + 1 }, (_, i) => Math.max(val(hours, lo + i), val(compare, lo + i))));
  return (
    <div className="s-mini">
      {Array.from({ length: hi - lo + 1 }, (_, i) => {
        const h = lo + i;
        return (
          <span key={h}>
            <i className="cmp" style={{ height: `${(val(compare, h) / max) * 100}%` }} />
            <i className="cur" style={{ height: `${(val(hours, h) / max) * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export type { SalePack };
