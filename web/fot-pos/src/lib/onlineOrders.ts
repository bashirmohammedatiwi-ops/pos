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
  };
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

export const SHIPMENT_STATE_LABELS: Record<string, string> = {
  PENDING: 'بانتظار الإنشاء',
  CREATING: 'قيد الإنشاء',
  CREATED: 'أُنشئت الشحنة',
  RETRYING: 'إعادة محاولة',
  FAILED: 'فشل الإنشاء',
  CANCELLED: 'ملغاة',
};
