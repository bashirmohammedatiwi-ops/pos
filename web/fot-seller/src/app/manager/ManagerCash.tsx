import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Empty, ErrorLine, I, Screen, Skeleton, toast } from '../kit';
import { exportHtmlPdf, haptic } from '../native';
import { BackBtn } from '../parts';
import { cashApi, onLive, relTime, snapCache, useLoad, type CashBox, type CashBoxes, type CashStatement } from '../work';
import { CashAlertsSheet } from './ManagerCashFlow';
import { cashAmount, cashBoxesPdfHtml, cashStatementFileBase, cashStatementPdfHtml, cashUnit } from './cashPdf';
import { CashierCard, CashiersSummary, moreBoxes } from './CashierBoxes';

/* ─────────────────────────────────────────────────────────────────────────────
 * الصناديق — من «إداري» مباشرة عبر سيرفر المحل:
 *   · الأرصدة الآن (الدولار، الخشن، الناعم، بطاقة كي، وبقية الصناديق) وتتحدث لحظياً.
 *   · كشف كل صندوق يوماً بيوم أو لفترة: رصيد أول المدة، كل حركة برصيدها، والإجماليات.
 *   · تصدير PDF للكشف ولملخص الأرصدة.
 * ───────────────────────────────────────────────────────────────────────────── */

const iraqToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const time12 = (hm?: string | null) => {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};

/** المبلغ بعملة الصندوق مع رمزها الصغير */
function Money({ value, currency, sign }: { value: number; currency: string; sign?: boolean }) {
  return (
    <span className="num ltr">
      {sign && value > 0 ? '+' : ''}
      {currency === 'USD' ? '$' : ''}
      {cashAmount(value, currency)}
    </span>
  );
}

/**
 * سيرفر محل أقدم (بلا إعداد «عرض المزيد») يُبرز 301 أيضاً: الرئيسية تبقى الدولار والخشن والناعم فقط،
 * والبقية تنتقل لـ«عرض المزيد». بعد تحديث السيرفر يحدد ذلك من لوحة التحكم.
 */
const MAIN_DEFAULT = ['131', '132', '133'];
function normalizeMain(d: CashBoxes): CashBoxes {
  if (d.extra !== undefined || !d.boxes.some(b => MAIN_DEFAULT.includes(b.num))) return d;
  return { ...d, featured: MAIN_DEFAULT, boxes: d.boxes.map(b => (b.featured && !MAIN_DEFAULT.includes(b.num) ? { ...b, featured: false } : b)) };
}

/** يحمّل الأرصدة ويعيد تحميلها مع كل تحديث يصل من المحل؛ آخر أرصدة محفوظة تظهر فوراً عند الفتح */
function useBoxes() {
  const [cached] = useState(() => {
    const c = snapCache.get<CashBoxes>('cash.boxes')?.data;
    return c ? normalizeMain(c) : null;
  });
  const q = useLoad<CashBoxes>(async () => {
    const d = normalizeMain(await cashApi.boxes());
    if (d.boxes.length) snapCache.set('cash.boxes', d);
    return d;
  }, ['cash']);
  return { ...q, data: q.data ?? cached, loading: q.loading && !q.data && !cached };
}

function StaleNote({ data }: { data: CashBoxes }) {
  if (data.error)
    return (
      <div className="t-error" style={{ marginBottom: 12 }}>
        <I.info size={18} />
        <span>{data.error}</span>
      </div>
    );
  if (!data.boxes.length) return null;
  if (!data.stale) return null;
  return (
    <div className="t-net bad" style={{ marginBottom: 12 }}>
      <I.info size={16} /> سيرفر المحل غير متصل — آخر تحديث {data.receivedAt ? relTime(data.receivedAt) : 'غير معروف'}
    </div>
  );
}

