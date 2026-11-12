import type { OrderPrintData, ReceiptPrintPreviewDto } from '@fot/shared';

/** ألوان حالة الأسطر — نفسها في كل تطبيقات الطلبات. */
export const LINE_COLORS = {
  green: '#1F9D63',
  red: '#D64545',
  yellow: '#DB8B12',
  grey: '#94A3B8',
} as const;

export type LineColor = keyof typeof LINE_COLORS;

export type SiteShipmentLite = {
  state?: string | null;
  trackingNumber?: string | null;
  statusName?: string | null;
  lastError?: string | null;
  codAmount?: number | null;
} | null;

export type QueueRow = {
  id: string;
  orderNumber: string;
  code: string;
  stage: string;
  deliveryOption: string;
  customer: string | null;
  governorate: string | null;
  area: string | null;
  pickerName: string | null;
  pickedAt: string | null;
  parcelCount: number | null;
  total: number;
  finalTotal: number | null;
  codAmount: number | null;
  adjusted: boolean;
  receiptNumber: string | null;
  shipment: SiteShipmentLite;
} & Partial<UnitTotals>;

/** أسطر الطلب وقطعه كما طُلب، وما سيُسلَّم بعد التجهيز (المطابق + الإضافي). */
export type UnitTotals = {
  orderedLines: number;
  orderedUnits: number;
  lines: number;
  units: number;
  missingUnits: number;
  extraUnits: number;
};

/** صنف من كتالوج المحل بالباركود. */
export type PosProductLookup =
  | { found: false; barcode: string }
  | {
      found: true;
      id: number;
      name: string | null;
      barcode: string | null;
      siteBarcode: string;
      price: number;
      originalPrice: number;
      stock: number;
      offerName: string | null;
    };

export type OrderEditBody =
  | { code: string; op: 'add'; barcode: string; qty: number; charge: 'PAID' | 'FREE'; reason?: string; clientEditId: string }
  | { code: string; op: 'set'; lineId: string; qty: number; charge?: 'PAID' | 'FREE'; reason?: string; clientEditId: string }
  /** إعادة بناء إيصال المحل المحجوز من طلب الموقع (بعد تعديل لم يكتمل في المحل). */
  | { code: string; op: 'sync' };

/** خيارات التوصيل عند هاي إكسبريس لهذا الطلب. */
export type CourierInfo = {
  /** null = الافتراضي من الإعدادات، 0 = بلا نوع. */
  typeId: number | null;
  defaultTypeId: number | null;
  effectiveTypeId: number | null;
  note: string | null;
  phone2: string | null;
  parcelCount: number;
  types: { id: number; name: string }[];
};

export type CourierLabelResult ={ pdfBase64: string; trackingNumber: string; orderNumber: string; parcelCount: number };

/** فاتورة طلب تطبيق محجوزة عن الترحيل التلقائي إلى الإداري. */
export type HeldInvoice = {
  clientReceiptId: string;
  orderId: string;
  orderNumber: string | null;
  createdAt: string;
  edits: number;
  lastEditAt: string | null;
  receiptId: number | null;
  receiptNumber: number | null;
  total: number;
  deliveryOption: string | null;
  trackingNumber: string | null;
  cashierName: string | null;
};

/** حالة الترحيل اليدوي لفاتورة الطلب في هذا المحل. */
export type EdariState = {
  held: boolean;
  posted: boolean;
  releasedAt: string | null;
  releasedByName: string | null;
  edits: number;
  lastEditAt: string | null;
  receiptNumber: number | null;
  receiptTotal: number;
  /** فاتورة مُفوترة هنا ولم تُرحَّل: تُعدّل أصنافها ويتبعها الموقع وشركة التوصيل. */
  editable: boolean;
  /** إيصال المحل لا يطابق الموقع (تعديل لم يكتمل) — «مزامنة إيصال المحل». */
  outOfSync: boolean;
};

export type QueueResult = {
  ready: QueueRow[];
  pickup: QueueRow[];
  awaitingCourier: QueueRow[];
  picking: QueueRow[];
  returns: QueueRow[];
  counts: Record<string, number>;
};

