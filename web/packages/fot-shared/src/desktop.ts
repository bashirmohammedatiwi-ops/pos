import type { PrinterInfo } from './print-types';

export type DesktopStoreApi = {
  getMeta: (key: string) => Promise<string | null>;
  setMeta: (key: string, value: string) => Promise<void>;
  upsertProducts: (products: unknown[]) => Promise<void>;
  findProduct: (code: string) => Promise<unknown | null>;
  searchProducts: (term: string, limit?: number) => Promise<unknown[]>;
  productCount: () => Promise<number>;
  /** Drops local products missing from the server's live id list (older builds lack it). */
  pruneProducts?: (liveIds: number[]) => Promise<number>;
  productsByIds?: (ids: number[]) => Promise<unknown[]>;
  saveGroups: (groups: unknown[], itemsByGroup: Record<number, unknown[]>) => Promise<void>;
  loadGroups: () => Promise<unknown[]>;
  loadGroupItems: (groupId: number) => Promise<unknown[]>;
  saveSalesmen: (list: unknown[]) => Promise<void>;
  loadSalesmen: () => Promise<unknown[]>;
  saveAccounts: (list: unknown[]) => Promise<void>;
  loadAccounts: () => Promise<unknown[]>;
  savePrintSettings: (settings: unknown) => Promise<void>;
  loadPrintSettings: () => Promise<unknown | null>;
  nextLocalNumber: (cashierCode?: number) => Promise<number>;
  seedReceiptSeq?: (cashierCode: number, serverSeq: number) => Promise<void>;
  enqueue: (row: unknown) => Promise<number>;
  pending: () => Promise<unknown[]>;
  pendingCount: () => Promise<number>;
  removeOutbox: (id: number) => Promise<void>;
  markOutboxError: (id: number, error: string, permanent?: boolean) => Promise<void>;
  updateOutbox?: (id: number, changes: { payload?: unknown; status?: 'queued' | 'deferred'; localNumber?: number }) => Promise<void>;
  resetOutboxRetry?: (id: number) => Promise<void>;
  outboxCounts?: () => Promise<{ total: number; queued: number; deferred: number; dead: number }>;
  saveLastReceipt: (data: unknown) => Promise<void>;
  loadLastReceipt: () => Promise<unknown | null>;
  saveTodayReceipts?: (list: unknown[]) => Promise<void>;
  loadTodayReceipts?: () => Promise<unknown[]>;
};

export type DesktopCatalogApi = {
  findBarcode: (code: string) => Promise<unknown | null>;
  search: (term: string, limit?: number) => Promise<unknown[]>;
  syncBatch: (products: unknown[]) => Promise<void>;
  productCount: () => Promise<number>;
  /** Drops local products missing from the server's live id list (older builds lack it). */
  prune?: (liveIds: number[]) => Promise<number>;
};

export type DesktopOutboxApi = {
  enqueue: (row: unknown) => Promise<number>;
  list: () => Promise<unknown[]>;
  count: () => Promise<number>;
  markSynced: (id: number) => Promise<void>;
  markError: (id: number, error: string, permanent?: boolean) => Promise<void>;
  update?: (id: number, changes: { payload?: unknown; status?: 'queued' | 'deferred'; localNumber?: number }) => Promise<void>;
  resetRetry?: (id: number) => Promise<void>;
  counts?: () => Promise<{ total: number; queued: number; deferred: number; dead: number }>;
};

export type LanServer = {
  url: string;
  hostName?: string;
  port?: number;
  source?: 'udp' | 'http' | 'saved' | 'local' | 'lan';
};

export type FotDesktopBridge = {
  role: 'admin' | 'pos';
  info: () => Promise<{
    role: string;
    version: string;
    packaged: boolean;
    hasLocalApi?: boolean;
    isServerEdition?: boolean;
    apiBase?: string | null;
  }>;
  recover?: () => Promise<{ ok: boolean }>;
  /** True exactly once per app launch — POS forces a fresh login on every restart. */
  consumeFreshLaunch?: () => Promise<boolean>;
  hwId?: () => Promise<string>;
  printHtml?: (
    html: string,
    copies?: number,
    deviceName?: string | null,
    /** Roll width so the hidden print window uses the paper size instead of the driver default. */
    options?: { paperWidthMm?: number },
  ) => Promise<{ ok: boolean; message?: string }>;
  listPrinters?: () => Promise<PrinterInfo[]>;
  getPrintConfig?: () => Promise<{ printerName: string | null; askBeforePrint: boolean }>;
  setPrintConfig?: (config: { printerName?: string | null; askBeforePrint?: boolean }) => Promise<void>;
  getFullScreen?: () => Promise<boolean>;
  setFullScreen?: (flag: boolean) => Promise<boolean>;
  toggleFullScreen?: () => Promise<boolean>;
  ensureApi?: (preferredUrl?: string) => Promise<{
    ok: boolean;
    mode: string;
    url?: string;
    message?: string;
    hostName?: string;
  }>;
  getApiBase?: () => Promise<string | null>;
  setApiBase?: (url: string) => Promise<string | null>;
  discoverServers?: (opts?: { timeoutMs?: number; httpScan?: boolean }) => Promise<LanServer[]>;
  onApiBaseChanged?: (callback: (url: string) => void) => () => void;
  cardCharge?: (payload: {
    amount: number;
    service?: string | null;
    comPort?: string | null;
  }) => Promise<{
    ok: boolean;
    message: string;
    payment?: Record<string, unknown> | null;
    cancelledByDevice?: boolean;
  }>;
  store?: DesktopStoreApi;
  catalog?: DesktopCatalogApi;
  outbox?: DesktopOutboxApi;
};

declare global {
  interface Window {
    fotDesktop?: FotDesktopBridge;
  }
}

export {};
