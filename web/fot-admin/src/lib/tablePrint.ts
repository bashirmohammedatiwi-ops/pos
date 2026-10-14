import { formatNum } from '@/api/client';
import { printDocument } from '@/lib/print';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * طباعة جدول كما يظهر (الأعمدة الظاهرة والصفوف بعد الفلترة والفرز) على ورق A4.
 * الأعمدة الكثيرة تُطبع بالعرض (landscape) تلقائياً.
 */
export async function printTable(opts: {
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  footer?: (string | null | undefined)[];
  subtitle?: string;
}) {
  const { title, headers, rows, footer, subtitle } = opts;
  const landscape = headers.length > 7;
  const head = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map(r => `<tr>${r.map(c => (typeof c === 'number'
      ? `<td class="n">${esc(formatNum(c, 2))}</td>`
      : `<td>${esc(String(c ?? ''))}</td>`)).join('')}</tr>`)
    .join('');
  const foot = footer && footer.some(Boolean)
    ? `<tfoot><tr>${footer.map(c => `<td class="n">${esc(c ?? '')}</td>`).join('')}</tr></tfoot>`
    : '';
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f9f76; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 17px; margin: 0; } .sub { color: #64748b; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-size: ${landscape ? '10px' : '11px'}; }
  thead th { background: #f1f5f9; color: #334155; padding: 5px; text-align: right; border: 1px solid #cbd5e1; white-space: nowrap; }
  tbody td { border: 1px solid #e2e8f0; padding: 4px 5px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tfoot td { border: 1px solid #cbd5e1; background: #f1f5f9; font-weight: 700; padding: 5px; }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { text-align: center; color: #94a3b8; padding: 16px; }
  footer { margin-top: 12px; color: #94a3b8; font-size: 10px; display: flex; justify-content: space-between; }
  thead { display: table-header-group; } tfoot { display: table-row-group; } tr { break-inside: avoid; }
</style></head><body>
<header><div><h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div>
<span class="sub">${esc(new Date().toLocaleString('ar-IQ'))} · ${formatNum(rows.length)} سجل</span></header>
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="empty">لا بيانات</td></tr>`}</tbody>${foot}</table>
<footer><span>FOT POS — لوحة الإدارة</span><span>${esc(title)}</span></footer>
</body></html>`;
  await printDocument(html);
}