export type SiteLine = {
  id: string;
  kind: 'ORDERED' | 'EXTRA';
  barcode: string | null;
  name: string;
  shadeName: string | null;
  orderedQty: number;
  pickedQty: number;
  missingQty: number;
  unitPrice: number;
  charge: 'PAID' | 'FREE';
  reason: string | null;
  substituteForLineId: string | null;
  state: 'MATCHED' | 'SHORT' | 'EXTRA' | 'PENDING';
  color: LineColor;
  label: string;
  thumb?: string | null;
};

export type SiteMoney = {
  orderedSubtotal: number;
  shortageValue: number;
  extrasValue: number;
  freeExtrasValue: number;
  finalSubtotal: number;
  shippingTotal: number;
  giftWrapFee: number;
  finalTotal: number;
  codAmount: number;
  refundAmount: number;
  adjustmentTotal: number;
  prepaid: boolean;
  changed: boolean;
  allMissing: boolean;
  needsApproval: boolean;
};

export type PlannedLine = {
  barcode: string | null;
  name: string;
  qty: number;
  chargePrice: number;
  free: boolean;
  kind: string | null;
  articleId: number;
  posName: string | null;
  posBarcode: string | null;
  posPrice: number;
  listPrice: number;
  priceDiffers: boolean;
  resolved: boolean;
};

export type ReceiptLink = {
  orderId: string;
  orderNumber: string;
  receiptId: number;
  receiptNumber: number;
  kind: 'sale' | 'return';
  trackingNumber: string | null;
  total: number;
  reportedOk: boolean;
  lastError: string | null;
  createdAt: string;
};

export type LookupResult = {
  order: {
    id: string;
    orderNumber: string;
    code: string;
    stage: string;
    status: string;
    deliveryOption: string;
    paymentMethod: string;
    paymentStatus: string;
    prepaid: boolean;
    createdAt: string;
    pickedAt: string | null;
    pickerName: string | null;
    parcelCount: number | null;
    notes: string | null;
    isGift: boolean;
    giftMessage: string | null;
    giftHidePrices: boolean;
  };
  customer: {
    name: string | null;
    phone: string | null;
    governorate: string | null;
    area: string | null;
    street: string | null;
    house: string | null;
    landmark: string | null;
    addressLine: string | null;
  };
  lines: SiteLine[];
  counts: Record<string, number>;
  /** من سيرفر أحدث فقط. */
  totals?: UnitTotals;
  money: SiteMoney;
  receipt: OrderPrintData['receipt'];
  blockers: string[];
  canInvoice: boolean;
  invoiced: { receiptNumber: string | null; clientReceiptId: string | null; at: string | null; cashierName: string | null } | null;
  shipment: SiteShipmentLite;
  local: {
    lines: PlannedLine[];
    unresolved: string[];
    deliveryFee: number;
    deliveryArticleName: string | null;
    accountName: string | null;
    paymentLabel: string;
    computedTotal: number;
    problems: string[];
    sale: ReceiptLink | null;
    return: ReceiptLink | null;
    invoicedHere: boolean;
    /** من سيرفر 2.6+: null = فاتورة تُرحَّل تلقائياً (أو لم تُفوتر بعد). */
    edari?: EdariState | null;
  };
  /** خيارات التوصيل (من سيرفر أحدث فقط). */
  courier?: CourierInfo;
  /** رد حفظ خيارات التوصيل بعد الفوترة: اطبع ملصق هاي إكسبريس الجديد. */
  reprintLabel?: boolean;
  /** رد التعديل بعد الفوترة: هل وصل التعديل لهاي إكسبريس؟ */
  courierUpdate?: { ok: boolean; error?: string; codAmount?: number } | null;
  /** عُدّلت فاتورة مُفوترة — اطبع الإيصال والملصق من جديد. */
  reprint?: boolean;
};

export type OrderReceiptPrint = ReceiptPrintPreviewDto;

export type PrintDataResult = OrderPrintData & {
  receiptPrint?: OrderReceiptPrint | null;
  returnPrint?: OrderReceiptPrint | null;
  link?: ReceiptLink | null;
};

export type FinalizeResult = {
  ok: boolean;
  alreadyInvoiced: boolean;
  receipt: { id: number; number: number; total: number };
  receiptPrint: OrderReceiptPrint;
  print: OrderPrintData;
  shipment: SiteShipmentLite;
};

export type ReturnResult = {
  ok: boolean;
  already: boolean;
  receipt: { id: number; number: number; total: number };
  receiptPrint: OrderReceiptPrint;
};

