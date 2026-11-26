import arabicFontUrl from '@fontsource-variable/readex-pro/files/readex-pro-arabic-wght-normal.woff2?url';
import latinFontUrl from '@fontsource-variable/readex-pro/files/readex-pro-latin-wght-normal.woff2?url';
import type { CashBox, CashBoxes, CashStatement } from '../work';

/* قوالب PDF للصناديق: كشف صندوق لفترة، وملخص أرصدة كل الصناديق — A4 أبيض بخط التطبيق. */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** مبلغ بعملة الصندوق: الدينار عدداً صحيحاً، والدولار بكسوره إن وُجدت */
export function cashAmount(v: number, currency: string) {
  const n = Number(v) || 0;
  return currency === 'USD'
    ? n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
    : Math.round(n).toLocaleString('en-US');
}
export const cashUnit = (currency: string) => (currency === 'USD' ? '$' : 'د.ع');
export const cashMoney = (v: number, currency: string) => (currency === 'USD' ? `⁦$${cashAmount(v, currency)}⁩` : `${cashAmount(v, currency)} د.ع`);

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const issuedNow = () => new Date().toLocaleString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const MARK = `<svg width="30" height="30" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7a17 17 0 1 0 16.2 11.8" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="37.6" cy="11.2" r="4.6" fill="#F0B04F"/><circle cx="24" cy="24" r="5.2" fill="#fff" fill-opacity=".92"/></svg>`;

