export const DISCOUNT_QR_PREFIX = 'FOTDQ';

const CODE_RE = /^FOTDQ[0-9A-F]{16}$/;

/** Windows Arabic 101 unshifted keys, so a US wedge scanner still yields the printed code. */
const AR_LAYOUT: Record<string, string> = {
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l',
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm',
  'ذ': '`', 'ج': '[', 'د': ']', 'ك': ';', 'ط': "'", 'و': ',', 'ز': '.', 'ظ': '/',
};

function replaceToken(value: string, from: string, to: string) {
  return value.split(from).join(to);
}

/** Undo Latin-1 bytes a wedge emitted with the high bit set (O → Ï). */
function foldLatin1(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 0xc0 && code <= 0xff) {
      const folded = String.fromCharCode(code & 0x7f);
      out += /[0-9A-Za-z]/.test(folded) ? folded : '';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Windows Arabic layout emits lam-alef as two characters (لأ لإ لآ لا).
 * The sale field already keeps the physical Latin letter, and the hamza
 * half still lands in the box: GT-212 is read as GأTإ-212.
 */
function dropLamAlefTails(value: string): string {
  return value
    .replace(/[Gg]أ/g, 'G')
    .replace(/[Tt]إ/g, 'T')
    .replace(/[Bb]آ/g, 'B')
    .replace(/[Bb]ا/g, m => (m[0] === 'B' ? 'B' : 'b'));
}

/** Scanner text typed through an Arabic keyboard, back to the Latin barcode. */
export function decodeScannerText(raw: string): string {
  const prepared = replaceToken(
    replaceToken(replaceToken(replaceToken(foldLatin1(raw), 'لآ', 'B'), 'لأ', 'G'), 'لإ', 'T'),
    'لا',
    'b',
  );
  const tails = dropLamAlefTails(prepared);
  let out = '';
  for (const ch of tails) out += AR_LAYOUT[ch] ?? ch;
  return dropLamAlefTails(out);
}

export function normalizeDiscountQrCode(raw: string): string {
  const cleaned = decodeScannerText(raw).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  const at = cleaned.indexOf(DISCOUNT_QR_PREFIX);
  if (at >= 0) return cleaned.slice(at, at + DISCOUNT_QR_PREFIX.length + 16);
  // The caret in an RTL field can tear "FOT" off the front and leave "DQ" + the hex body.
  const body = cleaned.match(/DQ([0-9A-F]{16})/);
  if (body && cleaned.length > body[0].length && cleaned.includes('F') && cleaned.includes('O') && cleaned.includes('T')) {
    return DISCOUNT_QR_PREFIX + body[1];
  }
  return cleaned;
}

export function isDiscountQrCode(raw: string): boolean {
  return CODE_RE.test(normalizeDiscountQrCode(raw));
}

export type DiscountQrPerson = {
  id: number;
  name: string;
  code: string;
  /** الشروط — كلها اختيارية: غيابها يعني بلا حد */
  maxPercent?: number | null;
  maxAmount?: number | null;
  minInvoice?: number | null;
  /** قناع الأيام: 1 = الأحد … 64 = السبت */
  weekdays?: number | null;
  /** بالدقائق من منتصف الليل */
  timeFrom?: number | null;
  timeTo?: number | null;
  /** yyyy-MM-dd */
  validFrom?: string | null;
  validTo?: string | null;
  maxUses?: number | null;
  maxUsesPerDay?: number | null;
  budgetTotal?: number | null;
  budgetMonth?: number | null;
  allowGift?: boolean;
  /** الاستخدام كما عرفه السيرفر عند usageAt */
  usesToday?: number;
  usesSince?: number;
  spentMonth?: number;
  spentSince?: number;
  usageAt?: string | null;
};

/** ترتيب الأسبوع في الشاشات: السبت أولاً. value = بتّ اليوم في القناع */
export const DISCOUNT_QR_DAYS = [
  { value: 64, label: 'السبت' },
  { value: 1, label: 'الأحد' },
  { value: 2, label: 'الاثنين' },
  { value: 4, label: 'الثلاثاء' },
  { value: 8, label: 'الأربعاء' },
  { value: 16, label: 'الخميس' },
  { value: 32, label: 'الجمعة' },
];
const ALL_DAYS = 127;

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const money = (n: number) => Math.round(n).toLocaleString('en-US');
export const discountQrClock = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${pad2(minutes % 60)} ${h < 12 ? 'ص' : 'م'}`;
};
const dayNames = (mask: number) => DISCOUNT_QR_DAYS.filter(d => mask & d.value).map(d => d.label).join('، ');

/** استخدام اليوم والشهر كما يصحّ الآن: رقم محفوظ من يوم أو شهر سابق لم يعد يُحتسب */
function liveUsage(p: DiscountQrPerson, now: Date) {
  const at = String(p.usageAt ?? '').slice(0, 10);
  const today = dayKey(now);
  return {
    usesToday: at === today ? p.usesToday ?? 0 : 0,
    usesSince: p.usesSince ?? 0,
    spentMonth: at.slice(0, 7) === today.slice(0, 7) ? p.spentMonth ?? 0 : 0,
    spentSince: p.spentSince ?? 0,
  };
}

/** هل يعمل الرمز الآن؟ الحد على المبلغ يحسبه discountQrCap */
export function evaluateDiscountQr(p: DiscountQrPerson, now: Date = new Date()): { ok: true } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  const today = dayKey(now);
  if (p.validFrom && today < p.validFrom.slice(0, 10)) return no(`رمز ${p.name} يبدأ يوم ${p.validFrom.slice(0, 10)}`);
  if (p.validTo && today > p.validTo.slice(0, 10)) return no(`انتهت صلاحية رمز ${p.name} يوم ${p.validTo.slice(0, 10)}`);
  const minute = now.getHours() * 60 + now.getMinutes();
  let weekday = now.getDay();
  if (p.timeFrom != null && p.timeTo != null && p.timeFrom !== p.timeTo) {
    const crosses = p.timeFrom > p.timeTo;
    const inside = crosses ? minute >= p.timeFrom || minute < p.timeTo : minute >= p.timeFrom && minute < p.timeTo;
    if (!inside) return no(`رمز ${p.name} يعمل من ${discountQrClock(p.timeFrom)} إلى ${discountQrClock(p.timeTo)}`);
    // بعد منتصف الليل ما زلنا ضمن دوام اليوم السابق
    if (crosses && minute < p.timeTo) weekday = (weekday + 6) % 7;
  }
  if (p.weekdays != null && p.weekdays !== ALL_DAYS && !(p.weekdays & (1 << weekday))) {
    return no(`رمز ${p.name} لا يعمل اليوم — يعمل: ${dayNames(p.weekdays)}`);
  }
  const u = liveUsage(p, now);
  if (p.maxUsesPerDay != null && u.usesToday >= p.maxUsesPerDay) return no(`رمز ${p.name} بلغ حده اليوم (${p.maxUsesPerDay} فاتورة)`);
  if (p.maxUses != null && u.usesSince >= p.maxUses) return no(`رمز ${p.name} بلغ حد الاستخدام (${p.maxUses} فاتورة)`);
  if (p.budgetMonth != null && u.spentMonth >= p.budgetMonth) return no(`رمز ${p.name} استنفد ميزانية هذا الشهر`);
  if (p.budgetTotal != null && u.spentSince >= p.budgetTotal) return no(`رمز ${p.name} استنفد ميزانيته`);
  return { ok: true };
}

/** أكبر خصم يسمح به الرمز على هذه الفاتورة (Infinity = بلا حد، 0 = الفاتورة أقل من الحد الأدنى) */
export function discountQrCap(p: DiscountQrPerson, subtotal: number, now: Date = new Date()): number {
  if (p.minInvoice != null && subtotal < p.minInvoice) return 0;
  let cap = Infinity;
  if (p.maxPercent != null) cap = Math.min(cap, Math.floor((subtotal * p.maxPercent) / 100));
  if (p.maxAmount != null) cap = Math.min(cap, p.maxAmount);
  const u = liveUsage(p, now);
  if (p.budgetMonth != null) cap = Math.min(cap, Math.max(0, p.budgetMonth - u.spentMonth));
  if (p.budgetTotal != null) cap = Math.min(cap, Math.max(0, p.budgetTotal - u.spentSince));
  return cap;
}

/** وصف قصير لحد الخصم، للكاشير */
export function discountQrLimitText(p: DiscountQrPerson): string {
  const parts: string[] = [];
  if (p.maxPercent != null) parts.push(`حتى ${p.maxPercent}%`);
  if (p.maxAmount != null) parts.push(`${parts.length ? 'بحد' : 'حتى'} ${money(p.maxAmount)} د.ع`);
  if (p.minInvoice != null) parts.push(`لفاتورة من ${money(p.minInvoice)} د.ع`);
  return parts.length ? parts.join(' · ') : 'غير محدود';
}

/** كل الشروط بجمل قصيرة (فارغة = رمز بلا شروط) */
export function describeDiscountQrRules(p: DiscountQrPerson): string[] {
  const out: string[] = [];
  if (p.maxPercent != null) out.push(`خصم حتى ${p.maxPercent}%`);
  if (p.maxAmount != null) out.push(`أقصى خصم للفاتورة ${money(p.maxAmount)} د.ع`);
  if (p.minInvoice != null) out.push(`أقل فاتورة ${money(p.minInvoice)} د.ع`);
  if (p.weekdays != null && p.weekdays !== ALL_DAYS) out.push(`الأيام: ${dayNames(p.weekdays)}`);
  if (p.timeFrom != null && p.timeTo != null) out.push(`الوقت: ${discountQrClock(p.timeFrom)} – ${discountQrClock(p.timeTo)}`);
  if (p.validFrom || p.validTo) {
    out.push(`الصلاحية: ${p.validFrom ? `من ${p.validFrom.slice(0, 10)}` : ''}${p.validFrom && p.validTo ? ' ' : ''}${p.validTo ? `إلى ${p.validTo.slice(0, 10)}` : ''}`);
  }
  if (p.maxUsesPerDay != null) out.push(`${p.maxUsesPerDay} فاتورة في اليوم`);
  if (p.maxUses != null) out.push(`${p.maxUses} فاتورة إجمالاً`);
  if (p.budgetMonth != null) out.push(`ميزانية الشهر ${money(p.budgetMonth)} د.ع`);
  if (p.budgetTotal != null) out.push(`الميزانية الكلية ${money(p.budgetTotal)} د.ع`);
  if (p.allowGift === false) out.push('لا يفتح الهدايا');
  return out;
}
