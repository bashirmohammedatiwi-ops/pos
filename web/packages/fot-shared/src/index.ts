export { flushErrors, initErrorReporter, reportError } from './errorReporter';
export type { ErrorReport, ErrorReporterOptions } from './errorReporter';
export { fetchLan } from './lanFetch';
export { formatIqd, formatNum, getHwId, resolveHwId } from './money';
export {
  receiptHtml,
  receiptHtmlForBrowser,
  receiptKindLabel,
  receiptLogoSrc,
  receiptPaperWidthMm,
  receiptContentWidthMm,
  receiptThermalWidthPx,
  THERMAL_DPI,
  normalizeReceiptTemplate,
  RECEIPT_TEMPLATES,
} from './receipt';
export {
  code128Svg,
  ean13Checksum,
  formatReceiptNumber,
  receiptNumberFromScan,
  renderProductBarcode,
  renderReceiptBarcode,
} from './receipt-barcode';
export type { BarcodeGraphic } from './receipt-barcode';
export {
  DEFAULT_TOTAL_ROUNDING,
  OFFER_PRICE_STEP,
  roundOfferSalePrice,
  roundToStep,
  totalRoundingDiscount,
  totalRoundingStep,
} from './rounding';
export { DISCOUNT_QR_PREFIX, isDiscountQrCode, normalizeDiscountQrCode } from './discountQr';
export type { DiscountQrPerson } from './discountQr';
export {
  PRICE_CHECKER_SETTINGS_QR,
  isPriceCheckerSettingsQr,
  normalizePriceCheckerCode,
} from './priceChecker';
export {
  CLASSIC_BLOCK_IDS,
  CLASSIC_BLOCK_LABELS,
  CLASSIC_PART_IDS,
  CLASSIC_PART_LABELS,
  CLASSIC_TABLE_COL_LABELS,
  TABLE_PART_IDS,
  TABLE_SIZE_MAX,
  TABLE_SIZE_MIN,
  classicStyleToDto,
  defaultClassicParts,
  isClassicBlockVisible,
  moveClassicItem,
  normalizeClassicOrder,
  normalizeTableColOrder,
  parseClassicStyle,
  resolveClassicStyle,
} from './classic-style';
export type {
  ClassicBlockId,
  ClassicDateFormat,
  ClassicPartId,
  ClassicStyleDto,
  ClassicStylePart,
  ClassicTableCol,
  ClassicTablePartId,
  ReceiptAlign,
  ResolvedClassicStyle,
} from './classic-style';
export type {
  PrintSettingsDto,
  PrinterInfo,
  ReceiptPrintLineDto,
  ReceiptPrintPreviewDto,
  ReceiptTemplateId,
} from './print-types';
export type {
  DesktopCatalogApi,
  DesktopOutboxApi,
  DesktopStoreApi,
  FotDesktopBridge,
  LanServer,
} from './desktop';
export type { ApiHealth, HealthzReport } from './health';
export type { components as OpenApiComponents, paths as OpenApiPaths } from './openapi';
export type {
  AccountSummaryDto,
  ArticleGroupDto,
  ArticleGroupItemDto,
  CardChargeResult,
  CardPaymentDto,
  CashierPermissionsDto,
  CatalogInfoDto,
  CreateReceiptResponse,
  HoldReceiptDto,
  PosSessionDto,
  ProductDto,
  ProductAttributionDto,
  ProductAllowedSalesmenDto,
  ReceiptDetailDto,
  ReceiptItemDto,
  ReceiptReturnLineDto,
  ReceiptReturnSourceDto,
  CashReportDto,
  ReceiptSearchResult,
  ReceiptSummaryDto,
  SaleKind,
  SalesmanDto,
  SectionCashBoxDto,
} from './pos-types';
