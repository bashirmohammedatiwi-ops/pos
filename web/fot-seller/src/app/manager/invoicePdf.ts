import arabicFontUrl from '@fontsource-variable/readex-pro/files/readex-pro-arabic-wght-normal.woff2?url';
import latinFontUrl from '@fontsource-variable/readex-pro/files/readex-pro-latin-wght-normal.woff2?url';
import { cleanName } from '../../names';
import type { InvoiceDetail } from '../work';

/* قالب فاتورة PDF: ورق أبيض A4 دائماً مهما كان وضع التطبيق، والخط من داخل التطبيق ليبقى كما هو على كل هاتف. */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const n = (v: number) => Math.round(Number(v) || 0).toLocaleString('en-US');
const q = (v: number) => (Number.isInteger(v) ? n(v) : v.toFixed(2).replace(/0+$/, ''));
const KIND = ['فاتورة بيع', 'فاتورة مرتجع', 'فاتورة هدية'];

const MARK = `<svg width="30" height="30" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7a17 17 0 1 0 16.2 11.8" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="37.6" cy="11.2" r="4.6" fill="#F0B04F"/><circle cx="24" cy="24" r="5.2" fill="#fff" fill-opacity=".92"/></svg>`;

export const invoiceFileBase = (inv: InvoiceDetail) => `invoice-${inv.number}`;

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

