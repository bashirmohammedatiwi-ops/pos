import {
  avgTicket, dayLabel, groupGoalsByRule, liveGoals, moneyIq, pct, shareOf, todayKey,
  type CashierRow, type DayRow, type GoalRow, type SellerRow,
} from './api';
import type { PeriodBounds, PeriodStats } from './period';

type Person = {
  rank: number;
  name: string;
  sales: number;
  share: number;
  commission: number;
  receipts: number;
  pieces: number;
  ticket: number;
  goals: string;
  due: number;
};

type DayPoint = {
  label: string;
  sales: number;
  receipts: number;
  pieces: number;
  ticket: number;
  share: number;
};

type GoalBrief = {
  avg: number;
  hit: number;
  near: number;
  focus: number;
  total: number;
  weekScoped: boolean;
  rules: Array<{ name: string; avg: number; hit: number; total: number }>;
};

export type PeriodReport = {
  title: string;
  focus: 'sales' | 'commission';
  period: string;
  range: string;
  printedAt: string;
  sales: number;
  receipts: number;
  ticket: number;
  commission: number;
  pieces: number;
  findings: string[];
  note: string;
  days: DayPoint[];
  sellers: Person[];
  cashiers: Person[];
  goals: GoalBrief | null;
};

export function buildPeriodReport(input: {
  title: string;
  period: PeriodBounds;
  totals: PeriodStats;
  sellers: SellerRow[];
  cashiers: CashierRow[];
  days?: DayRow[];
  goals?: GoalRow[];
  focus?: 'sales' | 'commission';
}): PeriodReport {
  const focus = input.focus ?? 'sales';
  const sales = Number(input.totals.sales) || 0;
  const receipts = Number(input.totals.receipts) || 0;
  const ticket = Number(input.totals.ticket) || avgTicket(sales, receipts);
  const commission = Number(input.totals.commission) || 0;
  const pieces = Number(input.totals.pieces) || 0;

  const sellerRows = [...input.sellers]
    .filter(s => s.salesAmount > 0 || s.commissionAmount > 0 || s.receiptCount > 0)
    .sort((a, b) => focus === 'commission'
      ? b.commissionAmount - a.commissionAmount || b.salesAmount - a.salesAmount
      : b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount);
  const sellerSales = sellerRows.reduce((s, r) => s + (Number(r.salesAmount) || 0), 0);
  const sellerComm = sellerRows.reduce((s, r) => s + (Number(r.commissionAmount) || 0), 0);
  const salesBase = Math.max(sales, sellerSales, 0);
  const commBase = Math.max(commission, sellerComm, 0);

  const sellers: Person[] = sellerRows.map((s, i) => ({
    rank: i + 1,
    name: s.name,
    sales: Number(s.salesAmount) || 0,
    share: shareOf(focus === 'commission' ? s.commissionAmount : s.salesAmount, focus === 'commission' ? commBase : salesBase),
    commission: Number(s.commissionAmount) || 0,
    receipts: Number(s.receiptCount) || 0,
    pieces: Number(s.pieceCount) || 0,
    ticket: avgTicket(s.salesAmount, s.receiptCount),
    goals: s.goalCount > 0 ? `${s.goalsHit}/${s.goalCount} · ${pct(s.goalPercent)}` : '—',
    due: Number(s.balanceDue) || 0,
  }));

  const cashierRows = focus === 'sales'
    ? [...input.cashiers]
      .filter(c => c.salesAmount > 0 || c.receiptCount > 0)
      .sort((a, b) => b.salesAmount - a.salesAmount || b.receiptCount - a.receiptCount)
    : [];
  const cashierSales = cashierRows.reduce((s, r) => s + (Number(r.salesAmount) || 0), 0);
  const cashierBase = Math.max(sales, cashierSales, 0);
  const cashiers: Person[] = cashierRows.map((c, i) => ({
    rank: i + 1,
    name: c.name,
    sales: Number(c.salesAmount) || 0,
    share: shareOf(c.salesAmount, cashierBase),
    commission: Number(c.commissionAmount) || 0,
    receipts: Number(c.receiptCount) || 0,
    pieces: Number(c.pieceCount) || 0,
    ticket: avgTicket(c.salesAmount, c.receiptCount),
    goals: '—',
    due: 0,
  }));

  const dayRows = (input.days ?? [])
    .map(d => ({
      key: String(d.day || '').slice(0, 10),
      sales: Number(d.salesAmount) || 0,
      receipts: Number(d.receiptCount) || 0,
      pieces: Number(d.pieceCount) || 0,
    }))
    .filter(d => d.key >= input.period.from && d.key <= input.period.to && (d.sales !== 0 || d.receipts > 0))
    .sort((a, b) => a.key.localeCompare(b.key));
  const daySales = dayRows.reduce((s, d) => s + d.sales, 0);
  const days: DayPoint[] = focus === 'sales' && dayRows.length > 1
    ? dayRows.map(d => ({
      label: dayLabel(d.key),
      sales: d.sales,
      receipts: d.receipts,
      pieces: d.pieces,
      ticket: avgTicket(d.sales, d.receipts),
      share: shareOf(d.sales, daySales),
    }))
    : [];

  const goals = briefGoals(input.goals, input.period.kind === 'week');
  const note = accuracyNote(focus, sales, sellerSales, commission, sellerComm);
  const findings = writeFindings({ focus, sales, receipts, ticket, commission, pieces, sellers, cashiers, days, goals });

  return {
    title: input.title,
    focus,
    period: input.period.label,
    range: input.period.from === input.period.to
      ? dayLabel(input.period.from)
      : `${dayLabel(input.period.from)} — ${dayLabel(input.period.to)}`,
    printedAt: printedAt(),
    sales,
    receipts,
    ticket,
    commission,
    pieces,
    findings,
    note,
    days,
    sellers,
    cashiers,
    goals,
  };
}

