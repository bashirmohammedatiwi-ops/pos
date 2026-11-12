/**
 * مطبوعات «كاشير الطلبات» على الورق الحراري 80مم: فاتورة الزبونة (أو بطاقة هدية بلا أسعار)،
 * ملصق الشحن (ملصق لكل طرد)، وقائمة الطلب. نفس قواعد receipt.ts: التخطيط بنقاط الطابعة (203 DPI)
 * داخل .ticket وكل المقاسات في <style> حتى تعمل receiptHtmlForBrowser للمعاينة في المتصفح.
 */
import { formatIqd, formatNum } from './money';
import { qrSvg } from './qr';
import { renderCode128Barcode } from './receipt-barcode';
import { receiptThermalWidthPx, THERMAL_DPI } from './receipt';

export type OrderPrintItem = {
  barcode?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  kind?: string | null;
  free?: boolean;
};

export type OrderPrintData = {
  store: { name?: string | null; phone?: string | null };
  order: {
    orderNumber: string;
    code: string;
    createdAt?: string | null;
    deliveryOption?: string | null;
    paymentMethod?: string | null;
    prepaid?: boolean;
    isGift?: boolean;
    giftMessage?: string | null;
    giftHidePrices?: boolean;
    notes?: string | null;
    parcelCount?: number | null;
    receiptNumber?: string | null;
    cashierName?: string | null;
  };
  customer: { name?: string | null; phone?: string | null; governorate?: string | null; addressLine?: string | null };
  receipt: { items: OrderPrintItem[]; itemsTotal: number; shipping: number; giftWrap: number; discount: number; total: number };
  changes?: {
    missing?: { name: string; shadeName?: string | null; qty: number; reason?: string | null }[];
    extras?: { name: string; shadeName?: string | null; qty: number; free?: boolean; reason?: string | null }[];
  } | null;
  money: { total: number; finalTotal: number; codAmount: number; refundAmount?: number | null };
  shipment?: { trackingNumber?: string | null; state?: string | null; codAmount?: number | null; lastError?: string | null } | null;
};

export type OrderSlipLine = { name: string; shadeName?: string | null; qty: number; barcode?: string | null };

const SCALE = THERMAL_DPI / 96;
const u = (cssPx: number) => Math.max(1, Math.round(cssPx * SCALE));

function esc(s: string | null | undefined) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function when(iso?: string | null) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { hour12: false });
}