export type OnlineOrdersStatus = {
  enabled: boolean;
  keyConfigured: boolean;
  reachable: boolean;
  serverTime: string | null;
  error: string | null;
  print: {
    receiptCopies: number;
    invoiceCopies: number;
    labelCopies: number;
    labelPrinterName: string | null;
    autoPrintNewSlips: boolean;
    doubleCheck: boolean;
  };
};

/** رمز طلب التطبيق كما في QR: «ORD-…» (أو «ORD…» إن أسقط الماسح الشرطة). */
export function parseOrderCode(raw: string | null | undefined): string | null {
  const clean = String(raw ?? '')
    .replace(/[‎‏‪-‮﻿\s]/g, '')
    .toUpperCase();
  const m = /^ORD-?([A-Z0-9]{6,32})$/.exec(clean);
  return m ? `ORD-${m[1]}` : null;
}

export function isOrderCode(raw: string | null | undefined) {
  return parseOrderCode(raw) !== null;
}

/** تطبيق «كاشير الطلبات» المستقل، أو ?mode=orders في المتصفح أثناء التطوير. */
export function isOrdersApp() {
  try {
    if (window.fotDesktop?.role === 'orders') return true;
    return new URLSearchParams(window.location.search).get('mode') === 'orders';
  } catch {
    return false;
  }
}

export const STAGE_LABELS: Record<string, string> = {
  NEW: 'جديد',
  CONFIRMED: 'مؤكد',
  PICKING: 'قيد التجهيز',
  PICKED: 'بانتظار الكاشير',
  READY_FOR_PICKUP: 'جاهز للاستلام',
  INVOICED: 'مُفوتر (بانتظار شركة التوصيل)',
  HANDED_OVER: 'سُلّم للشحن',
  OUT_FOR_DELIVERY: 'مع المندوب',
  DELIVERY_ISSUE: 'مشكلة توصيل',
  DELIVERED: 'تم التسليم',
  PARTIALLY_DELIVERED: 'تسليم جزئي',
  RETURNING: 'راجع للمحل',
  RETURNED: 'مُرتجع',
  CANCELLED: 'ملغي',
};

/** «قطعة/قطعتان/3 قطع/11 قطعة» بالعربية الصحيحة. */
export function unitsLabel(n: number) {
  return arabicCount(n, 'قطعة', 'قطعتان', 'قطع', 'قطعة');
}

/** «بند/بندان/3 بنود/11 بنداً». */
export function linesLabel(n: number) {
  return arabicCount(n, 'بند', 'بندان', 'بنود', 'بنداً');
}

function arabicCount(n: number, one: string, two: string, few: string, many: string) {
  const v = Math.abs(Math.trunc(n));
  if (v === 0) return `لا ${few}`;
  if (v === 1) return one;
  if (v === 2) return two;
  const mod = v % 100;
  if (mod >= 3 && mod <= 10) return `${v} ${few}`;
  return `${v} ${many}`;
}

/** القطع والأسطر: من الخادم إن وُجدت، وإلا من أسطر الطلب نفسها. */
export function orderTotals(order: Pick<LookupResult, 'lines' | 'totals'>): UnitTotals {
  if (order.totals) return order.totals;
  const ordered = order.lines.filter(l => l.kind === 'ORDERED');
  const extras = order.lines.filter(l => l.kind === 'EXTRA' && l.pickedQty > 0);
  const picked = ordered.reduce((n, l) => n + Math.min(l.pickedQty, l.orderedQty), 0);
  return {
    orderedLines: ordered.length,
    orderedUnits: ordered.reduce((n, l) => n + l.orderedQty, 0),
    lines: ordered.filter(l => l.pickedQty > 0).length + extras.length,
    units: picked + extras.reduce((n, l) => n + l.pickedQty, 0),
    missingUnits: ordered.reduce((n, l) => n + Math.max(0, l.orderedQty - l.pickedQty), 0),
    extraUnits: extras.reduce((n, l) => n + l.pickedQty, 0),
  };
}

export const SHIPMENT_STATE_LABELS: Record<string, string> = {
  PENDING: 'بانتظار الإنشاء',
  CREATING: 'قيد الإنشاء',
  CREATED: 'أُنشئت الشحنة',
  RETRYING: 'إعادة محاولة',
  FAILED: 'فشل الإنشاء',
  CANCELLED: 'ملغاة',
};
