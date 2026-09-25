import { dayLabel, moneyIq, receiptLabel, stampLabel, type CashierRow, type DayRow, type LineRow, type SellerRow } from './api';
import { groupReceipts, rankProducts } from './insights';
import type { PeriodBounds, PeriodStats } from './period';

export type PeriodReport = {
  title: string;
  period: string;
  range: string;
  sales: number;
  receipts: number;
  ticket: number;
  commission: number;
  pieces: number;
  sellers: SellerRow[];
  cashiers: CashierRow[];
  days: Array<{ label: string; sales: number; receipts: number }>;
  products: Array<{ name: string; qty: number; count: number; sales: number }>;
  invoices: Array<{ no: string; at: string; cashier: string; sellers: string; qty: number; sales: number; items: number }>;
};

export function buildPeriodReport(input: {
  title: string;
  period: PeriodBounds;
  totals: PeriodStats;
  sellers: SellerRow[];
  cashiers: CashierRow[];
  lines: LineRow[];
  days?: DayRow[];
}): PeriodReport {
  const days = (input.days ?? [])
    .map(d => ({
      key: String(d.day || '').slice(0, 10),
      sales: Number(d.salesAmount) || 0,
      receipts: Number(d.receiptCount) || 0,
    }))
    .filter(d => d.key >= input.period.from && d.key <= input.period.to && (d.sales !== 0 || d.receipts > 0));
  const invoices = groupReceipts(input.lines).map(g => ({
    no: receiptLabel(g.receiptNumber),
    at: stampLabel(g.at),
    cashier: g.cashierName || '—',
    sellers: g.sellers.join('، ') || '—',
    qty: g.qty,
    sales: g.sales,
    items: g.count,
  }));
  return {
    title: input.title,
    period: input.period.label,
    range: `${dayLabel(input.period.from)} — ${dayLabel(input.period.to)}`,
    sales: input.totals.sales,
    receipts: input.totals.receipts,
    ticket: input.totals.ticket,
    commission: input.totals.commission,
    pieces: input.totals.pieces,
    sellers: [...input.sellers].filter(s => s.salesAmount > 0 || s.commissionAmount > 0 || s.receiptCount > 0)
      .sort((a, b) => b.salesAmount - a.salesAmount),
    cashiers: [...input.cashiers].filter(c => c.salesAmount > 0 || c.receiptCount > 0)
      .sort((a, b) => b.salesAmount - a.salesAmount),
    days: days.map(d => ({ label: dayLabel(d.key), sales: d.sales, receipts: d.receipts })),
    products: rankProducts(input.lines).slice(0, 40).map(p => ({ name: p.name, qty: p.qty, count: p.count, sales: p.sales })),
    invoices,
  };
}