function briefGoals(goals: GoalRow[] | undefined, weekScoped: boolean): GoalBrief | null {
  const rows = liveGoals(goals);
  if (!rows.length) return null;
  const hit = rows.filter(g => g.percent >= 100).length;
  const near = rows.filter(g => g.percent >= 80 && g.percent < 100).length;
  const avg = rows.reduce((s, g) => s + g.percent, 0) / rows.length;
  const rules = groupGoalsByRule(rows)
    .filter(r => r.avg < 100)
    .slice(0, 6)
    .map(r => ({ name: r.ruleName || 'هدف', avg: r.avg, hit: r.hit, total: r.total }));
  return { avg, hit, near, focus: rows.length - hit - near, total: rows.length, weekScoped, rules };
}

function accuracyNote(focus: 'sales' | 'commission', sales: number, sellerSales: number, commission: number, sellerComm: number) {
  const parts: string[] = [];
  if (focus === 'sales' && materialGap(sales, sellerSales)) {
    parts.push(`إجمالي المبيعات الرسمي للمدة ${moneyIq(sales)}، ومجموع صفوف البائعين ${moneyIq(sellerSales)}.`);
  }
  if (focus === 'commission' && materialGap(commission, sellerComm)) {
    parts.push(`إجمالي العمولة الرسمي ${moneyIq(commission)}، ومجموع صفوف البائعين ${moneyIq(sellerComm)}.`);
  }
  parts.push('عدد فواتير كل شخص يخصه، والفاتورة الواحدة قد تظهر عند أكثر من بائع. إجمالي الفواتير الرسمي في أعلى التقرير.');
  return parts.join(' ');
}

function materialGap(official: number, listed: number) {
  const gap = Math.abs(official - listed);
  return gap > 1 && (official <= 0 || gap / official > 0.01);
}

