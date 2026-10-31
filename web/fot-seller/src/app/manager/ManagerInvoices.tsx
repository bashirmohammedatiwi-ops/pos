import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cleanName } from '../../names';
import { Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, fmt, toast } from '../kit';
import { exportHtmlPdf, haptic } from '../native';
import { BackBtn } from '../parts';
import { invoicesApi, onLive, type InvoiceDetail, type InvoiceFacets, type InvoiceList, type InvoiceRow } from '../work';
import { invoiceFileBase, invoicePdfHtml } from './invoicePdf';

/* ────────────────────────────────────────────────────────────
 * كل فواتير المحل للمدير (صلاحية viewInvoices):
 *   القائمة  — بحث برقم الفاتورة أو المادة أو الباركود، فترات وفلاتر، ملخص يطابق الفلتر،
 *              مجمّعة بالأيام مع تحميل تلقائي عند النزول، وتصل الفواتير الجديدة مباشرة.
 *   الفاتورة — موادها وأسعارها وخصوماتها والدفع والبائع والمرتجعات المرتبطة، وتصدير PDF.
 * أوقات السيرفر محلية (بغداد) بلا منطقة زمنية.
 * ──────────────────────────────────────────────────────────── */

const LOC = 'ar-IQ-u-nu-latn';
const KIND_LABEL: Record<number, string> = { 0: 'بيع', 1: 'مرتجع', 2: 'هدية' };

type Period = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';
type Filters = {
  q: string;
  period: Period;
  from: string;
  to: string;
  kind: 'all' | '0' | '1' | '2';
  sort: 'new' | 'old' | 'high' | 'low';
  pay: '' | 'cash' | 'card';
  cashier: string;
  seller: string;
  pos: string;
  min: string;
  max: string;
};
const NO_FILTERS: Filters = { q: '', period: 'all', from: '', to: '', kind: 'all', sort: 'new', pay: '', cashier: '', seller: '', pos: '', min: '', max: '' };

const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: 'week', label: '7 أيام' },
  { id: 'month', label: 'هذا الشهر' },
  { id: 'lastMonth', label: 'الشهر الماضي' },
  { id: 'custom', label: 'تحديد' },
];

const baghdadDay = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function rangeOf(f: Filters): { from?: string; to?: string } {
  const t = baghdadDay();
  switch (f.period) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'week':
      return { from: addDays(t, -6), to: t };
    case 'month':
      return { from: `${t.slice(0, 7)}-01`, to: t };
    case 'lastMonth': {
      const end = addDays(`${t.slice(0, 7)}-01`, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case 'custom':
      return { from: f.from || undefined, to: f.to || undefined };
    default:
      return {};
  }
}
function paramsOf(f: Filters) {
  const p = new URLSearchParams();
  const { from, to } = rangeOf(f);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.kind !== 'all') p.set('kind', f.kind);
  if (f.sort !== 'new') p.set('sort', f.sort);
  if (f.pay) p.set('pay', f.pay);
  if (f.cashier) p.set('cashier', f.cashier);
  if (f.seller) p.set('seller', f.seller);
  if (f.pos) p.set('pos', f.pos);
  if (Number(f.min) > 0) p.set('min', String(Number(f.min)));
  if (Number(f.max) > 0) p.set('max', String(Number(f.max)));
  return p;
}
const extraCount = (f: Filters) => [f.sort !== 'new', f.pay, f.cashier, f.seller, f.pos, Number(f.min) > 0, Number(f.max) > 0].filter(Boolean).length;

