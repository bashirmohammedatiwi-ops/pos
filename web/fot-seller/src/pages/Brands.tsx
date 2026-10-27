import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSeller } from '../api';
import {
  PRESETS,
  buildReport,
  firstDataDay,
  pct,
  presetRange,
  useBrandList,
  useBrandPack,
  type BrandFilter,
  type PresetId,
  type Scope,
} from '../brands';
import { dayName, exportBrandExcel, fmtDate, openBrandPdf } from '../report';

/* ─────────────────────────────────────────────────────────────────────────────
 * براندي — مبيعات كل براند مرتبط بالموظف (شجرة مستقلة لكل براند)،
 * لأي مدة يختارها، كل المحل أو مبيعاته فقط، مع كشف Excel و PDF.
 * ───────────────────────────────────────────────────────────────────────────── */

const nf = (n: number) => Math.round(n).toLocaleString('en-US');
const PREF = 'fot_seller_brand_prefs';

type Prefs = { preset: PresetId; scope: Scope; from?: string; to?: string };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) || '{}') as Prefs;
    return { preset: p.preset && p.preset !== 'custom' ? p.preset : 'month', scope: p.scope === 'mine' ? 'mine' : 'all' };
  } catch {
    return { preset: 'month', scope: 'all' };
  }
}

function Delta({ now, prev, invert }: { now: number; prev: number; invert?: boolean }) {
  const p = pct(now, prev);
  if (p == null) return <span className="bx-delta flat">لا مقارنة</span>;
  const good = invert ? p < 0 : p >= 0;
  return (
    <span className={`bx-delta ${Math.abs(p) < 0.05 ? 'flat' : good ? 'up' : 'down'}`}>
      {p >= 0 ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%
    </span>
  );
}

export function Brands() {
  const seller = getSeller();
  const { list, err: listErr } = useBrandList();
  const [params, setParams] = useSearchParams();
  const brands = list ?? [];
  const seqParam = Number(params.get('b') || 0);
  const active = brands.find(b => b.treeSeq === seqParam) ?? brands[0] ?? null;
  const { pack, loading, err } = useBrandPack(active?.treeSeq ?? null);

  const init = loadPrefs();
  const [preset, setPreset] = useState<PresetId>(init.preset);
  const [scope, setScope] = useState<Scope>(init.scope);
  const [custom, setCustom] = useState(() => presetRange('last30'));
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'amount' | 'qty'>('amount');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify({ preset, scope }));
    } catch {
      /* ignore */
    }
  }, [preset, scope]);

  const first = firstDataDay(pack);
  const range = preset === 'custom' ? (custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }) : presetRange(preset, first);
  const filter: BrandFilter = { from: range.from, to: range.to, scope, sectionId: null };
  const report = useMemo(() => (pack ? buildReport(pack, filter) : null), [pack, filter.from, filter.to, filter.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => {
    if (!report) return [];
    const needle = q.trim();
    const list = needle ? report.products.filter(p => p.name.includes(needle) || p.barcode.includes(needle)) : report.products;
    return [...list].sort((a, b) => (sort === 'qty' ? b.qty - a.qty : b.amount - a.amount));
  }, [report, q, sort]);

  if (list && brands.length === 0) {
    return (
      <div className="bx-empty card">
        <div className="bx-empty-ico">◎</div>
        <h2>لا براند مرتبط بحسابك بعد</h2>
        <p>تربط الإدارة حسابك بشجرة البراند من لوحة التحكم، فتظهر هنا مبيعاته وكشوفاته.</p>
        {listErr && <p className="text-sm font-bold text-danger">{listErr}</p>}
      </div>
    );
  }

  const max = Math.max(1, ...(report?.days ?? []).map(d => d.amount));
  const shown = showAll ? products : products.slice(0, 30);
  const exportArgs = report && active ? { brand: active.name, seller: seller?.name || '', filter, report } : null;

  return (
    <div className="bx">
      {/* البراندات */}
      {brands.length > 1 && (
        <div className="bx-brands" role="tablist">
          {brands.map(b => (
            <button
              key={b.treeSeq}
              type="button"
              role="tab"
              aria-selected={b.treeSeq === active?.treeSeq}
              className={b.treeSeq === active?.treeSeq ? 'on' : ''}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('b', String(b.treeSeq));
                setParams(next, { replace: true });
              }}
            >
              {b.name}
              <small>{b.productCount} مادة</small>
            </button>
          ))}
        </div>
      )}

      <section className="bx-hero">
        <div className="bx-hero-top">
          <div>
            <p className="bx-kicker">براندي</p>
            <h1>{active?.name ?? '…'}</h1>
            <p className="bx-range">
              {fmtDate(range.from)} — {fmtDate(range.to)}
              {loading && <span className="bx-sync"> · جارٍ التحديث…</span>}
            </p>
          </div>
          <div className="bx-scope" role="radiogroup" aria-label="نطاق المبيعات">
            <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
              كل المحل
            </button>
            <button type="button" className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>
              مبيعاتي
            </button>
          </div>
        </div>

        <div className="bx-presets">
          {PRESETS.map(p => (
            <button key={p.id} type="button" className={preset === p.id ? 'on' : ''} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="bx-custom">
            <label>
              من
              <input type="date" value={custom.from} onChange={e => e.target.value && setCustom(c => ({ ...c, from: e.target.value }))} />
            </label>
            <label>
              إلى
              <input type="date" value={custom.to} onChange={e => e.target.value && setCustom(c => ({ ...c, to: e.target.value }))} />
            </label>
          </div>
        )}

        {report && (
          <div className="bx-total">
            <span>صافي المبيعات</span>
            <b className="num">
              {nf(report.amount)} <small>د.ع</small>
            </b>
            <Delta now={report.amount} prev={report.prev.amount} />
          </div>
        )}
      </section>

      {(err && !pack) && <div className="card bx-error">{err}</div>}
      {!report && !err && <div className="card bx-loading">جارٍ تحميل بيانات البراند…</div>}

      {report && (
        <>
          <div className="bx-kpis">
            <div className="card bx-kpi">
              <span>القطع المباعة</span>
              <b className="num">{nf(report.qty)}</b>
              <Delta now={report.qty} prev={report.prev.qty} />
            </div>
            <div className="card bx-kpi">
              <span>الفواتير</span>
              <b className="num">{nf(report.receipts)}</b>
              <Delta now={report.receipts} prev={report.prev.receipts} />
            </div>
            <div className="card bx-kpi">
              <span>متوسط الفاتورة</span>
              <b className="num">{nf(report.avgTicket)}</b>
              <em>د.ع</em>
            </div>
            <div className="card bx-kpi">
              <span>مواد بيعت</span>
              <b className="num">{nf(report.productsSold)}</b>
              <em>{report.activeDays} يوم بيع</em>
            </div>
          </div>

          <div className="bx-actions">
            <button type="button" className="bx-btn excel" disabled={!exportArgs} onClick={() => exportArgs && exportBrandExcel(exportArgs)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M9 8l6 8M15 8l-6 8" /></svg>
              كشف Excel
            </button>
            <button type="button" className="bx-btn pdf" disabled={!exportArgs} onClick={() => exportArgs && openBrandPdf(exportArgs)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 14h6M9 17h4" /></svg>
              كشف PDF
            </button>
          </div>

          {report.days.length > 1 && (
            <section className="card bx-chart">
              <div className="bx-sec-head">
                <h3>المبيعات اليومية</h3>
                <span>أعلى يوم {nf(max)} د.ع</span>
              </div>
              <div className="bx-bars" dir="ltr">
                {report.days.map(d => (
                  <div key={d.day} className="bx-bar" title={`${dayName(d.day)} ${fmtDate(d.day)} — ${nf(d.amount)} د.ع · ${nf(d.qty)} قطعة`}>
                    <i style={{ height: `${Math.max(d.amount > 0 ? 3 : 0, (Math.max(0, d.amount) / max) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="bx-axis" dir="ltr">
                <span>{fmtDate(report.days[0].day)}</span>
                <span>{fmtDate(report.days[report.days.length - 1].day)}</span>
              </div>
            </section>
          )}

          <section className="card bx-products">
            <div className="bx-sec-head">
              <h3>المواد ({products.length})</h3>
              <div className="bx-sort">
                <button type="button" className={sort === 'amount' ? 'on' : ''} onClick={() => setSort('amount')}>
                  بالمبلغ
                </button>
                <button type="button" className={sort === 'qty' ? 'on' : ''} onClick={() => setSort('qty')}>
                  بالكمية
                </button>
              </div>
            </div>
            <input className="search-field bx-search" placeholder="ابحث باسم المادة أو الباركود" value={q} onChange={e => setQ(e.target.value)} />
            {shown.length === 0 ? (
              <p className="bx-none">لا مبيعات في هذه المدة</p>
            ) : (
              <ol className="bx-list">
                {shown.map((p, i) => (
                  <li key={p.id}>
                    <span className="bx-rank">{i + 1}</span>
                    <span className="bx-name">
                      <b>{p.name}</b>
                      <small dir="ltr">{p.barcode}</small>
                      <span className="bx-share">
                        <i style={{ width: `${Math.min(100, Math.max(0, p.share))}%` }} />
                      </span>
                    </span>
                    <span className="bx-vals">
                      <b className="num">{nf(p.amount)}</b>
                      <small className="num">{nf(p.qty)} قطعة · {p.share.toFixed(1)}%</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {products.length > 30 && (
              <button type="button" className="bx-more" onClick={() => setShowAll(v => !v)}>
                {showAll ? 'عرض أقل' : `عرض كل المواد (${products.length})`}
              </button>
            )}
          </section>

          <p className="bx-note">
            المبالغ صافية بعد المرتجعات ولا تشمل الهدايا · المقارنة مع نفس عدد الأيام قبل المدة
            {active?.builtAt ? ` · آخر تحديث ${new Date(active.builtAt).toLocaleTimeString('ar-IQ', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
        </>
      )}
    </div>
  );
}