/** بطاقة صندوق: الرصيد الآن وصافي حركة اليوم */
function BoxCard({ box, big }: { box: CashBox; big?: boolean }) {
  const net = box.todayIn - box.todayOut;
  return (
    <Link to={`/m/cash/${box.seq}`} className={`c-box press ${big ? 'big' : ''} ${box.currency === 'USD' ? 'usd' : ''}`} onClick={() => haptic('tap')}>
      <span className="name">
        {box.name}
        <small className="num">{box.num}</small>
      </span>
      <b className="num ltr">
        {box.currency === 'USD' ? '$' : ''}
        {cashAmount(box.balance, box.currency)}
        {box.currency !== 'USD' && <small>د.ع</small>}
      </b>
      <span className={`today ${box.todayCount ? (net >= 0 ? 'up' : 'down') : ''}`}>
        {box.todayCount ? (
          <>
            اليوم <Money value={net} currency={box.currency} sign /> · {box.todayCount} حركة
          </>
        ) : (
          'لا حركة اليوم'
        )}
      </span>
    </Link>
  );
}

/* ═════════════ بطاقة الرئيسية ═════════════ */
export function CashHomeCard() {
  const { data, err } = useBoxes();
  // خادم أقدم أو بلا صلاحية: لا بطاقة
  if (err && !data) return null;
  if (!data) return <Skeleton h={190} r={24} mt={0} />;
  const featured = data.boxes.filter(b => b.featured).slice(0, 6);
  if (!featured.length) return null;
  const more = moreBoxes(data);
  const working = more.cashiers.filter(x => x.live.online).length;
  return (
    <section className="t-section">
      <div className="t-section-head">
        <h2>الصناديق الآن</h2>
        <Link to="/m/cash" className="more" onClick={() => haptic('tap')}>
          التفاصيل
        </Link>
      </div>
      <StaleNote data={data} />
      <div className={`c-grid ${featured.length === 3 ? 'three' : ''}`}>
        {featured.map(b => (
          <BoxCard key={b.seq} box={b} big />
        ))}
      </div>
      <Link to="/m/cash#more" className="cz-more press" onClick={() => haptic('tap')}>
        <span className="t-tile accent">
          <I.wallet size={18} />
        </span>
        <span className="txt">
          <b>عرض المزيد من الصناديق</b>
          <small>
            {more.cashiers.length
              ? `${more.cashiers.length === 1 ? 'صندوق كاشير واحد' : `${more.cashiers.length} صناديق كاشير`} اليوم${working ? ` · ${working} يعمل الآن` : ''}`
              : 'صناديق الكاشير وبقية الصناديق'}
          </small>
        </span>
        <I.chevron size={16} />
      </Link>
    </section>
  );
}