const clock = (s: string) => new Date(`${s.slice(0, 19)}+03:00`).toLocaleTimeString(LOC, { timeZone: 'Asia/Baghdad', hour: 'numeric', minute: '2-digit' });
const dayTitle = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(LOC, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayHead = (day: string) => {
  const t = baghdadDay();
  if (day === t) return 'اليوم';
  if (day === addDays(t, -1)) return 'أمس';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(LOC, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
};
const qty = (n: number) => (Number.isInteger(n) ? fmt(n) : n.toFixed(2).replace(/0+$/, ''));

function KindTile({ kind }: { kind: number }) {
  return (
    <span className={`t-tile ${kind === 1 ? 'bad' : kind === 2 ? 'accent' : 'ok'}`}>
      {kind === 1 ? <I.refresh size={17} /> : kind === 2 ? <I.sparkle size={17} /> : <I.receipt size={17} />}
    </span>
  );
}
const Amount = ({ kind, value }: { kind: number; value: number }) => (
  <b className={`num ${kind === 1 ? 'ltr s-neg' : ''}`}>
    {kind === 1 ? '−' : ''}
    {fmt(value)}
  </b>
);

/** تبقى القائمة وموضعها عند الرجوع من تفاصيل فاتورة */
let saved: { filters: Filters; data: InvoiceList; scrollY: number } | null = null;

export function MInvoices() {
  const [filters, setFilters] = useState<Filters>(saved?.filters ?? NO_FILTERS);
  const [data, setData] = useState<InvoiceList | null>(saved?.data ?? null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!saved);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const req = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async (f: Filters, quiet = false) => {
    const id = ++req.current;
    if (!quiet) setLoading(true);
    setErr('');
    try {
      const out = await invoicesApi.list(paramsOf(f), 0);
      if (id !== req.current) return;
      setData(prev => {
        if (!quiet || !prev || prev.rows.length <= out.rows.length) return out;
        // تحديث هادئ بعد النزول في القائمة: نُبقي ما حُمّل ونضيف الجديد في الأعلى
        const fresh = new Set(out.rows.map(r => r.id));
        return { ...out, rows: [...out.rows, ...prev.rows.filter(r => !fresh.has(r.id))], days: { ...prev.days, ...out.days }, hasMore: prev.hasMore };
      });
    } catch (e) {
      if (id === req.current) setErr(e instanceof Error ? e.message : 'تعذر تحميل الفواتير');
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cur = dataRef.current;
    if (!cur?.hasMore) return;
    setMore(true);
    const id = req.current;
    try {
      const out = await invoicesApi.list(paramsOf(filtersRef.current), cur.rows.length);
      if (id !== req.current) return;
      setData(prev => {
        if (!prev) return out;
        const have = new Set(prev.rows.map(r => r.id));
        return { ...prev, rows: [...prev.rows, ...out.rows.filter(r => !have.has(r.id))], days: { ...prev.days, ...out.days }, hasMore: out.hasMore };
      });
    } catch {
      toast('تعذر تحميل المزيد');
    } finally {
      setMore(false);
    }
  }, []);

  // أول فتح (أو رجوع): نحدّث بهدوء ونعيد موضع التمرير
  useEffect(() => {
    const back = saved;
    void load(filtersRef.current, !!back);
    if (back) window.requestAnimationFrame(() => window.scrollTo(0, back.scrollY));
    return () => {
      if (dataRef.current) saved = { filters: filtersRef.current, data: dataRef.current, scrollY: window.scrollY };
    };
  }, [load]);

  const apply = (next: Filters) => {
    setFilters(next);
    window.scrollTo(0, 0);
    void load(next);
  };

  // بحث مؤجَّل أثناء الكتابة
  useEffect(() => {
    if (search === filters.q) return;
    const t = window.setTimeout(() => apply({ ...filtersRef.current, q: search }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // فاتورة جديدة في المحل
  useEffect(
    () =>
      onLive(m => {
        if (m.event === 'invoices') void load(filtersRef.current, true);
      }),
    [load],
  );

  // تحميل تلقائي عند الوصول لآخر القائمة
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void loadMore(), { rootMargin: '500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, data?.hasMore]);

  const groups = useMemo(() => {
    const rows = data?.rows ?? [];
    if (filters.sort === 'high' || filters.sort === 'low') return [{ day: '', rows }];
    const out: { day: string; rows: InvoiceRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last?.day === r.day) last.rows.push(r);
      else out.push({ day: r.day, rows: [r] });
    }
    return out;
  }, [data?.rows, filters.sort]);

  const extras = extraCount(filters);
  const s = data?.summary;
  const anyFilter = extras > 0 || filters.q || filters.kind !== 'all' || filters.period !== 'all';
  const sync = data?.sync;

  return (
    <Screen
      title="الفواتير"
      subtitle={s ? `${fmt(s.count)} فاتورة` : undefined}
      start={<BackBtn to="/m/more" />}
      end={
        <button type="button" className="t-icon-btn press iv-filter-btn" aria-label="الفلاتر" onClick={() => setSheet(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
          {extras > 0 && <span className="iv-dot num">{extras}</span>}
        </button>
      }
      onRefresh={() => load(filters, true)}
    >
      <label className="t-search iv-search">
        <I.search size={18} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="رقم الفاتورة، مادة، باركود، بائع…" enterKeyHint="search" />
        {search && (
          <button type="button" className="iv-clear" aria-label="مسح البحث" onClick={() => setSearch('')}>
            <I.close size={16} />
          </button>
        )}
      </label>

      <div className="s-presets iv-periods">
        {PERIODS.map(p => (
          <button
            key={p.id}
            type="button"
            className={`t-chip press ${filters.period === p.id ? 'on' : ''}`}
            onClick={() => {
              haptic('tap');
              if (p.id === 'custom') setSheet(true);
              else apply({ ...filters, period: p.id });
            }}
          >
            {p.id === 'custom' && filters.period === 'custom' && (filters.from || filters.to) ? `${filters.from || '…'} ← ${filters.to || '…'}` : p.label}
          </button>
        ))}
      </div>

      <Segmented
        items={[
          { id: 'all', label: 'الكل' },
          { id: '0', label: 'بيع' },
          { id: '1', label: 'مرتجع' },
          { id: '2', label: 'هدية' },
        ]}
        value={filters.kind}
        onChange={kind => apply({ ...filters, kind })}
      />

      {sync && (sync.pendingDays ?? 0) > 0 && (
        <p className="iv-note">
          <I.refresh size={15} /> يجري نقل الفواتير الأقدم من المحل — بقي <span className="num">{fmt(sync.pendingDays ?? 0)}</span> يوم، والأرقام هنا تشمل ما وصل فقط.
        </p>
      )}

      {err && !data && <ErrorLine text={err} onRetry={() => void load(filters)} />}

      {s && s.count > 0 && (
        <section className="t-card iv-sum">
          <div className="iv-sum-head">
            <span>الصافي</span>
            <b className={`num ${s.net < 0 ? 'ltr s-neg' : ''}`}>
              {s.net < 0 ? '−' : ''}
              {fmt(Math.abs(s.net))}
              <small> د.ع</small>
            </b>
          </div>
          <div className="iv-sum-grid">
            <div>
              <small>بيع</small>
              <b className="num">{fmt(s.sales)}</b>
            </div>
            <div>
              <small>مرتجع</small>
              <b className="num">{fmt(s.returns)}</b>
              {s.returnsTotal > 0 && <i className="num ltr s-neg">−{fmt(s.returnsTotal)}</i>}
            </div>
            <div>
              <small>هدية</small>
              <b className="num">{fmt(s.gifts)}</b>
            </div>
            <div>
              <small>قطعة</small>
              <b className="num">{fmt(s.pieces)}</b>
            </div>
          </div>
        </section>
      )}

      {loading && !data?.rows.length ? (
        <>
          <Skeleton h={108} r={22} mt={12} />
          <Skeleton h={72} r={18} mt={12} />
          <Skeleton h={72} r={18} mt={8} />
          <Skeleton h={72} r={18} mt={8} />
        </>
      ) : data && !data.rows.length ? (
        anyFilter ? (
          <Empty icon={<I.search size={30} />} title="لا فواتير مطابقة" text="جرّب تغيير الفترة أو البحث أو الفلاتر." action={<button type="button" className="t-btn press" onClick={() => { setSearch(''); apply(NO_FILTERS); }}>إزالة الفلاتر</button>} />
        ) : (
          <Empty icon={<I.receipt size={30} />} title="لم تصل فواتير بعد" text="تبدأ الفواتير بالوصول بعد تحديث سيرفر المحل إلى الإصدار الجديد." />
        )
      ) : (
        groups.map(g => (
          <section key={g.day || 'all'} className="iv-day">
            {g.day && (
              <div className="iv-day-head">
                <b>{dayHead(g.day)}</b>
                {data?.days[g.day] && (
                  <small className="num">
                    {fmt(data.days[g.day].n)} فاتورة · {fmt(data.days[g.day].net)}
                  </small>
                )}
              </div>
            )}
            <div className="t-list flat iv-list">
              {g.rows.map(r => (
                <Link key={r.id} to={`/m/invoices/${r.id}`} className="t-row press" onClick={() => haptic('tap')}>
                  <KindTile kind={r.kind} />
                  <div className="body">
                    <div className="title">
                      <span className="num">#{r.number}</span>
                      {r.kind !== 0 && <span className={`iv-tag ${r.kind === 1 ? 'bad' : 'gift'}`}>{KIND_LABEL[r.kind]}</span>}
                      {r.card && <span className="s-card-tag">بطاقة</span>}
                      {r.edited && <span className="iv-tag">معدّلة</span>}
                    </div>
                    <div className="sub iv-preview">
                      {r.preview || '—'}
                      {r.lines > 1 ? ` +${r.lines - 1}` : ''}
                    </div>
                    <div className="sub">
                      {clock(r.at)}
                      {!g.day ? ` · ${dayHead(r.day)}` : ''}
                      {r.cashier ? ` · ${cleanName(r.cashier)}` : ''}
                    </div>
                  </div>
                  <div className="end">
                    <Amount kind={r.kind} value={r.total} />
                    <small className="num">{qty(r.pieces)} قطعة</small>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
      <div ref={end} />
      {more && <Skeleton h={72} r={18} mt={8} />}

      <FiltersSheet
        open={sheet}
        value={filters}
        onClose={() => setSheet(false)}
        onApply={f => {
          setSheet(false);
          apply(f);
        }}
        onReset={() => {
          setSheet(false);
          setSearch('');
          apply(NO_FILTERS);
        }}
      />
    </Screen>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="t-field">
      <span>{label}</span>
      <select className="t-input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">الكل</option>
        {options.map(o => (
          <option key={o} value={o}>
            {cleanName(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function FiltersSheet({ open, value, onClose, onApply, onReset }: { open: boolean; value: Filters; onClose: () => void; onApply: (f: Filters) => void; onReset: () => void }) {
  const [d, setD] = useState(value);
  const [facets, setFacets] = useState<InvoiceFacets | null>(null);
  useEffect(() => {
    if (!open) return;
    setD(value);
    invoicesApi.facets(paramsOf({ ...NO_FILTERS, period: value.period, from: value.from, to: value.to })).then(setFacets).catch(() => setFacets(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const chip = <K extends 'sort' | 'pay'>(k: K, v: Filters[K], label: string) => (
    <button type="button" className={`t-chip press ${d[k] === v ? 'on' : ''}`} onClick={() => setD({ ...d, [k]: v })}>
      {label}
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title="تصفية الفواتير">
      <div className="iv-form">
        <div className="t-row-2">
          <label className="t-field">
            <span>من تاريخ</span>
            <input className="t-input num" type="date" value={d.period === 'custom' ? d.from : ''} onChange={e => setD({ ...d, period: 'custom', from: e.target.value })} />
          </label>
          <label className="t-field">
            <span>إلى تاريخ</span>
            <input className="t-input num" type="date" value={d.period === 'custom' ? d.to : ''} onChange={e => setD({ ...d, period: 'custom', to: e.target.value })} />
          </label>
        </div>
        <div className="t-field">
          <span>الترتيب</span>
          <div className="t-chips">
            {chip('sort', 'new', 'الأحدث')}
            {chip('sort', 'old', 'الأقدم')}
            {chip('sort', 'high', 'الأعلى مبلغاً')}
            {chip('sort', 'low', 'الأقل مبلغاً')}
          </div>
        </div>
        <div className="t-field">
          <span>طريقة الدفع</span>
          <div className="t-chips">
            {chip('pay', '', 'الكل')}
            {chip('pay', 'cash', 'نقد')}
            {chip('pay', 'card', 'بطاقة')}
          </div>
        </div>
        <Select label="الكاشير" value={d.cashier} options={facets?.cashiers ?? (d.cashier ? [d.cashier] : [])} onChange={cashier => setD({ ...d, cashier })} />
        <Select label="البائع" value={d.seller} options={facets?.sellers ?? (d.seller ? [d.seller] : [])} onChange={seller => setD({ ...d, seller })} />
        <Select label="نقطة البيع" value={d.pos} options={facets?.pos ?? (d.pos ? [d.pos] : [])} onChange={pos => setD({ ...d, pos })} />
        <div className="t-row-2">
          <label className="t-field">
            <span>المبلغ من</span>
            <input className="t-input num" inputMode="numeric" value={d.min} onChange={e => setD({ ...d, min: e.target.value.replace(/\D/g, '') })} placeholder="0" />
          </label>
          <label className="t-field">
            <span>المبلغ إلى</span>
            <input className="t-input num" inputMode="numeric" value={d.max} onChange={e => setD({ ...d, max: e.target.value.replace(/\D/g, '') })} placeholder="بلا حد" />
          </label>
        </div>
        <div className="iv-form-actions">
          <button type="button" className="t-btn soft press" onClick={onReset}>
            إعادة ضبط
          </button>
          <button type="button" className="t-btn press" onClick={() => onApply(d)}>
            عرض النتائج
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ═════════════ تفاصيل الفاتورة ═════════════ */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="iv-info">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

export function MInvoice() {
  const { id } = useParams();
  const nav = useNavigate();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      setInv(await invoicesApi.get(Number(id)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر تحميل الفاتورة');
    }
  }, [id]);
  useEffect(() => {
    setInv(null);
    window.scrollTo(0, 0);
    void load();
  }, [load]);

  const exportPdf = async () => {
    if (!inv || busy) return;
    setBusy(true);
    haptic('tap');
    try {
      await exportHtmlPdf(invoiceFileBase(inv), await invoicePdfHtml(inv));
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'تعذر تصدير الملف');
    } finally {
      setBusy(false);
    }
  };

  const title = inv ? `${inv.kind === 1 ? 'مرتجع' : inv.kind === 2 ? 'هدية' : 'فاتورة'} ⁦#${inv.number}⁩` : 'الفاتورة';
  const pdfBtn = (
    <button type="button" className="t-icon-btn press" aria-label="تصدير PDF" disabled={!inv || busy} onClick={() => void exportPdf()}>
      <I.share size={20} />
    </button>
  );
  if (!inv) {
    return (
      <Screen title="الفاتورة" hideLarge start={<BackBtn />}>
        {err ? (
          <ErrorLine text={err} onRetry={() => void load()} />
        ) : (
          <>
            <Skeleton h={170} r={24} />
            <Skeleton h={220} r={22} mt={12} />
            <Skeleton h={160} r={22} mt={12} />
          </>
        )}
      </Screen>
    );
  }

  const before = inv.lines.reduce((s, l) => s + Math.abs(l.qty) * (l.original || l.price), 0);
  const discounts = inv.offersDiscount + inv.userDiscount + inv.itemsDiscount;
  const groupNames = [...new Set(inv.lines.map(l => l.group || ''))];
  const grouped = groupNames.length > 1;
  const sellers = [...new Set(inv.lines.map(l => l.seller).filter(Boolean))] as string[];

  return (
    <Screen title={title} hideLarge start={<BackBtn />} end={pdfBtn} onRefresh={load}>
      <section className={`iv-hero k${inv.kind}`}>
        <div className="iv-hero-top">
          <span className="iv-hero-kind">{KIND_LABEL[inv.kind] ?? 'فاتورة'}</span>
          <span className="iv-hero-pay">{inv.kind === 2 ? 'بلا دفع' : inv.card ? 'بطاقة' : 'نقد'}</span>
        </div>
        <div className="iv-hero-total num">
          {inv.kind === 1 ? '−' : ''}
          {fmt(inv.total)}
          <small> د.ع</small>
        </div>
        <div className="iv-hero-meta">
          <span className="num">#{inv.number}</span>
          <span>{dayTitle(inv.day)}</span>
          <span className="num">{clock(inv.at)}</span>
        </div>
        <div className="iv-hero-counts">
          <span>
            <b className="num">{fmt(inv.lines.length)}</b> مادة
          </span>
          <span>
            <b className="num">{qty(inv.pieces)}</b> قطعة
          </span>
          {discounts > 0 && (
            <span>
              وفّر <b className="num">{fmt(discounts)}</b>
            </span>
          )}
        </div>
      </section>

      {(inv.returnOfInvoice || inv.returnOf) && (
        <LinkedInvoice label="مرتجع من الفاتورة" row={inv.returnOfInvoice} fallback={inv.returnOf} />
      )}
      {inv.returns.map(r => (
        <LinkedInvoice key={r.id} label="أُرجع منها" row={r} />
      ))}

      <section className="t-section">
        <div className="t-section-head">
          <h2>المواد</h2>
          <small className="num">{fmt(inv.lines.length)}</small>
        </div>
        <div className="t-card iv-lines">
          {groupNames.map(g => (
            <div key={g}>
              {grouped && <div className="iv-group">{g || 'بلا سلة'}</div>}
              {inv.lines
                .filter(l => (l.group || '') === g)
                .map((l, i) => (
                  <div key={i} className="iv-line">
                    <div className="iv-line-main">
                      <b>{l.name}</b>
                      <small>
                        <span className="num">{qty(Math.abs(l.qty))}</span> × <span className="num">{fmt(l.price)}</span>
                        {l.original > l.price && <s className="num">{fmt(l.original)}</s>}
                      </small>
                      {(l.barcode || (l.seller && sellers.length > 1)) && (
                        <small className="iv-line-sub">
                          {l.barcode && <span className="num ltr">{l.barcode}</span>}
                          {l.seller && sellers.length > 1 && <span>{cleanName(l.seller)}</span>}
                        </small>
                      )}
                    </div>
                    <b className="num iv-line-total">{fmt(Math.abs(l.qty) * l.price)}</b>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>الحساب</h2>
        </div>
        <div className="t-card iv-calc">
          {discounts > 0 && <InfoRow label="قبل الخصم"><span className="num">{fmt(before)}</span></InfoRow>}
          {inv.offersDiscount > 0 && <InfoRow label="خصم العروض"><span className="num ltr iv-off">−{fmt(inv.offersDiscount)}</span></InfoRow>}
          {inv.itemsDiscount > 0 && <InfoRow label="خصم المواد"><span className="num ltr iv-off">−{fmt(inv.itemsDiscount)}</span></InfoRow>}
          {inv.userDiscount > 0 && <InfoRow label={inv.discountPerson ? `خصم يدوي (${inv.discountPerson})` : 'خصم يدوي'}><span className="num ltr iv-off">−{fmt(inv.userDiscount)}</span></InfoRow>}
          <div className="iv-calc-total">
            <span>{inv.kind === 1 ? 'المبلغ المُعاد' : inv.kind === 2 ? 'قيمة الهدية' : 'الإجمالي'}</span>
            <b className="num">{fmt(inv.total)}</b>
          </div>
          {inv.kind === 0 && <InfoRow label="المدفوع"><span className="num">{fmt(inv.payment)}</span></InfoRow>}
          {inv.cashBack > 0 && <InfoRow label="الباقي للزبون"><span className="num">{fmt(inv.cashBack)}</span></InfoRow>}
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>التفاصيل</h2>
        </div>
        <div className="t-card iv-calc">
          {inv.cashier && <InfoRow label="الكاشير">{cleanName(inv.cashier)}</InfoRow>}
          {sellers.length === 1 ? <InfoRow label="البائع">{cleanName(sellers[0])}</InfoRow> : sellers.length === 0 && inv.seller ? <InfoRow label="البائع">{cleanName(inv.seller)}</InfoRow> : null}
          {inv.pos && <InfoRow label="نقطة البيع">{inv.pos}</InfoRow>}
          {inv.section && <InfoRow label="القسم">{inv.section}</InfoRow>}
          {inv.card && (
            <>
              <InfoRow label="البطاقة">
                <span className="num ltr">
                  {inv.card.acquirer || inv.card.type || 'بطاقة'}
                  {inv.card.last4 ? ` •••• ${inv.card.last4}` : ''}
                </span>
              </InfoRow>
              {inv.card.ref && <InfoRow label="مرجع العملية"><span className="num ltr">{inv.card.ref}</span></InfoRow>}
            </>
          )}
          {inv.voucher && <InfoRow label="قسيمة"><span className="num ltr">{inv.voucher}</span></InfoRow>}
          {inv.systemNumber !== inv.number && <InfoRow label="رقم النظام"><span className="num ltr">{inv.systemNumber}</span></InfoRow>}
          {inv.edited && <InfoRow label="الحالة">عُدّلت بعد البيع</InfoRow>}
          {inv.remarks && <InfoRow label="ملاحظات">{inv.remarks}</InfoRow>}
        </div>
      </section>

      <button type="button" className="t-btn block press iv-export" disabled={busy} onClick={() => void exportPdf()}>
        <I.download size={18} /> {busy ? 'جارٍ إنشاء الملف…' : 'تصدير الفاتورة PDF'}
      </button>

      <div className="iv-nav">
        <button type="button" className="t-chip press" disabled={!inv.older} onClick={() => inv.older && nav(`/m/invoices/${inv.older}`, { replace: true })}>
          الفاتورة السابقة
        </button>
        <button type="button" className="t-chip press" disabled={!inv.newer} onClick={() => inv.newer && nav(`/m/invoices/${inv.newer}`, { replace: true })}>
          الفاتورة التالية
        </button>
      </div>
    </Screen>
  );
}

function LinkedInvoice({ label, row, fallback }: { label: string; row: InvoiceDetail['returnOfInvoice']; fallback?: number | null }) {
  if (!row) {
    return (
      <div className="iv-link muted">
        <I.info size={16} />
        <span>{label} رقم نظام {fallback} — لم تصل بعد</span>
      </div>
    );
  }
  return (
    <Link to={`/m/invoices/${row.id}`} className="iv-link press">
      <I.receipt size={16} />
      <span>
        {label} <b className="num">#{row.number}</b>
      </span>
      <b className="num">{fmt(row.total)}</b>
      <I.chevron size={16} />
    </Link>
  );
}