async function fontDataUrl(url: string) {
  try {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:font/woff2;base64,${btoa(bin)}`;
  } catch {
    return '';
  }
}

/** قالب A4 بخط التطبيق وشعار المحل — يُستخدم لكل تقارير الإداري */
export async function pdfShell(title: string, docTitle: string, docSub: string, body: string) {
  const [arabic, latin] = await Promise.all([fontDataUrl(arabicFontUrl), fontDataUrl(latinFontUrl)]);
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  ${latin ? `@font-face { font-family: 'Readex'; src: url(${latin}) format('woff2'); font-weight: 200 700; }` : ''}
  ${arabic ? `@font-face { font-family: 'Readex'; src: url(${arabic}) format('woff2'); font-weight: 200 700; unicode-range: U+0600-06FF, U+0750-077F, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFF; }` : ''}
  @page { size: A4; margin: 11mm 11mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Readex', 'Noto Sans Arabic', Tahoma, sans-serif; color: #17131f; font-size: 11.5px; line-height: 1.55; }
  .num { font-variant-numeric: tabular-nums; } .ltr { direction: ltr; unicode-bidi: isolate; }
  .top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 2.5px solid #4c2a85; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 44px; height: 44px; border-radius: 13px; background: #4c2a85; display: flex; align-items: center; justify-content: center; }
  .brand b { display: block; font-size: 17px; font-weight: 700; }
  .brand small { color: #6c6578; font-size: 10.5px; }
  .doc { text-align: left; }
  .doc .t { font-size: 16px; font-weight: 700; color: #4c2a85; }
  .doc .s { font-size: 11px; color: #4a4458; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .kpi { background: #f6f4f9; border-radius: 11px; padding: 9px 12px; }
  .kpi span { display: block; color: #6c6578; font-size: 9.5px; }
  .kpi b { font-size: 14px; font-weight: 700; }
  .kpi.in b { color: #0f7a4f; } .kpi.out b { color: #c2362f; } .kpi.end { background: #4c2a85; color: #fff; } .kpi.end span { color: #d9cbff; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead th { background: #4c2a85; color: #fff; font-weight: 600; font-size: 10px; padding: 7px 8px; text-align: right; }
  thead th:first-child { border-radius: 0 9px 9px 0; } thead th:last-child { border-radius: 9px 0 0 9px; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #e8e5ee; vertical-align: top; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  th.e, td.e { text-align: left; white-space: nowrap; }
  td.in { color: #0f7a4f; font-weight: 600; } td.out { color: #c2362f; font-weight: 600; } td.bal { font-weight: 700; }
  .sub { color: #6c6578; font-size: 9.5px; }
  tr.day td { background: #efe9fb; font-weight: 700; color: #3a1f69; border-bottom: 0; padding: 6px 10px; }
  tr.day td span { font-weight: 500; color: #4a4458; }
  tr.open td { background: #fff8e8; font-weight: 600; }
  .note { margin-top: 10px; background: #fff8e8; border-radius: 10px; padding: 8px 12px; font-size: 10.5px; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e8e5ee; color: #94909e; font-size: 9.5px; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="top">
    <div class="brand"><div class="logo">${MARK}</div><div><b>ديما الحياة</b><small>بغداد</small></div></div>
    <div class="doc"><div class="t">${esc(docTitle)}</div><div class="s">${docSub}</div></div>
  </div>
  ${body}
  <div class="foot"><span>صادر من تطبيق ديما · الفريق — البيانات من الإداري</span><span class="num">${esc(issuedNow())}</span></div>
</body></html>`;
}

export const cashStatementFileBase = (st: CashStatement) => `cash-${st.box.num}-${st.from}${st.to !== st.from ? `_${st.to}` : ''}`;

/** كشف صندوق لفترة: رصيد أول المدة، الحركات مجمّعة بالأيام برصيد جارٍ، والإجماليات */
export async function cashStatementPdfHtml(st: CashStatement) {
  const c = st.box.currency;
  const period = st.from === st.to ? dayLabel(st.from) : `من ${st.from.split('-').reverse().join('/')} إلى ${st.to.split('-').reverse().join('/')}`;
  const byDay = new Map(st.days.map(d => [d.date, d]));
  let rows = `<tr class="open"><td colspan="4">رصيد أول المدة</td><td class="e num bal">${cashAmount(st.opening, c)}</td></tr>`;
  let current = '';
  for (const l of st.lines) {
    if (l.date !== current) {
      current = l.date;
      const d = byDay.get(l.date);
      rows += `<tr class="day"><td colspan="5">${esc(dayLabel(l.date))}${d ? ` <span class="num">· ${d.count} حركة · قبض ${cashAmount(d.in, c)} · صرف ${cashAmount(d.out, c)}</span>` : ''}</td></tr>`;
    }
    rows += `<tr>
      <td class="num sub">${esc(l.time ?? '')}<br>${esc(l.num)}</td>
      <td>${esc(l.description || '—')}${l.other ? `<div class="sub">${esc(l.other)}${l.rate ? ` · <span class="num">سعر ${cashAmount(l.rate, 'IQD')}</span>` : ''}</div>` : ''}</td>
      <td class="e num in">${l.in ? cashAmount(l.in, c) : ''}</td>
      <td class="e num out">${l.out ? cashAmount(l.out, c) : ''}</td>
      <td class="e num bal">${cashAmount(l.balance, c)}</td>
    </tr>`;
  }
  if (!st.lines.length) rows += `<tr><td colspan="5" style="text-align:center;color:#6c6578;padding:18px">لا حركات في هذه الفترة</td></tr>`;
  const body = `
  <div class="kpis">
    <div class="kpi"><span>رصيد أول المدة</span><b class="num">${cashAmount(st.opening, c)}</b></div>
    <div class="kpi in"><span>القبض (${st.lines.filter(l => l.in).length})</span><b class="num">${cashAmount(st.totalIn, c)}</b></div>
    <div class="kpi out"><span>الصرف (${st.lines.filter(l => l.out).length})</span><b class="num">${cashAmount(st.totalOut, c)}</b></div>
    <div class="kpi end"><span>رصيد آخر المدة (${cashUnit(c)})</span><b class="num">${cashAmount(st.closing, c)}</b></div>
  </div>
  <table>
    <thead><tr><th style="width:52px">الوقت / السند</th><th>البيان</th><th class="e">قبض</th><th class="e">صرف</th><th class="e">الرصيد</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${st.truncated ? '<div class="note">الفترة فيها حركات أكثر من الحد المعروض — اختر فترة أقصر لرؤيتها كاملة.</div>' : ''}`;
  return pdfShell(cashStatementFileBase(st), 'كشف صندوق', `${esc(st.box.name)} · <span class="num">${esc(st.box.num)}</span><br>${esc(period)}`, body);
}

/** صناديق الكاشير اليوم (من فواتير المحل) */
function cashiersTable(data: CashBoxes) {
  const list = data.cashiers ?? [];
  if (!list.length) return '';
  const bySeq = new Map(data.boxes.map(b => [b.seq, b]));
  const t = (iso?: string | null) => {
    if (!iso || iso.length < 16) return '';
    const h = Number(iso.slice(11, 13));
    return `${h % 12 === 0 ? 12 : h % 12}:${iso.slice(14, 16)} ${h < 12 ? 'ص' : 'م'}`;
  };
  const a = (n: number) => cashAmount(n, 'IQD');
  const rows = list
    .map(c => {
      const box = bySeq.get(c.seq);
      return `<tr>
    <td>${esc(c.cashiers.join(' · ') || box?.name || '')}<div class="sub">${esc(box ? `${box.name} · ${box.num}` : '')} · ${t(c.firstAt)} – ${t(c.lastAt)}</div></td>
    <td class="e num bal">${a(c.cash)}</td>
    <td class="e num">${a(c.cardTotal)}<div class="sub">${c.cardCount} فاتورة</div></td>
    <td class="e num">${c.sales + c.cardCount}</td>
    <td class="e num out">${c.returns ? a(c.returnsTotal) : ''}<div class="sub">${c.returns ? `${c.returns} مرتجع` : ''}</div></td>
    <td class="e num">${c.discount ? a(c.discount) : ''}</td>
    <td class="e num out">${c.voids || ''}<div class="sub">${c.voids ? a(c.voidsAmount) : ''}</div></td>
  </tr>`;
    })
    .join('');
  return `<h3 style="margin:18px 0 6px;font-size:14px">صناديق الكاشير اليوم</h3>
  <table>
    <thead><tr><th>الكاشير</th><th class="e">النقد في الدرج</th><th class="e">بطاقة كي</th><th class="e">الفواتير</th><th class="e">المرتجعات</th><th class="e">الخصم</th><th class="e">الحذف</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** ملخص أرصدة كل الصناديق الآن */
export async function cashBoxesPdfHtml(data: CashBoxes) {
  const row = (b: CashBox) => `<tr>
    <td class="num">${esc(b.num)}</td>
    <td>${esc(b.name)}${b.fixDate ? `<div class="sub">آخر تثبيت <span class="num">${b.fixDate.split('-').reverse().join('/')}</span> · <span class="num">${cashAmount(b.fixBalance ?? 0, b.currency)}</span></div>` : ''}</td>
    <td class="e num in">${b.todayIn ? cashAmount(b.todayIn, b.currency) : ''}</td>
    <td class="e num out">${b.todayOut ? cashAmount(b.todayOut, b.currency) : ''}</td>
    <td class="e num bal">${cashAmount(b.balance, b.currency)} ${cashUnit(b.currency)}</td>
  </tr>`;
  const featured = data.boxes.filter(b => b.featured);
  const rest = data.boxes.filter(b => !b.featured && (b.balance !== 0 || b.todayCount > 0));
  const body = `
  <div class="kpis">${featured
    .slice(0, 4)
    .map((b, i) => `<div class="kpi ${i === 0 ? 'end' : ''}"><span>${esc(b.name)}</span><b class="num">${cashAmount(b.balance, b.currency)} ${cashUnit(b.currency)}</b></div>`)
    .join('')}</div>
  <table>
    <thead><tr><th style="width:44px">الرقم</th><th>الصندوق</th><th class="e">قبض اليوم</th><th class="e">صرف اليوم</th><th class="e">الرصيد الآن</th></tr></thead>
    <tbody>${featured.map(row).join('')}${rest.length ? `<tr class="day"><td colspan="5">بقية الصناديق</td></tr>${rest.map(row).join('')}` : ''}</tbody>
  </table>
  ${cashiersTable(data)}`;
  return pdfShell(`cash-boxes-${data.today ?? ''}`, 'أرصدة الصناديق', esc(data.today ? dayLabel(data.today) : ''), body);
}
