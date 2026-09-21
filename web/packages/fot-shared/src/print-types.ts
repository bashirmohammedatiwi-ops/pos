import type { ClassicStyleDto } from './classic-style';

export type PrintSettingsDto = {
  id: number;
  name?: string;
  headerText?: string;
  headerDescription?: string;
  footerText?: string;
  qrCodeText?: string;
  logoUrl?: string | null;
  showLogo: boolean;
  showBarcode: boolean;
  showArticleNumber: boolean;
  copies: number;
  paperWidthMm: number;
  fontSize: number;
  /** CSS weight from 300 (light) to 700 (bold). */
  fontWeight?: number;
  logoMaxHeightPx: number;
  showQrCode: boolean;
  showCashier: boolean;
  showSalesman: boolean;
  showCashBox: boolean;
  showTotalQuantity: boolean;
  showDiscountDetails: boolean;
  showItemTable: boolean;
  showSubtotal: boolean;
  showPaymentLines: boolean;
  autoPrint: boolean;
  /** Round the final total down to this step (IQD). 0 disables it. */
  roundTotalTo?: number;
  /** classic | compact | branded */
  receiptTemplate?: string;
  /** Per-element typography and block order for the classic table template. */
  classicStyle?: ClassicStyleDto | string | null;
};

export type ReceiptTemplateId = 'classic' | 'compact' | 'branded';

export type ReceiptPrintLineDto = {
  name: string;
  barcode: string;
  articleNumber: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  originalPrice: number;
};

export type ReceiptPrintPreviewDto = {
  receiptNumber: number;
  printedAt: string;
  /** 0 = مبيعات, 1 = مرتجع, 2 = هدية */
  kind?: number;
  cashierName?: string | null;
  salesmanName?: string | null;
  posLabel?: string | null;
  cashBoxName?: string | null;
  lines: ReceiptPrintLineDto[];
  subTotal: number;
  userDiscount: number;
  total: number;
  paid: number;
  change: number;
};

export type PrinterInfo = {
  name: string;
  displayName: string;
  isDefault: boolean;
};