function writeFindings(input: {
  focus: 'sales' | 'commission';
  sales: number;
  receipts: number;
  ticket: number;
  commission: number;
  pieces: number;
  sellers: Person[];
  cashiers: Person[];
  days: DayPoint[];
  goals: GoalBrief | null;
}) {
  if (input.sales <= 0 && input.receipts <= 0 && input.commission <= 0) {
    return ['لا توجد حركة مسجّلة في هذه المدة.'];
  }
  const lines: string[] = [];
  if (input.focus === 'commission') {
    lines.push(`عمولات المدة ${moneyIq(input.commission)} مقابل مبيعات ${moneyIq(input.sales)} و${input.receipts} فاتورة.`);
    const top = input.sellers[0];
    if (top) lines.push(`أعلى عمولة: ${top.name} — ${moneyIq(top.commission)} (${pct(top.share)} من عمولات الجدول).`);
  } else {
    lines.push(`مبيعات المدة ${moneyIq(input.sales)} من ${input.receipts} فاتورة، بمتوسط ${moneyIq(input.ticket)}، و${moneyIq(input.pieces)} قطعة.`);
    if (input.commission > 0) {
      lines.push(`العمولات ${moneyIq(input.commission)}${input.sales > 0 ? `، بنسبة ${pct(shareOf(input.commission, input.sales))} من المبيعات` : ''}.`);
    }
    const top = input.sellers[0];
    if (top) lines.push(`أقوى بائع: ${top.name} — ${moneyIq(top.sales)} (${pct(top.share)}).`);
    const cash = input.cashiers[0];
    if (cash) lines.push(`أقوى كاشير: ${cash.name} — ${moneyIq(cash.sales)} و${cash.receipts} فاتورة.`);
  }
  const bestDay = [...input.days].sort((a, b) => b.sales - a.sales)[0];
  if (bestDay) lines.push(`أعلى يوم: ${bestDay.label} — ${moneyIq(bestDay.sales)} (${pct(bestDay.share)} من أيام المدة).`);
  if (input.goals) {
    lines.push(`أهداف الأسبوع: ${input.goals.hit} تحقق من ${input.goals.total}، والمتوسط ${pct(input.goals.avg)}.`);
  }
  return lines.slice(0, 5);
}

function printedAt() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dayLabel(todayKey())} · ${hh}:${mm}`;
}

function esc(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cell(value: string | number, style: string, kind: 'String' | 'Number' = typeof value === 'number' ? 'Number' : 'String') {
  const text = kind === 'Number' ? String(value) : esc(String(value));
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${kind}">${text}</Data></Cell>`;
}

function row(cells: string) {
  return `<Row>${cells}</Row>`;
}

function blank() {
  return row(cell('', 'plain'));
}

