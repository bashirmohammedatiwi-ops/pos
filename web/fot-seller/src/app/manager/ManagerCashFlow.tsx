import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Empty, ErrorLine, I, Screen, Sheet, Skeleton, Switch, toast } from '../kit';
import { exportHtmlPdf, haptic } from '../native';
import { BackBtn } from '../parts';
import { cashApi, snapCache, type CashAlerts, type CashBoxes, type CashFlow, type CashFlowCurrency, type CashFlowGroup } from '../work';
import { cashAmount, pdfShell } from './cashPdf';

/* ─────────────────────────────────────────────────────────────────────────────
 * حركة الأموال — من أين جاء المال وإلى أين ذهب، لكل الصناديق أو لصندوق واحد:
 *   · الداخل حسب مصدره (مبيعات، توصيل، زبائن…) والخارج حسب وجهته (مجهزون، رواتب، مصاريف…).
 *   · القيود المركّبة (إقفال الكاشير…) موزّعة على حساباتها الحقيقية في الإداري.
 *   · التحويلات بين الصناديق منفصلة: ليست دخلاً ولا مصروفاً.
 *   · اضغط أي مجموعة لرؤية حساباتها، وتصدير PDF.
 * ───────────────────────────────────────────────────────────────────────────── */

const LOC = 'ar-IQ-u-nu-latn';
const iraqToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOC, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const money = (v: number, c: string) => (c === 'USD' ? `$${cashAmount(v, c)}` : cashAmount(v, c));

