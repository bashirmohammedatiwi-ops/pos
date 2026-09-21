import { printHtmlDoc } from '@/lib/print';
import { formatNum } from '@/api/client';
import type { ReceiptDetailDto, ReceiptSummary } from '@/api/types';
import { receiptDisplayNumber } from '@/api/client';

/**
 * طباعة فاتورة A4 أنيقة — تُستخدم من أي مكان (صف موسّع، صفحة، إلخ).
 */

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n: number) {
  return formatNum(Math.round(n * 100) / 100);
}

export function receiptTotals(r: ReceiptSummary, d?: ReceiptDetailDto) {
  return {
    sub: d ? d.totalAmount + d.userDiscount + d.offersDiscount + d.itemsDiscount : r.grossAmount ?? r.totalAmount,
    offers: d?.offersDiscount ?? r.offersDiscount,
    user: d?.userDiscount ?? r.userDiscount,
    items: d?.itemsDiscount ?? r.itemsDiscount,
    total: d?.totalAmount ?? r.totalAmount,
    paid: d?.payment ?? r.payment,
    back: d?.cashBack ?? r.cashBack,
  };
}

export async function printReceiptA4(receipt: ReceiptSummary, d: ReceiptDetailDto) {
  const t = receiptTotals(receipt, d);
  const rows = d.items
    .map(
      (it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name ?? String(it.articleId))}</td>
        <td class="c mono">${esc(it.barcode ?? '')}</td>
        <td class="c">${esc(it.salesmanName ?? '')}</td>
        <td class="n">${it.quantity}</td>
        <td class="n">${fmt(it.originalPrice)}</td>
        <td class="n">${it.originalPrice * it.quantity - it.lineTotal > 0 ? fmt(it.originalPrice * it.quantity - it.lineTotal) : '—'}</td>
        <td class="n">${fmt(it.price)}</td>
        <td class="n"><b>${fmt(it.lineTotal)}</b></td>
      </tr>`,
    )
    .join('');
  const summaryRows = [
    ['الإجمالي قبل الخصم', fmt(t.sub)],
    ['خصم العروض', fmt(t.offers)],
    ['خصم المستخدم', fmt(t.user)],
    ['خصم البنود', fmt(t.items)],
    ['الصافي المستحق', fmt(t.total)],
    ['المدفوع', fmt(t.paid)],
    ['المرتجع', fmt(t.back)],
  ]
    .map(([k, v]) => `<tr><td class="lbl">${k}</td><td class="n"><b>${v}</b></td></tr>`)
    .join('');
  const kindLabel = receipt.kindLabel ?? (receipt.kind === 1 ? 'مرتجع' : receipt.kind === 2 ? 'هدية' : 'مبيعات');
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فاتورة ${esc(receiptDisplayNumber(receipt))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 24px; }
  .sheet { max-width: 900px; margin: auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f9f76; padding-bottom: 14px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #04301f; }
  .sub { color: #64748b; font-size: 12px; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; font-size: 12.5px; margin-bottom: 14px; }
  .meta b { color: #0b1220; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { background: #0b1220; color: #fff; padding: 7px 6px; font-size: 11.5px; text-align: right; }
  tbody td { border-bottom: 1px solid #e2e8f0; padding: 6px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .c { text-align: center; } .n { text-align: left; font-variant-numeric: tabular-nums; } .mono { font-family: Consolas, monospace; }
  .totals { margin-top: 14px; margin-right: auto; width: 320px; border-collapse: collapse; font-size: 13px; }
  .totals td { padding: 5px 10px; border-bottom: 1px dashed #cbd5e1; }
  .totals .lbl { color: #64748b; } .totals .n { text-align: left; }
  .foot { margin-top: 22px; text-align: center; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  @media print { body { margin: 10mm; } thead { display: table-header-group; } }
</style></head><body><div class="sheet">
  <div class="head">
    <div><h1>فاتورة ${esc(kindLabel)}</h1>
      <div class="sub">${esc(receipt.sectionName ?? '')} · ${esc(receipt.posName ?? '')}</div></div>
    <div style="text-align:left"><div class="sub">رقم الفاتورة</div>
      <div style="font-size:20px;font-weight:800">${esc(receiptDisplayNumber(receipt))}</div>
      <div class="sub">${esc(String(receipt.creationDate ?? ''))}</div></div>
  </div>
  <div class="meta">
    <div>الكاشير: <b>${esc(receipt.cashierName ?? '—')}</b></div>
    <div>البائع: <b>${esc(d.salesmanName ?? receipt.salesmanName ?? '—')}</b></div>
    <div>الحساب: <b>${esc(receipt.accountName ?? 'نقدي')}</b></div>
  </div>
  <table><thead><tr><th>#</th><th>المادة</th><th>الباركود</th><th>المندوب</th><th>الكمية</th><th>السعر الأصلي</th><th>الخصم</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <table class="totals">${summaryRows}</table>
  <div class="foot">شكراً لتعاملكم معنا — ${new Date().toLocaleString('ar-IQ')}</div>
</div></body></html>`;
  await printHtmlDoc(html);
}
