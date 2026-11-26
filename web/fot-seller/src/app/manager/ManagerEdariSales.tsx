import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, fmt, toast } from '../kit';
import { exportHtmlPdf, haptic } from '../native';
import { BackBtn } from '../parts';
import { EDARI_SALES_MAX_DAYS, edariSalesApi, snapCache, type EdSalesItem, type EdSalesReport } from '../work';
import { pdfShell } from './cashPdf';

/* ─────────────────────────────────────────────────────────────────────────────
 * مبيعات الإداري — نفس تقرير تطبيق الحسابات، من الإداري مباشرة عبر سيرفر المحل:
 *   · الصافي والمبيعات والمردود والهدايا لليوم أو لأي فترة (حتى 93 يوماً).
 *   · أشجار المواد: اضغط الشجرة لترى مجموعاتها ثم موادها ثم حركات المادة في الفواتير
 *     (زر الرجوع في الهاتف يصعد في الشجرة).
 *   · الفروع (136، 138، الكاشيرات، الدلفري…) للفلترة، والأيام، وأكثر المواد مبيعاً.
 *   · تصدير PDF لما هو معروض.
 * ───────────────────────────────────────────────────────────────────────────── */

const LOC = 'ar-IQ-u-nu-latn';
const iraqToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOC, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const n0 = (v: number) => fmt(Math.round(v));
const qty = (v: number) => (Number.isInteger(v) ? fmt(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
type Sort = 'net' | 'up' | 'down';

/** التغير عن الفترة السابقة: نسبة، أو «جديد» / «توقف» */
function Delta({ net, prev }: { net: number; prev?: number | null }) {
  if (prev == null) return null;
  if (!prev && !net) return null;
  if (!prev) return <span className="e-delta up">جديد</span>;
  if (!net) return <span className="e-delta down">توقف</span>;
  const pct = ((net - prev) / Math.abs(prev)) * 100;
  const cls = Math.abs(pct) < 1 ? 'flat' : pct > 0 ? 'up' : 'down';
  return (
    <span className={`e-delta ${cls}`}>
      {pct > 0 ? '+' : ''}
      {Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

export function MEdariSales() {
  const [sp, setSp] = useSearchParams();
  const today = iraqToday();
  const from = isDay(sp.get('f')) ? sp.get('f')! : today;
  const to = isDay(sp.get('t')) && sp.get('t')! >= from ? sp.get('t')! : from;
  const node = Number(sp.get('n')) || null;
  const leaf = sp.get('l') === '1';
  const branches = (sp.get('b') || '').split(',').filter(Boolean);
  const compare = sp.get('c') === '1';
  const sort: Sort = compare && (sp.get('s') === 'up' || sp.get('s') === 'down') ? (sp.get('s') as Sort) : 'net';
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

  /** تغيير الفترة/الفلتر يستبدل الصفحة؛ الدخول في شجرة يضيف صفحة كي يرجع زر الرجوع خطوة */
  const set = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: !push });
  };
  const setRange = (f: string, t: string) => set({ f: f === today && t === today ? null : f, t: f === t ? null : t });

  const cacheKey = `edari:${from}:${to}:${node ?? 0}:${leaf ? 1 : 0}:${branches.join(',')}:${compare ? 1 : 0}`;
  const [r, setR] = useState<EdSalesReport | null>(() => snapCache.get<EdSalesReport>(cacheKey)?.data ?? null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [qText, setQText] = useState('');
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState(false);
  const [branchSheet, setBranchSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(qText.trim()), 400);
    return () => clearTimeout(t);
  }, [qText]);
  // تغيّر الموضع: البحث يبدأ من جديد والصفحة من أعلاها
  useEffect(() => {
    setQText('');
    setQ('');
    window.scrollTo({ top: 0 });
  }, [node, leaf]);

  async function load(fresh = false) {
    if (span > EDARI_SALES_MAX_DAYS) {
      setErr(`أقصى فترة للتقرير ${EDARI_SALES_MAX_DAYS} يوماً — اختر فترة أقصر`);
      setLoading(false);
      return;
    }
    const id = ++seqRef.current;
    setLoading(true);
    try {
      const data = await edariSalesApi.report({ from, to, branches, node, q: q || undefined, lines: leaf, fresh: fresh || undefined, compare: compare || undefined });
      if (id !== seqRef.current) return;
      setR(data);
      setErr('');
      if (!q) snapCache.set(cacheKey, data);
    } catch (e) {
      if (id !== seqRef.current) return;
      const msg = e instanceof Error ? e.message : '';
      setErr(msg === 'not found' ? 'خادم الفريق لا يعرف هذا التقرير بعد — حدّث الخادم' : msg || 'تعذر تحميل التقرير');
    } finally {
      if (id === seqRef.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [from, to, node, leaf, branches.join(','), q, compare]); // eslint-disable-line react-hooks/exhaustive-deps
  // لقطة محفوظة للموضع الجديد تظهر فوراً بدل التقرير السابق
  useEffect(() => {
    const hit = snapCache.get<EdSalesReport>(cacheKey)?.data;
    if (hit) setR(hit);
  }, [cacheKey]);

  const open = (i: EdSalesItem) => {
    haptic('tap');
    set({ n: String(i.seq), l: i.leaf ? '1' : null }, true);
  };
  const goUp = (seq: number | null) => {
    haptic('select');
    set({ n: seq ? String(seq) : null, l: null }, true);
  };
  const toggleBranch = (code: string) => {
    haptic('select');
    const next = branches.includes(code) ? branches.filter(c => c !== code) : [...branches, code];
    set({ b: next.join(',') || null });
  };

  // التقرير الظاهر يطابق الطلب الحالي (أثناء التحميل يبقى السابق باهتاً)
  const scope = r ? (r.node ? r.nodeTotals : r.totals) : null;
  const included = useMemo(() => {
    const list = r?.items.filter(i => !i.excluded) ?? [];
    if (sort === 'net') return list;
    const change = (i: EdSalesItem) => i.net - (i.prevNet ?? 0);
    return [...list].sort((a, b) => (sort === 'up' ? change(b) - change(a) : change(a) - change(b)));
  }, [r, sort]);
  const excluded = useMemo(() => r?.items.filter(i => i.excluded) ?? [], [r]);
  const peak = Math.max(1, ...included.map(i => Math.abs(i.net)));
  const dayPeak = Math.max(1, ...(r?.days ?? []).map(d => d.net));
  const lineGroups = useMemo(() => {
    const out: { date: string; rows: NonNullable<EdSalesReport['lines']> }[] = [];
    for (const l of r?.lines ?? []) {
      const last = out[out.length - 1];
      if (last && last.date === l.date) last.rows.push(l);
      else out.push({ date: l.date, rows: [l] });
    }
    return out;
  }, [r]);
  const title = node ? (r?.node?.seq === node ? r.node.name : 'الماركات') : 'المبيعات';
  const go = useNavigate();
  const periodLabel = from === to ? (from === today ? 'اليوم' : from === addDays(today, -1) ? 'أمس' : dayName(from)) : `${dayShort(from)} – ${dayShort(to)}`;
  const preset = from === to ? (from === today ? 'day' : from === addDays(today, -1) ? 'yesterday' : 'custom') : from === addDays(today, -6) && to === today ? 'week' : from === `${today.slice(0, 8)}01` && to === today ? 'month' : 'custom';

  async function exportPdf() {
    if (!r || busy) return;
    setBusy(true);
    try {
      await exportHtmlPdf(`edari-sales-${r.from}${r.to !== r.from ? `_${r.to}` : ''}`, await salesPdfHtml(r));
      haptic('success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تصدير الملف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={title}
      subtitle={`${node ? '' : 'حسب الماركات · '}${periodLabel}${branches.length ? ` · ${branches.length === 1 ? (r?.branches.find(b => b.code === branches[0])?.label ?? 'فرع واحد') : `${branches.length} فروع`}` : ''}`}
      hideLarge={!!node}
      start={node ? <BackBtn /> : undefined}
      end={
        <button type="button" className="t-btn soft sm press" disabled={!r || busy} onClick={() => void exportPdf()}>
          {busy ? <span className="spinner" style={{ borderTopColor: 'var(--brand)' }} /> : 'PDF'}
        </button>
      }
      onRefresh={() => load(true)}
    >
      {!node && (
        <div className="s-switch">
          <Segmented
            items={[
              { id: 'live', label: 'اليوم' },
              { id: 'day', label: 'يوم سابق' },
              { id: 'range', label: 'فترات' },
              { id: 'brands', label: 'الماركات' },
            ]}
            value="brands"
            onChange={v => v !== 'brands' && go(v === 'live' ? '/m/sales' : `/m/sales?v=${v}`, { replace: true })}
          />
        </div>
      )}
      {/* الفترة */}
      <div className="c-nav">
        <button type="button" className="t-icon-btn press" aria-label="اليوم السابق" onClick={() => (haptic('select'), setCustom(false), setRange(addDays(from, -1), addDays(from, -1)))}>
          <I.chevron size={18} />
        </button>
        <div className="day">
          <b>{periodLabel}</b>
          <small className="num">{from === to ? dmy(from) : `${span + 1} يوماً`}</small>
        </div>
        <button type="button" className="t-icon-btn press flip" aria-label="اليوم التالي" disabled={to >= today} onClick={() => (haptic('select'), setCustom(false), setRange(addDays(to, 1), addDays(to, 1)))}>
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
          <button key={id} type="button" className={`m-pill press ${!custom && preset === id ? 'on' : ''}`} onClick={() => (haptic('select'), setCustom(false), setRange(f, t))}>
            {label}
          </button>
        ))}
        <button type="button" className={`m-pill press ${custom || preset === 'custom' ? 'on' : ''}`} onClick={() => (haptic('select'), setCustom(v => !v))}>
          فترة محددة
        </button>
        <button type="button" className={`m-pill press ${branches.length ? 'on' : ''}`} onClick={() => (haptic('tap'), setBranchSheet(true))}>
          {branches.length ? `الفروع (${branches.length})` : 'كل الفروع'}
        </button>
        <button type="button" className={`m-pill press ${compare ? 'on' : ''}`} aria-pressed={compare} onClick={() => (haptic('select'), set({ c: compare ? null : '1', s: null }))}>
          مقارنة بالسابق
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

      {err && <ErrorLine text={err} onRetry={() => void load(true)} />}
      {!r && loading && (
        <>
          <Skeleton h={150} r={22} mt={14} />
          <Skeleton h={320} r={20} mt={12} />
        </>
      )}

      {r && scope && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          {/* المسار */}
          {r.path.length > 0 && (
            <nav className="e-path" aria-label="المسار">
              <button type="button" className="press" onClick={() => goUp(null)}>
                كل الأشجار
              </button>
              {r.path.map((p, i) => (
                <span key={p.seq}>
                  <I.chevron size={12} />
                  {i < r.path.length - 1 ? (
                    <button type="button" className="press" onClick={() => goUp(p.seq)}>
                      {p.name}
                    </button>
                  ) : (
                    <b>{p.name}</b>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* المؤشرات */}
          <div className="c-sum">
            <div className="end e-wide">
              <span>{r.node ? `صافي ${r.node.name}` : 'الصافي'} · المبيعات − المردود</span>
              <b className="num">{n0(scope.net)}</b>
              {r.prevFrom && (r.node ? r.prevNodeTotals : r.prevTotals) && (
                <small>
                  <Delta net={scope.net} prev={(r.node ? r.prevNodeTotals : r.prevTotals)!.net} /> عن{' '}
                  {r.prevFrom === r.prevTo ? (r.prevFrom === addDays(today, -1) ? 'أمس' : dayName(r.prevFrom)) : `${dayShort(r.prevFrom)} – ${dayShort(r.prevTo!)}`} (
                  <span className="num">{n0((r.node ? r.prevNodeTotals : r.prevTotals)!.net)}</span>)
                </small>
              )}
              <small>
                {r.node ? (
                  <>
                    {r.totals.net ? ((scope.net / r.totals.net) * 100).toFixed(1) : '0'}% من إجمالي المحل (<span className="num">{n0(r.totals.net)}</span>)
                  </>
                ) : (
                  <>
                    <span className="num">{fmt(r.invoices)}</span> فاتورة · د.ع
                  </>
                )}
              </small>
            </div>
            <div className="in">
              <span>المبيعات · {qty(scope.salesQty)} قطعة</span>
              <b className="num">{n0(scope.sales)}</b>
            </div>
            <div className="out">
              <span>المردود · {qty(scope.returnsQty)} قطعة</span>
              <b className="num">{n0(scope.returns)}</b>
            </div>
            <div className="gift e-wide">
              <span>الهدايا · {qty(scope.giftsQty)} قطعة (فواتير الهدايا والبونص)</span>
              <b className="num">{n0(scope.gifts)}</b>
            </div>
          </div>

          {/* الأيام */}
          {!r.node && r.days.length > 1 && (
            <section className="t-section">
              <div className="t-section-head">
                <h2>الصافي اليومي</h2>
              </div>
              <div className="t-card pad">
                <div className="e-days" role="img" aria-label="الصافي لكل يوم">
                  {r.days.map(d => (
                    <button
                      key={d.date}
                      type="button"
                      className="col"
                      aria-label={`${dayName(d.date)}: صافي ${n0(d.net)}`}
                      onClick={() => (haptic('select'), setCustom(false), setRange(d.date, d.date))}
                    >
                      <i style={{ height: `${d.net > 0 ? Math.max(4, (d.net / dayPeak) * 100) : 0}%` }} />
                      {r.days.length <= 16 || Number(d.date.slice(8)) % 5 === 1 ? <small className="num">{Number(d.date.slice(8))}</small> : <small />}
                    </button>
                  ))}
                </div>
                <p className="t-hint" style={{ marginTop: 8 }}>
                  المتوسط <span className="num">{n0(r.days.reduce((s, d) => s + d.net, 0) / r.days.length)}</span> يومياً — اضغط يوماً لتفصيله
                </p>
              </div>
            </section>
          )}

          {/* حركات المادة */}
          {r.lines ? (
            <>
              {lineGroups.length === 0 ? (
                <Empty icon={<I.box size={28} />} title="لا حركات لهذه المادة في الفترة" text="جرّب فترة أطول من الأزرار في الأعلى." />
              ) : (
                lineGroups.map(g => {
                  const total = g.rows.reduce((s, l) => s + l.total, 0);
                  return (
                    <section key={g.date} className="c-day">
                      <div className="head">
                        <b>{g.date === today ? 'اليوم' : dayName(g.date)}</b>
                        <small className="num">
                          {g.rows.length} حركة · {n0(total)}
                        </small>
                      </div>
                      <div className="t-list">
                        {g.rows.map((l, i) => (
                          <div key={i} className="c-line">
                            <span className={`dir ${l.total < 0 ? 'out' : 'in'}`} aria-hidden>
                              <I.receipt size={15} />
                            </span>
                            <div className="body">
                              <div className="title">
                                فاتورة <span className="num">{l.invNum}</span>
                                {l.kind === 6 || l.total < 0 ? <em className={`e-kind ${l.kind === 6 ? 'gift' : 'ret'}`}>{l.kindLabel}</em> : null}
                              </div>
                              <div className="sub">
                                {l.branch}
                                {l.seller ? ` · ${l.seller}` : ''}
                              </div>
                            </div>
                            <div className="end">
                              <b className={l.total < 0 ? 'out' : ''}>
                                <span className="num ltr">{n0(l.total)}</span>
                              </b>
                              <small className="num">
                                {qty(l.qty)}
                                {l.bonus > 0 ? ` +${qty(l.bonus)}` : ''} × {n0(l.price)}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
              {r.linesTruncated && <p className="t-hint bad">عُرضت أحدث {r.lines.length} حركة — اختر فترة أقصر لرؤية البقية.</p>}
            </>
          ) : (
            <section className="t-section">
              <div className="t-section-head">
                <h2>{r.search ? 'نتائج البحث' : r.node ? 'المجموعات والمواد' : 'أشجار المواد'}</h2>
                {!r.search && included.length > 0 && <span className="more num">{included.length}</span>}
              </div>
              {compare && !r.search && included.length > 1 && (
                <div className="t-scroller" style={{ gap: 8, marginBottom: 10 }}>
                  {(
                    [
                      ['net', 'الأعلى صافياً'],
                      ['up', 'الأكثر نمواً'],
                      ['down', 'الأكثر تراجعاً'],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" className={`m-pill press ${sort === id ? 'on' : ''}`} onClick={() => (haptic('select'), set({ s: id === 'net' ? null : id }))}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <label className="t-search">
                <I.search />
                <input placeholder={r.node ? `ابحث عن مادة في ${r.node.name}` : 'ابحث عن مادة بالاسم أو الباركود'} value={qText} onChange={e => setQText(e.target.value)} />
                {qText && (
                  <button type="button" aria-label="مسح البحث" onClick={() => setQText('')}>
                    <I.close size={16} />
                  </button>
                )}
              </label>
              {r.items.length === 0 ? (
                <Empty icon={<I.box size={28} />} title={r.search ? 'لا مادة مطابقة لها حركة' : 'لا مبيعات في هذه الفترة'} text={r.search ? 'جرّب اسماً آخر أو فترة أطول.' : undefined} />
              ) : (
                <div className="t-list" style={{ marginTop: 10 }}>
                  {included.map(i => (
                    <ItemRow key={i.seq} item={i} peak={peak} total={scope.net} onOpen={() => open(i)} />
                  ))}
                </div>
              )}
              {excluded.length > 0 && (
                <>
                  <p className="t-hint" style={{ marginTop: 14, lineHeight: 1.8 }}>
                    خارج الإجمالي (أشجار رقمها 1000 فأكثر: سوالب، مواد مجرودة، عمولات…) — كما في تطبيق الحسابات. صافيها <span className="num">{n0(excluded.reduce((s, i) => s + i.net, 0))}</span>.
                  </p>
                  <div className="t-list e-excluded">
                    {excluded.map(i => (
                      <ItemRow key={i.seq} item={i} peak={peak} total={0} onOpen={() => open(i)} />
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* الفروع */}
          {!r.node && r.branches.some(b => b.invoices > 0) && (
            <section className="t-section">
              <div className="t-section-head">
                <h2>الفروع</h2>
                <span className="more">كل المواد · اضغط للفلترة</span>
              </div>
              <div className="t-list">
                {r.branches
                  .filter(b => b.invoices > 0 || branches.includes(b.code))
                  .map(b => {
                    const on = branches.includes(b.code);
                    return (
                      <button
                        key={b.code || 'none'}
                        type="button"
                        className={`t-row press-soft ${on ? 'e-on' : ''}`}
                        disabled={!b.code}
                        onClick={() => b.code && toggleBranch(b.code)}
                      >
                        <span className={`t-tile ${on ? 'accent' : b.code ? 'ok' : 'mute'}`}>
                          <I.store size={18} />
                        </span>
                        <div className="body">
                          <div className="title">{b.label}</div>
                          <div className="sub">
                            <span className="num">{b.invoices}</span> فاتورة
                            {b.returns ? (
                              <>
                                {' '}
                                · مردود <span className="num">{n0(b.returns)}</span>
                              </>
                            ) : null}
                            {b.gifts ? (
                              <>
                                {' '}
                                · هدايا <span className="num">{n0(b.gifts)}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="end">
                          <b className="num">{n0(b.net)}</b>
                          {on && <small>مفلتر</small>}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </section>
          )}

          {/* أكثر المواد */}
          {r.topMaterials.length > 0 && !r.search && (
            <section className="t-section">
              <div className="t-section-head">
                <h2>أكثر المواد مبيعاً</h2>
              </div>
              <div className="t-list">
                {r.topMaterials.slice(0, 15).map((m, i) => (
                  <button key={m.seq} type="button" className="t-row press-soft" onClick={() => open(m)}>
                    <span className="t-tile mute e-rank num">{i + 1}</span>
                    <div className="body">
                      <div className="title">{m.name}</div>
                      <div className="sub">
                        {m.tree} · <span className="num">{qty(m.salesQty)}</span> قطعة
                      </div>
                    </div>
                    <div className="end">
                      <b className="num">{n0(m.sales)}</b>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <p className="t-hint" style={{ marginTop: 16, lineHeight: 1.8 }}>
            بنفس حساب تطبيق الحسابات · {new Date(r.at).toLocaleTimeString(LOC, { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      )}

      <Sheet open={branchSheet} onClose={() => setBranchSheet(false)} title="الفروع" subtitle="اختر فرعاً أو أكثر — بلا اختيار تظهر كل الفروع">
        <div className="t-list">
          {(r?.branches ?? [])
            .filter(b => b.code)
            .map(b => {
              const on = branches.includes(b.code);
              return (
                <button key={b.code} type="button" className={`t-row press-soft ${on ? 'e-on' : ''}`} onClick={() => toggleBranch(b.code)}>
                  <span className={`t-tile ${on ? 'accent' : 'mute'}`}>{on ? <I.check size={18} /> : <I.store size={18} />}</span>
                  <div className="body">
                    <div className="title">{b.label}</div>
                    <div className="sub">
                      <span className="num">{b.invoices}</span> فاتورة في الفترة
                    </div>
                  </div>
                  <div className="end">
                    <b className="num">{n0(b.net)}</b>
                  </div>
                </button>
              );
            })}
        </div>
        <div className="t-row-2" style={{ marginTop: 14 }}>
          <button type="button" className="t-btn soft press" disabled={!branches.length} onClick={() => (set({ b: null }), setBranchSheet(false))}>
            كل الفروع
          </button>
          <button type="button" className="t-btn press" onClick={() => setBranchSheet(false)}>
            تم
          </button>
        </div>
      </Sheet>
    </Screen>
  );
}

function ItemRow({ item, peak, total, onOpen }: { item: EdSalesItem; peak: number; total: number; onOpen: () => void }) {
  const share = total > 0 ? (item.net / total) * 100 : 0;
  return (
    <button type="button" className="t-row press-soft e-item" onClick={onOpen}>
      <span className={`t-tile ${item.leaf ? 'mute' : 'accent'}`}>{item.leaf ? <I.box size={18} /> : <I.tag size={18} />}</span>
      <div className="body">
        <div className="title">{item.name || '—'}</div>
        <div className="sub">
          <span className="num">{qty(item.salesQty)}</span> قطعة
          {item.returns ? (
            <>
              {' '}
              · مردود <span className="num">{n0(item.returns)}</span>
            </>
          ) : null}
          {item.gifts ? (
            <>
              {' '}
              · هدايا <span className="num">{n0(item.gifts)}</span>
            </>
          ) : null}
        </div>
        {total > 0 && (
          <span className="e-bar" aria-hidden>
            <i style={{ width: `${Math.max(2, Math.min(100, (Math.abs(item.net) / peak) * 100))}%` }} />
          </span>
        )}
      </div>
      <div className="end">
        <b className="num">{n0(item.net)}</b>
        {item.prevNet != null ? (
          <small>
            <Delta net={item.net} prev={item.prevNet} />
          </small>
        ) : (
          total > 0 && <small className="num">{share.toFixed(share >= 10 ? 0 : 1)}%</small>
        )}
      </div>
    </button>
  );
}

/** التقرير المعروض على A4 */
async function salesPdfHtml(r: EdSalesReport) {
  const scope = r.node ? r.nodeTotals : r.totals;
  const period = r.from === r.to ? dayName(r.from) : `من ${dmy(r.from)} إلى ${dmy(r.to)}`;
  const title = r.node ? r.path.map(p => p.name).join(' ‹ ') : 'كل أشجار المواد';
  const filter = r.branchFilter.length ? r.branches.filter(b => r.branchFilter.includes(b.code)).map(b => b.label).join('، ') : '';
  const itemRow = (i: EdSalesItem) => `<tr><td class="num sub">${esc(i.barcode || i.num)}</td><td>${esc(i.name)}${i.tree ? `<div class="sub">${esc(i.tree)}</div>` : ''}</td>
    <td class="e num">${qty(i.salesQty)}</td><td class="e num in">${i.sales ? n0(i.sales) : ''}</td><td class="e num gf">${i.gifts ? n0(i.gifts) : ''}</td><td class="e num out">${i.returns ? n0(i.returns) : ''}</td><td class="e num bal">${n0(i.net)}</td></tr>`;
  const inc = r.items.filter(i => !i.excluded);
  const exc = r.items.filter(i => i.excluded);
  let main: string;
  if (r.lines) {
    main = `<table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>الفرع</th><th class="e">الكمية</th><th class="e">السعر</th><th class="e">المجموع</th></tr></thead><tbody>${
      r.lines
        .map(l => `<tr><td class="num">${dmy(l.date)}</td><td><span class="num">${esc(l.invNum)}</span> <span class="sub">${esc(l.kindLabel)}</span></td><td>${esc(l.branch)}${l.seller ? `<div class="sub">${esc(l.seller)}</div>` : ''}</td>
        <td class="e num">${qty(l.qty)}${l.bonus > 0 ? ` +${qty(l.bonus)}` : ''}</td><td class="e num">${n0(l.price)}</td><td class="e num bal ${l.total < 0 ? 'out' : ''}">${n0(l.total)}</td></tr>`)
        .join('') || '<tr><td colspan="6" style="text-align:center;color:#6c6578;padding:18px">لا حركات في هذه الفترة</td></tr>'
    }</tbody></table>`;
  } else {
    main = `<table><thead><tr><th style="width:86px">الرقم</th><th>${r.node ? 'المجموعة / المادة' : 'شجرة المواد'}</th><th class="e">الكمية</th><th class="e">المبيعات</th><th class="e">الهدايا</th><th class="e">المردود</th><th class="e">الصافي</th></tr></thead><tbody>
      ${inc.map(itemRow).join('') || '<tr><td colspan="7" style="text-align:center;color:#6c6578;padding:18px">لا مبيعات في هذه الفترة</td></tr>'}
      ${inc.length && !r.search ? `<tr class="open"><td colspan="2">الإجمالي</td><td class="e num">${qty(scope.salesQty)}</td><td class="e num">${n0(scope.sales)}</td><td class="e num">${n0(scope.gifts)}</td><td class="e num">${n0(scope.returns)}</td><td class="e num bal">${n0(scope.net)}</td></tr>` : ''}
      ${exc.length ? `<tr class="day"><td colspan="7">خارج الإجمالي (رقم الشجرة 1000 فأكثر)</td></tr>${exc.map(itemRow).join('')}` : ''}
    </tbody></table>`;
  }
  const branches = r.node
    ? ''
    : `<h3>الفروع <span>(كل المواد)</span></h3><table><thead><tr><th>الفرع</th><th class="e">الفواتير</th><th class="e">المبيعات</th><th class="e">المردود</th><th class="e">الهدايا</th><th class="e">الصافي</th></tr></thead><tbody>${r.branches
        .filter(b => b.invoices > 0)
        .map(b => `<tr><td>${esc(b.label)}</td><td class="e num">${b.invoices}</td><td class="e num in">${n0(b.sales)}</td><td class="e num out">${b.returns ? n0(b.returns) : ''}</td><td class="e num gf">${b.gifts ? n0(b.gifts) : ''}</td><td class="e num bal">${n0(b.net)}</td></tr>`)
        .join('')}</tbody></table>`;
  const days =
    r.node || r.days.length < 2
      ? ''
      : `<h3>الأيام</h3><table><thead><tr><th>اليوم</th><th class="e">الفواتير</th><th class="e">المبيعات</th><th class="e">المردود</th><th class="e">الهدايا</th><th class="e">الصافي</th></tr></thead><tbody>${r.days
          .map(d => `<tr><td>${esc(dayName(d.date))}</td><td class="e num">${d.invoices}</td><td class="e num in">${n0(d.sales)}</td><td class="e num out">${d.returns ? n0(d.returns) : ''}</td><td class="e num gf">${d.gifts ? n0(d.gifts) : ''}</td><td class="e num bal">${n0(d.net)}</td></tr>`)
          .join('')}</tbody></table>`;
  const body = `<style>
    h3 { font-size: 12.5px; margin: 16px 0 4px; color: #4c2a85; } h3 span { font-size: 9.5px; font-weight: 400; color: #6c6578; }
    td.gf { color: #b0661a; } .kpi.gf b { color: #b0661a; }
  </style>
  <div class="kpis">
    <div class="kpi in"><span>المبيعات (${qty(scope.salesQty)} قطعة)</span><b class="num">${n0(scope.sales)}</b></div>
    <div class="kpi out"><span>المردود (${qty(scope.returnsQty)} قطعة)</span><b class="num">${n0(scope.returns)}</b></div>
    <div class="kpi gf"><span>الهدايا (${qty(scope.giftsQty)} قطعة)</span><b class="num">${n0(scope.gifts)}</b></div>
    <div class="kpi end"><span>الصافي (د.ع)</span><b class="num">${n0(scope.net)}</b></div>
  </div>
  ${!r.node && r.excludedNet ? `<div class="note">الإجمالي يستثني الأشجار التي رقمها 1000 فأكثر وصافيها ${n0(r.excludedNet)} — كما في تطبيق الحسابات.</div>` : ''}
  ${main}${branches}${days}`;
  return pdfShell(`edari-sales-${r.from}_${r.to}`, 'تقرير المبيعات', `${esc(title)}${filter ? ` · ${esc(filter)}` : ''}<br>${esc(period)}`, body);
}