function esc(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cell(value: string | number, style: string, kind: 'String' | 'Number' = typeof value === 'number' ? 'Number' : 'String') {
  const text = kind === 'Number' ? String(Math.round(Number(value) || 0)) : esc(String(value));
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${kind}">${text}</Data></Cell>`;
}

function row(cells: string) {
  return `<Row>${cells}</Row>`;
}

export function reportExcel(report: PeriodReport) {
  const blocks: string[] = [];
  const pushTitle = (text: string) => blocks.push(row(cell(text, 'section')));
  const pushHead = (cols: string[]) => blocks.push(row(cols.map(c => cell(c, 'head')).join('')));
  blocks.push(row(cell('FOT MANAGER', 'kicker') + cell(report.period, 'kicker')));
  blocks.push(row(cell(report.title, 'title') + cell(report.range, 'title')));
  blocks.push(row(['المبيعات', 'الفواتير', 'المتوسط', 'العمولات', 'القطع'].map(c => cell(c, 'head')).join('')));
  blocks.push(row([
    cell(report.sales, 'kpi', 'Number'),
    cell(report.receipts, 'kpi', 'Number'),
    cell(report.ticket, 'kpi', 'Number'),
    cell(report.commission, 'kpi', 'Number'),
    cell(report.pieces, 'kpi', 'Number'),
  ].join('')));
  blocks.push(row(cell('', 'plain')));
  if (report.days.length) {
    pushTitle('الأيام');
    pushHead(['اليوم', 'المبيعات', 'الفواتير']);
    for (const d of report.days) blocks.push(row(cell(d.label, 'plain') + cell(d.sales, 'num', 'Number') + cell(d.receipts, 'num', 'Number')));
    blocks.push(row(cell('', 'plain')));
  }
  pushTitle('البائعون');
  pushHead(['البائع', 'المبيعات', 'العمولة', 'الفواتير', 'القطع']);
  for (const s of report.sellers) {
    blocks.push(row([
      cell(s.name, 'plain'), cell(s.salesAmount, 'num', 'Number'), cell(s.commissionAmount, 'num', 'Number'),
      cell(s.receiptCount, 'num', 'Number'), cell(s.pieceCount, 'num', 'Number'),
    ].join('')));
  }
  blocks.push(row(cell('', 'plain')));
  pushTitle('الكاشير');
  pushHead(['الكاشير', 'المبيعات', 'الفواتير', 'القطع']);
  for (const c of report.cashiers) {
    blocks.push(row(cell(c.name, 'plain') + cell(c.salesAmount, 'num', 'Number') + cell(c.receiptCount, 'num', 'Number') + cell(c.pieceCount, 'num', 'Number')));
  }
  blocks.push(row(cell('', 'plain')));
  pushTitle('المنتجات');
  pushHead(['المنتج', 'الكمية', 'الحركات', 'المبيعات']);
  for (const p of report.products) {
    blocks.push(row(cell(p.name, 'plain') + cell(p.qty, 'num', 'Number') + cell(p.count, 'num', 'Number') + cell(p.sales, 'num', 'Number')));
  }
  blocks.push(row(cell('', 'plain')));
  pushTitle('الفواتير');
  pushHead(['الفاتورة', 'الوقت', 'الكاشير', 'البائعون', 'الأصناف', 'الكمية', 'المبلغ']);
  for (const inv of report.invoices) {
    blocks.push(row([
      cell(inv.no, 'plain'), cell(inv.at, 'plain'), cell(inv.cashier, 'plain'), cell(inv.sellers, 'plain'),
      cell(inv.items, 'num', 'Number'), cell(inv.qty, 'num', 'Number'), cell(inv.sales, 'num', 'Number'),
    ].join('')));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="kicker"><Font ss:Bold="1" ss:Color="#8A7340" ss:FontName="Tahoma" ss:Size="11"/></Style>
<Style ss:ID="title"><Font ss:Bold="1" ss:Color="#101628" ss:FontName="Tahoma" ss:Size="16"/></Style>
<Style ss:ID="section"><Font ss:Bold="1" ss:Color="#101628" ss:FontName="Tahoma" ss:Size="13"/><Interior ss:Color="#F6E7B8" ss:Pattern="Solid"/></Style>
<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#E4C56A" ss:FontName="Tahoma"/><Interior ss:Color="#101628" ss:Pattern="Solid"/></Style>
<Style ss:ID="kpi"><Font ss:Bold="1" ss:Color="#101628" ss:FontName="Tahoma" ss:Size="12"/><Interior ss:Color="#F4F1EA" ss:Pattern="Solid"/></Style>
<Style ss:ID="plain"><Font ss:FontName="Tahoma" ss:Color="#101628"/></Style>
<Style ss:ID="num"><Font ss:FontName="Tahoma" ss:Color="#101628"/><NumberFormat ss:Format="#,##0"/></Style>
</Styles>
<Worksheet ss:Name="التقرير" ss:RightToLeft="1"><Table>${blocks.join('')}</Table></Worksheet>
</Workbook>`;
}

function table(headers: string[], rows: string[][]) {
  const head = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function reportHtml(report: PeriodReport) {
  const money = (n: number) => moneyIq(n);
  const days = report.days.length
    ? `<h2>الأيام</h2>${table(['اليوم', 'المبيعات', 'الفواتير'], report.days.map(d => [d.label, money(d.sales), String(d.receipts)]))}`
    : '';
  return `<article class="rpt">
    <header class="rpt-hero">
      <p class="rpt-kicker">FOT MANAGER · ${esc(report.period)}</p>
      <h1>${esc(report.title)}</h1>
      <p class="rpt-range">${esc(report.range)}</p>
      <div class="rpt-kpis">
        <div><span>المبيعات</span><strong>${esc(money(report.sales))}</strong></div>
        <div><span>الفواتير</span><strong>${report.receipts}</strong></div>
        <div><span>المتوسط</span><strong>${esc(money(report.ticket))}</strong></div>
        <div><span>العمولات</span><strong>${esc(money(report.commission))}</strong></div>
      </div>
    </header>
    ${days}
    <h2>البائعون</h2>
    ${table(['البائع', 'المبيعات', 'العمولة', 'الفواتير'], report.sellers.map(s => [s.name, money(s.salesAmount), money(s.commissionAmount), String(s.receiptCount)]))}
    <h2>الكاشير</h2>
    ${table(['الكاشير', 'المبيعات', 'الفواتير', 'القطع'], report.cashiers.map(c => [c.name, money(c.salesAmount), String(c.receiptCount), String(Math.round(c.pieceCount))]))}
    <h2>المنتجات</h2>
    ${table(['المنتج', 'الكمية', 'الحركات', 'المبيعات'], report.products.map(p => [p.name, String(p.qty), String(p.count), money(p.sales)]))}
    <h2>الفواتير · ${report.invoices.length}</h2>
    ${table(['الفاتورة', 'الوقت', 'الكاشير', 'البائع', 'المبلغ'], report.invoices.map(inv => [inv.no, inv.at, inv.cashier, inv.sellers, money(inv.sales)]))}
  </article>`;
}
