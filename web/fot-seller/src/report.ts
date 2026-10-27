import { downloadXlsxFile, type XlsxRowInput, type XlsxStyleDef } from './xlsx';
import type { BrandReport, BrandFilter } from './brands';

/* ─────────────────────────────────────────────────────────────────────────────
 * كشف البراند — Excel منظم (ملخص · المواد · يومي) و PDF رسمي بهوية ديما الحياة.
 * ───────────────────────────────────────────────────────────────────────────── */

const GREEN = '0F9F76';
const NAVY = '0F172A';

const STYLES: XlsxStyleDef[] = [
  { id: 'xTitle', fontSize: 16, bold: true, color: 'FFFFFF', bg: NAVY, align: 'center', valign: 'center' },
  { id: 'xSub', fontSize: 10, color: 'CCFBEF', bg: NAVY, align: 'center', valign: 'center' },
  { id: 'xBand', fontSize: 10.5, bold: true, color: 'FFFFFF', bg: GREEN, align: 'center', valign: 'center', border: 'thin' },
  { id: 'xHead', fontSize: 10, bold: true, color: 'FFFFFF', bg: '134E4A', align: 'center', valign: 'center', wrap: true, border: 'thin' },
  { id: 'xLbl', fontSize: 10, bold: true, color: '334155', bg: 'F0FDF9', valign: 'center', border: 'thin' },
  { id: 'xMoney', fontSize: 12, bold: true, color: NAVY, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
  { id: 'xInt', fontSize: 12, bold: true, color: NAVY, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
  { id: 'xPctV', fontSize: 12, bold: true, color: GREEN, align: 'center', valign: 'center', border: 'thin', numFmt: '0.0%' },
  { id: 'xTxt', fontSize: 10, color: NAVY, valign: 'center', border: 'thin' },
  { id: 'xTxtZ', fontSize: 10, color: NAVY, bg: 'F8FAFC', valign: 'center', border: 'thin' },
  { id: 'xCode', fontSize: 10, color: '334155', align: 'center', valign: 'center', border: 'thin' },
  { id: 'xCodeZ', fontSize: 10, color: '334155', bg: 'F8FAFC', align: 'center', valign: 'center', border: 'thin' },
  { id: 'xNum', fontSize: 10, color: NAVY, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
  { id: 'xNumZ', fontSize: 10, color: NAVY, bg: 'F8FAFC', align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
  { id: 'xPct', fontSize: 10, color: GREEN, align: 'center', valign: 'center', border: 'thin', numFmt: '0.0%' },
  { id: 'xPctZ', fontSize: 10, color: GREEN, bg: 'F8FAFC', align: 'center', valign: 'center', border: 'thin', numFmt: '0.0%' },
  { id: 'xRank', fontSize: 10, bold: true, color: '64748B', bg: 'F1F5F9', align: 'center', valign: 'center', border: 'thin' },
  { id: 'xTotL', fontSize: 10.5, bold: true, color: 'FFFFFF', bg: NAVY, valign: 'center', border: 'thin' },
  { id: 'xTotN', fontSize: 10.5, bold: true, color: 'FFFFFF', bg: NAVY, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
  { id: 'xNote', fontSize: 9, color: '64748B', valign: 'center', wrap: true },
];

import { dayName, fmtDate } from './dates';
export { dayName, fmtDate };

function scopeLabel(f: BrandFilter) {
  return f.scope === 'mine' ? 'مبيعاتي فقط' : 'مبيعات البراند في المحل';
}

function fileBase(brand: string, f: BrandFilter) {
  return `كشف-${brand}-${f.from}_${f.to}`.replace(/[\\/:*?"<>|]+/g, '-');
}

export function exportBrandExcel(opts: { brand: string; seller: string; filter: BrandFilter; report: BrandReport }) {
  const { brand, seller, filter: f, report: r } = opts;
  const period = `من ${fmtDate(f.from)} إلى ${fmtDate(f.to)}`;
  const generated = new Date().toLocaleString('ar-IQ');

  /* ── ملخص ── */
  const summary: XlsxRowInput[] = [
    { height: 34, cells: [{ value: `كشف مبيعات ${brand}`, style: 'xTitle', mergeAcross: 3 }] },
    { height: 20, cells: [{ value: `${period} · ${scopeLabel(f)}`, style: 'xSub', mergeAcross: 3 }] },
    { height: 18, cells: [{ value: `الموظف: ${seller} · أُعد: ${generated}`, style: 'xSub', mergeAcross: 3 }] },
    { cells: [{ value: '' }] },
    { height: 22, cells: [{ value: 'المؤشرات الرئيسية', style: 'xBand', mergeAcross: 3 }] },
    { height: 22, cells: [{ value: 'المؤشر', style: 'xHead' }, { value: 'هذه المدة', style: 'xHead' }, { value: 'المدة السابقة', style: 'xHead' }, { value: 'التغيّر', style: 'xHead' }] },
  ];
  const kpi = (label: string, now: number, prev: number, style = 'xMoney') => {
    summary.push({
      height: 22,
      cells: [
        { value: label, style: 'xLbl' },
        { value: Math.round(now), style, type: 'Number' },
        { value: Math.round(prev), style, type: 'Number' },
        prev ? { value: (now - prev) / Math.abs(prev), style: 'xPctV', type: 'Number' } : { value: '—', style: 'xCode' },
      ],
    });
  };
  kpi('صافي المبيعات (د.ع)', r.amount, r.prev.amount);
  kpi('القطع المباعة', r.qty, r.prev.qty, 'xInt');
  kpi('عدد الفواتير', r.receipts, r.prev.receipts, 'xInt');
  summary.push({ height: 22, cells: [{ value: 'متوسط الفاتورة (د.ع)', style: 'xLbl' }, { value: Math.round(r.avgTicket), style: 'xMoney', type: 'Number' }, { value: '', style: 'xCode' }, { value: '', style: 'xCode' }] });
  summary.push({ height: 22, cells: [{ value: 'مواد بيعت', style: 'xLbl' }, { value: r.productsSold, style: 'xInt', type: 'Number' }, { value: '', style: 'xCode' }, { value: '', style: 'xCode' }] });
  summary.push({ height: 22, cells: [{ value: 'أيام فيها بيع', style: 'xLbl' }, { value: r.activeDays, style: 'xInt', type: 'Number' }, { value: '', style: 'xCode' }, { value: '', style: 'xCode' }] });
  summary.push({ cells: [{ value: '' }] });
  summary.push({ height: 22, cells: [{ value: 'أعلى 10 مواد', style: 'xBand', mergeAcross: 3 }] });
  summary.push({ height: 22, cells: [{ value: 'المادة', style: 'xHead' }, { value: 'الكمية', style: 'xHead' }, { value: 'المبلغ', style: 'xHead' }, { value: 'الحصة', style: 'xHead' }] });
  r.products.slice(0, 10).forEach((p, i) => {
    const z = i % 2 === 1;
    summary.push({
      height: 20,
      cells: [
        { value: p.name, style: z ? 'xTxtZ' : 'xTxt' },
        { value: p.qty, style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: Math.round(p.amount), style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: p.share / 100, style: z ? 'xPctZ' : 'xPct', type: 'Number' },
      ],
    });
  });
  summary.push({ cells: [{ value: '' }] });
  summary.push({ cells: [{ value: 'المبالغ صافية بعد طرح المرتجعات، والهدايا غير محسوبة. المدة السابقة = نفس عدد الأيام قبل بداية المدة.', style: 'xNote', mergeAcross: 3 }], height: 30 });

  /* ── المواد ── */
  const prod: XlsxRowInput[] = [
    { height: 30, cells: [{ value: `مواد ${brand} — ${period}`, style: 'xTitle', mergeAcross: 6 }] },
    { height: 22, cells: ['#', 'المادة', 'الباركود', 'الكمية', 'المبلغ (د.ع)', 'متوسط السعر', 'الحصة'].map(v => ({ value: v, style: 'xHead' })) },
  ];
  r.products.forEach((p, i) => {
    const z = i % 2 === 1;
    prod.push({
      height: 19,
      cells: [
        { value: i + 1, style: 'xRank', type: 'Number' },
        { value: p.name, style: z ? 'xTxtZ' : 'xTxt' },
        { value: p.barcode, style: z ? 'xCodeZ' : 'xCode', type: 'String' },
        { value: p.qty, style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: Math.round(p.amount), style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: p.qty ? Math.round(p.amount / p.qty) : 0, style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: p.share / 100, style: z ? 'xPctZ' : 'xPct', type: 'Number' },
      ],
    });
  });
  prod.push({
    height: 22,
    cells: [
      { value: 'المجموع', style: 'xTotL', mergeAcross: 2 },
      { value: r.qty, style: 'xTotN', type: 'Number' },
      { value: Math.round(r.amount), style: 'xTotN', type: 'Number' },
      { value: '', style: 'xTotN' },
      { value: '', style: 'xTotN' },
    ],
  });

  /* ── يومي ── */
  const daily: XlsxRowInput[] = [
    { height: 30, cells: [{ value: `المبيعات اليومية — ${brand}`, style: 'xTitle', mergeAcross: 4 }] },
    { height: 22, cells: ['التاريخ', 'اليوم', 'الفواتير', 'القطع', 'المبلغ (د.ع)'].map(v => ({ value: v, style: 'xHead' })) },
  ];
  r.days.forEach((d, i) => {
    const z = i % 2 === 1;
    daily.push({
      height: 19,
      cells: [
        { value: fmtDate(d.day), style: z ? 'xCodeZ' : 'xCode' },
        { value: dayName(d.day), style: z ? 'xCodeZ' : 'xCode' },
        { value: d.receipts, style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: d.qty, style: z ? 'xNumZ' : 'xNum', type: 'Number' },
        { value: Math.round(d.amount), style: z ? 'xNumZ' : 'xNum', type: 'Number' },
      ],
    });
  });
  daily.push({
    height: 22,
    cells: [
      { value: 'المجموع', style: 'xTotL', mergeAcross: 1 },
      { value: r.receipts, style: 'xTotN', type: 'Number' },
      { value: r.qty, style: 'xTotN', type: 'Number' },
      { value: Math.round(r.amount), style: 'xTotN', type: 'Number' },
    ],
  });

  downloadXlsxFile(
    fileBase(brand, f),
    [
      { name: 'ملخص', rtl: true, columnWidths: [230, 140, 140, 100], rows: summary },
      { name: 'المواد', rtl: true, columnWidths: [44, 320, 130, 80, 120, 110, 80], rows: prod },
      { name: 'يومي', rtl: true, columnWidths: [110, 90, 80, 80, 120], rows: daily },
    ],
    STYLES,
  );
}

/* ── PDF: صفحة A4 رسمية تُفتح في نافذة الطباعة (حفظ كـ PDF) ── */

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const nf = (n: number) => Math.round(n).toLocaleString('en-US');

export function brandPdfHtml(opts: { brand: string; seller: string; filter: BrandFilter; report: BrandReport }) {
  const { brand, seller, filter: f, report: r } = opts;
  const delta = (now: number, prev: number) => {
    if (!prev) return '<span class="d">—</span>';
    const p = ((now - prev) / Math.abs(prev)) * 100;
    return `<span class="d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`;
  };
  const max = Math.max(1, ...r.days.map(d => d.amount));
  const bars = r.days.length <= 62
    ? `<div class="chart">${r.days
        .map(d => `<div class="bar" title="${d.day}"><i style="height:${Math.max(1, (Math.max(0, d.amount) / max) * 100)}%"></i><span>${r.days.length <= 31 ? d.day.slice(8) : ''}</span></div>`)
        .join('')}</div>`
    : '';
  const rows = r.products
    .map(
      (p, i) => `<tr><td class="c m">${i + 1}</td><td>${esc(p.name)}</td><td class="c code">${esc(p.barcode)}</td><td class="c">${nf(p.qty)}</td><td class="c b">${nf(p.amount)}</td><td class="c g">${p.share.toFixed(1)}%</td></tr>`,
    )
    .join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(fileBase(brand, f))}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8px; }
  .brandmark { font-size: 22px; font-weight: 300; letter-spacing: .5px; color: #0f9f76; direction: ltr; }
  .brandmark b { font-weight: 700; color: #0f172a; }
  .tag { text-align: left; color: #64748b; font-size: 10px; line-height: 1.6; }
  .tag b { color: #0f9f76; letter-spacing: 1px; }
  .rule { height: 3px; border-radius: 2px; background: linear-gradient(90deg, #0f172a 0 60%, #0f9f76 60% 100%); margin-bottom: 12px; }
  h1 { margin: 0; font-size: 21px; } h1 span { color: #0f9f76; }
  .meta { margin-top: 4px; color: #475569; font-size: 11.5px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin: 12px 0; }
  .k { border: 1px solid #dbe4ea; border-radius: 10px; padding: 8px 10px; }
  .k .l { color: #64748b; font-size: 9.5px; font-weight: 700; }
  .k .v { font-size: 17px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .k.main { background: #0f172a; color: #fff; border-color: #0f172a; } .k.main .l { color: #9fe3cc; }
  .d { font-size: 10px; font-weight: 700; color: #94a3b8; } .d.up { color: #059669; } .d.down { color: #dc2626; }
  .k.main .d.up { color: #6ee7b7; } .k.main .d.down { color: #fca5a5; }
  h2 { font-size: 13px; margin: 14px 0 6px; color: #134e4a; }
  .chart { display: flex; align-items: flex-end; gap: 2px; height: 90px; border-bottom: 1px solid #cbd5e1; padding: 0 2px; }
  .bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
  .bar i { display: block; width: 100%; background: #0f9f76; border-radius: 2px 2px 0 0; }
  .bar span { font-size: 7px; color: #94a3b8; height: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #134e4a; color: #fff; font-size: 10px; padding: 6px; text-align: right; }
  td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  .c { text-align: center; } .b { font-weight: 800; } .g { color: #0f9f76; font-weight: 700; } .m { color: #94a3b8; }
  .code { font-family: Consolas, monospace; font-size: 10px; }
  tfoot td { background: #0f172a !important; color: #fff; font-weight: 800; }
  thead { display: table-header-group; } tr { break-inside: avoid; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9.5px; display: flex; justify-content: space-between; }
</style></head><body>
<div class="top">
  <div class="brandmark">deema <b>alhayat</b></div>
  <div class="tag"><b>BRAND SALES STATEMENT</b><br/>${esc(new Date().toLocaleString('ar-IQ'))}</div>
</div>
<div class="rule"></div>
<h1>كشف مبيعات <span>${esc(brand)}</span></h1>
<div class="meta">من ${fmtDate(f.from)} إلى ${fmtDate(f.to)} · ${scopeLabel(f)} · الموظف: ${esc(seller)}</div>
<div class="kpis">
  <div class="k main"><div class="l">صافي المبيعات (د.ع)</div><div class="v">${nf(r.amount)}</div>${delta(r.amount, r.prev.amount)}</div>
  <div class="k"><div class="l">القطع المباعة</div><div class="v">${nf(r.qty)}</div>${delta(r.qty, r.prev.qty)}</div>
  <div class="k"><div class="l">عدد الفواتير</div><div class="v">${nf(r.receipts)}</div>${delta(r.receipts, r.prev.receipts)}</div>
  <div class="k"><div class="l">متوسط الفاتورة (د.ع)</div><div class="v">${nf(r.avgTicket)}</div><span class="d">${r.productsSold} مادة · ${r.activeDays} يوم بيع</span></div>
</div>
${bars ? `<h2>المبيعات اليومية</h2>${bars}` : ''}
<h2>المواد (${r.products.length})</h2>
<table><thead><tr><th class="c">#</th><th>المادة</th><th class="c">الباركود</th><th class="c">الكمية</th><th class="c">المبلغ (د.ع)</th><th class="c">الحصة</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="c m">لا مبيعات في هذه المدة</td></tr>'}</tbody>
<tfoot><tr><td colspan="3">المجموع</td><td class="c">${nf(r.qty)}</td><td class="c">${nf(r.amount)}</td><td class="c">100%</td></tr></tfoot></table>
<div class="foot"><span>المبالغ صافية بعد المرتجعات · الهدايا غير محسوبة</span><span>Deema Al Hayat · Baghdad</span></div>
</body></html>`;
}

/** يفتح الكشف في نافذة جديدة ويطلب الطباعة — «حفظ كـ PDF» من نافذة الطباعة. */
export function openBrandPdf(opts: { brand: string; seller: string; filter: BrandFilter; report: BrandReport }) {
  const html = brandPdfHtml(opts);
  const w = window.open('', '_blank');
  if (!w) {
    // متصفح يمنع النوافذ: تنزيل الملف HTML ليُفتح ويُطبع
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase(opts.brand, opts.filter)}.html`;
    a.click();
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  };
  w.onload = () => setTimeout(go, 250);
  setTimeout(go, 900);
}