export function reportExcel(report: PeriodReport) {
  const blocks: string[] = [];
  const pushTitle = (text: string) => blocks.push(row(cell(text, 'section')));
  const pushHead = (cols: string[]) => blocks.push(row(cols.map(c => cell(c, 'head')).join('')));
  const shareCell = (share: number) => cell(Math.round(share * 10) / 1000, 'pct', 'Number');

  blocks.push(row(cell('FOT MANAGER', 'kicker') + cell(report.period, 'kicker') + cell(report.printedAt, 'kicker')));
  blocks.push(row(cell(report.title, 'title') + cell(report.range, 'title')));
  blocks.push(blank());
  pushHead(report.focus === 'commission'
    ? ['العمولات', 'المبيعات', 'الفواتير', 'البائعون']
    : ['المبيعات', 'الفواتير', 'متوسط الفاتورة', 'القطع', 'العمولات', 'البائعون']);
  blocks.push(row(report.focus === 'commission'
    ? [
      cell(Math.round(report.commission), 'kpi', 'Number'),
      cell(Math.round(report.sales), 'kpi', 'Number'),
      cell(report.receipts, 'kpi', 'Number'),
      cell(report.sellers.length, 'kpi', 'Number'),
    ].join('')
    : [
      cell(Math.round(report.sales), 'kpi', 'Number'),
      cell(report.receipts, 'kpi', 'Number'),
      cell(Math.round(report.ticket), 'kpi', 'Number'),
      cell(Math.round(report.pieces), 'kpi', 'Number'),
      cell(Math.round(report.commission), 'kpi', 'Number'),
      cell(report.sellers.length, 'kpi', 'Number'),
    ].join('')));
  blocks.push(blank());
  pushTitle('الخلاصة');
  for (const line of report.findings) blocks.push(row(cell(line, 'find')));
  blocks.push(blank());

  if (report.days.length) {
    pushTitle('الأيام');
    pushHead(['اليوم', 'المبيعات', 'الحصة', 'الفواتير', 'المتوسط', 'القطع']);
    for (const d of report.days) {
      blocks.push(row([
        cell(d.label, 'plain'),
        cell(Math.round(d.sales), 'num', 'Number'),
        shareCell(d.share),
        cell(d.receipts, 'num', 'Number'),
        cell(Math.round(d.ticket), 'num', 'Number'),
        cell(Math.round(d.pieces), 'num', 'Number'),
      ].join('')));
    }
    blocks.push(blank());
  }

  pushTitle(report.focus === 'commission' ? 'عمولات البائعين' : 'البائعون');
  const sellerHead = report.focus === 'commission'
    ? ['#', 'البائع', 'العمولة', 'الحصة', 'المبيعات', 'الفواتير', 'المستحق']
    : ['#', 'البائع', 'المبيعات', 'الحصة', 'العمولة', 'الفواتير', 'المتوسط', 'القطع', 'الأهداف'];
  pushHead(sellerHead);
  for (const s of report.sellers) {
    blocks.push(row(report.focus === 'commission'
      ? [
        cell(s.rank, 'num', 'Number'), cell(s.name, 'plain'),
        cell(Math.round(s.commission), 'num', 'Number'), shareCell(s.share),
        cell(Math.round(s.sales), 'num', 'Number'), cell(s.receipts, 'num', 'Number'),
        cell(s.due > 0 ? Math.round(s.due) : 0, 'num', 'Number'),
      ].join('')
      : [
        cell(s.rank, 'num', 'Number'), cell(s.name, 'plain'),
        cell(Math.round(s.sales), 'num', 'Number'), shareCell(s.share),
        cell(Math.round(s.commission), 'num', 'Number'), cell(s.receipts, 'num', 'Number'),
        cell(Math.round(s.ticket), 'num', 'Number'), cell(Math.round(s.pieces), 'num', 'Number'),
        cell(s.goals, 'plain'),
      ].join('')));
  }
  blocks.push(blank());

  if (report.cashiers.length) {
    pushTitle('الكاشير');
    pushHead(['#', 'الكاشير', 'المبيعات', 'الحصة', 'الفواتير', 'المتوسط', 'القطع']);
    for (const c of report.cashiers) {
      blocks.push(row([
        cell(c.rank, 'num', 'Number'), cell(c.name, 'plain'),
        cell(Math.round(c.sales), 'num', 'Number'), shareCell(c.share),
        cell(c.receipts, 'num', 'Number'), cell(Math.round(c.ticket), 'num', 'Number'),
        cell(Math.round(c.pieces), 'num', 'Number'),
      ].join('')));
    }
    blocks.push(blank());
  }

  if (report.goals) {
    pushTitle(report.goals.weekScoped ? 'أهداف الأسبوع' : 'أهداف الأسبوع الحالي');
    pushHead(['المتوسط', 'تحقق', 'قريب', 'تركيز', 'العدد']);
    blocks.push(row([
      cell(Math.round(report.goals.avg * 10) / 1000, 'pct', 'Number'),
      cell(report.goals.hit, 'num', 'Number'),
      cell(report.goals.near, 'num', 'Number'),
      cell(report.goals.focus, 'num', 'Number'),
      cell(report.goals.total, 'num', 'Number'),
    ].join('')));
    if (report.goals.rules.length) {
      pushHead(['هدف يحتاج متابعة', 'المتوسط', 'تحقق', 'العدد']);
      for (const rule of report.goals.rules) {
        blocks.push(row([
          cell(rule.name, 'plain'),
          cell(Math.round(rule.avg * 10) / 1000, 'pct', 'Number'),
          cell(rule.hit, 'num', 'Number'),
          cell(rule.total, 'num', 'Number'),
        ].join('')));
      }
    }
    blocks.push(blank());
  }

  blocks.push(row(cell(report.note, 'note')));

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="kicker"><Font ss:Bold="1" ss:Color="#8A7340" ss:FontName="Tahoma" ss:Size="11"/></Style>
<Style ss:ID="title"><Font ss:Bold="1" ss:Color="#101628" ss:FontName="Tahoma" ss:Size="16"/></Style>
<Style ss:ID="section"><Font ss:Bold="1" ss:Color="#101628" ss:FontName="Tahoma" ss:Size="13"/><Interior ss:Color="#F6E7B8" ss:Pattern="Solid"/></Style>
<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#E4C56A" ss:FontName="Tahoma"/><Interior ss:Color="#101628" ss:Pattern="Solid"/></Style>
<Style ss:ID="kpi"><Font ss:Bold="1" ss:Color="#101628" ss:FontName="Tahoma" ss:Size="12"/><Interior ss:Color="#F4F1EA" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="find"><Font ss:FontName="Tahoma" ss:Color="#101628" ss:Size="11"/></Style>
<Style ss:ID="plain"><Font ss:FontName="Tahoma" ss:Color="#101628"/></Style>
<Style ss:ID="num"><Font ss:FontName="Tahoma" ss:Color="#101628"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="pct"><Font ss:FontName="Tahoma" ss:Color="#101628"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="note"><Font ss:FontName="Tahoma" ss:Color="#64748B" ss:Size="10"/></Style>
</Styles>
<Worksheet ss:Name="التقرير" ss:RightToLeft="1"><Table ss:DefaultColumnWidth="88">${blocks.join('')}</Table></Worksheet>
</Workbook>`;
}

function shareBar(share: number) {
  const width = Math.max(0, Math.min(100, share));
  return `<td class="share"><span class="bar" style="width:${width}%"></span><b>${esc(pct(share))}</b></td>`;
}

function moneyCell(n: number) {
  return `<td class="num">${esc(moneyIq(n))}</td>`;
}

export function reportHtml(report: PeriodReport) {
  const kpis = report.focus === 'commission'
    ? [
      ['العمولات', moneyIq(report.commission)],
      ['المبيعات', moneyIq(report.sales)],
      ['الفواتير', String(report.receipts)],
      ['البائعون', String(report.sellers.length)],
    ]
    : [
      ['المبيعات', moneyIq(report.sales)],
      ['الفواتير', String(report.receipts)],
      ['متوسط الفاتورة', moneyIq(report.ticket)],
      ['القطع', String(Math.round(report.pieces))],
      ['العمولات', moneyIq(report.commission)],
      ['البائعون', String(report.sellers.length)],
    ];
  const findings = report.findings.map(line => `<li>${esc(line)}</li>`).join('');
  const days = report.days.length ? `<section class="rpt-block">
      <h2>الأيام</h2>
      <table>
        <thead><tr><th>اليوم</th><th>المبيعات</th><th>الحصة</th><th>الفواتير</th><th>المتوسط</th><th>القطع</th></tr></thead>
        <tbody>${report.days.map(d => `<tr><td>${esc(d.label)}</td>${moneyCell(d.sales)}${shareBar(d.share)}<td class="num">${d.receipts}</td>${moneyCell(d.ticket)}<td class="num">${Math.round(d.pieces)}</td></tr>`).join('')}</tbody>
      </table>
    </section>` : '';
  const showDue = report.focus === 'commission' && report.sellers.some(s => s.due > 0);
  const sellerHead = report.focus === 'commission'
    ? `<th>#</th><th>البائع</th><th>العمولة</th><th>الحصة</th><th>المبيعات</th><th>الفواتير</th>${showDue ? '<th>المستحق</th>' : ''}`
    : '<th>#</th><th>البائع</th><th>المبيعات</th><th>الحصة</th><th>العمولة</th><th>الفواتير</th><th>المتوسط</th><th>الأهداف</th>';
  const sellerRows = report.sellers.map(s => report.focus === 'commission'
    ? `<tr><td class="num">${s.rank}</td><td>${esc(s.name)}</td>${moneyCell(s.commission)}${shareBar(s.share)}${moneyCell(s.sales)}<td class="num">${s.receipts}</td>${showDue ? moneyCell(s.due) : ''}</tr>`
    : `<tr><td class="num">${s.rank}</td><td>${esc(s.name)}</td>${moneyCell(s.sales)}${shareBar(s.share)}${moneyCell(s.commission)}<td class="num">${s.receipts}</td>${moneyCell(s.ticket)}<td>${esc(s.goals)}</td></tr>`
  ).join('');
  const cashiers = report.cashiers.length ? `<section class="rpt-block">
      <h2>الكاشير</h2>
      <table>
        <thead><tr><th>#</th><th>الكاشير</th><th>المبيعات</th><th>الحصة</th><th>الفواتير</th><th>المتوسط</th><th>القطع</th></tr></thead>
        <tbody>${report.cashiers.map(c => `<tr><td class="num">${c.rank}</td><td>${esc(c.name)}</td>${moneyCell(c.sales)}${shareBar(c.share)}<td class="num">${c.receipts}</td>${moneyCell(c.ticket)}<td class="num">${Math.round(c.pieces)}</td></tr>`).join('')}</tbody>
      </table>
    </section>` : '';
  const goals = report.goals ? `<section class="rpt-block">
      <h2>${report.goals.weekScoped ? 'أهداف الأسبوع' : 'أهداف الأسبوع الحالي'}</h2>
      ${report.goals.weekScoped ? '' : '<p class="rpt-hint">هذه الأهداف للأسبوع كله، وليست محصورة بالمدة المختارة.</p>'}
      <div class="rpt-goals">
        <div><span>المتوسط</span><strong>${esc(pct(report.goals.avg))}</strong></div>
        <div><span>تحقق</span><strong>${report.goals.hit}</strong></div>
        <div><span>قريب</span><strong>${report.goals.near}</strong></div>
        <div><span>تركيز</span><strong>${report.goals.focus}</strong></div>
      </div>
      ${report.goals.rules.length ? `<table>
        <thead><tr><th>هدف يحتاج متابعة</th><th>المتوسط</th><th>تحقق</th><th>العدد</th></tr></thead>
        <tbody>${report.goals.rules.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${esc(pct(r.avg))}</td><td class="num">${r.hit}</td><td class="num">${r.total}</td></tr>`).join('')}</tbody>
      </table>` : ''}
    </section>` : '';

  return `<article class="rpt">
    <header class="rpt-hero">
      <div class="rpt-top">
        <p class="rpt-kicker">FOT · تقرير المدير</p>
        <p class="rpt-stamp">${esc(report.printedAt)}</p>
      </div>
      <h1>${esc(report.title)}</h1>
      <p class="rpt-range">${esc(report.period)} · ${esc(report.range)}</p>
      <div class="rpt-kpis">${kpis.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
    </header>
    <section class="rpt-findings">
      <h2>الخلاصة</h2>
      <ul>${findings}</ul>
    </section>
    ${days}
    <section class="rpt-block">
      <h2>${report.focus === 'commission' ? 'عمولات البائعين' : 'البائعون'}</h2>
      <table>
        <thead><tr>${sellerHead}</tr></thead>
        <tbody>${sellerRows || `<tr><td colspan="${report.focus === 'commission' ? 6 : 8}">لا بائعين في هذه المدة</td></tr>`}</tbody>
      </table>
    </section>
    ${cashiers}
    ${goals}
    <p class="rpt-note">${esc(report.note)}</p>
  </article>`;
}
