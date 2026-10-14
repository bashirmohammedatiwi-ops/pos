import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, formatNum, todayIso } from '@/api/client';
import type { CashReportDto, DayBreakdownDto, MovementRowDto, NamedTotalDto, SalesmanSalesRowDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { IconChevronLeft, IconChevronRight, IconPrinter, IconReceipt } from '@/components/icons';
import { Btn, Input } from '@/components/ui';
import { isoDate } from '@/lib/businessPeriod';
import { printDocument } from '@/lib/print';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import { ReportBanner, ReportError, ReportFill } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تقرير نهاية اليوم — صفحة واحدة لليوم: الصافي، النقدي والبطاقة، المرتجعات،
 * الأقسام ونقاط البيع والكاشيرات والبائعون، المبيعات بالساعة، وأكثر المواد مبيعاً.
 * نفس المحتوى يُطبع على A4 بتنسيق رسمي.
 * ───────────────────────────────────────────────────────────────────────────── */

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function dayTitle(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function hourLabel(h: number) {
  const suffix = h < 12 ? 'ص' : 'م';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const money = (n: number) => formatNum(Math.round(n));

type Model = {
  date: string;
  cash: CashReportDto;
  day: DayBreakdownDto | null;
  top: MovementRowDto[];
  salesmen: SalesmanSalesRowDto[];
  cardTotal: number;
  cashTotal: number;
  pieces: number;
  hours: { hour: number; total: number; count: number }[];
  peak: { hour: number; total: number } | null;
};

export function DailyCloseApp({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [printing, setPrinting] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) >= 2000;
  const d = valid ? date : today;

  const cashQ = useQuery({ queryKey: ['report-cash', d, d], queryFn: () => api.cashReport(d, d) });
  const dayQ = useQuery({ queryKey: ['day-breakdown', d], queryFn: () => api.dayBreakdown(d), retry: 0 });
  const movQ = useQuery({ queryKey: ['report-movement', d, d, ''], queryFn: () => api.movement(d, d) });
  const smQ = useQuery({ queryKey: ['report-salesmen', d, d], queryFn: () => api.salesBySalesman(d, d) });
  const settingsQ = useQuery({ queryKey: ['print-settings'], queryFn: api.printSettings, staleTime: 300_000 });
  const shopName = (settingsQ.data?.headerText || settingsQ.data?.name || '').trim();
  const loading = cashQ.isLoading || movQ.isLoading || smQ.isLoading;
  const error = cashQ.error || movQ.error || smQ.error;

  const m = useMemo<Model | null>(() => {
    if (!cashQ.data) return null;
    const day = dayQ.data ?? null;
    const cardTotal = day?.cardTotal ?? 0;
    const hours = (day?.hourly ?? []).filter(h => h.count > 0 || h.total !== 0).sort((a, b) => a.hour - b.hour);
    const peak = hours.length ? hours.reduce((p, h) => (h.total > p.total ? h : p)) : null;
    const top = [...(movQ.data ?? [])].filter(x => x.soldQty > 0).sort((a, b) => b.soldAmount - a.soldAmount).slice(0, 15);
    return {
      date: d,
      cash: cashQ.data,
      day,
      top,
      salesmen: [...(smQ.data ?? [])].filter(s => s.total !== 0).sort((a, b) => b.total - a.total),
      cardTotal,
      cashTotal: cashQ.data.totalSales - cardTotal,
      pieces: (movQ.data ?? []).reduce((s, x) => s + x.soldQty, 0),
      hours,
      peak,
    };
  }, [cashQ.data, dayQ.data, movQ.data, smQ.data, d]);

  async function print() {
    if (!m) return;
    setPrinting(true);
    try {
      await printDocument(closeHtml(m, shopName));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
    }
  }

  const maxHour = Math.max(1, ...(m?.hours ?? []).map(h => h.total));

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #22d3ee 0%, #0e7490 100%)"
      title="تقرير نهاية اليوم"
      subtitle={valid ? dayTitle(d) : 'اختر التاريخ'}
      icon={<IconReceipt size={20} />}
      toolbar={
        <div className="flex items-center gap-1.5">
          <Btn size="sm" variant="secondary" icon={<IconChevronRight size={14} />} onClick={() => setDate(shift(d, -1))}>
            اليوم السابق
          </Btn>
          <Input type="date" className="!h-8 !w-40" value={date} max={today} onChange={e => setDate(e.target.value)} />
          <Btn size="sm" variant="secondary" disabled={d >= today} onClick={() => setDate(shift(d, 1))}>
            اليوم التالي
            <IconChevronLeft size={14} />
          </Btn>
          {d !== today && (
            <Btn size="sm" variant="ghost" onClick={() => setDate(today)}>
              اليوم
            </Btn>
          )}
        </div>
      }
      actions={
        <Btn size="sm" icon={<IconPrinter size={14} />} loading={printing} disabled={!m} onClick={() => void print()}>
          طباعة A4
        </Btn>
      }
      onClose={onClose}
    >
      <ReportFill>
        {error && (
          <ReportBanner>
            <ReportError
              error={error}
              onRetry={() => {
                void cashQ.refetch();
                void movQ.refetch();
                void smQ.refetch();
              }}
            />
          </ReportBanner>
        )}
        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {loading || !m ? (
            <div className="mx-auto max-w-5xl space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skeleton h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-3">
              {/* المؤشرات */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Kpi label="صافي المبيعات" value={money(m.cash.totalSales)} unit="IQD" tone="text-cyan-800" big />
                <Kpi label="نقدي" value={m.day ? money(m.cashTotal) : '—'} unit={m.day ? 'IQD' : ''} />
                <Kpi label="بطاقة" value={m.day ? money(m.cardTotal) : '—'} unit={m.day ? `IQD · ${formatNum(m.day.cardCount)} فاتورة` : ''} />
                <Kpi label="المرتجعات" value={money(m.cash.returnsTotal ?? 0)} unit={`IQD · ${formatNum(m.cash.returnsCount ?? 0)} فاتورة`} tone="text-rose-700" />
                <Kpi label="فواتير البيع" value={formatNum(m.cash.receiptCount)} />
                <Kpi label="متوسط الفاتورة" value={money(m.cash.averageTicket)} unit="IQD" />
                <Kpi label="القطع المباعة" value={formatNum(m.pieces)} />
                <Kpi label="ساعة الذروة" value={m.peak ? hourLabel(m.peak.hour) : '—'} unit={m.peak ? `${money(m.peak.total)} IQD` : ''} />
              </div>

              {/* بالساعة */}
              {m.hours.length > 0 && (
                <Panel title="المبيعات بالساعة">
                  <div className="flex h-36 items-end gap-1.5 px-1">
                    {m.hours.map(h => (
                      <div key={h.hour} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${hourLabel(h.hour)} — ${money(h.total)} IQD · ${formatNum(h.count)} فاتورة`}>
                        <span className="num hidden text-[10px] font-bold text-slate-500 group-hover:block">{formatNum(Math.round(h.total / 1000))}K</span>
                        <div
                          className={`w-full rounded-t-md ${m.peak?.hour === h.hour ? 'bg-cyan-600' : 'bg-cyan-300'}`}
                          style={{ height: `${Math.max(3, (Math.max(0, h.total) / maxHour) * 110)}px` }}
                        />
                        <span className="text-[10.5px] font-semibold text-slate-500">{hourLabel(h.hour)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <div className="grid gap-3 lg:grid-cols-3">
                <Breakdown title="حسب القسم" rows={m.day?.bySection} total={m.cash.totalSales} />
                <Breakdown title="حسب نقطة البيع" rows={m.day?.byPos} total={m.cash.totalSales} />
                <Breakdown title="حسب الكاشير" rows={m.day?.byCashier} total={m.cash.totalSales} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <Panel title={`أكثر المواد مبيعاً (${formatNum(m.top.length)})`}>
                  {m.top.length === 0 ? (
                    <Empty />
                  ) : (
                    <table className="w-full text-[12.5px]">
                      <tbody>
                        {m.top.map((t, i) => (
                          <tr key={t.articleId} className="border-t border-slate-100 first:border-0">
                            <td className="num w-6 py-1.5 text-slate-400">{i + 1}</td>
                            <td className="py-1.5 font-semibold text-slate-800">{fixEdariName(t.name) || t.barcode}</td>
                            <td className="num py-1.5 text-center text-slate-500">×{formatNum(t.soldQty)}</td>
                            <td className="num py-1.5 text-end font-bold">{money(t.soldAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
                <Panel title="حسب البائع">
                  {m.salesmen.length === 0 ? (
                    <Empty />
                  ) : (
                    <table className="w-full text-[12.5px]">
                      <tbody>
                        {m.salesmen.map(s => (
                          <tr key={s.salesmanId} className="border-t border-slate-100 first:border-0">
                            <td className="py-1.5 font-semibold text-slate-800">{fixEdariName(s.name) || (s.salesmanId ? `#${s.salesmanId}` : 'بدون بائع')}</td>
                            <td className="num py-1.5 text-center text-slate-500">{formatNum(s.count)} فاتورة</td>
                            <td className="num py-1.5 text-end font-bold">{money(s.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>
              {!m.day && <p className="text-center text-[12px] text-slate-500">تفصيل الأقسام والبطاقة والساعات يتطلب تحديث الخادم.</p>}
            </div>
          )}
        </div>
      </ReportFill>
    </ReportAppWindow>
  );
}

function Kpi({ label, value, unit, tone, big }: { label: string; value: string; unit?: string; tone?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-slate-500">{label}</div>
      <div className={`num font-extrabold ${big ? 'text-[22px]' : 'text-[17px]'} ${tone ?? 'text-header'}`}>{value}</div>
      {unit && <div className="num text-[10.5px] text-slate-400">{unit}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-[13px] font-extrabold text-slate-700">{title}</h3>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="py-4 text-center text-[12px] text-slate-400">لا بيانات</p>;
}

function Breakdown({ title, rows, total }: { title: string; rows?: NamedTotalDto[]; total: number }) {
  const list = (rows ?? []).filter(r => r.total !== 0 || r.count > 0);
  return (
    <Panel title={title}>
      {list.length === 0 ? (
        <Empty />
      ) : (
        <ul className="space-y-2">
          {list.map(r => {
            const p = total > 0 ? Math.max(0, Math.min(100, (r.total / total) * 100)) : 0;
            return (
              <li key={`${r.id}-${r.name}`}>
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate font-semibold text-slate-800">{fixEdariName(r.name)}</span>
                  <span className="num shrink-0 font-bold">{money(r.total)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${p}%` }} />
                  </div>
                  <span className="num w-20 text-end text-[10.5px] text-slate-400">
                    {p.toFixed(0)}% · {formatNum(r.count)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** صفحة A4 رسمية لنهاية اليوم. */
function closeHtml(m: Model, shopName: string) {
  const kpi = (label: string, value: string, sub = '') => `<div class="k"><div class="kl">${esc(label)}</div><div class="kv">${esc(value)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ''}</div>`;
  const table = (title: string, rows: NamedTotalDto[] | undefined) => {
    const list = (rows ?? []).filter(r => r.total !== 0 || r.count > 0);
    if (!list.length) return '';
    return `<section><h2>${esc(title)}</h2><table><thead><tr><th>الاسم</th><th>الفواتير</th><th>المبلغ</th></tr></thead><tbody>${list
      .map(r => `<tr><td>${esc(fixEdariName(r.name))}</td><td class="n">${formatNum(r.count)}</td><td class="n">${money(r.total)}</td></tr>`)
      .join('')}</tbody></table></section>`;
  };
  const hours = m.hours.length
    ? `<section class="wide"><h2>المبيعات بالساعة</h2><table><thead><tr>${m.hours.map(h => `<th class="c">${hourLabel(h.hour)}</th>`).join('')}</tr></thead><tbody><tr>${m.hours
        .map(h => `<td class="c n">${formatNum(Math.round(h.total / 1000))}K</td>`)
        .join('')}</tr><tr>${m.hours.map(h => `<td class="c n muted">${formatNum(h.count)}</td>`).join('')}</tr></tbody></table></section>`
    : '';
  const top = m.top.length
    ? `<section><h2>أكثر المواد مبيعاً</h2><table><thead><tr><th>#</th><th>المادة</th><th>الكمية</th><th>المبلغ</th></tr></thead><tbody>${m.top
        .map((t, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(fixEdariName(t.name) || t.barcode || '')}</td><td class="n">${formatNum(t.soldQty)}</td><td class="n">${money(t.soldAmount)}</td></tr>`)
        .join('')}</tbody></table></section>`
    : '';
  const sm = m.salesmen.length
    ? `<section><h2>حسب البائع</h2><table><thead><tr><th>البائع</th><th>الفواتير</th><th>المبلغ</th></tr></thead><tbody>${m.salesmen
        .map(s => `<tr><td>${esc(fixEdariName(s.name) || (s.salesmanId ? `#${s.salesmanId}` : 'بدون بائع'))}</td><td class="n">${formatNum(s.count)}</td><td class="n">${money(s.total)}</td></tr>`)
        .join('')}</tbody></table></section>`
    : '';
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>نهاية اليوم ${esc(m.date)}</title>
<style>
  @page { size: A4; margin: 11mm; }
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 11.5px; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0e7490; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 20px; margin: 0; color: #155e75; } .day { font-size: 13px; font-weight: 700; margin-top: 3px; }
  .meta { text-align: left; color: #64748b; font-size: 10.5px; line-height: 1.6; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
  .k { border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 8px; } .kl { color: #64748b; font-size: 10px; font-weight: 700; }
  .kv { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; } .ks { color: #94a3b8; font-size: 9.5px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; } section.wide { grid-column: 1 / -1; }
  h2 { font-size: 12.5px; margin: 6px 0 4px; color: #155e75; }
  table { width: 100%; border-collapse: collapse; } th { background: #ecfeff; color: #155e75; font-size: 10.5px; padding: 4px 5px; text-align: right; border: 1px solid #a5f3fc; }
  td { border: 1px solid #e2e8f0; padding: 4px 5px; } td.n { font-variant-numeric: tabular-nums; white-space: nowrap; } .c { text-align: center; } .muted { color: #94a3b8; }
  .signs { display: flex; gap: 24px; margin-top: 26px; } .signs div { flex: 1; text-align: center; border-top: 1px dashed #94a3b8; padding-top: 5px; color: #475569; }
  tr { break-inside: avoid; }
</style></head><body>
<div class="top"><div><h1>تقرير نهاية اليوم${shopName ? ` — ${esc(shopName)}` : ''}</h1><div class="day">${esc(dayTitle(m.date))}</div></div>
<div class="meta">طُبع: ${esc(new Date().toLocaleString('ar-IQ'))}<br/>المبالغ بالدينار العراقي · الصافي بعد المرتجعات</div></div>
<div class="kpis">
${kpi('صافي المبيعات', money(m.cash.totalSales))}
${kpi('نقدي', m.day ? money(m.cashTotal) : '—')}
${kpi('بطاقة', m.day ? money(m.cardTotal) : '—', m.day ? `${formatNum(m.day.cardCount)} فاتورة` : '')}
${kpi('المرتجعات', money(m.cash.returnsTotal ?? 0), `${formatNum(m.cash.returnsCount ?? 0)} فاتورة`)}
${kpi('فواتير البيع', formatNum(m.cash.receiptCount))}
${kpi('متوسط الفاتورة', money(m.cash.averageTicket))}
${kpi('القطع المباعة', formatNum(m.pieces))}
${kpi('ساعة الذروة', m.peak ? hourLabel(m.peak.hour) : '—', m.peak ? money(m.peak.total) : '')}
</div>
<div class="grid">
${hours}
${table('حسب القسم', m.day?.bySection)}
${table('حسب نقطة البيع', m.day?.byPos)}
${table('حسب الكاشير', m.day?.byCashier)}
${sm}
${top}
</div>
<div class="signs"><div>الكاشير</div><div>المحاسب</div><div>المدير</div></div>
</body></html>`;
}
