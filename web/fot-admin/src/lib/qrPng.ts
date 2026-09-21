import QRCode from 'qrcode';

export function discountQrDataUrl(code: string, size = 280): Promise<string> {
  return QRCode.toDataURL(code, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

export function qrDataUrl(code: string, size = 280): Promise<string> {
  return discountQrDataUrl(code, size);
}

export async function printLabeledQr(title: string, subtitle: string, code: string) {
  const src = await discountQrDataUrl(code, 360);
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;text-align:center;padding:24px;color:#0f172a}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#475569;font-size:13px;margin:0 0 16px}
  img{width:280px;height:280px}
  code{display:block;margin-top:12px;font-size:14px;letter-spacing:1px}
</style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(subtitle)}</p>
  <img src="${src}" alt="${escapeHtml(code)}" />
  <code dir="ltr">${escapeHtml(code)}</code>
  <script>window.onload=()=>window.print()</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=420,height=560');
  if (!w) throw new Error('تعذر فتح نافذة الطباعة');
  w.document.write(html);
  w.document.close();
}

export async function printPriceCheckerSettingsQr() {
  const { PRICE_CHECKER_SETTINGS_QR } = await import('@fot/shared');
  await printLabeledQr('إعدادات كاشف السعر', 'امسح هذا الرمز على أي جهاز فحص سعر لفتح إعدادات IP والمنفذ', PRICE_CHECKER_SETTINGS_QR);
}

export async function printDiscountQr(name: string, code: string) {
  await printLabeledQr(name, 'رمز اعتماد خصم الفاتورة', code);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] ?? ch));
}