/* ═════════════ كل الصناديق ═════════════ */
export function MCash() {
  const { data, err, loading, reload } = useBoxes();
  const [showEmpty, setShowEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const featured = (data?.boxes ?? []).filter(b => b.featured);
  const more = data ? moreBoxes(data) : null;
  const shown = more ? (showEmpty ? [...more.others, ...more.hidden] : more.others) : [];
  // «عرض المزيد» من الرئيسية يفتح على صناديق الكاشير
  useEffect(() => {
    if (location.hash.endsWith('#more') || location.hash.includes('#more'))
      window.setTimeout(() => document.getElementById('cz-more')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportPdf() {
    if (!data || busy) return;
    setBusy(true);
    try {
      await exportHtmlPdf(`cash-boxes-${data.today ?? ''}`, await cashBoxesPdfHtml(data));
      haptic('success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تصدير الملف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="الصناديق"
      subtitle={data?.receivedAt ? `من الإداري · محدّث ${relTime(data.receivedAt)}` : 'أرصدة الصناديق من الإداري'}
      start={<BackBtn to="/m" />}
      end={
        <>
          <button type="button" className="t-icon-btn press" aria-label="تنبيهات الصناديق" onClick={() => (haptic('tap'), setAlerts(true))}>
            <I.bell size={20} />
          </button>
          {data?.boxes.length ? (
            <button type="button" className="t-btn soft sm press" disabled={busy} onClick={() => void exportPdf()}>
              {busy ? <span className="spinner" style={{ borderTopColor: 'var(--brand)' }} /> : 'PDF'}
            </button>
          ) : null}
        </>
      }
      onRefresh={reload}
    >
      <CashAlertsSheet open={alerts} onClose={() => setAlerts(false)} />
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={320} r={24} />
      ) : data ? (
        <>
          <StaleNote data={data} />
          {!data.boxes.length ? (
            <Empty icon={<I.wallet size={30} />} title="لم تصل أرصدة الصناديق بعد" text="تظهر هنا بعد تحديث سيرفر المحل واتصاله بالإنترنت." />
          ) : (
            <>
              <div className={`c-grid ${featured.length === 3 ? 'three' : ''}`}>
                {featured.map(b => (
                  <BoxCard key={b.seq} box={b} big />
                ))}
              </div>
              <Link to="/m/cash/flow" className="t-row press-soft e-link" style={{ marginTop: 14 }} onClick={() => haptic('tap')}>
                <span className="t-tile accent">
                  <I.chart size={19} />
                </span>
                <div className="body">
                  <div className="title">حركة الأموال</div>
                  <div className="sub">من أين جاء المال وإلى أين ذهب — مجهزون، رواتب، مصاريف</div>
                </div>
                <I.chevron size={16} />
              </Link>
              {more && (
                <section className="t-section" id="cz-more">
                  <div className="t-section-head">
                    <h2>صناديق الكاشير اليوم</h2>
                    <small>{more.manual ? 'المختارة من لوحة التحكم' : 'كل كاشير عمل اليوم'}</small>
                  </div>
                  {data.cashiers == null ? (
                    <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.8 }}>
                      تفاصيل الكاشير تظهر بعد تحديث سيرفر المحل.
                    </div>
                  ) : more.cashiers.length === 0 ? (
                    <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
                      لم يعمل أي كاشير بعد اليوم.
                    </div>
                  ) : (
                    <>
                      <CashiersSummary items={more.cashiers} />
                      <div className="cz-list">
                        {more.cashiers.map(x => (
                          <CashierCard key={x.live.seq} live={x.live} box={x.box} />
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}
              {more && (more.others.length > 0 || more.hidden.length > 0) && (
                <section className="t-section">
                  <div className="t-section-head">
                    <h2>{more.manual ? 'صناديق أخرى مختارة' : 'بقية الصناديق'}</h2>
                    {more.hidden.length > 0 && (
                      <button type="button" className="more" onClick={() => (haptic('select'), setShowEmpty(v => !v))}>
                        {showEmpty ? 'إخفاء' : more.manual ? `كل الصناديق (${more.hidden.length})` : `إظهار الفارغة (${more.hidden.length})`}
                      </button>
                    )}
                  </div>
                  {shown.length === 0 ? (
                    <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
                      {more.manual ? 'لا صناديق أخرى مختارة — اختر من لوحة التحكم (تقرير الصناديق).' : 'كل الصناديق الأخرى فارغة وبلا حركة اليوم.'}
                    </div>
                  ) : (
                    <div className="t-list">
                      {shown.map(b => (
                        <Link key={b.seq} to={`/m/cash/${b.seq}`} className="t-row press-soft" onClick={() => haptic('tap')}>
                          <span className={`t-tile ${b.balance < 0 ? 'bad' : b.todayCount ? 'accent' : 'mute'}`}>
                            <I.wallet size={19} />
                          </span>
                          <div className="body">
                            <div className="title">{b.name}</div>
                            <div className="sub">
                              <span className="num">{b.num}</span>
                              {b.todayCount ? ` · اليوم ${b.todayCount} حركة` : ' · لا حركة اليوم'}
                            </div>
                          </div>
                          <div className="end">
                            <b>
                              <Money value={b.balance} currency={b.currency} />
                            </b>
                            <small>{b.currency === 'USD' ? 'دولار' : cashUnit(b.currency)}</small>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <p className="t-hint" style={{ marginTop: 14, lineHeight: 1.8 }}>
                الرصيد = آخر مبلغ مثبّت في الإداري + الحركات بعده. «النقد المتوقع في الدرج» من فواتير المحل لحظة بلحظة (المبيعات − المرتجعات، والبطاقة منفصلة). اختيار الصناديق الظاهرة من لوحة التحكم ← تقرير الصناديق.
              </p>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}

/* ═════════════ كشف صندوق ═════════════ */
type Preset = 'day' | 'week' | 'month' | 'custom';

export function MCashBox() {
  const { seq: seqParam } = useParams();
  const seq = Number(seqParam);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = iraqToday();
  const from = params.get('from') || today;
  const to = params.get('to') || from;
  const preset: Preset = from === to ? 'day' : from === addDays(today, -6) && to === today ? 'week' : from === `${today.slice(0, 8)}01` && to === today ? 'month' : 'custom';
  const setRange = (f: string, t: string) => {
    const next = new URLSearchParams(params);
    if (f === today && t === today) {
      next.delete('from');
      next.delete('to');
    } else {
      next.set('from', f);
      next.set('to', t);
    }
    setParams(next, { replace: true });
  };

  const boxes = useBoxes();
  const box = boxes.data?.boxes.find(b => b.seq === seq) ?? null;
  const liveCashier = boxes.data?.cashiers?.find(c => c.seq === seq) ?? null;
  const stKey = `cash.st:${seq}:${from}:${to}`;
  const [st, setSt] = useState<CashStatement | null>(() => snapCache.get<CashStatement>(stKey)?.data ?? null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);

  async function load(silent = false) {
    if (!seq) return;
    if (!silent) setLoading(true);
    try {
      const d = await cashApi.statement(seq, from, to);
      setSt(d);
      setErr('');
      snapCache.set(`cash.st:${seq}:${from}:${to}`, d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر تحميل الكشف');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setSt(snapCache.get<CashStatement>(stKey)?.data ?? null);
    void load();
  }, [seq, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  // حركة جديدة في المحل: يتحدث الكشف إن كان يشمل اليوم
  useEffect(
    () =>
      onLive(m => {
        if (m.event === 'cash' && to >= today) void load(true);
      }),
    [seq, from, to], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const lines = useMemo(() => {
    const n = q.trim();
    const all = st?.lines ?? [];
    return n ? all.filter(l => l.description.includes(n) || (l.other ?? '').includes(n) || l.num.includes(n) || String(l.in || l.out).includes(n.replace(/,/g, ''))) : all;
  }, [st, q]);
  const groups = useMemo(() => {
    const out: { date: string; rows: typeof lines }[] = [];
    // الأحدث أولاً
    for (const l of [...lines].reverse()) {
      const last = out[out.length - 1];
      if (last && last.date === l.date) last.rows.push(l);
      else out.push({ date: l.date, rows: [l] });
    }
    return out;
  }, [lines]);
  const dayInfo = useMemo(() => new Map((st?.days ?? []).map(d => [d.date, d])), [st]);
  const c = st?.box.currency ?? box?.currency ?? 'IQD';
  const history = box?.days ?? [];
  const peak = Math.max(1, ...history.map(d => Math.max(d.in, d.out)));

  async function exportPdf() {
    if (!st || busy) return;
    setBusy(true);
    try {
      await exportHtmlPdf(cashStatementFileBase(st), await cashStatementPdfHtml(st));
      haptic('success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تصدير الملف');
    } finally {
      setBusy(false);
    }
  }

  const name = st?.box.name ?? box?.name ?? 'الصندوق';
  const balance = box?.balance ?? st?.box.balance ?? 0;
  const ledgerGap = box ? Math.round((box.ledgerBalance - box.balance) * 100) / 100 : 0;

  return (
    <Screen
      title={name}
      subtitle={from === to ? dayName(from) : `${dayShort(from)} – ${dayShort(to)}`}
      hideLarge
      start={<BackBtn to="/m/cash" />}
      end={
        <button type="button" className="t-btn soft sm press" disabled={!st || busy} onClick={() => void exportPdf()}>
          {busy ? <span className="spinner" style={{ borderTopColor: 'var(--brand)' }} /> : 'PDF'}
        </button>
      }
      onRefresh={async () => {
        await Promise.all([boxes.reload(), load(true)]);
      }}
    >
      <section className={`c-hero ${c === 'USD' ? 'usd' : ''}`}>
        <span className="label">
          {name}
          {box && <small className="num"> · {box.num}</small>}
        </span>
        <div className="amount num ltr">
          {c === 'USD' ? '$' : ''}
          {cashAmount(balance, c)}
          {c !== 'USD' && <small>د.ع</small>}
        </div>
        <div className="meta">
          <span>الرصيد الآن</span>
          {box?.fixDate && (
            <span>
              آخر تثبيت {dayShort(box.fixDate)} · <span className="num ltr">{cashAmount(box.fixBalance ?? 0, c)}</span>
            </span>
          )}
        </div>
        {history.length > 0 && (
          <div className="c-bars" role="img" aria-label="القبض والصرف في آخر 14 يوماً">
            {[...history].reverse().map(d => (
              <button
                key={d.date}
                type="button"
                className={`col ${from === d.date && to === d.date ? 'on' : ''}`}
                aria-label={`${dayName(d.date)}: قبض ${cashAmount(d.in, c)}، صرف ${cashAmount(d.out, c)}`}
                onClick={() => {
                  haptic('select');
                  setCustom(false);
                  setRange(d.date, d.date);
                }}
              >
                <span className="pair">
                  <i className="in" style={{ height: `${d.in ? Math.max(6, (d.in / peak) * 100) : 0}%` }} />
                  <i className="out" style={{ height: `${d.out ? Math.max(6, (d.out / peak) * 100) : 0}%` }} />
                </span>
                <small className="num">{Number(d.date.slice(8))}</small>
              </button>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <div className="c-legend">
            <span>
              <i className="in" /> قبض
            </span>
            <span>
              <i className="out" /> صرف
            </span>
            <span>آخر 14 يوماً — اضغط يوماً لكشفه</span>
          </div>
        )}
      </section>

      {ledgerGap !== 0 && (
        <p className="t-hint" style={{ marginTop: 10, lineHeight: 1.8 }}>
          الرصيد الدفتري في الإداري <span className="num ltr">{cashAmount(box!.ledgerBalance, c)}</span> — يختلف عن المثبّت بـ <span className="num ltr">{cashAmount(Math.abs(ledgerGap), c)}</span> (قيود أُدخلت بتاريخ سابق لآخر تثبيت).
        </p>
      )}

      {/* صندوق كاشير يعمل اليوم: تفاصيله الحية من فواتير المحل */}
      {liveCashier && (
        <section className="t-section" style={{ marginTop: 16 }}>
          <div className="t-section-head">
            <h2>الكاشير اليوم</h2>
            <small>من فواتير المحل مباشرة</small>
          </div>
          <CashierCard live={liveCashier} box={box} link={false} />
        </section>
      )}

      {/* اليوم المعروض والفترات السريعة */}
      <div className="c-nav">
        <button type="button" className="t-icon-btn press" aria-label="اليوم السابق" onClick={() => (haptic('select'), setCustom(false), setRange(addDays(from, -1), addDays(from, -1)))}>
          <I.chevron size={18} />
        </button>
        <div className="day">
          <b>{from === to ? (from === today ? 'اليوم' : from === addDays(today, -1) ? 'أمس' : dayName(from)) : `${dayShort(from)} – ${dayShort(to)}`}</b>
          <small className="num">{from === to ? from.split('-').reverse().join('/') : `${Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1} يوماً`}</small>
        </div>
        <button
          type="button"
          className="t-icon-btn press flip"
          aria-label="اليوم التالي"
          disabled={to >= today}
          onClick={() => (haptic('select'), setCustom(false), setRange(addDays(to, 1), addDays(to, 1)))}
        >
          <I.chevron size={18} />
        </button>
      </div>
      <div className="t-scroller" style={{ gap: 8, marginTop: 10 }}>
        {(
          [
            ['day', 'اليوم', today, today],
            ['yesterday', 'أمس', addDays(today, -1), addDays(today, -1)],
            ['week', 'آخر 7 أيام', addDays(today, -6), today],
            ['month', 'هذا الشهر', `${today.slice(0, 8)}01`, today],
          ] as const
        ).map(([id, label, f, t]) => (
          <button key={id} type="button" className={`m-pill press ${!custom && from === f && to === t ? 'on' : ''}`} onClick={() => (haptic('select'), setCustom(false), setRange(f, t))}>
            {label}
          </button>
        ))}
        <button type="button" className={`m-pill press ${custom || preset === 'custom' ? 'on' : ''}`} onClick={() => (haptic('select'), setCustom(v => !v))}>
          فترة محددة
        </button>
      </div>
      {(custom || preset === 'custom') && (
        <div className="t-row-2" style={{ marginTop: 10 }}>
          <label className="t-field">
            <span>من</span>
            <input className="t-input sm" type="date" max={today} value={from} onChange={e => e.target.value && setRange(e.target.value, e.target.value > to ? e.target.value : to)} />
          </label>
          <label className="t-field">
            <span>إلى</span>
            <input className="t-input sm" type="date" max={today} value={to} onChange={e => e.target.value && setRange(e.target.value < from ? e.target.value : from, e.target.value)} />
          </label>
        </div>
      )}

      {err && !st && <ErrorLine text={err} onRetry={() => void load()} />}
      {loading && !st ? (
        <Skeleton h={260} r={20} mt={14} />
      ) : st ? (
        <>
          <div className="c-sum">
            <div>
              <span>رصيد أول المدة</span>
              <b>
                <Money value={st.opening} currency={c} />
              </b>
            </div>
            <div className="in">
              <span>القبض</span>
              <b>
                <Money value={st.totalIn} currency={c} />
              </b>
            </div>
            <div className="out">
              <span>الصرف</span>
              <b>
                <Money value={st.totalOut} currency={c} />
              </b>
            </div>
            <div className="end">
              <span>رصيد آخر المدة</span>
              <b>
                <Money value={st.closing} currency={c} />
              </b>
            </div>
          </div>

          <Link to={`/m/cash/flow?box=${seq}&f=${from}${to !== from ? `&t=${to}` : ''}`} className="t-row press-soft e-link" style={{ marginTop: 12 }} onClick={() => haptic('tap')}>
            <span className="t-tile accent">
              <I.chart size={19} />
            </span>
            <div className="body">
              <div className="title">أين ذهب المال من هذا الصندوق</div>
              <div className="sub">الصرف والقبض مجمّعاً حسب الحساب لنفس الفترة</div>
            </div>
            <I.chevron size={16} />
          </Link>
          {st.lines.length > 6 && (
            <label className="t-search" style={{ marginTop: 12 }}>
              <I.search />
              <input placeholder="ابحث في البيان أو الحساب أو المبلغ" value={q} onChange={e => setQ(e.target.value)} />
            </label>
          )}
          {st.truncated && <p className="t-hint bad">الفترة فيها حركات أكثر من الحد المعروض — اختر فترة أقصر.</p>}

          {groups.length === 0 ? (
            <Empty icon={<I.wallet size={28} />} title={q ? 'لا نتائج للبحث' : 'لا حركات في هذه الفترة'} text={q ? undefined : 'الرصيد لم يتغير. جرّب يوماً آخر من الأعمدة في الأعلى.'} />
          ) : (
            groups.map(g => {
              const d = dayInfo.get(g.date);
              return (
                <section key={g.date} className="c-day">
                  <div className="head">
                    <b>{g.date === today ? 'اليوم' : dayName(g.date)}</b>
                    {d && !q && (
                      <small className="num">
                        {d.count} حركة · رصيد <span className="ltr">{cashAmount(d.closing, c)}</span>
                      </small>
                    )}
                  </div>
                  <div className="t-list">
                    {g.rows.map(l => (
                      <div key={l.seq} className="c-line">
                        <span className={`dir ${l.in ? 'in' : 'out'}`} aria-hidden>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            {l.in ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />}
                          </svg>
                        </span>
                        <div className="body">
                          <div className="title">{l.description || (l.in ? 'قبض' : 'صرف')}</div>
                          <div className="sub">
                            {l.other ? `${l.other} · ` : ''}
                            {l.time ? `${time12(l.time)} · ` : ''}سند <span className="num">{l.num}</span>
                            {l.rate ? (
                              <>
                                {' '}
                                · سعر <span className="num">{cashAmount(l.rate, 'IQD')}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="end">
                          <b className={l.in ? 'in' : 'out'}>
                            <span className="num ltr">
                              {l.in ? '+' : '−'}
                              {c === 'USD' ? '$' : ''}
                              {cashAmount(l.in || l.out, c)}
                            </span>
                          </b>
                          <small className="num ltr">{cashAmount(l.balance, c)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </>
      ) : null}
      {boxes.data && !box && !loading && (
        <div className="t-card pad" style={{ marginTop: 14, textAlign: 'center' }}>
          <p className="muted" style={{ fontSize: 13.5 }}>هذا الصندوق غير موجود في آخر تحديث.</p>
          <button type="button" className="t-btn soft sm press" style={{ marginTop: 10 }} onClick={() => nav('/m/cash', { replace: true })}>
            كل الصناديق
          </button>
        </div>
      )}
    </Screen>
  );
}