function doc(title: string, css: string, body: string) {
  const content = receiptThermalWidthPx(80);
  const pad = Math.round((3 / 25.4) * THERMAL_DPI);
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${content}px; max-width: ${content}px; margin: 0; padding: 0; overflow: hidden; }
  body { background: #fff; color: #000; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ticket { width: ${content}px; max-width: ${content}px; padding: ${pad}px ${pad}px ${pad + u(8)}px;
            font-size: ${u(13)}px; line-height: 1.35; font-weight: 500; overflow: hidden; }
  .center { text-align: center; }
  .ltr { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  .b { font-weight: 700; }
  .muted { font-size: ${u(11)}px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: ${u(8)}px; }
  .row > * { min-width: 0; }
  .amt { white-space: nowrap; }
  .dash { border-top: ${u(1)}px dashed #000; margin: ${u(6)}px 0; }
  .solid { border-top: ${u(2)}px solid #000; margin: ${u(6)}px 0; }
  .store { font-size: ${u(18)}px; font-weight: 800; }
  .qr svg { display: block; margin: ${u(4)}px auto 0; }
  ${css}
</style>
</head>
<body>
<div class="ticket">
${body}
</div>
</body>
</html>`;
}

function qrBlock(code: string, cssPx: number, cls: string) {
  const svg = qrSvg(code, { sizePx: u(cssPx), margin: 2 });
  return svg ? `<div class="qr ${cls}">${svg}</div>` : '';
}

function itemName(name: string, shade?: string | null) {
  return shade ? `${name} — ${shade}` : name;
}

/** فاتورة الزبونة: الأصناف المسلّمة وأسعارها، الدفع عند الاستلام أو «مدفوع»، وسطر بالأصناف الناقصة. */
export function orderInvoiceHtml(data: OrderPrintData): string {
  const o = data.order;
  const store = esc(data.store.name || 'ديما الحياة');
  const header = `
    <div class="center store">${store}</div>
    ${data.store.phone ? `<div class="center muted ltr">${esc(data.store.phone)}</div>` : ''}
    <div class="solid"></div>
    <div class="center title">${o.giftHidePrices ? 'هدية لكِ' : 'فاتورة الطلب'}</div>
    <div class="row"><span>رقم الطلب</span><span class="ltr b">${esc(o.orderNumber)}</span></div>
    ${o.receiptNumber ? `<div class="row"><span>رقم الإيصال</span><span class="ltr">${esc(o.receiptNumber)}</span></div>` : ''}
    <div class="row"><span>التاريخ</span><span class="ltr">${esc(when(o.createdAt))}</span></div>
    ${data.customer.name ? `<div class="row"><span>الاسم</span><span>${esc(data.customer.name)}</span></div>` : ''}
    ${data.customer.addressLine ? `<div class="muted addr">${esc(data.customer.addressLine)}</div>` : ''}
    <div class="dash"></div>`;

  const missing = data.changes?.missing ?? [];
  const missingBlock = missing.length
    ? `<div class="note">
        <div class="b">أصناف لم تتوفر ولم تُحسب عليكِ:</div>
        ${missing.map(m => `<div>• ${esc(itemName(m.name, m.shadeName))} × <span class="ltr">${formatNum(m.qty)}</span></div>`).join('')}
        ${o.prepaid && (data.money.refundAmount ?? 0) > 0
          ? `<div class="b">يُعاد مبلغ <span class="ltr">${formatIqd(data.money.refundAmount ?? 0)}</span> إلى بطاقتكِ.</div>`
          : ''}
      </div>`
    : '';

  if (o.giftHidePrices) {
    const lines = data.receipt.items
      .map(i => `<div class="gift-line"><span>${esc(i.name)}</span><span class="ltr">× ${formatNum(i.qty)}</span></div>`)
      .join('');
    const body = `${header}
      ${o.giftMessage ? `<div class="gift-msg">${esc(o.giftMessage)}</div><div class="dash"></div>` : ''}
      ${lines}
      ${missing.length ? '<div class="dash"></div><div class="muted">بعض الأصناف لم تتوفر وأُبلغ صاحب الطلب.</div>' : ''}
      <div class="dash"></div>
      <div class="center">مع أطيب التمنيات</div>
      ${qrBlock(o.code, 72, 'small')}`;
    return doc(`هدية ${o.orderNumber}`, invoiceCss(), body);
  }

  const rows = data.receipt.items.map(i => `
    <div class="item">
      <div class="name">${esc(i.name)}${i.free ? ' <span class="tag">هدية مجانية</span>' : i.kind === 'EXTRA' ? ' <span class="tag">إضافي</span>' : ''}</div>
      <div class="row"><span class="ltr">${formatNum(i.qty)} × ${formatNum(i.unitPrice)}</span><span class="amt ltr">${i.free ? 'مجاناً' : formatIqd(i.lineTotal)}</span></div>
    </div>`).join('');
  const r = data.receipt;
  const totals = `
    <div class="row"><span>مجموع الأصناف</span><span class="amt ltr">${formatIqd(r.itemsTotal)}</span></div>
    ${r.shipping > 0 ? `<div class="row"><span>التوصيل</span><span class="amt ltr">${formatIqd(r.shipping)}</span></div>` : ''}
    ${r.giftWrap > 0 ? `<div class="row"><span>تغليف الهدية</span><span class="amt ltr">${formatIqd(r.giftWrap)}</span></div>` : ''}
    ${r.discount > 0 ? `<div class="row"><span>الخصم</span><span class="amt ltr">-${formatIqd(r.discount)}</span></div>` : ''}
    <div class="row total"><span>المجموع</span><span class="amt ltr">${formatIqd(r.total)}</span></div>`;
  const pay = o.prepaid
    ? `<div class="pay center">مدفوع</div>`
    : o.deliveryOption === 'PICKUP'
      ? `<div class="pay center">المبلغ: <span class="ltr">${formatIqd(r.total)}</span></div>`
      : `<div class="pay center">المبلغ عند الاستلام<br/><span class="ltr">${formatIqd(data.money.codAmount || r.total)}</span></div>`;
  const body = `${header}
    ${rows}
    <div class="dash"></div>
    ${totals}
    ${pay}
    ${missingBlock ? `<div class="dash"></div>${missingBlock}` : ''}
    ${o.isGift && o.giftMessage ? `<div class="dash"></div><div class="gift-msg">${esc(o.giftMessage)}</div>` : ''}
    <div class="dash"></div>
    <div class="center">شكراً لتسوقكِ من ${store}</div>
    ${qrBlock(o.code, 72, 'small')}`;
  return doc(`فاتورة ${o.orderNumber}`, invoiceCss(), body);
}

function invoiceCss() {
  return `
  .title { font-size: ${u(16)}px; font-weight: 800; margin: ${u(2)}px 0 ${u(4)}px; }
  .addr { margin-top: ${u(2)}px; }
  .item { padding: ${u(4)}px 0; border-bottom: ${u(1)}px dotted #000; }
  .item:last-child { border-bottom: 0; }
  .name { font-weight: 700; overflow-wrap: anywhere; }
  .tag { font-size: ${u(10)}px; border: ${u(1)}px solid #000; padding: 0 ${u(3)}px; font-weight: 600; }
  .total { font-size: ${u(15)}px; font-weight: 800; margin-top: ${u(4)}px; }
  .pay { font-size: ${u(17)}px; font-weight: 800; border: ${u(3)}px solid #000; padding: ${u(6)}px; margin: ${u(8)}px 0 ${u(4)}px; }
  .note { font-size: ${u(12)}px; }
  .gift-msg { font-size: ${u(14)}px; text-align: center; white-space: pre-wrap; padding: ${u(4)}px 0; }
  .gift-line { display: flex; justify-content: space-between; gap: ${u(8)}px; padding: ${u(4)}px 0; border-bottom: ${u(1)}px dotted #000; font-weight: 600; }
  .qr.small svg { width: ${u(72)}px; height: ${u(72)}px; }
`;
}

/**
 * ملصق الشحن (80مم، ملصق لكل طرد): باركود التتبع Code128 كبير، الزبونة وهاتفها ومحافظتها وعنوانها،
 * مبلغ الاستلام بخط كبير، «1 من N»، اسم المحل وهاتفه، وQR صغير برمز الطلب.
 */
export function orderLabelHtml(data: OrderPrintData, parcel: number, parcels: number): string {
  const o = data.order;
  const tracking = (data.shipment?.trackingNumber ?? '').trim();
  const content = receiptThermalWidthPx(80) - Math.round((3 / 25.4) * THERMAL_DPI) * 2;
  let barcode = '';
  let bw = 0, bh = 0;
  if (tracking) {
    try {
      const g = renderCode128Barcode(tracking, { height: u(64), moduleWidth: 4, maxWidth: content, quietModules: 10, minModuleWidth: 2 });
      barcode = g.svg;
      bw = g.width;
      bh = g.height;
    } catch {
      barcode = '';
    }
  }
  const cod = data.shipment?.codAmount ?? data.money.codAmount ?? 0;
  const codBlock = o.prepaid || cod <= 0
    ? `<div class="cod paid center">مدفوع — لا يُستلم مبلغ</div>`
    : `<div class="cod center"><div class="cod-label">المبلغ عند الاستلام</div><div class="cod-amt ltr">${formatIqd(cod)}</div></div>`;
  const body = `
    <div class="row top"><span class="b">${esc(data.store.name || 'ديما الحياة')}</span><span class="ltr">${esc(data.store.phone ?? '')}</span></div>
    <div class="parcel center">طرد <span class="ltr">${parcel}</span> من <span class="ltr">${parcels}</span></div>
    ${tracking
      ? `<div class="trk center">${barcode}<div class="trk-num ltr">${esc(tracking)}</div></div>`
      : `<div class="center b">بانتظار رقم التتبع من شركة التوصيل</div>`}
    <div class="solid"></div>
    <div class="cust">${esc(data.customer.name ?? '')}</div>
    <div class="phone ltr center">${esc(data.customer.phone ?? '')}</div>
    <div class="gov">${esc(data.customer.governorate ?? '')}</div>
    <div class="addr">${esc(data.customer.addressLine ?? '')}</div>
    <div class="solid"></div>
    ${codBlock}
    ${o.notes ? `<div class="muted notes">ملاحظة: ${esc(o.notes)}</div>` : ''}
    <div class="row foot"><div>
      <div class="b ltr">${esc(o.orderNumber)}</div>
      <div class="muted">${o.isGift ? 'هدية — ' : ''}${esc(when(o.createdAt))}</div>
    </div>${qrBlock(o.code, 64, 'tiny')}</div>`;
  const css = `
  .top { font-size: ${u(12)}px; }
  .parcel { font-size: ${u(20)}px; font-weight: 800; border: ${u(2)}px solid #000; margin: ${u(4)}px 0; padding: ${u(2)}px; }
  .trk { margin: ${u(4)}px 0; }
  .trk svg { display: block; margin: 0 auto; width: ${bw}px; height: ${bh}px; shape-rendering: crispEdges; }
  .trk-num { font-size: ${u(16)}px; font-weight: 800; letter-spacing: ${u(1)}px; margin-top: ${u(2)}px; }
  .cust { font-size: ${u(20)}px; font-weight: 800; text-align: center; }
  .phone { font-size: ${u(20)}px; font-weight: 800; letter-spacing: ${u(1)}px; }
  .gov { font-size: ${u(17)}px; font-weight: 800; text-align: center; margin-top: ${u(2)}px; }
  .addr { font-size: ${u(13)}px; text-align: center; overflow-wrap: anywhere; }
  .cod { border: ${u(3)}px solid #000; padding: ${u(4)}px; margin: ${u(4)}px 0; }
  .cod-label { font-size: ${u(13)}px; font-weight: 700; }
  .cod-amt { font-size: ${u(28)}px; font-weight: 900; }
  .cod.paid { font-size: ${u(18)}px; font-weight: 800; }
  .notes { margin: ${u(2)}px 0; }
  .foot { align-items: center; margin-top: ${u(4)}px; }
  .qr.tiny svg { width: ${u(64)}px; height: ${u(64)}px; margin: 0; }
`;
  return doc(`ملصق ${o.orderNumber} ${parcel}/${parcels}`, css, body);
}

/** قائمة الطلب (بلا أسعار): رمز QR الطلب، الزبونة، الأصناف والكميات — للتجهيز والمراجعة. */
export function orderSlipHtml(opts: {
  storeName?: string | null;
  orderNumber: string;
  code: string;
  customerName?: string | null;
  governorate?: string | null;
  deliveryOption?: string | null;
  isGift?: boolean;
  notes?: string | null;
  lines: OrderSlipLine[];
}): string {
  const total = opts.lines.reduce((s, l) => s + l.qty, 0);
  const body = `
    <div class="center store">${esc(opts.storeName || 'ديما الحياة')}</div>
    <div class="center b">قائمة طلب التطبيق</div>
    ${qrBlock(opts.code, 110, 'big')}
    <div class="center b ltr">${esc(opts.orderNumber)}</div>
    <div class="dash"></div>
    <div class="row"><span>${esc(opts.customerName ?? '')}</span><span>${esc(opts.governorate ?? '')}</span></div>
    <div class="row"><span>${opts.deliveryOption === 'PICKUP' ? 'استلام من المحل' : 'توصيل'}</span><span>${opts.isGift ? 'هدية' : ''}</span></div>
    <div class="dash"></div>
    ${opts.lines.map(l => `<div class="line"><span>${esc(itemName(l.name, l.shadeName))}</span><span class="ltr b">× ${formatNum(l.qty)}</span></div>`).join('')}
    <div class="dash"></div>
    <div class="row b"><span>عدد القطع</span><span class="ltr">${formatNum(total)}</span></div>
    ${opts.notes ? `<div class="muted">ملاحظة: ${esc(opts.notes)}</div>` : ''}`;
  const css = `
  .qr.big svg { width: ${u(110)}px; height: ${u(110)}px; }
  .line { display: flex; justify-content: space-between; gap: ${u(8)}px; padding: ${u(3)}px 0; border-bottom: ${u(1)}px dotted #000; }
`;
  return doc(`قائمة ${opts.orderNumber}`, css, body);
}
