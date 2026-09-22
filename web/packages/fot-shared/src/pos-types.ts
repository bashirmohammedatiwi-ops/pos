export type ProductDto = {
  id: number;
  seq: number;
  num: string | null;
  name: string | null;
  barcode: string | null;
  originalPrice: number;
  price: number;
  stock: number;
  discountPercent: number;
  offerName: string | null;
  /** Rowversion watermark — bumped on every server-side change, drives the delta sync. */
  changeVersion?: number;
  /** Stored per-product discount percent (ext_discount_percent), editable from POS with permission. */
  storedDiscountPercent?: number;
};

export type ProductAllowedSalesmenDto = {
  restricted: boolean;
  items: SalesmanDto[];
};

export type SalesmanDto = { id: number; name: string };

export type ProductAttributionDto = {
  requiresSalesman: boolean;
  hasCommission: boolean;
  hasTarget: boolean;
  reason: string | null;
};

export type SectionCashBoxDto = {
  masterAccount: number;
  masterAccountBank: number;
  masterAccountName: string | null;
  masterAccountNum: string | null;
  isDefault: boolean;
};

export type CashierPermissionsDto = {
  id: number;
  name: string | null;
  makeDiscount: boolean;
  viewReceipts: boolean;
  cashReport?: boolean;
  deleteItem: boolean;
  duplicateItem?: boolean;
  offlineLogin?: boolean;
  discardReceipt: boolean;
  allowCreditReceipt: boolean;
  allowSalesReturn: boolean;
  allowGiftReceipt?: boolean;
  allowSearchArticles: boolean;
  allowPriceChange: boolean;
  allowEditReceipt?: boolean;
  /** Manual transfer: invoices stay local until the cashier presses the transfer button. */
  manualTransfer?: boolean;
  /** Cashier may edit the stored per-product discount percent from POS. */
  allowProductDiscount?: boolean;
  /** Hide the salesman groups and pick a single salesman for the whole invoice. */
  hideSalesmanGroups?: boolean;
  /** Returns only by invoice number / receipt barcode, using original price and seller. */
  invoiceBoundReturn?: boolean;
  itemDiscountLimit: number;
  userDiscountLimit: number;
  numberOfHoldReceipts: number;
};

export type AccountSummaryDto = {
  id: number;
  num: string | null;
  name: string | null;
  balance: number;
};

export type SaleKind = 0 | 1 | 2;

export type PosSessionDto = {
  cashierId: number;
  cashierName: string;
  salesmanId: number;
  salesmanName: string;
  token: string;
  permissions: CashierPermissionsDto | null;
  posTerminalId: number | null;
  sectionId: number;
  sectionName: string | null;
  cashBoxes: SectionCashBoxDto[];
  activeMasterAccount: number;
  activeMasterAccountBank: number;
  allowOfflineMode: boolean;
  mposService?: string | null;
  mposComPort?: string | null;
  cardPaymentEnabled?: boolean;
  applyCommissions?: boolean;
  applyTargets?: boolean;
  cashierReceiptNum?: number;
  /** Current server receipt sequence for this cashier — seeds the local numbering counter. */
  receiptYear?: number;
  receiptSeq?: number;
};

export type ArticleGroupDto = {
  id: number;
  name: string | null;
  backColour: number;
  foreColour: number;
  itemCount: number;
};

export type ArticleGroupItemDto = {
  id: number;
  productId: number;
  seq: number;
  name: string | null;
  barcode: string | null;
  price: number;
  originalPrice: number;
  backColour?: number;
  foreColour?: number;
};

export type CreateReceiptResponse = {
  receiptId: number;
  number: number;
  totalAmount: number;
  cashBack: number;
  /** True when the server re-allocated the number (client number collided) — reprint advised. */
  renumbered?: boolean;
};

export type AllocateReceiptNumberResponse = {
  number: number;
  year: number;
  cashierCode: number;
  seq: number;
};

export type ReceiptSummaryDto = {
  id: number;
  number: number;
  creationDate: string;
  totalAmount: number;
  payment: number;
  cashBack: number;
  salesmanId: number;
  salesmanName?: string | null;
  itemCount: number;
  kind?: number;
  cashierName?: string | null;
  accountName?: string | null;
  cardAmount?: number | null;
  synced?: boolean;
  masterAccount?: number | null;
  cashBoxNum?: string | null;
  cashBoxName?: string | null;
};

export type ReceiptSearchResult = {
  items: ReceiptSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type CashReportDto = {
  totalSales: number;
  receiptCount: number;
  totalPayment: number;
  totalCashBack: number;
  averageTicket: number;
};

export type HoldReceiptDto = {
  id: number;
  creationDate: string;
  totalAmount: number;
  itemCount: number;
  salesmanId: number;
  salesmanName?: string | null;
  posId?: number | null;
  posName?: string | null;
  sectionName?: string | null;
  cashierName?: string | null;
};

export type ReceiptItemDto = {
  id: number;
  articleId: number;
  name?: string | null;
  barcode?: string | null;
  quantity: number;
  price: number;
  originalPrice: number;
  discount: number;
  lineTotal: number;
  salesmanId?: number;
  salesmanName?: string | null;
  groupKey?: number | null;
  groupLabel?: string | null;
};

export type ReceiptDetailDto = {
  id: number;
  number: number;
  creationDate: string;
  totalAmount: number;
  payment: number;
  cashBack: number;
  userDiscount: number;
  salesmanId: number;
  salesmanName?: string | null;
  items: ReceiptItemDto[];
  kind?: number;
  printedNumber?: number | null;
};

export type ReceiptReturnLineDto = {
  itemId: number;
  articleId: number;
  name?: string | null;
  barcode?: string | null;
  soldQty: number;
  returnedQty: number;
  remainingQty: number;
  price: number;
  originalPrice: number;
  discount: number;
  salesmanId?: number;
  salesmanName?: string | null;
  groupKey?: number | null;
  groupLabel?: string | null;
};

export type ReceiptReturnSourceDto = {
  id: number;
  number: number;
  creationDate: string;
  kind: number;
  totalAmount: number;
  salesmanId: number;
  salesmanName?: string | null;
  items: ReceiptReturnLineDto[];
  printedNumber?: number | null;
};

export type ReceiptReturnMatchesDto = {
  items: ReceiptReturnSourceDto[];
};

export type CatalogInfoDto = {
  totalProducts: number;
  maxSeq: number;
};

export type CardPaymentDto = {
  amount: number;
  rrn?: string | null;
  terminalId?: string | null;
  acquirer?: string | null;
  accNo?: string | null;
  cardName?: string | null;
  cardType?: string | null;
  authCode?: string | null;
  batchNo?: string | null;
  refNo?: string | null;
  merchantName?: string | null;
  currencyCode?: string | null;
  deviceType?: string | null;
  transTime?: string | null;
};

export type CardChargeResult = {
  ok: boolean;
  message: string;
  payment?: CardPaymentDto | null;
  cancelledByDevice?: boolean;
};
