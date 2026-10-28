import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSeller } from '../../api';
import { PRESETS, buildReport, firstDataDay, presetRange, useBrandList, useBrandPack, type BrandFilter, type PresetId, type Scope } from '../../brands';
import { dayName } from '../../dates';
import { Delta, Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, fmt, shortDate as fmtDate, toast } from '../kit';
import { BackBtn } from '../parts';
import { haptic } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * براندي — مبيعات كل براند مرتبط بالموظف لأي مدة، كل المحل أو مبيعاتي فقط،
 * مقارنة بالمدة السابقة، ترتيب المواد، وكشف Excel يُشارك من الهاتف.
 * ───────────────────────────────────────────────────────────────────────────── */

const PREF = 'fot_team_brand_prefs';

function loadPrefs(): { preset: PresetId; scope: Scope } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) || '{}') as { preset?: PresetId; scope?: Scope };
    return { preset: p.preset && p.preset !== 'custom' ? p.preset : 'month', scope: p.scope === 'mine' ? 'mine' : 'all' };
  } catch {
    return { preset: 'month', scope: 'all' };
  }
}

export function Brands({ back }: { back?: string }) {
  const seller = getSeller();
  const { list, err: listErr } = useBrandList();
  const [params, setParams] = useSearchParams();
  const brands = list ?? [];
  const seq = Number(params.get('b') || 0);
  const active = brands.find(b => b.treeSeq === seq) ?? brands[0] ?? null;
  const { pack, loading, err } = useBrandPack(active?.treeSeq ?? null);

  const init = loadPrefs();
  const [preset, setPreset] = useState<PresetId>(init.preset);
  const [scope, setScope] = useState<Scope>(init.scope);
  const [custom, setCustom] = useState(() => presetRange('last30'));
  const [pickRange, setPickRange] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'amount' | 'qty'>('amount');
  const [limit, setLimit] = useState(25);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify({ preset, scope }));
    } catch {
      /* ignore */
    }
  }, [preset, scope]);

  // الفترة المختارة تبقى ظاهرة في شريط الفترات
  useEffect(() => {
    document.querySelector('.t-hero [data-on="1"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [preset]);

  const range = preset === 'custom' ? (custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }) : presetRange(preset, firstDataDay(pack));
  const filter: BrandFilter = { from: range.from, to: range.to, scope, sectionId: null };
  const report = useMemo(() => (pack ? buildReport(pack, filter) : null), [pack, filter.from, filter.to, filter.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => {
    if (!report) return [];
    const n = q.trim();
    const rows = n ? report.products.filter(p => p.name.includes(n) || p.barcode.includes(n)) : report.products;
    return [...rows].sort((a, b) => (sort === 'qty' ? b.qty - a.qty : b.amount - a.amount));
  }, [report, q, sort]);

  if (list && brands.length === 0) {
    return (
      <Screen title="براندي" start={back ? <BackBtn to={back} /> : undefined}>
        <Empty icon={<I.tag size={30} />} title="لا براند مرتبط بحسابك" text="تربط الإدارة حسابك بشجرة البراند من لوحة التحكم، فتظهر هنا مبيعاته وكشوفاته." />
        {listErr && <ErrorLine text={listErr} />}
      </Screen>
    );
  }

  const peak = Math.max(1, ...(report?.days ?? []).map(d => d.amount));
  const peakDay = report?.days.find(d => d.amount === peak);

  async function exportExcel() {
    if (!report || !active || exporting) return;
    haptic('tap');
    setExporting(true);
    try {
      const m = await import('../../report');
      m.exportBrandExcel({ brand: active.name, seller: seller?.name || '', filter, report });
      toast('تم تجهيز الكشف — اختر مكان المشاركة');
    } catch {
      toast('تعذر تجهيز الكشف');
    } finally {
      setTimeout(() => setExporting(false), 800);
    }
  }

  return (
    <Screen
      title={active?.name ?? 'براندي'}
      subtitle={`${fmtDate(range.from)} — ${fmtDate(range.to)}${loading ? ' · جارٍ التحديث…' : ''}`}
      start={back ? <BackBtn to={back} /> : undefined}
      end={
        <button type="button" className="t-icon-btn press" aria-label="مشاركة كشف Excel" disabled={!report} onClick={() => void exportExcel()}>
          <I.share size={20} />
        </button>
      }
    >
      {brands.length > 1 && (
        <div className="t-scroller" style={{ marginBottom: 12 }}>
          {brands.map(b => (
            <button
              key={b.treeSeq}
              type="button"
              className={`t-pill press ${b.treeSeq === active?.treeSeq ? 'on' : ''}`}
              onClick={() => {
                haptic('select');
                const next = new URLSearchParams(params);
                next.set('b', String(b.treeSeq));
                setParams(next, { replace: true });
              }}
            >
              {b.name}
              <small className="num">{fmt(b.productCount)} مادة</small>
            </button>
          ))}
        </div>
      )}

      <section className="t-hero">
        <Segmented
          glass
          items={[
            { id: 'all', label: 'كل المحل' },
            { id: 'mine', label: 'مبيعاتي' },
          ]}
          value={scope}
          onChange={setScope}
        />
        <div className="t-hero-row" style={{ marginTop: 16 }}>
          <div>
            <p className="kicker">صافي المبيعات</p>
            <div className="amount">
              <span className="num">{report ? fmt(report.amount) : '—'}</span>
              <small>د.ع</small>
            </div>
          </div>
          {report && <Delta glass now={report.amount} prev={report.prev.amount} />}
        </div>
        <div className="t-scroller" style={{ marginTop: 14, gap: 6 }}>
          {PRESETS.filter(p => p.id !== 'custom').map(p => (
            <button
              key={p.id}
              type="button"
              data-on={preset === p.id ? '1' : undefined}
              className="t-chip-glass press"
              style={preset === p.id ? { background: '#fff', color: '#241245', padding: '6px 12px' } : { padding: '6px 12px' }}
              onClick={() => {
                haptic('select');
                setPreset(p.id);
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            data-on={preset === 'custom' ? '1' : undefined}
            className="t-chip-glass press"
            style={preset === 'custom' ? { background: '#fff', color: '#241245', padding: '6px 12px' } : { padding: '6px 12px' }}
            onClick={() => setPickRange(true)}
          >
            <I.calendar size={14} /> مدة محددة
          </button>
        </div>
      </section>

      {err && !pack && (
        <div style={{ marginTop: 12 }}>
          <ErrorLine text={err} />
        </div>
      )}

      {!report ? (
        !err && <Skeleton h={260} r={20} mt={14} />
      ) : (
        <>
          <div className="t-stats two" style={{ marginTop: 14 }}>
            <div className="t-stat">
              <span>القطع المباعة</span>
              <b className="num">{fmt(report.qty)}</b>
              <em>
                <Delta now={report.qty} prev={report.prev.qty} />
              </em>
            </div>
            <div className="t-stat">
              <span>الفواتير</span>
              <b className="num">{fmt(report.receipts)}</b>
              <em>
                <Delta now={report.receipts} prev={report.prev.receipts} />
              </em>
            </div>
            <div className="t-stat">
              <span>متوسط الفاتورة</span>
              <b className="num">{fmt(report.avgTicket)}</b>
              <em>د.ع</em>
            </div>
            <div className="t-stat">
              <span>مواد بيعت</span>
              <b className="num">{fmt(report.productsSold)}</b>
              <em>{report.activeDays} يوم بيع</em>
            </div>
          </div>

          {report.days.length > 1 && (
            <section className="t-card pad" style={{ marginTop: 12 }}>
              <div className="t-section-head" style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: 15 }}>المبيعات اليومية</h2>
                {peakDay && (
                  <small>
                    الأعلى {dayName(peakDay.day)} · <span className="num">{fmt(peak)}</span>
                  </small>
                )}
              </div>
              <div className="t-chart" aria-hidden>
                {report.days.map((d, i) => (
                  <i
                    key={d.day}
                    className={d === peakDay ? 'peak' : ''}
                    style={{ height: `${Math.max(d.amount > 0 ? 3 : 1, (Math.max(0, d.amount) / peak) * 100)}%`, animationDelay: `${Math.min(i, 40) * 12}ms` }}
                  />
                ))}
              </div>
              <div className="t-chart-axis">
                <span>{fmtDate(report.days[0].day)}</span>
                <span>{fmtDate(report.days[report.days.length - 1].day)}</span>
              </div>
            </section>
          )}

          <button type="button" className="t-btn soft block press" style={{ marginTop: 12 }} disabled={exporting} onClick={() => void exportExcel()}>
            <I.sheet size={20} />
            {exporting ? 'جارٍ التجهيز…' : 'مشاركة كشف Excel'}
          </button>

          <section className="t-section">
            <div className="t-section-head">
              <h2>المواد ({fmt(products.length)})</h2>
              <div style={{ width: 150 }}>
                <Segmented
                  items={[
                    { id: 'amount', label: 'المبلغ' },
                    { id: 'qty', label: 'الكمية' },
                  ]}
                  value={sort}
                  onChange={setSort}
                />
              </div>
            </div>
            <label className="t-search" style={{ marginBottom: 10 }}>
              <I.search />
              <input placeholder="اسم المادة أو الباركود" value={q} onChange={e => setQ(e.target.value)} />
            </label>
            {products.length === 0 ? (
              <Empty icon={<I.box size={28} />} title="لا مبيعات في هذه المدة" />
            ) : (
              <div className="t-list">
                {products.slice(0, limit).map((p, i) => (
                  <div key={p.id} className="t-row">
                    <span className={`t-tile ${i < 3 && !q ? 'accent' : 'mute'} num`}>{i + 1}</span>
                    <div className="body">
                      <div className="title">{p.name}</div>
                      <div className="sub num ltr" style={{ textAlign: 'right' }}>
                        {p.barcode}
                      </div>
                      <div className="t-share">
                        <i style={{ width: `${Math.min(100, Math.max(0, p.share))}%` }} />
                      </div>
                    </div>
                    <div className="end">
                      <b className="num">{fmt(p.amount)}</b>
                      <small className="num">
                        {fmt(p.qty)} قطعة · {p.share.toFixed(1)}%
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {products.length > limit && (
              <button type="button" className="t-btn plain block sm press" style={{ marginTop: 10 }} onClick={() => setLimit(l => l + 50)}>
                عرض المزيد ({fmt(products.length - limit)})
              </button>
            )}
          </section>

          <p className="t-foot">
            المبالغ صافية بعد المرتجعات ولا تشمل الهدايا
            <br />
            المقارنة مع نفس عدد الأيام قبل المدة
          </p>
        </>
      )}

      <Sheet open={pickRange} onClose={() => setPickRange(false)} title="مدة محددة" subtitle="اختر البداية والنهاية">
        <div style={{ display: 'grid', gap: 12 }}>
          <label className="t-field">
            <span>من</span>
            <input className="t-input" type="date" value={custom.from} onChange={e => e.target.value && setCustom(c => ({ ...c, from: e.target.value }))} />
          </label>
          <label className="t-field">
            <span>إلى</span>
            <input className="t-input" type="date" value={custom.to} onChange={e => e.target.value && setCustom(c => ({ ...c, to: e.target.value }))} />
          </label>
          <button
            type="button"
            className="t-btn block press"
            onClick={() => {
              haptic('success');
              setPreset('custom');
              setPickRange(false);
            }}
          >
            عرض المدة
          </button>
        </div>
      </Sheet>
    </Screen>
  );
}
