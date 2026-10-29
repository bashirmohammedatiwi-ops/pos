export interface UserDto {
  id: number;
  username: string;
  displayName: string;
  role: string;
}

export interface PortalSellerAccountDto {
  salesmanId: number;
  name: string;
  hasAccount: boolean;
  isActive: boolean;
  pinDisplay?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  /** أوقات فتح الويب بتوقيت العراق (دقائق من بداية اليوم) — null = بلا تقييد. */
  accessFromMin?: number | null;
  accessToMin?: number | null;
  /** بت 0 = السبت … بت 6 = الجمعة (127 = كل الأيام). */
  accessDays?: number;
}

/* ── تطبيق الفريق ── */
export interface StaffDto {
  id: number;
  code: string;
  name: string;
  kind: 'seller' | 'cashier' | 'supervisor' | 'other' | string;
  jobTitle?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  salesmanId?: number | null;
  cashierId?: number | null;
  sectionId?: number | null;
  sectionName?: string | null;
  pinDisplay?: string | null;
  hasPin: boolean;
  isActive: boolean;
  hireDate?: string | null;
  notes?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface StaffSaveRequest {
  code: string | null;
  name: string | null;
  kind: string | null;
  jobTitle: string | null;
  phone: string | null;
  salesmanId: number | null;
  cashierId: number | null;
  sectionId: number | null;
  hireDate: string | null;
  notes: string | null;
  isActive: boolean | null;
}

export interface TeamHubStatusDto {
  staffCount: number;
  devices: { staffId: number; label?: string | null; platform?: string | null; appVersion?: string | null; boundAt: string; lastSeen: string }[];
  push: { staffId: number; n: number }[];
  serverTime: string;
  /** نسخة خادم الفريق (YYYY.MM.DD) — غائبة في الخوادم القديمة. */
  hubVersion?: string;
}

/* تطبيق الفريق: الإجازات والعطل والإعلانات والتبليغات (من خادم الفريق) */
export interface TeamAudience {
  all?: boolean;
  kinds?: string[];
  sections?: number[];
  staff?: number[];
}
export type TeamLeaveType = 'swap' | 'day' | 'sick' | 'urgent' | 'hours';
export interface TeamLeaveDto {
  id: number;
  staffId: number;
  staffName: string;
  staffKind?: string | null;
  sectionName?: string | null;
  type: TeamLeaveType;
  typeLabel: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  swapFrom?: string | null;
  swapTo?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  reason?: string | null;
  attachment?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decidedBy?: string | null;
  decidedNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
}
export interface TeamDirStaffDto {
  id: number;
  code: string;
  name: string;
  kind: string;
  jobTitle?: string | null;
  sectionId?: number | null;
  sectionName?: string | null;
  isActive: boolean;
  weeklyOff: number;
  device?: string | null;
  lastSeen?: string | null;
}
export interface TeamPostDto {
  id: number;
  kind: string;
  title: string;
  body?: string | null;
  images: string[];
  pinned: boolean;
  requiresAck: boolean;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  audience: TeamAudience;
  audienceLabel: string;
  targetCount: number;
  readCount: number;
  ackCount: number;
  expired: boolean;
}
export interface TeamPostSave {
  kind: string;
  title: string;
  body?: string;
  images: string[];
  audience: TeamAudience;
  pinned: boolean;
  requiresAck: boolean;
  expiresAt?: string | null;
  notify?: boolean;
}
export interface TeamPostReaderDto {
  staffId: number;
  name: string;
  kind: string;
  sectionName?: string | null;
  readAt?: string | null;
  ackAt?: string | null;
}
export interface TeamBroadcastDto {
  id: number;
  title: string;
  body?: string | null;
  image?: string | null;
  audienceLabel: string;
  targetCount: number;
  readCount: number;
  createdBy?: string | null;
  createdAt: string;
}
export interface TeamShiftDto {
  start: string;
  end: string;
  breakMinutes: number;
  maxBreaks: number;
  custom?: boolean;
  overtime?: boolean;
  overtimeRate?: number | null;
}
export interface TeamBreakDto {
  id: number;
  startAt: string;
  endAt?: string | null;
  plannedMinutes: number;
  endsAt: string;
  overMinutes: number;
}
export interface TeamAttendDto {
  id: number;
  date: string;
  checkIn: string;
  checkOut?: string | null;
  lateMinutes: number;
  autoClosed: boolean;
  edited: boolean;
  note?: string | null;
  workedMinutes: number;
  overtimeMinutes?: number;
  breakMinutes: number;
  overMinutes: number;
  breaks: TeamBreakDto[];
  staffId?: number;
  staffName?: string;
  staffKind?: string | null;
  sectionName?: string | null;
  inIp?: string | null;
  inBssid?: string | null;
  editedBy?: string | null;
}
export type TeamBoardStatus = 'in' | 'break' | 'over' | 'out' | 'off' | 'soon' | 'missing' | 'absent';
export interface TeamBoardDto {
  date: string;
  now: string;
  rows: { staffId: number; name: string; kind: string; sectionName?: string | null; shift: TeamShiftDto; day?: { off: boolean; reason?: string | null } | null; status: TeamBoardStatus; attendance: TeamAttendDto | null }[];
  counts: Record<'in' | 'break' | 'over' | 'out' | 'off' | 'missing' | 'soon' | 'late', number>;
  network: { enforced: boolean; count: number };
}
export interface TeamNetworkDto {
  id: number;
  name: string;
  bssid?: string | null;
  /** كل نقاط بث الشبكة (راوتر + مقويات + النطاقان) */
  bssids?: string[];
  ip?: string | null;
  /** auto: يتبع عنوان إنترنت المحل الذي يتعلّمه الخادم تلقائياً */
  ipMode?: 'fixed' | 'auto';
  ssid?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
}
export interface TeamAttendSettingsDto {
  enforceNetwork: boolean;
  shiftStart: string;
  shiftEnd: string;
  breakMinutes: number;
  maxBreaks: number;
  graceMinutes: number;
  earlyMinutes: number;
  autoCloseHours: number;
  breakWarnMinutes: number;
  requireIp: boolean;
  otMinMinutes: number;
  otRoundMinutes: number;
  otCountDayOff: boolean;
}
export interface WifiAccessPointDto {
  bssid: string;
  signal?: number | null;
  channel?: number | null;
  band?: string | null;
}
export interface WifiScanDto {
  networks: { ssid: string; auth?: string | null; accessPoints: WifiAccessPointDto[] }[];
  current?: { ssid?: string | null; bssid?: string | null; signal?: number | null } | null;
  error?: string | null;
}
export interface TeamSummaryRowDto {
  staffId: number;
  name: string;
  kind: string;
  sectionName?: string | null;
  scheduledDays: number;
  presentDays: number;
  absentDays: number;
  offDays: number;
  leaveDays: number;
  workedMinutes: number;
  avgMinutes: number;
  lateDays: number;
  lateMinutes: number;
  breakMinutes: number;
  overMinutes: number;
  overtimeEnabled: boolean;
  overtimeRate?: number | null;
  overtimeMinutes: number;
  overtimeDays: number;
  overtimePay?: number | null;
  autoClosed: number;
  edited: number;
  attendanceRate: number | null;
}
export interface TeamSummaryDto {
  from: string;
  to: string;
  days: number;
  rows: TeamSummaryRowDto[];
}
export interface TeamRosterDto {
  from: string;
  dates: string[];
  rows: { staffId: number; name: string; kind: string; sectionName?: string | null; cells: { date: string; off: boolean; reason?: string | null }[] }[];
  working: number[];
  staffCount: number;
}
export interface TeamAppReleaseDto {
  id: number;
  version: string;
  notes?: string | null;
  required: boolean;
  size: number;
  sha256?: string | null;
  url: string;
  createdBy?: string | null;
  createdAt: string;
}
export interface TeamPushStatusDto {
  configured: boolean;
  projectId?: string | null;
  tokens: { kind: string; n: number }[];
  log: { at: string; kind: string; count: number; ok: number; title: string; error?: string }[];
}
export interface TeamManagerPermsDto {
  id: number;
  username: string;
  displayName: string;
  isActive: boolean;
  perms: Record<'approveLeave' | 'viewAttendance' | 'editAttendance' | 'sendPosts' | 'manageChat', boolean>;
  sections: number[];
  sectionNames: string[];
}
export interface TeamCommissionProductDto {
  barcode: string;
  name: string;
  groups: string[];
  commissionType?: string | null;
  commissionValue: number;
  image?: string | null;
  orphan?: boolean;
}
export interface TeamAuditDto {
  id: number;
  at: string;
  actor?: string | null;
  action: string;
  target?: string | null;
  details?: string | null;
}

export interface TeamOverviewDto {
  today: string;
  weekday: string;
  staffCount: number;
  offToday: { staffId: number; name: string; kind: string; reason: string }[];
  partial: { staffId: number; name: string; kind: string; timeFrom?: string; timeTo?: string }[];
  pending: number;
  devices: number;
  active7: number;
}

export interface SellerBrandLinkDto {
  salesmanId: number;
  treeSeq: number;
  treeName?: string | null;
  sortOrder: number;
}

export interface SellerAccessRequest {
  fromMin: number | null;
  toMin: number | null;
  days: number;
}

export interface PortalManagerAccountDto {
  id: number;
  username: string;
  displayName: string;
  isActive: boolean;
  passwordDisplay?: string | null;
  createdAt: string;
}

export interface PortalBulkIssueResult {
  issued: number;
  sellers: PortalSellerAccountDto[];
}

export interface PortalWebStatusDto {
  sellerAccounts: number;
  activeSellers: number;
  savedOnShop: boolean;
  visibleOnWeb: boolean;
  message: string;
  webUrl: string;
  statusCode?: number | null;
}

export interface PortalPublishResult {
  account: PortalSellerAccountDto;
  savedOnShop: boolean;
  visibleOnWeb: boolean;
  message: string;
  webUrl: string;
}

export interface LoginResponse {
  token: string;
  user: UserDto;
}

export interface ServerInfoDto {
  hostName: string;
  lanAddresses: string[];
  apiPort: number;
  adminUiHosted: boolean;
  timestampUtc: string;
}

export interface DashboardStats {
  activeOffers: number;
  edariMaterials: number;
  edariTreeFolders: number;
  edariSalesmen: number;
  edariBranches: number;
  localProducts: number;
  localSections: number;
  edariDatabaseAlias?: string;
  edariConnected: boolean;
  edariConnectionMessage?: string;
}

export interface EdariBranchDto {
  seq: number;
  name: string;
  symbol?: string;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductDto {
  id: number;
  seq: number;
  num?: string;
  name?: string;
  barcode?: string;
  originalPrice: number;
  price: number;
  stock: number;
  discountPercent: number;
  offerName?: string;
  /** Rowversion watermark — bumped on every server-side change, drives the POS delta sync. */
  changeVersion?: number;
  /** Stored per-product discount percent (ext_discount_percent). */
  storedDiscountPercent?: number;
}

export interface UpdateProductRequest {
  name?: string;
  barcode?: string;
  originalPrice?: number;
  finalPrice?: number;
  stock?: number;
  /** 0–100 stored discount percent for this product. */
  discountPercent?: number;
}

export interface CatalogInfoDto {
  totalProducts: number;
  maxSeq: number;
}

export interface AddOfferBulkRequest {
  itemIds: number[];
  discountPercent: number;
  detailRole: number;
  fromDate?: string | null;
  toDate?: string | null;
  unlimited: boolean;
}

export interface OfferDto {
  id: number;
  name: string;
  priority: number;
  enabled: boolean;
  type: number;
  detailCount: number;
  activeProductCount: number;
  folderId?: number | null;
  folderName?: string | null;
  /** فترة العرض — متوفرة من الخادم الحديث ضمن القائمة. */
  unlimited?: boolean;
  fromDate?: string | null;
  toDate?: string | null;
}

/**
 * شروط تفعيل العرض المشروط.
 * matchMode: 0 كل المواد المشروطة · 1 عدد منها (minCount).
 * countBasis: 0 مواد مختلفة · 1 عدد قطع (تكرار نفس المادة يُحسب).
 */
export interface OfferBundleConditionsDto {
  matchMode: 0 | 1;
  minCount: number;
  countBasis: 0 | 1;
  minQtyEach: number;
  minRequiredAmount: number;
  requiredDiscount: number;
  /** كل giftEvery قطعة مدفوعة من المشروطة ← giftCount قطعة مخفّضة (0 = بلا حد). */
  giftEvery?: number;
  giftCount?: number;
}

export interface OfferFolderDto {
  id: number;
  name: string;
  sortOrder: number;
  offerCount: number;
}

export interface OfferDetailDto {
  id: number;
  itemId?: number;
  itemName?: string;
  discount: number;
  discountType: number;
  fromDate?: string;
  toDate?: string;
  unlimited: boolean;
  detailRole: number;
  sourceTreeSeq?: number;
  sourceTreeName?: string;
  excluded?: boolean;
  barcode?: string;
  price?: number;
}

export interface OfferTreeCardDto {
  treeSeq: number;
  treeName?: string | null;
  count: number;
  excludedCount: number;
  discount: number;
  lastSyncedAt?: string | null;
}

export interface OfferScopeDto {
  trees: OfferTreeCardDto[];
  standalone: OfferDetailDto[];
  defaultDiscount: number;
  unlimited?: boolean;
  fromDate?: string | null;
  toDate?: string | null;
}

/** One product currently under a tree with in-offer state — expandable tree cards. */
export interface OfferTreeProductDto {
  detailId?: number;
  seq: number;
  name?: string;
  barcode?: string;
  price: number;
  inOffer: boolean;
  excluded: boolean;
  discount?: number;
}

/** Per-tree membership drift for an offer batch. */
export interface OfferTreeStateDto {
  treeSeq: number;
  treeName?: string;
  currentTreeCount: number;
  inOfferCount: number;
  excludedCount: number;
  drift: number;
  lastSyncedAt?: string;
}

export interface CreateOfferRequest {
  name: string;
  priority: number;
  type: number;
  enabled: boolean;
  folderId?: number | null;
}

export interface UpdateOfferRequest {
  name: string;
  priority: number;
  type: number;
  enabled: boolean;
}

export interface UpsertOfferDetailRequest {
  itemId?: number;
  discount: number;
  discountType: number;
  fromDate?: string | null;
  toDate?: string | null;
  unlimited: boolean;
  detailRole?: number;
}

export interface UpdateOfferDetailRequest {
  discount: number;
  fromDate?: string | null;
  toDate?: string | null;
  unlimited?: boolean;
  discountType?: number;
}

export interface ProductOfferMembershipDto {
  offerId: number;
  offerName: string;
  offerType: number;
  enabled: boolean;
  priority: number;
  discount: number;
  discountType: number;
  detailRole: number;
  excluded: boolean;
  isWinning: boolean;
}

export interface ProductOfferLookupDto {
  id: number;
  seq: number;
  name?: string;
  barcode?: string;
  num?: string;
  originalPrice: number;
  price: number;
  discountPercent: number;
  offerName?: string;
  offers: ProductOfferMembershipDto[];
}

export interface ProductOfferMembershipsDto {
  itemId: number;
  offers: ProductOfferMembershipDto[];
}

export interface UpdateOfferTreeDiscountRequest {
  discountPercent: number;
  fromDate?: string | null;
  toDate?: string | null;
  unlimited?: boolean;
}

export interface AddOfferTreeRequest {
  treeSeq: number;
  discountPercent: number;
  fromDate?: string | null;
  toDate?: string | null;
  unlimited: boolean;
}

export interface OfferTreeApplyResult {
  productsAdded: number;
  skipped: number;
  treeName?: string;
  productsUpdated?: number;
}

export interface ReceiptSummary {
  id: number;
  number: number;
  creationDate: string;
  totalAmount: number;
  payment: number;
  cashBack: number;
  salesmanId: number;
  salesmanName?: string;
  posId?: number;
  posName?: string;
  synced: boolean;
  edrNum?: number;
  itemCount: number;
  itemsDiscount: number;
  offersDiscount: number;
  userDiscount: number;
  kind: number;
  cashierId?: number;
  cashierName?: string;
  accountName?: string;
  sectionId?: number;
  sectionName?: string;
  syncDate?: string;
  grossAmount?: number;
  netAmount?: number;
  displayNumber?: string;
  kindLabel?: string;
  syncLabel?: string;
  cardAmount?: number;
  cardName?: string;
  cardAcquirer?: string;
  cardAccNo?: string;
  cardRrn?: string;
  cardTerminalId?: string;
  cardAuthCode?: string;
  cardTransTime?: string;
  cardType?: string;
  cardRefNo?: string;
  /** Edari account Seq of the cash box the sale was rung into. */
  masterAccount?: number;
  cashBoxNum?: string;
  cashBoxName?: string;
  /** Distinct salesmen on the lines — more than one means the receipt has no single owner. */
  salesmanCount?: number;
  discountQrPersonId?: number | null;
  discountQrPersonName?: string | null;
  wasEdited?: boolean;
  printedNumber?: number | null;
}

export interface ReceiptTotalsSummary {
  receiptCount: number;
  grossTotal: number;
  netTotal: number;
  totalPayment: number;
  totalCashBack: number;
  totalOffersDiscount: number;
  totalUserDiscount: number;
  totalItemsDiscount: number;
}

export interface HoldReceiptDto {
  id: number;
  creationDate: string;
  totalAmount: number;
  itemCount: number;
  salesmanId: number;
  salesmanName?: string;
  posId?: number;
  posName?: string;
  sectionName?: string;
  cashierName?: string;
}

export interface ReceiptSearchResult {
  items: ReceiptSummary[];
  total: number;
  page: number;
  pageSize: number;
  summary: ReceiptTotalsSummary;
}

export interface ReceiptItemDto {
  id: number;
  articleId: number;
  name?: string;
  barcode?: string;
  quantity: number;
  price: number;
  originalPrice: number;
  discount: number;
  lineTotal: number;
  salesmanId?: number;
  salesmanName?: string;
  groupKey?: number;
  groupLabel?: string;
}

export interface ReceiptEditLineDto {
  articleId: number;
  name?: string;
  barcode?: string;
  quantity: number;
  price: number;
  originalPrice: number;
  discount: number;
  salesmanId?: number;
  salesmanName?: string;
}

export interface ReceiptEditSnapshotDto {
  salesmanId: number;
  salesmanName?: string;
  userDiscount: number;
  masterAccount: number;
  items: ReceiptEditLineDto[];
}

export interface ReceiptEditRevisionDto {
  editedAt: string;
  before: ReceiptEditSnapshotDto;
  after: ReceiptEditSnapshotDto;
}

export interface ReceiptDetailDto {
  id: number;
  number: number;
  creationDate: string;
  totalAmount: number;
  payment: number;
  cashBack: number;
  itemsDiscount: number;
  offersDiscount: number;
  userDiscount: number;
  salesmanId: number;
  salesmanName?: string;
  synced: boolean;
  edrNum?: number;
  items: ReceiptItemDto[];
  discountQrPersonId?: number | null;
  discountQrPersonName?: string | null;
  wasEdited?: boolean;
  edits?: ReceiptEditRevisionDto[];
  printedNumber?: number | null;
}

export interface DiscountQrPersonDto {
  id: number;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
  receiptCount: number;
  totalDiscount: number;
}

export interface DiscountQrReceiptDto {
  id: number;
  number: number;
  creationDate: string;
  totalAmount: number;
  userDiscount: number;
  cashierName?: string | null;
  personName?: string | null;
}

export interface TerminalDto {
  id: number;
  name?: string;
  lastConnection?: string;
  sectionName?: string;
  active: boolean;
}

export interface PosTerminalMonitorDto {
  id: number;
  name?: string;
  hwId?: string;
  sectionId?: number;
  sectionName?: string;
  lastConnection?: string;
  lastSync?: string;
  lastUpdate?: string;
  exeVersion?: string;
  active: boolean;
  isOnline: boolean;
  pathLabel?: string;
  /** Offline receipts waiting for upload on that terminal (from its heartbeat). */
  pendingOffline?: number;
  /** Offline receipts that exhausted retries on that terminal — need attention. */
  deadOffline?: number;
}

export interface SectionTerminalGroupDto {
  sectionId: number;
  sectionName: string;
  terminals: PosTerminalMonitorDto[];
}

export interface CashierActivityDto {
  id: number;
  cashierName?: string;
  eventType: string;
  eventLabel?: string;
  posPath?: string;
  createdAt: string;
  receiptId?: number;
  receiptNum?: string;
  message?: string;
}

export interface CashierVoidLineDto {
  name?: string | null;
  barcode?: string | null;
  quantity: number;
  amount: number;
}

export interface CashierVoidSummaryDto {
  cashierId: number;
  cashierName: string;
  deletedLines: number;
  cancelledInvoices: number;
  deletedAmount: number;
  cancelledAmount: number;
}

export interface CashierVoidReportDto {
  cashiers: CashierVoidSummaryDto[];
  deletedLines: number;
  cancelledInvoices: number;
  deletedAmount: number;
  cancelledAmount: number;
}

export interface OfferSalesClosureDto {
  id: number;
  offerId: number;
  offerName: string;
  periodFrom: string;
  periodTo: string;
  closedAt: string;
  totalAmount: number;
  totalQuantity: number;
}

export interface OfferSalesProductRowDto {
  articleSeq: number;
  barcode?: string | null;
  name?: string | null;
  quantity: number;
  amount: number;
  listAmount: number;
  discountAmount: number;
  sharePercent: number;
  firstSoldDate?: string | null;
  lastSoldDate?: string | null;
  activeDaysCount?: number;
}

export interface OfferSalesProductDayRowDto {
  date: string;
  articleSeq: number;
  barcode?: string | null;
  name?: string | null;
  quantity: number;
  amount: number;
  listAmount: number;
  discountAmount: number;
  receiptCount: number;
}

export interface OfferSalesDailyRowDto {
  date: string;
  quantity: number;
  amount: number;
  receiptCount: number;
}

export interface OfferSalesUnsoldRowDto {
  barcode?: string | null;
  name?: string | null;
}

export interface OfferSalesReportDto {
  offerId: number;
  offerName: string;
  offerType: number;
  discountPercent: number;
  periodFrom: string;
  periodTo: string;
  periodDays: number;
  storeLabel?: string | null;
  scopeProductCount: number;
  soldProductCount: number;
  unsoldProductCount: number;
  receiptCount: number;
  totalQuantity: number;
  totalAmount: number;
  totalListAmount: number;
  totalDiscountAmount: number;
  averageDailyAmount: number;
  averageTicketAmount: number;
  generatedAt: string;
  daily: OfferSalesDailyRowDto[];
  products: OfferSalesProductRowDto[];
  unsoldSamples: OfferSalesUnsoldRowDto[];
  productDaily?: OfferSalesProductDayRowDto[];
}

export interface CashierVoidEventDto {
  id: number;
  kind: string;
  productName?: string | null;
  barcode?: string | null;
  quantity: number;
  amount: number;
  lineCount: number;
  receiptNum?: string | null;
  source?: string | null;
  createdAt: string;
  lines: CashierVoidLineDto[];
}

export interface SalesmanDto {
  id: number;
  name: string;
}

export interface CashierDto {
  id: number;
  username: string;
  accountName?: string;
  active: boolean;
  permissionsId: number;
  permissionsName?: string | null;
  sectionId?: number;
  sectionName?: string | null;
}

export interface CashierCreditAccountDto {
  edariSeq: number;
  num?: string | null;
  name?: string | null;
  balance?: number;
}

export interface CashierDetailDto {
  id: number;
  username: string;
  accountName?: string | null;
  active: boolean;
  sectionId: number;
  sectionName?: string | null;
  permissions: CashierPermissionsDto;
  cardMasterAccount?: number | null;
  cardMasterAccountBank?: number | null;
  cardMasterAccountName?: string | null;
  cardMasterAccountNum?: string | null;
  applyCommissions?: boolean;
  applyTargets?: boolean;
  allowedSalesmen?: SalesmanDto[] | null;
  creditAccounts?: CashierCreditAccountDto[] | null;
}

export interface CreateCashierRequest {
  username: string;
  password: string;
  accountName?: string | null;
  permissions: UpdatePermissionsRequest;
  sectionId: number;
  active?: boolean;
  cardMasterAccount?: number | null;
  cardMasterAccountBank?: number | null;
  applyCommissions?: boolean;
  applyTargets?: boolean;
  allowedSalesmanIds?: number[] | null;
  creditAccounts?: CashierCreditAccountDto[] | null;
}

export interface UpdateCashierRequest {
  username?: string | null;
  password?: string | null;
  accountName?: string | null;
  permissions?: UpdatePermissionsRequest | null;
  active: boolean;
  sectionId?: number | null;
  cardMasterAccount?: number | null;
  cardMasterAccountBank?: number | null;
  clearCardMasterAccount?: boolean;
  applyCommissions?: boolean | null;
  applyTargets?: boolean | null;
  allowedSalesmanIds?: number[] | null;
  creditAccounts?: CashierCreditAccountDto[] | null;
}

export interface SectionDto {
  id: number;
  name: string;
  branchId: number;
  state: boolean;
  sellPrice: number;
}

export interface SectionSummaryDto extends SectionDto {
  branchName?: string;
  edariBranchId: number;
  edariWarehouseNumber: number;
  masterAccount: number;
  cashBoxCount?: number;
  terminalCount: number;
  onlineTerminals: number;
  todayReceipts: number;
  todaySales: number;
}

export interface SectionCashBoxDto {
  masterAccount: number;
  masterAccountBank: number;
  masterAccountName?: string | null;
  masterAccountNum?: string | null;
  isDefault: boolean;
}

export interface SectionCashBoxAssignment {
  masterAccount: number;
  masterAccountBank?: number | null;
  isDefault?: boolean;
}

export interface SectionDetailDto extends SectionSummaryDto {
  groupsColumnsCount: number;
  groupsItemSize: number;
  roundTotalTo: number;
  roundItemTo: number;
  fastSaving: boolean;
  collectivePrinting: boolean;
  displayArticleQuantity: boolean;
  cashBoxes: SectionCashBoxDto[];
  terminals: PosTerminalDto[];
}

export interface CreateSectionRequest {
  name: string;
  edariWarehouseNumber: number;
  edariBranchId?: number | null;
  edariSymbol?: string | null;
  branchId?: number | null;
  state?: boolean;
  sellPrice?: number;
  cashBoxes?: SectionCashBoxAssignment[] | null;
}

export interface SectionSaveResponse {
  id: number;
  edariBranchId: number;
  edariMessage?: string;
}

export interface UpdateSectionRequest {
  name: string;
  state: boolean;
  sellPrice: number;
  edariBranchId: number;
  edariWarehouseNumber: number;
  groupsColumnsCount: number;
  groupsItemSize: number;
  roundTotalTo: number;
  roundItemTo: number;
  fastSaving: boolean;
  collectivePrinting: boolean;
  displayArticleQuantity: boolean;
  cashBoxes?: SectionCashBoxAssignment[] | null;
  edariSymbol?: string | null;
}

export interface PosTerminalDto {
  id: number;
  name?: string;
  hwId?: string;
  sectionId?: number;
  sectionName?: string;
  lastConnection?: string;
  exeVersion?: string;
  active: boolean;
}

export interface PosTerminalDetailDto extends PosTerminalDto {
  lastSync?: string;
  lastUpdate?: string;
  isOnline: boolean;
  allowOfflineMode: boolean;
  remarks?: string;
  vfdFirstLine?: string;
  vfdSecondLine?: string;
  todayReceipts: number;
  todaySales: number;
}

export interface UpdateTerminalRequest {
  name?: string | null;
  sectionId?: number | null;
  active: boolean;
  allowOfflineMode: boolean;
  remarks?: string | null;
  vfdFirstLine?: string | null;
  vfdSecondLine?: string | null;
}

export interface CashierPermissionsDto {
  id: number;
  name?: string;
  makeDiscount: boolean;
  viewReceipts: boolean;
  cashReport: boolean;
  deleteItem: boolean;
  duplicateItem: boolean;
  offlineLogin: boolean;
  discardReceipt: boolean;
  allowCreditReceipt: boolean;
  allowSalesReturn: boolean;
  allowGiftReceipt: boolean;
  /** Gift dock only after discount QR scan; gift lines by barcode only. */
  giftViaDiscountQr?: boolean;
  allowPriceChange: boolean;
  allowSearchArticles: boolean;
  allowEditReceipt: boolean;
  /** Manual transfer: invoices stay local until the cashier presses the transfer button. */
  manualTransfer?: boolean;
  /** Cashier may edit the stored per-product discount percent from POS. */
  allowProductDiscount?: boolean;
  /** Hide the salesman groups in POS and pick one salesman for the whole invoice. */
  hideSalesmanGroups?: boolean;
  invoiceBoundReturn?: boolean;
  printSalesmanOnReceipt?: boolean;
  itemDiscountLimit: number;
  userDiscountLimit: number;
  numberOfHoldReceipts: number;
}

export interface UpdatePermissionsRequest {
  makeDiscount: boolean;
  viewReceipts: boolean;
  cashReport: boolean;
  deleteItem: boolean;
  duplicateItem: boolean;
  offlineLogin: boolean;
  discardReceipt: boolean;
  allowCreditReceipt: boolean;
  allowSalesReturn: boolean;
  allowGiftReceipt: boolean;
  /** Gift dock only after discount QR scan; gift lines by barcode only. */
  giftViaDiscountQr?: boolean;
  allowPriceChange: boolean;
  allowSearchArticles: boolean;
  allowEditReceipt: boolean;
  manualTransfer: boolean;
  allowProductDiscount: boolean;
  hideSalesmanGroups: boolean;
  invoiceBoundReturn: boolean;
  printSalesmanOnReceipt: boolean;
  itemDiscountLimit: number;
  userDiscountLimit: number;
  numberOfHoldReceipts: number;
}

export interface ArticleGroupDto {
  id: number;
  name?: string;
  backColour: number;
  foreColour: number;
  itemCount: number;
}

export interface ArticleGroupItemDto {
  id: number;
  productId: number;
  seq: number;
  name?: string;
  barcode?: string;
  price: number;
  originalPrice: number;
  backColour: number;
  foreColour: number;
}

export interface CreateArticleGroupRequest {
  name: string;
  backColour: number;
  foreColour: number;
}

export interface UpdateArticleGroupRequest {
  name: string;
  backColour: number;
  foreColour: number;
}

export interface ArticleGroupWriteResult {
  added: number;
  skipped: number;
}

export interface AccountSummaryDto {
  id: number;
  num?: string;
  name?: string;
  balance: number;
  /** Edari chart folder — «صناديق المحل» vs a delivery/customer folder. */
  group?: string;
}

export interface PosCreditAccountDto {
  edariSeq: number;
  num?: string;
  name?: string;
  balance: number;
  enabledForPos: boolean;
  sortOrder: number;
}

export interface SavePosCreditAccountsRequest {
  edariSeqs: number[];
}

export interface DailySalesRowDto {
  date: string;
  total: number;
  receiptCount: number;
}

export interface SalesmanSalesRowDto {
  salesmanId: number;
  name?: string;
  total: number;
  count: number;
  lineCount?: number;
}

export interface MovementRowDto {
  articleId: number;
  name?: string;
  barcode?: string;
  soldQty: number;
  soldAmount: number;
  returnedQty?: number;
  giftQty?: number;
  receiptCount?: number;
}

export interface HeatCellDto {
  weekday: number;
  hour: number;
  total: number;
  count: number;
}

export interface HeatmapReportDto {
  posStartDate?: string | null;
  cells: HeatCellDto[];
}

export interface CashierPerformanceRowDto {
  cashierId: number;
  name?: string | null;
  sectionName?: string | null;
  netSales: number;
  receiptCount: number;
  returnsTotal: number;
  returnsCount: number;
  giftCount: number;
  manualDiscount: number;
  cardTotal: number;
  daysWorked: number;
  firstAt?: string | null;
  lastAt?: string | null;
}

export interface ReorderRowDto {
  articleId: number;
  name?: string | null;
  barcode?: string | null;
  stock: number;
  price: number;
  soldQty: number;
  dailyRate: number;
  coverDays: number;
  lastSaleDate?: string | null;
}

export interface ReorderReportDto {
  effectiveDays: number;
  coverDays: number;
  outOfStock: number;
  underWeek: number;
  total: number;
  rows: ReorderRowDto[];
}

export interface SlowMoverRowDto {
  articleId: number;
  name?: string | null;
  barcode?: string | null;
  stock: number;
  price: number;
  stockValue: number;
  lastSaleDate?: string | null;
  totalSoldQty: number;
}

export interface SlowMoverReportDto {
  since: string;
  posStartDate?: string | null;
  totalCount: number;
  totalValue: number;
  neverSoldCount: number;
  rows: SlowMoverRowDto[];
}

export interface HourBucketDto {
  hour: number;
  total: number;
  count: number;
}

export interface NamedTotalDto {
  id: number;
  name: string;
  sub?: string | null;
  total: number;
  count: number;
}

/** تفصيل يوم للوحة الرئيسية. */
export interface DayBreakdownDto {
  date: string;
  hourly: HourBucketDto[];
  prevHourly: HourBucketDto[];
  bySection: NamedTotalDto[];
  byPos: NamedTotalDto[];
  byCashier: NamedTotalDto[];
  cardTotal: number;
  cardCount: number;
}

export interface CashReportDto {
  totalSales: number;
  receiptCount: number;
  totalPayment: number;
  totalCashBack: number;
  averageTicket: number;
  returnsTotal?: number;
  returnsCount?: number;
}

export interface CommissionRuleDto {
  id: number;
  productId?: number;
  productName?: string;
  barcode?: string;
  salesmanId?: number;
  salesmanName?: string;
  label?: string;
  commissionType: string;
  commissionValue: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface CreateCommissionRuleRequest {
  productId?: number | null;
  barcode?: string | null;
  commissionType: string;
  commissionValue: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  salesmanId?: number | null;
  label?: string | null;
}

export interface UpdateCommissionRuleRequest {
  productId?: number | null;
  barcode?: string | null;
  salesmanId?: number | null;
  label?: string | null;
  commissionType: string;
  commissionValue: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  isActive: boolean;
}

export interface CommissionCalculationDto {
  id: number;
  receiptId: number;
  articleId: number;
  productName?: string;
  salesmanId: number;
  salesmanName?: string;
  commissionType: string;
  commissionValue: number;
  quantity: number;
  lineAmount: number;
  commissionAmount: number;
  calculatedAt: string;
  commissionGroupId?: number | null;
  commissionGroupName?: string | null;
  saleDate?: string | null;
  receiptNumber?: number | null;
}

export interface RecalculateCommissionsResult {
  receiptsScanned: number;
  receiptsProcessed: number;
  linesWritten: number;
  skipped: number;
  message: string;
}

export interface CommissionGapRow {
  receiptId: number;
  receiptNumber?: number | null;
  saleDate: string;
  articleId: number;
  productName?: string | null;
  salesmanId: number;
  salesmanName?: string | null;
  reason: string;
}

export interface CommissionHealthDto {
  from: string;
  to: string;
  activeGroups: number;
  activeRules: number;
  linkedProducts: number;
  receiptsInPeriod: number;
  eligibleLines: number;
  calculatedLines: number;
  missingCalculations: number;
  linesWithoutSalesman: number;
  gaps: CommissionGapRow[];
  hints: string[];
}

export interface CommissionLineDiagnoseDto {
  itemId: number;
  articleId: number;
  articleSeq: number;
  productName?: string | null;
  barcode?: string | null;
  salesmanId: number;
  quantity: number;
  price: number;
  hasCalculation: boolean;
  commissionAmount?: number | null;
  groupName?: string | null;
  status: string;
  message: string;
}

export interface CommissionReceiptDiagnoseDto {
  receiptId: number;
  receiptNumber?: number | null;
  saleDate?: string | null;
  receiptSalesmanId: number;
  itemCount: number;
  calculatedCount: number;
  lines: CommissionLineDiagnoseDto[];
}

export interface CommissionReceiptReportRow {
  receiptId: number;
  receiptNumber?: number | null;
  saleDate?: string | null;
  lineCount: number;
  totalCommission: number;
  totalSales: number;
}

export interface CommissionPreviewDto {
  matched: boolean;
  source?: string | null;
  groupId?: number | null;
  groupName?: string | null;
  productName?: string | null;
  articleSeq?: number | null;
  commissionType?: string | null;
  commissionValue: number;
  commissionAmount: number;
  resolvedSalesmanId: number;
  message: string;
}

export interface CommissionPayoutDto {
  id: number;
  salesmanId: number;
  salesmanName?: string | null;
  amount: number;
  paidAt: string;
  note?: string | null;
  voided: boolean;
}

export interface TargetReceiptRowDto {
  receiptId: number;
  receiptNumber?: number | null;
  saleDate: string;
  salesmanId: number;
  salesmanName?: string | null;
  quantity: number;
  lineAmount: number;
  lineCount: number;
}

export interface CommissionDailyReportRow {
  day: string;
  totalCommission: number;
  transactionCount: number;
  totalSales: number;
}

export interface CommissionGroupReportRow {
  groupId?: number | null;
  groupName?: string | null;
  transactionCount: number;
  totalCommission: number;
  totalSales: number;
}

export interface CommissionProductReportRow {
  articleId: number;
  productName?: string | null;
  transactionCount: number;
  totalCommission: number;
  totalSales: number;
  quantity: number;
}

export interface SalesmanCommissionSummaryDto {
  salesmanId: number;
  salesmanName?: string;
  currencyCode: string;
  openingBalance: number;
  paidOutTotal: number;
  totalCommission: number;
  transactionCount: number;
  balanceDue: number;
  notes?: string;
}

export interface SalesmanCommissionProfileDto {
  salesmanId: number;
  salesmanName?: string;
  currencyCode: string;
  openingBalance: number;
  paidOutTotal: number;
  notes?: string;
}

export interface UpdateSalesmanCommissionProfileRequest {
  currencyCode: string;
  openingBalance: number;
  paidOutTotal: number;
  notes?: string | null;
}

export interface CommissionGroupSalesmanDto {
  salesmanId: number;
  salesmanName?: string;
}

export interface CommissionGroupDto {
  id: number;
  name: string;
  description?: string;
  commissionType: string;
  commissionValue: number;
  salesmanId?: number;
  salesmanName?: string;
  salesmen?: CommissionGroupSalesmanDto[];
  label?: string;
  sortOrder: number;
  colorHex?: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  treeCount: number;
  itemCount: number;
  productCount: number;
}

export interface CommissionGroupTreeDto {
  id: number;
  treeSeq: number;
  treeName?: string;
  isFullTree: boolean;
  productCount: number;
  excludedCount?: number;
  lastSyncedAt?: string;
}

export interface CommissionGroupItemDto {
  id: number;
  articleId?: number;
  barcode?: string;
  articleName?: string;
  sourceTreeSeq?: number;
  sourceTreeName?: string;
  excluded?: boolean;
  price?: number;
}

export interface CommissionGroupDetailDto extends Omit<CommissionGroupDto, 'treeCount' | 'itemCount' | 'productCount'> {
  trees: CommissionGroupTreeDto[];
  items: CommissionGroupItemDto[];
}

export interface CreateCommissionGroupRequest {
  name: string;
  description?: string | null;
  commissionType: string;
  commissionValue: number;
  salesmanId?: number | null;
  salesmanIds?: number[] | null;
  label?: string | null;
  sortOrder?: number;
  colorHex?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface UpdateCommissionGroupRequest {
  name: string;
  description?: string | null;
  commissionType: string;
  commissionValue: number;
  salesmanId?: number | null;
  salesmanIds?: number[] | null;
  label?: string | null;
  sortOrder: number;
  colorHex?: string | null;
  isActive: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface CommissionGroupTreeApplyResult {
  added: number;
  skipped: number;
  treeName?: string;
  updated?: number;
}

export interface ProductCommissionMembershipDto {
  groupId: number;
  groupName: string;
  isActive: boolean;
  commissionType: string;
  commissionValue: number;
  sourceTreeSeq?: number | null;
  sourceTreeName?: string | null;
  excluded: boolean;
}

export interface ProductCommissionLookupDto {
  id: number;
  seq: number;
  name?: string;
  barcode?: string;
  num?: string;
  price: number;
  groups: ProductCommissionMembershipDto[];
}

export interface ProductCommissionMembershipsDto {
  itemId: number;
  groups: ProductCommissionMembershipDto[];
}

export interface CommissionOverlapGroupDto {
  groupId: number;
  groupName: string;
  isActive: boolean;
  commissionType: string;
  commissionValue: number;
  sourceTreeSeq?: number | null;
  sourceTreeName?: string | null;
}

export interface CommissionOverlapProductDto {
  articleId: number;
  name?: string;
  barcode?: string;
  price: number;
  groups: CommissionOverlapGroupDto[];
}

export interface CommissionGroupTreeProductDto {
  itemId?: number;
  articleId: number;
  name?: string;
  barcode?: string;
  inGroup: boolean;
  excluded?: boolean;
  price?: number;
}

export interface TargetTreeLinkDto {
  treeSeq: number;
  treeName?: string;
}

export interface TargetRuleDto {
  id: number;
  name: string;
  isActive: boolean;
  trees: TargetTreeLinkDto[];
  assignments: TargetSalesmanAssignmentDto[];
  edariTreeSeq?: number;
  edariTreeName?: string;
  /** quantity | amount — amount targets measure IQD sold. */
  targetType?: string;
  excludedArticleIds?: number[];
}

export interface TargetSalesmanAssignmentDto {
  salesmanId: number;
  salesmanName?: string;
  dailyTarget: number;
  weeklyTarget: number;
  monthlyTarget: number;
}

export interface TargetProgressDto {
  ruleId: number;
  ruleName: string;
  currentQuantity: number;
  periodStart: string;
  periodEnd: string;
}

export interface TargetSalesmanRowDto {
  salesmanId: number;
  salesmanName?: string;
  quantity: number;
  dailyTarget: number;
  weeklyTarget: number;
  monthlyTarget: number;
  dailyPercent: number;
  weeklyPercent: number;
  monthlyPercent: number;
  rank: number;
  amount?: number;
}

export interface TargetBreakdownDto {
  ruleId: number;
  ruleName: string;
  periodStart: string;
  periodEnd: string;
  treeCount: number;
  productCount: number;
  totalQuantity: number;
  salesmen: TargetSalesmanRowDto[];
  trees: TargetTreeLinkDto[];
  products?: TargetProductRowDto[] | null;
  receiptCount?: number;
  unassignedQuantity?: number;
  /** quantity | amount */
  targetType?: string;
  totalAmount?: number;
}

export interface TargetProductRowDto {
  articleSeq: number;
  productName?: string | null;
  quantity: number;
  receiptCount: number;
}

export interface CreateTargetRuleRequest {
  name: string;
  trees?: TargetTreeLinkDto[];
  assignments?: TargetSalesmanAssignmentDto[];
  targetType?: string;
  excludedArticleIds?: number[];
}

export interface UpdateTargetRuleRequest extends CreateTargetRuleRequest {}

export type { PrintSettingsDto, ReceiptPrintLineDto, ReceiptPrintPreviewDto } from '@fot/shared';

export type UpdatePrintSettingsRequest = Omit<import('@fot/shared').PrintSettingsDto, 'id'>;

export interface PosCashBoxSettingsDto {
  qiMasterAccount?: number | null;
  qiMasterAccountBank: number;
  qiMasterAccountName?: string | null;
  qiMasterAccountNum?: string | null;
  giftMasterAccount?: number | null;
  giftMasterAccountBank: number;
  giftMasterAccountName?: string | null;
  giftMasterAccountNum?: string | null;
  /** Edari account gifts post against (output invoice Kind 3). Default 3133. */
  edariGiftAccount?: number;
  /** Edari account card-paid receipts post against — without it card money is indistinguishable from cash. */
  edariQiAccount?: number;
  edariQiAccountName?: string | null;
  edariQiAccountNum?: string | null;
}

export interface UpdatePosCashBoxSettingsRequest {
  qiMasterAccount?: number | null;
  qiMasterAccountBank?: number | null;
  giftMasterAccount?: number | null;
  giftMasterAccountBank?: number | null;
  edariGiftAccount?: number;
  edariQiAccount?: number;
}

export interface BusinessPeriodSettingsDto {
  weekStartDay: number;
  weekLengthDays: number;
  weekStartDayName: string;
  weekEndDayName: string;
  currentWeekStart: string;
  currentWeekEnd: string;
  previousWeekStart: string;
  previousWeekEnd: string;
  currentMonthStart: string;
  currentMonthEnd: string;
}

export interface UpdateBusinessPeriodSettingsRequest {
  weekStartDay: number;
  weekLengthDays: number;
}

export interface EdariSyncStatusDto {
  unsyncedCount: number;
  syncedCount: number;
  failedCount: number;
  message: string;
  connectionOk?: boolean;
  databaseAlias?: string;
  dataRoot?: string;
  lastDataPullAt?: string;
  lastHeartbeatAt?: string;
  lastChangeDetectedAt?: string;
  liveWatching?: boolean;
  autoSyncEnabled?: boolean;
  liveMessage?: string;
  deadLetterCount?: number;
  oldestUnsyncedMinutes?: number;
  circuitOpen?: boolean;
  circuitRetryInSeconds?: number;
}

export interface EdariDeadLetterDto {
  id: number;
  number: number;
  creationDate: string;
  totalAmount: number;
  syncAttempts: number;
  reason?: string;
  lastAttemptAt?: string;
}

export interface OfferStatsDto {
  total: number;
  enabled: number;
  disabled: number;
  discountedItems: number;
}

export interface ClientErrorDto {
  id: number;
  source: string;
  terminal?: string;
  message: string;
  stack?: string;
  context?: string;
  appVersion?: string;
  createdAt: string;
}

export interface EdariSettingsDto {
  dataRoot: string;
  databaseAlias: string;
  server: string;
  port: number;
  connectionMode: string;
  odbcDriver: string;
  adoProviderPath?: string;
  adoConnectorDirectory?: string;
  enabled: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalSeconds: number;
  catalogSyncEnabled: boolean;
  lastReceiptSyncAt?: string;
  lastCatalogSyncAt?: string;
  lastDataPullAt?: string;
  lastConnectionTestAt?: string;
  lastConnectionOk?: boolean;
  lastConnectionMessage?: string;
  availableYears: string[];
  lastHeartbeatAt?: string;
  lastChangeDetectedAt?: string;
  liveWatching?: boolean;
  dataPullIntervalSeconds: number;
}

export interface UpdateEdariSettingsRequest {
  dataRoot: string;
  databaseAlias: string;
  server: string;
  port: number;
  connectionMode: string;
  odbcDriver: string;
  adoProviderPath?: string;
  adoConnectorDirectory?: string;
  enabled: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalSeconds: number;
  catalogSyncEnabled: boolean;
  dataPullIntervalSeconds: number;
}

export interface EdariConnectionTestResult {
  ok: boolean;
  message: string;
  materialTreeCount?: number;
  offerCount?: number;
  testedAt: string;
}

export interface EdariDataPullResult {
  ok: boolean;
  message: string;
  salesmenAdded: number;
  salesmenUpdated: number;
  salesmenTotal: number;
  offersImported: number;
  articlesAdded: number;
  articlesUpdated: number;
  articlesTotal: number;
  sectionsCreated: number;
  materialCount?: number;
  treeFolderCount?: number;
  branchCount?: number;
  finishedAt: string;
}

export interface EdariSyncRunResult {
  ok: boolean;
  message: string;
  receiptsSynced: number;
  receiptsFailed: number;
  offersImported: number;
  finishedAt: string;
}

export interface EdariFullSyncResult {
  ok: boolean;
  message: string;
  salesmenTotal: number;
  articlesAdded: number;
  articlesUpdated: number;
  articlesTotal: number;
  sectionsCreated: number;
  receiptsSynced: number;
  receiptsFailed: number;
  offersImported: number;
  finishedAt: string;
}

export interface EdariArabicNamesBackfillResult {
  success: boolean;
  message: string;
  articlesUpdated: number;
  branchesUpdated: number;
  sectionsUpdated: number;
  salesmenUpdated: number;
  salesmenImported: number;
  finishedAt: string;
}

export interface EdariSyncLogDto {
  id: number;
  receiptId?: number;
  status: string;
  edrNum?: number;
  operation?: string;
  errorMessage?: string;
  details?: string;
  attemptedAt: string;
}

export interface TreeProductInfoDto {
  seq: number;
  name?: string;
  barcode?: string;
  price: number;
}

export interface TreeNodeDto {
  seq: number;
  father?: number;
  name?: string;
  num?: string;
  barcode?: string;
  isFolder: boolean;
  hasChildren: boolean;
  price?: number;
}

export interface WeeklySettlementSettingsDto {
  deductionPercent: number;
  salesmanIds: number[];
}

export interface WeeklySettlementTargetColumnDto {
  targetId: number;
  name: string;
  targetType: string;
}

export interface WeeklySettlementTargetCellDto {
  targetId: number;
  sold: number;
  goal: number;
  percent: number;
}

export interface WeeklySettlementRowDto {
  salesmanId: number;
  salesmanName?: string | null;
  commission: number;
  afterDeduction: number;
  amount: number;
  delivered: boolean;
  deliveredAt?: string | null;
  payoutId?: number | null;
  targets: WeeklySettlementTargetCellDto[];
}

export interface WeeklySettlementReportDto {
  weekStart: string;
  weekEnd: string;
  isCurrentWeek: boolean;
  canDeliver: boolean;
  deductionPercent: number;
  salesmanIds: number[];
  targetColumns: WeeklySettlementTargetColumnDto[];
  rows: WeeklySettlementRowDto[];
}

export interface UpdateWeeklySettlementSettingsRequest {
  deductionPercent: number;
  salesmanIds: number[];
}

export interface UpdateWeeklySettlementRowRequest {
  weekStart: string;
  salesmanId: number;
  amount?: number | null;
  delivered?: boolean | null;
}

export interface WeeklySettlementRowSaveDto {
  salesmanId: number;
  amount: number;
  delivered: boolean;
  deliveredAt?: string | null;
  payoutId?: number | null;
}

export interface ProductInquiryRequest {
  from?: string;
  to?: string;
  articleSeqs?: number[];
  treeSeqs?: number[];
  commissionGroupId?: number | null;
  salesmanId?: number | null;
  fullDetails?: boolean;
}

export interface ProductInquiryScopeDto {
  kind: string;
  label?: string | null;
  productCount: number;
  commissionGroupId?: number | null;
}

export interface ProductInquirySummaryDto {
  quantity: number;
  salesAmount: number;
  receiptCount: number;
  commissionAmount: number;
  commissionLineCount: number;
}

export interface ProductInquiryProductRowDto {
  articleSeq: number;
  productName?: string | null;
  barcode?: string | null;
  quantity: number;
  salesAmount: number;
  commissionAmount: number;
  receiptCount: number;
}

export interface ProductInquirySalesmanRowDto {
  salesmanId: number;
  salesmanName?: string | null;
  quantity: number;
  salesAmount: number;
  commissionAmount: number;
  receiptCount: number;
}

export interface ProductInquiryCommissionRowDto {
  id: number;
  receiptId: number;
  receiptNumber?: number | null;
  saleDate?: string | null;
  articleSeq: number;
  productName?: string | null;
  salesmanId: number;
  salesmanName?: string | null;
  commissionType?: string | null;
  commissionValue: number;
  quantity: number;
  lineAmount: number;
  commissionAmount: number;
  commissionGroupId?: number | null;
  commissionGroupName?: string | null;
}

export interface ProductInquiryReceiptRowDto {
  receiptId: number;
  receiptNumber?: number | null;
  saleDate?: string | null;
  salesmanId: number;
  salesmanName?: string | null;
  quantity: number;
  salesAmount: number;
  commissionAmount: number;
  lineCount: number;
}

export interface ProductInquiryDto {
  scope: ProductInquiryScopeDto;
  summary: ProductInquirySummaryDto;
  products: ProductInquiryProductRowDto[];
  salesmen: ProductInquirySalesmanRowDto[];
  commissions: ProductInquiryCommissionRowDto[];
  receipts: ProductInquiryReceiptRowDto[];
  receiptsTruncated: boolean;
  commissionsTruncated: boolean;
}

// ── System Backup & Restore ─────────────────────────────────────────────────

export interface BackupSummaryCountsDto {
  offersCount: number;
  commissionGroupsCount: number;
  targetsCount: number;
  cashiersCount: number;
  salesmenCount: number;
  sectionsCount: number;
  receiptsCount: number;
  articlesCount: number;
  tablesCount: number;
  totalRows: number;
}

export interface BackupSectionInfoDto {
  id: string;
  label: string;
  tableCount: number;
  rowCount: number;
}

export interface BackupTableInfoDto {
  name: string;
  section: string;
  rowCount: number;
  hasIdentity: boolean;
}

export interface BackupManifestDto {
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  label: string;
  includeCatalog: boolean;
  summary: BackupSummaryCountsDto;
  sections: BackupSectionInfoDto[];
  tables: BackupTableInfoDto[];
}

export interface BackupFileItemDto {
  fileName: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
  includeCatalog: boolean;
  isAuto: boolean;
  summary?: BackupSummaryCountsDto | null;
}

export interface BackupSettingsDto {
  autoBackupEnabled: boolean;
  intervalHours: number;
  retainCount: number;
  includeCatalogInAuto: boolean;
  backupFolder: string;
  lastAutoBackupAt?: string | null;
  lastBackupAt?: string | null;
  storedBackupsCount: number;
  totalStorageBytes: number;
}

export interface UpdateBackupSettingsRequest {
  autoBackupEnabled: boolean;
  intervalHours: number;
  retainCount: number;
  includeCatalogInAuto: boolean;
}

export interface CreateBackupRequest {
  label?: string | null;
  includeCatalog?: boolean;
}

export interface RestoreBackupRequest {
  sections?: string[] | null;
  createSafetyBackup?: boolean;
}

export interface RestoreBackupResultDto {
  ok: boolean;
  message: string;
  restoredTables: number;
  restoredRows: number;
  safetyBackupFileName?: string | null;
}