export async function invoicePdfHtml(inv: InvoiceDetail) {
  const [arabic, latin] = await Promise.all([fontDataUrl(arabicFontUrl), fontDataUrl(latinFontUrl)]);
  const when = new Date(`${inv.at.slice(0, 19)}+03:00`);
  const date = when.toLocaleDateString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = when.toLocaleTimeString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', hour: 'numeric', minute: '2-digit' });
  const issued = new Date().toLocaleString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const sellers = [...new Set(inv.lines.map(l => l.seller).filter(Boolean))] as string[];
  const showSeller = sellers.length > 1;
  const anyDiscount = inv.lines.some(l => l.original > l.price);
  const before = inv.lines.reduce((s, l) => s + Math.abs(l.qty) * (l.original || l.price), 0);
  const discounts = inv.offersDiscount + inv.itemsDiscount + inv.userDiscount;

  const rows = inv.lines
    .map(
      (l, i) => `<tr>
        <td class="c m num">${i + 1}</td>
        <td><div class="name">${esc(l.name)}</div>${l.barcode || showSeller ? `<div class="sub">${l.barcode ? `<span class="num ltr">${esc(l.barcode)}</span>` : ''}${showSeller && l.seller ? `<span>${esc(cleanName(l.seller))}</span>` : ''}</div>` : ''}</td>
        <td class="c num">${q(Math.abs(l.qty))}</td>
        ${anyDiscount ? `<td class="c num old">${l.original > l.price ? n(l.original) : ''}</td>` : ''}
        <td class="c num">${n(l.price)}</td>
        <td class="e num b">${n(Math.abs(l.qty) * l.price)}</td>
      </tr>`,
    )
    .join('');

  const calc = (label: string, value: string, cls = '') => `<div class="row ${cls}"><span>${esc(label)}</span><b class="num">${value}</b></div>`;
  const totals = [
    discounts > 0 ? calc('قبل الخصم', n(before)) : '',
    inv.offersDiscount > 0 ? calc('خصم العروض', `⁦−${n(inv.offersDiscount)}⁩`, 'off') : '',
    inv.itemsDiscount > 0 ? calc('خصم المواد', `⁦−${n(inv.itemsDiscount)}⁩`, 'off') : '',
    inv.userDiscount > 0 ? calc(inv.discountPerson ? `خصم يدوي (${inv.discountPerson})` : 'خصم يدوي', `⁦−${n(inv.userDiscount)}⁩`, 'off') : '',
    calc(inv.kind === 1 ? 'المبلغ المُعاد' : inv.kind === 2 ? 'قيمة الهدية' : 'الإجمالي', `${n(inv.total)} د.ع`, 'grand'),
    inv.kind === 0 ? calc('المدفوع', n(inv.payment)) : '',
    inv.cashBack > 0 ? calc('الباقي للزبون', n(inv.cashBack)) : '',
  ].join('');

  const info = (label: string, value?: string | null, ltr = false) => (value ? `<div class="i"><span>${esc(label)}</span><b${ltr ? ' class="num ltr"' : ''}>${esc(value)}</b></div>` : '');
  const seller = sellers.length === 1 ? sellers[0] : sellers.length === 0 ? inv.seller : null;
  const details = [
    info('الكاشير', inv.cashier ? cleanName(inv.cashier) : null),
    info('البائع', seller ? cleanName(seller) : null),
    info('نقطة البيع', inv.pos),
    info('القسم', inv.section),
    info('طريقة الدفع', inv.kind === 2 ? 'هدية بلا دفع' : inv.card ? `بطاقة ${inv.card.acquirer || ''}${inv.card.last4 ? ` ⁦•••• ${inv.card.last4}⁩` : ''}` : 'نقد'),
    info('مرجع العملية', inv.card?.ref, true),
    info('قسيمة', inv.voucher, true),
    info('مرتجع من الفاتورة', inv.returnOfInvoice ? `#${inv.returnOfInvoice.number}` : null, true),
    info('أُرجع منها', inv.returns.length ? inv.returns.map(r => `#${r.number}`).join('، ') : null, true),
    info('رقم النظام', inv.systemNumber !== inv.number ? String(inv.systemNumber) : null, true),
  ].join('');

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(invoiceFileBase(inv))}</title>
<style>
  ${latin ? `@font-face { font-family: 'Readex'; src: url(${latin}) format('woff2'); font-weight: 200 700; }` : ''}
  ${arabic ? `@font-face { font-family: 'Readex'; src: url(${arabic}) format('woff2'); font-weight: 200 700; unicode-range: U+0600-06FF, U+0750-077F, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFF; }` : ''}
  @page { size: A4; margin: 11mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Readex', 'Noto Sans Arabic', Tahoma, sans-serif; color: #17131f; font-size: 12px; line-height: 1.55; }
  .num { font-variant-numeric: tabular-nums; } .ltr { direction: ltr; unicode-bidi: isolate; }
  .top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 2.5px solid #4c2a85; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 44px; height: 44px; border-radius: 13px; background: #4c2a85; display: flex; align-items: center; justify-content: center; }
  .brand b { display: block; font-size: 17px; font-weight: 700; }
  .brand small { color: #6c6578; font-size: 10.5px; }
  .doc { text-align: left; }
  .doc .t { font-size: 16px; font-weight: 700; color: #4c2a85; }
  .doc.k1 .t { color: #cf3f3a; }
  .doc .no { font-size: 13px; font-weight: 600; direction: ltr; }
  .when { margin: 12px 0; color: #4a4458; font-size: 11.5px; display: flex; justify-content: space-between; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; background: #f6f4f9; border-radius: 12px; padding: 12px 14px; }
  .i span { display: block; color: #6c6578; font-size: 9.5px; }
  .i b { font-weight: 600; font-size: 11.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  thead th { background: #4c2a85; color: #fff; font-weight: 600; font-size: 10.5px; padding: 8px; text-align: right; }
  thead th:first-child { border-radius: 0 9px 9px 0; } thead th:last-child { border-radius: 9px 0 0 9px; }
  tbody td { padding: 8px; border-bottom: 1px solid #e8e5ee; vertical-align: top; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  th.c, td.c { text-align: center; } th.e, td.e { text-align: left; }
  .m { color: #6c6578; width: 26px; } .b { font-weight: 600; }
  .name { font-weight: 500; } .sub { color: #6c6578; font-size: 9.5px; display: flex; gap: 10px; margin-top: 1px; }
  .old { color: #94909e; text-decoration: line-through; }
  .bottom { display: flex; justify-content: flex-end; margin-top: 14px; break-inside: avoid; page-break-inside: avoid; }
  .calc { width: 58%; }
  .row { display: flex; justify-content: space-between; padding: 5px 2px; border-bottom: 1px dashed #e8e5ee; }
  .row b { font-weight: 600; } .off b { color: #138a5a; }
  .grand { background: #4c2a85; color: #fff; border: 0; border-radius: 10px; padding: 10px 12px; margin: 6px 0; font-size: 14px; }
  .grand b { font-weight: 700; }
  .note { margin-top: 12px; background: #fff8e8; border-radius: 10px; padding: 8px 12px; font-size: 11px; break-inside: avoid; }
  .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e8e5ee; color: #94909e; font-size: 9.5px; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="top">
    <div class="brand"><div class="logo">${MARK}</div><div><b>ديما الحياة</b><small>بغداد</small></div></div>
    <div class="doc k${inv.kind}"><div class="t">${KIND[inv.kind] ?? 'فاتورة'}</div><div class="no num">#${esc(inv.number)}</div></div>
  </div>
  <div class="when"><span>${esc(date)}</span><span class="num">${esc(time)}</span></div>
  <div class="grid">${details}</div>
  <table>
    <thead><tr><th class="c">#</th><th>المادة</th><th class="c">الكمية</th>${anyDiscount ? '<th class="c">قبل الخصم</th>' : ''}<th class="c">السعر</th><th class="e">المبلغ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="bottom"><div class="calc">${totals}</div></div>
  ${inv.remarks ? `<div class="note"><b>ملاحظات: </b>${esc(inv.remarks)}</div>` : ''}
  ${inv.edited ? '<div class="note">عُدّلت هذه الفاتورة بعد البيع، والقيم أعلاه هي الحالية.</div>' : ''}
  <div class="foot"><span>صادرة من تطبيق ديما · الفريق</span><span class="num">${esc(issued)}</span></div>
</body></html>`;
}