export function MCashFlow() {
  const [sp, setSp] = useSearchParams();
  const today = iraqToday();
  const from = isDay(sp.get('f')) ? sp.get('f')! : `${today.slice(0, 8)}01`;
  const to = isDay(sp.get('t')) && sp.get('t')! >= from ? sp.get('t')! : isDay(sp.get('f')) ? from : today;
  const seq = Number(sp.get('box')) || null;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };
  const setRange = (f: string, t: string) => set({ f, t: f === t ? null : t });
  const key = `cash.flow:${from}:${to}:${seq ?? 'all'}`;

  const [data, setData] = useState<CashFlow | null>(() => snapCache.get<CashFlow>(key)?.data ?? null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState(false);
  const [boxSheet, setBoxSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [boxes, setBoxes] = useState(() => snapCache.get<CashBoxes>('cash.boxes')?.data?.boxes ?? []);
  useEffect(() => {
    if (boxSheet && !boxes.length) void cashApi.boxes().then(d => setBoxes(d.boxes)).catch(() => undefined);
  }, [boxSheet]); // eslint-disable-line react-hooks/exhaustive-deps
  const reqId = useRef(0);

  async function load() {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await cashApi.flow(from, to, seq);
      if (id !== reqId.current) return;
      setData(d);
      setErr('');
      snapCache.set(key, d);
    } catch (e) {
      if (id !== reqId.current) return;
      setErr(e instanceof Error ? e.message : 'تعذر تحميل حركة الأموال');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }
  useEffect(() => {
    setData(snapCache.get<CashFlow>(key)?.data ?? null);
    void load();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const preset = from === to ? (from === today ? 'day' : from === addDays(today, -1) ? 'yesterday' : 'custom') : from === addDays(today, -6) && to === today ? 'week' : from === `${today.slice(0, 8)}01` && to === today ? 'month' : 'custom';
  const periodLabel = from === to ? (from === today ? 'اليوم' : from === addDays(today, -1) ? 'أمس' : dayName(from)) : `${dayShort(from)} – ${dayShort(to)}`;
  const scopeName = seq ? (data?.seq === seq ? data.scope : boxes.find(b => b.seq === seq)?.name ?? 'صندوق') : 'كل الصناديق';

  async function exportPdf() {
    if (!data || busy) return;
    setBusy(true);
    try {
      await exportHtmlPdf(`cash-flow-${data.from}_${data.to}`, await flowPdfHtml(data));
      haptic('success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تصدير الملف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="حركة الأموال"
      subtitle={`${scopeName} · ${periodLabel}`}
      start={<BackBtn to={seq ? `/m/cash/${seq}` : '/m/cash'} />}
      end={
        <button type="button" className="t-btn soft sm press" disabled={!data || busy} onClick={() => void exportPdf()}>
          {busy ? <span className="spinner" style={{ borderTopColor: 'var(--brand)' }} /> : 'PDF'}
        </button>
      }
      onRefresh={load}
    >
      <div className="t-scroller" style={{ gap: 8 }}>
        <button type="button" className={`m-pill press ${seq ? 'on' : ''}`} onClick={() => (haptic('tap'), setBoxSheet(true))}>
          {seq ? scopeName : 'كل الصناديق'} ▾
        </button>
        {(
          [
            ['day', 'اليوم', today, today],
            ['yesterday', 'أمس', addDays(today, -1), addDays(today, -1)],
            ['week', 'آخر 7 أيام', addDays(today, -6), today],
            ['month', 'هذا الشهر', `${today.slice(0, 8)}01`, today],
          ] as const
        ).map(([id, label, f, t]) => (
          <button key={id} type="button" className={`m-pill press ${!custom && preset === id ? 'on' : ''}`} onClick={() => (haptic('select'), setCustom(false), setRange(f, t))}>
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

      {err && <ErrorLine text={err} onRetry={() => void load()} />}
      {!data && loading && (
        <>
          <Skeleton h={150} r={22} mt={14} />
          <Skeleton h={300} r={20} mt={12} />
        </>
      )}
      {data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          {data.currencies.length === 0 ? (
            <Empty icon={<I.wallet size={28} />} title="لا حركة في هذه الفترة" text="لم يدخل أو يخرج أي مبلغ من الصناديق." />
          ) : (
            data.currencies.map(c => <CurrencyBlock key={c.currency} c={c} multi={data.currencies.length > 1} />)
          )}
          <p className="t-hint" style={{ marginTop: 16, lineHeight: 1.8 }}>
            من الإداري مباشرة. القيود المركّبة (مثل إقفال الكاشير) موزّعة على حساباتها، والتحويلات بين الصناديق منفصلة لأنها ليست دخلاً ولا مصروفاً.
          </p>
        </div>
      )}

      <Sheet open={boxSheet} onClose={() => setBoxSheet(false)} title="الصندوق" subtitle="حركة كل الصناديق معاً أو صندوق واحد">
        <div className="t-list">
          <button type="button" className={`t-row press-soft ${!seq ? 'e-on' : ''}`} onClick={() => (set({ box: null }), setBoxSheet(false))}>
            <span className={`t-tile ${!seq ? 'accent' : 'mute'}`}>
              <I.wallet size={18} />
            </span>
            <div className="body">
              <div className="title">كل الصناديق</div>
            </div>
          </button>
          {boxes
            .filter(b => b.featured || b.balance !== 0 || b.todayCount > 0 || b.seq === seq)
            .map(b => (
              <button key={b.seq} type="button" className={`t-row press-soft ${seq === b.seq ? 'e-on' : ''}`} onClick={() => (set({ box: String(b.seq) }), setBoxSheet(false))}>
                <span className={`t-tile ${seq === b.seq ? 'accent' : 'mute'}`}>
                  <I.wallet size={18} />
                </span>
                <div className="body">
                  <div className="title">{b.name}</div>
                  <div className="sub num">{b.num}</div>
                </div>
                <div className="end">
                  <b className="num ltr">{money(b.balance, b.currency)}</b>
                </div>
              </button>
            ))}
        </div>
      </Sheet>
    </Screen>
  );
}

function CurrencyBlock({ c, multi }: { c: CashFlowCurrency; multi: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const incoming = useMemo(() => c.groups.filter(g => !g.transfer && g.in > 0).sort((a, b) => b.in - a.in), [c]);
  const outgoing = useMemo(() => c.groups.filter(g => !g.transfer && g.out > 0).sort((a, b) => b.out - a.out), [c]);
  const transfer = c.groups.find(g => g.transfer);
  const net = c.in - c.out;
  const unit = c.currency === 'USD' ? 'دولار' : 'د.ع';
  const list = (groups: CashFlowGroup[], side: 'in' | 'out') => {
    const total = side === 'in' ? c.in : c.out;
    return (
      <div className="t-list">
        {groups.map(g => {
          const v = side === 'in' ? g.in : g.out;
          const id = `${side}:${g.seq}:${g.name}`;
          const rows = c.rows.filter(r => r.groupSeq === g.seq && r.group === g.name && (side === 'in' ? r.in : r.out) > 0).sort((a, b) => (side === 'in' ? b.in - a.in : b.out - a.out));
          return (
            <div key={id}>
              <button type="button" className="t-row press-soft e-item" aria-expanded={open === id} onClick={() => (haptic('select'), setOpen(open === id ? null : id))}>
                <span className={`t-tile ${side === 'in' ? 'ok' : 'bad'}`}>{side === 'in' ? <I.download size={18} /> : <I.out size={18} />}</span>
                <div className="body">
                  <div className="title">{g.name}</div>
                  <div className="sub">
                    {rows.length} حساب · <span className="num ltr">{Math.round((v / Math.max(1, total)) * 100)}%</span>
                  </div>
                  <span className="e-bar" aria-hidden>
                    <i style={{ width: `${Math.max(2, (v / Math.max(1, total)) * 100)}%`, background: side === 'in' ? 'var(--ok)' : 'var(--bad)' }} />
                  </span>
                </div>
                <div className="end">
                  <b className="num ltr">{money(v, c.currency)}</b>
                </div>
              </button>
              {open === id && (
                <div className="f-rows">
                  {rows.map(r => (
                    <div key={`${r.seq}:${r.name}`} className="f-row">
                      <span className="name">
                        {r.name}
                        {r.num && <small className="num"> · {r.num}</small>}
                      </span>
                      <b className="num ltr">{money(side === 'in' ? r.in : r.out, c.currency)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <section style={{ marginTop: 14 }}>
      {multi && <h2 className="f-cur">{c.currency === 'USD' ? 'صندوق الدولار (بالدولار)' : 'بالدينار العراقي'}</h2>}
      <div className="c-sum">
        <div className="in">
          <span>دخل الصناديق</span>
          <b className="num ltr">{money(c.in, c.currency)}</b>
        </div>
        <div className="out">
          <span>خرج من الصناديق</span>
          <b className="num ltr">{money(c.out, c.currency)}</b>
        </div>
        <div className="end e-wide">
          <span>الصافي · {unit}</span>
          <b className="num ltr">
            {net > 0 ? '+' : ''}
            {money(net, c.currency)}
          </b>
          {transfer && (
            <small>
              تحويلات بين الصناديق: دخل <span className="num ltr">{money(transfer.in, c.currency)}</span> · خرج <span className="num ltr">{money(transfer.out, c.currency)}</span>
            </small>
          )}
        </div>
      </div>
      {outgoing.length > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>إلى أين ذهب المال</h2>
          </div>
          {list(outgoing, 'out')}
        </section>
      )}
      {incoming.length > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>من أين جاء المال</h2>
          </div>
          {list(incoming, 'in')}
        </section>
      )}
    </section>
  );
}

/** إعدادات تنبيهات الصناديق (تصل لكل من يملك صلاحية الصناديق) */
export function CashAlertsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<CashAlerts | null>(null);
  useEffect(() => {
    if (open) void cashApi.alerts().then(setS).catch(e => toast(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, [open]);
  const toggle = (k: 'negative' | 'dailyClose', label: string, hint: string) =>
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
    <Sheet open={open} onClose={onClose} title="تنبيهات الصناديق" subtitle="إشعار على الهاتف لكل من يملك صلاحية الصناديق">
      {!s ? (
        <Skeleton h={260} r={16} />
      ) : (
        <>
          <label className="t-field" style={{ marginBottom: 10 }}>
            <span>صرف من صندوق بالدينار من (د.ع) — 0 للإيقاف</span>
            <input className="t-input sm num" inputMode="numeric" value={s.bigOut} onChange={e => setS({ ...s, bigOut: Number(e.target.value.replace(/\D/g, '')) })} />
          </label>
          <label className="t-field" style={{ marginBottom: 10 }}>
            <span>صرف من صندوق الدولار من ($) — 0 للإيقاف</span>
            <input className="t-input sm num" inputMode="numeric" value={s.bigOutUsd} onChange={e => setS({ ...s, bigOutUsd: Number(e.target.value.replace(/\D/g, '')) })} />
          </label>
          {toggle('negative', 'صندوق صار بالسالب', 'تنبيه واحد يومياً لكل صندوق')}
          {toggle('dailyClose', 'أرصدة الصناديق عند الإغلاق', 'الدولار والخشن والناعم وبطاقة كي — مرة يومياً')}
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
              void cashApi
                .saveAlerts(s)
                .then(() => {
                  haptic('success');
                  toast('حُفظت تنبيهات الصناديق');
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

/** حركة الأموال على A4 */
async function flowPdfHtml(d: CashFlow) {
  const period = d.from === d.to ? dayName(d.from) : `من ${dmy(d.from)} إلى ${dmy(d.to)}`;
  const block = (c: CashFlowCurrency) => {
    const rows = (side: 'in' | 'out') =>
      c.groups
        .filter(g => !g.transfer && (side === 'in' ? g.in : g.out) > 0)
        .sort((a, b) => (side === 'in' ? b.in - a.in : b.out - a.out))
        .map(g => {
          const v = side === 'in' ? g.in : g.out;
          const accounts = c.rows
            .filter(r => r.groupSeq === g.seq && r.group === g.name && (side === 'in' ? r.in : r.out) > 0)
            .sort((a, b) => (side === 'in' ? b.in - a.in : b.out - a.out));
          return `<tr class="day"><td>${esc(g.name)}</td><td class="e num">${money(v, c.currency)}</td></tr>${accounts
            .map(r => `<tr><td style="padding-inline-start:18px">${esc(r.name)}${r.num ? ` <span class="sub num">${esc(r.num)}</span>` : ''}</td><td class="e num">${money(side === 'in' ? r.in : r.out, c.currency)}</td></tr>`)
            .join('')}`;
        })
        .join('');
    const transfer = c.groups.find(g => g.transfer);
    return `${d.currencies.length > 1 ? `<h3 style="color:#4c2a85;margin:14px 0 4px">${c.currency === 'USD' ? 'صندوق الدولار (بالدولار)' : 'بالدينار العراقي'}</h3>` : ''}
    <div class="kpis">
      <div class="kpi in"><span>دخل الصناديق</span><b class="num">${money(c.in, c.currency)}</b></div>
      <div class="kpi out"><span>خرج من الصناديق</span><b class="num">${money(c.out, c.currency)}</b></div>
      <div class="kpi"><span>تحويلات داخلة / خارجة</span><b class="num">${money(transfer?.in ?? 0, c.currency)} / ${money(transfer?.out ?? 0, c.currency)}</b></div>
      <div class="kpi end"><span>الصافي</span><b class="num">${money(c.in - c.out, c.currency)}</b></div>
    </div>
    <table><thead><tr><th>إلى أين ذهب المال</th><th class="e">المبلغ</th></tr></thead><tbody>${rows('out') || '<tr><td colspan="2" class="sub">لا صرف</td></tr>'}</tbody></table>
    <table style="margin-top:12px"><thead><tr><th>من أين جاء المال</th><th class="e">المبلغ</th></tr></thead><tbody>${rows('in') || '<tr><td colspan="2" class="sub">لا قبض</td></tr>'}</tbody></table>`;
  };
  const body = `${d.currencies.map(block).join('')}
  <div class="note">القيود المركّبة (مثل إقفال الكاشير) موزّعة على حساباتها في الإداري، والتحويلات بين الصناديق ليست دخلاً ولا مصروفاً.</div>`;
  return pdfShell(`cash-flow-${d.from}_${d.to}`, 'حركة الأموال', `${esc(d.scope)}<br>${esc(period)}`, body);
}
