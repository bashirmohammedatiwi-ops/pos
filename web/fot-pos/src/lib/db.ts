import { formatReceiptNumber } from '@fot/shared';
import { withOfferSalePrice, withOfferSalePrices } from '@/lib/offerPrice';
import type { DiscountQrPerson } from '@fot/shared';
import type { AccountSummaryDto, ArticleGroupDto, ArticleGroupItemDto, PrintSettingsDto, ProductDto, SalesmanDto } from '@/api/types';

const DB_NAME = 'fot-pos';
const DB_VERSION = 4;

export type OutboxStatus = 'queued' | 'deferred';

export type OutboxRow = {
  id?: number;
  payload: unknown;
  clientReceiptId: string;
  localNumber: number;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
  status?: OutboxStatus;
  editedAt?: string | null;
};

export type OutboxCounts = { total: number; queued: number; deferred: number; dead: number };

function nativeStore() {
  return typeof window !== 'undefined' ? window.fotDesktop?.store : undefined;
}

function nativeCatalog() {
  return typeof window !== 'undefined' ? window.fotDesktop?.catalog : undefined;
}

function nativeOutbox() {
  return typeof window !== 'undefined' ? window.fotDesktop?.outbox : undefined;
}

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb);
  if (openingDb) return openingDb;
  openingDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      openingDb = null;
      reject(req.error);
    };
    req.onsuccess = () => {
      cachedDb = req.result;
      cachedDb.onclose = () => { cachedDb = null; };
      cachedDb.onversionchange = () => {
        cachedDb?.close();
        cachedDb = null;
      };
      openingDb = null;
      resolve(cachedDb);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('products')) {
        const s = db.createObjectStore('products', { keyPath: 'id' });
        s.createIndex('barcode', 'barcode', { unique: false });
        s.createIndex('num', 'num', { unique: false });
        s.createIndex('seq', 'seq', { unique: false });
      }
      if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('groupItems')) db.createObjectStore('groupItems', { keyPath: 'groupId' });
      if (!db.objectStoreNames.contains('salesmen')) db.createObjectStore('salesmen', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('print')) db.createObjectStore('print');
      if (!db.objectStoreNames.contains('lastReceipt')) db.createObjectStore('lastReceipt');
      if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('todayReceipts')) {
        db.createObjectStore('todayReceipts', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('discountQr')) db.createObjectStore('discountQr', { keyPath: 'id' });
    };
  });
  return openingDb;
}

/** IndexedDB stays open so every scan does not pay for a new connection. */
function releaseDb(_conn: IDBDatabase) {
  /* reused */
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const idb = {
  async getMeta(key: string): Promise<string | null> {
    const conn = await openDb();
    const v = await req(conn.transaction('meta').objectStore('meta').get(key));
    releaseDb(conn);
    return typeof v === 'string' ? v : v == null ? null : String(v);
  },

  async setMeta(key: string, value: string) {
    const conn = await openDb();
    await req(conn.transaction('meta', 'readwrite').objectStore('meta').put(value, key));
    releaseDb(conn);
  },

  async upsertProducts(products: ProductDto[]) {
    const conn = await openDb();
    const tx = conn.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const p of products) store.put(p);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    releaseDb(conn);
  },

  async findProduct(code: string): Promise<ProductDto | null> {
    const trimmed = code.trim();
    const conn = await openDb();
    const store = conn.transaction('products').objectStore('products');
    const byBarcode = await req<ProductDto[]>(store.index('barcode').getAll(trimmed));
    if (byBarcode[0]) {
      releaseDb(conn);
      return byBarcode[0];
    }
    const byNum = await req<ProductDto[]>(store.index('num').getAll(trimmed));
    releaseDb(conn);
    return byNum[0] ?? null;
  },

  async searchProducts(term: string, limit = 24): Promise<ProductDto[]> {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const conn = await openDb();
    const all = await req<ProductDto[]>(conn.transaction('products').objectStore('products').getAll());
    releaseDb(conn);
    return all
      .filter(p =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q) ||
        (p.num ?? '').includes(q))
      .slice(0, limit);
  },

  async productCount(): Promise<number> {
    const conn = await openDb();
    const n = await req(conn.transaction('products').objectStore('products').count());
    releaseDb(conn);
    return n;
  },

  /** Drops every local product missing from the server's live id list. */
  async pruneProducts(liveIds: number[]): Promise<number> {
    const keep = new Set(liveIds.map(Number));
    const conn = await openDb();
    const tx = conn.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    const existing = await req<IDBValidKey[]>(store.getAllKeys());
    let removed = 0;
    for (const key of existing) {
      if (keep.has(Number(key))) continue;
      store.delete(key);
      removed++;
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    releaseDb(conn);
    return removed;
  },

  async productsByIds(ids: number[]): Promise<ProductDto[]> {
    const wanted = new Set(ids.map(Number).filter(Number.isFinite));
    if (wanted.size === 0) return [];
    const conn = await openDb();
    const all = await req<ProductDto[]>(conn.transaction('products').objectStore('products').getAll());
    releaseDb(conn);
    return (all ?? []).filter(p => wanted.has(p.id));
  },

  async saveGroups(groups: ArticleGroupDto[], itemsByGroup: Record<number, ArticleGroupItemDto[]>) {
    const conn = await openDb();
    const gtx = conn.transaction(['groups', 'groupItems'], 'readwrite');
    const gs = gtx.objectStore('groups');
    const is = gtx.objectStore('groupItems');
    gs.clear();
    is.clear();
    for (const g of groups) gs.put(g);
    for (const [id, items] of Object.entries(itemsByGroup)) {
      is.put({ groupId: Number(id), items });
    }
    await new Promise<void>((resolve, reject) => {
      gtx.oncomplete = () => resolve();
      gtx.onerror = () => reject(gtx.error);
    });
    releaseDb(conn);
  },

  async loadGroups(): Promise<ArticleGroupDto[]> {
    const conn = await openDb();
    const list = await req<ArticleGroupDto[]>(conn.transaction('groups').objectStore('groups').getAll());
    releaseDb(conn);
    return list;
  },

  async loadGroupItems(groupId: number): Promise<ArticleGroupItemDto[]> {
    const conn = await openDb();
    const row = await req<{ groupId: number; items: ArticleGroupItemDto[] } | undefined>(
      conn.transaction('groupItems').objectStore('groupItems').get(groupId),
    );
    releaseDb(conn);
    return row?.items ?? [];
  },

  async saveSalesmen(list: SalesmanDto[]) {
    const conn = await openDb();
    const tx = conn.transaction('salesmen', 'readwrite');
    tx.objectStore('salesmen').clear();
    for (const s of list) tx.objectStore('salesmen').put(s);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    releaseDb(conn);
  },

  async loadSalesmen(): Promise<SalesmanDto[]> {
    const conn = await openDb();
    const list = await req<SalesmanDto[]>(conn.transaction('salesmen').objectStore('salesmen').getAll());
    releaseDb(conn);
    return list;
  },

  async saveAccounts(list: AccountSummaryDto[]) {
    const conn = await openDb();
    const tx = conn.transaction('accounts', 'readwrite');
    tx.objectStore('accounts').clear();
    for (const a of list) tx.objectStore('accounts').put(a);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    releaseDb(conn);
  },

  async loadAccounts(): Promise<AccountSummaryDto[]> {
    const conn = await openDb();
    const list = await req<AccountSummaryDto[]>(conn.transaction('accounts').objectStore('accounts').getAll());
    releaseDb(conn);
    return list;
  },

  async savePrintSettings(settings: PrintSettingsDto) {
    const conn = await openDb();
    await req(conn.transaction('print', 'readwrite').objectStore('print').put(settings, 'current'));
    releaseDb(conn);
  },

  async loadPrintSettings(): Promise<PrintSettingsDto | null> {
    const conn = await openDb();
    const v = await req<PrintSettingsDto | undefined>(conn.transaction('print').objectStore('print').get('current'));
    releaseDb(conn);
    return v ?? null;
  },

  async nextLocalNumber(cashierCode = 0): Promise<number> {
    const year = new Date().getFullYear();
    const code = cashierCode > 0 ? cashierCode : 9;
    const key = `offline_receipt_seq_${year}_${code}`;
    const raw = await this.getMeta(key);
    const next = (raw ? Number(raw) : 0) + 1;
    await this.setMeta(key, String(next));
    return formatReceiptNumber(year, code, next);
  },

  async seedReceiptSeq(cashierCode: number, serverSeq: number) {
    if (!serverSeq || serverSeq <= 0) return;
    const year = new Date().getFullYear();
    const code = cashierCode > 0 ? cashierCode : 9;
    const key = `offline_receipt_seq_${year}_${code}`;
    const local = Number((await this.getMeta(key)) ?? '0') || 0;
    if (serverSeq > local) await this.setMeta(key, String(serverSeq));
  },

  async enqueue(row: OutboxRow): Promise<number> {
    const conn = await openDb();
    const id = await req(conn.transaction('outbox', 'readwrite').objectStore('outbox').add(row));
    releaseDb(conn);
    return Number(id);
  },

  async pending(): Promise<OutboxRow[]> {
    const conn = await openDb();
    const list = await req<OutboxRow[]>(conn.transaction('outbox').objectStore('outbox').getAll());
    releaseDb(conn);
    return list.map(r => ({ ...r, status: r.status === 'deferred' ? 'deferred' : 'queued' }));
  },

  async pendingCount(): Promise<number> {
    const conn = await openDb();
    const n = await req(conn.transaction('outbox').objectStore('outbox').count());
    releaseDb(conn);
    return n;
  },

  async updateOutbox(id: number, changes: { payload?: unknown; status?: OutboxStatus; localNumber?: number }) {
    const conn = await openDb();
    const store = conn.transaction('outbox', 'readwrite').objectStore('outbox');
    const row = await req<OutboxRow | undefined>(store.get(id));
    if (row) {
      if (changes.payload !== undefined) row.payload = changes.payload;
      if (changes.status !== undefined) row.status = changes.status;
      if (changes.localNumber !== undefined) row.localNumber = changes.localNumber;
      if (changes.payload !== undefined) row.editedAt = new Date().toISOString();
      await req(store.put(row));
    }
    releaseDb(conn);
  },

  async resetOutboxRetry(id: number) {
    const conn = await openDb();
    const store = conn.transaction('outbox', 'readwrite').objectStore('outbox');
    const row = await req<OutboxRow | undefined>(store.get(id));
    if (row) {
      row.retryCount = 0;
      row.lastError = null;
      await req(store.put(row));
    }
    releaseDb(conn);
  },

  async outboxCounts(deadThreshold = 8): Promise<OutboxCounts> {
    const rows = await this.pending();
    const counts: OutboxCounts = { total: rows.length, queued: 0, deferred: 0, dead: 0 };
    for (const r of rows) {
      if ((r.retryCount ?? 0) >= deadThreshold) counts.dead++;
      else if (r.status === 'deferred') counts.deferred++;
      else counts.queued++;
    }
    return counts;
  },

  async removeOutbox(id: number) {
    const conn = await openDb();
    await req(conn.transaction('outbox', 'readwrite').objectStore('outbox').delete(id));
    releaseDb(conn);
  },

  async markOutboxError(id: number, error: string, permanent = false) {
    const conn = await openDb();
    const store = conn.transaction('outbox', 'readwrite').objectStore('outbox');
    const row = await req<OutboxRow | undefined>(store.get(id));
    if (row) {
      row.retryCount = permanent ? Math.max(row.retryCount, 99) : row.retryCount + 1;
      row.lastError = error.slice(0, 400);
      await req(store.put(row));
    }
    releaseDb(conn);
  },

  async saveLastReceipt(data: unknown) {
    const conn = await openDb();
    await req(conn.transaction('lastReceipt', 'readwrite').objectStore('lastReceipt').put(data, 'last'));
    releaseDb(conn);
  },

  async loadLastReceipt<T>(): Promise<T | null> {
    const conn = await openDb();
    const v = await req<T | undefined>(conn.transaction('lastReceipt').objectStore('lastReceipt').get('last'));
    releaseDb(conn);
    return v ?? null;
  },

  async saveTodayReceipts(list: unknown[]) {
    const conn = await openDb();
    const tx = conn.transaction('todayReceipts', 'readwrite');
    const store = tx.objectStore('todayReceipts');
    store.clear();
    for (const row of list) store.add(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    releaseDb(conn);
  },

  async loadTodayReceipts(): Promise<unknown[]> {
    const conn = await openDb();
    const list = await req<unknown[]>(conn.transaction('todayReceipts').objectStore('todayReceipts').getAll());
    releaseDb(conn);
    return list ?? [];
  },

  async saveDiscountQrPeople(list: DiscountQrPerson[]) {
    const conn = await openDb();
    const tx = conn.transaction('discountQr', 'readwrite');
    tx.objectStore('discountQr').clear();
    for (const row of list) tx.objectStore('discountQr').put(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    releaseDb(conn);
  },

  async loadDiscountQrPeople(): Promise<DiscountQrPerson[]> {
    const conn = await openDb();
    if (!conn.objectStoreNames.contains('discountQr')) {
      releaseDb(conn);
      return [];
    }
    const list = await req<DiscountQrPerson[]>(conn.transaction('discountQr').objectStore('discountQr').getAll());
    releaseDb(conn);
    return list ?? [];
  },
};

export const db = {
  getMeta: (key: string) => nativeStore()?.getMeta(key) ?? idb.getMeta(key),
  setMeta: (key: string, value: string) => nativeStore()?.setMeta(key, value) ?? idb.setMeta(key, value),
  upsertProducts: (products: ProductDto[]) =>
    nativeCatalog()?.syncBatch(products) ?? nativeStore()?.upsertProducts(products) ?? idb.upsertProducts(products),
  findProduct: async (code: string) => {
    const p =
      ((await nativeCatalog()?.findBarcode(code)) as ProductDto | null | undefined) ??
      ((await nativeStore()?.findProduct(code)) as ProductDto | null | undefined) ??
      await idb.findProduct(code);
    return p ? withOfferSalePrice(p) : null;
  },
  searchProducts: async (term: string, limit?: number) =>
    withOfferSalePrices(
      ((await nativeCatalog()?.search(term, limit)) as ProductDto[] | undefined) ??
      ((await nativeStore()?.searchProducts(term, limit)) as ProductDto[] | undefined) ??
      await idb.searchProducts(term, limit),
    ),
  productCount: () => nativeCatalog()?.productCount() ?? nativeStore()?.productCount() ?? idb.productCount(),
  pruneProducts: async (liveIds: number[]) =>
    ((await nativeCatalog()?.prune?.(liveIds)) as number | undefined) ??
    ((await nativeStore()?.pruneProducts?.(liveIds)) as number | undefined) ??
    idb.pruneProducts(liveIds),
  productsByIds: async (ids: number[]) =>
    withOfferSalePrices(
      ((await nativeStore()?.productsByIds?.(ids)) as ProductDto[] | undefined) ??
      await idb.productsByIds(ids),
    ),
  saveGroups: (groups: ArticleGroupDto[], itemsByGroup: Record<number, ArticleGroupItemDto[]>) =>
    nativeStore()?.saveGroups(groups, itemsByGroup) ?? idb.saveGroups(groups, itemsByGroup),
  loadGroups: async () =>
    ((await nativeStore()?.loadGroups()) as ArticleGroupDto[] | undefined) ?? idb.loadGroups(),
  loadGroupItems: async (groupId: number) =>
    withOfferSalePrices(
      ((await nativeStore()?.loadGroupItems(groupId)) as ArticleGroupItemDto[] | undefined) ??
      await idb.loadGroupItems(groupId),
    ),
  saveSalesmen: (list: SalesmanDto[]) => nativeStore()?.saveSalesmen(list) ?? idb.saveSalesmen(list),
  loadSalesmen: async () =>
    ((await nativeStore()?.loadSalesmen()) as SalesmanDto[] | undefined) ?? idb.loadSalesmen(),
  saveAccounts: (list: AccountSummaryDto[]) => nativeStore()?.saveAccounts(list) ?? idb.saveAccounts(list),
  loadAccounts: async () =>
    ((await nativeStore()?.loadAccounts()) as AccountSummaryDto[] | undefined) ?? idb.loadAccounts(),
  savePrintSettings: (settings: PrintSettingsDto) =>
    nativeStore()?.savePrintSettings(settings) ?? idb.savePrintSettings(settings),
  loadPrintSettings: async () =>
    ((await nativeStore()?.loadPrintSettings()) as PrintSettingsDto | null | undefined) ?? idb.loadPrintSettings(),
  nextLocalNumber: (cashierCode?: number) =>
    nativeStore()?.nextLocalNumber?.(cashierCode) ?? idb.nextLocalNumber(cashierCode),
  seedReceiptSeq: (cashierCode: number, serverSeq: number) =>
    nativeStore()?.seedReceiptSeq?.(cashierCode, serverSeq) ?? idb.seedReceiptSeq(cashierCode, serverSeq),
  enqueue: (row: OutboxRow) => nativeOutbox()?.enqueue(row) ?? nativeStore()?.enqueue(row) ?? idb.enqueue(row),
  pending: async () =>
    ((await nativeOutbox()?.list()) as OutboxRow[] | undefined) ??
    ((await nativeStore()?.pending()) as OutboxRow[] | undefined) ??
    idb.pending(),
  pendingCount: () => nativeOutbox()?.count() ?? nativeStore()?.pendingCount() ?? idb.pendingCount(),
  removeOutbox: (id: number) => nativeOutbox()?.markSynced(id) ?? nativeStore()?.removeOutbox(id) ?? idb.removeOutbox(id),
  markOutboxError: (id: number, error: string, permanent = false) =>
    nativeOutbox()?.markError(id, error, permanent)
    ?? nativeStore()?.markOutboxError(id, error, permanent)
    ?? idb.markOutboxError(id, error, permanent),
  updateOutbox: (id: number, changes: { payload?: unknown; status?: OutboxStatus; localNumber?: number }) =>
    nativeOutbox()?.update?.(id, changes)
    ?? nativeStore()?.updateOutbox?.(id, changes)
    ?? idb.updateOutbox(id, changes),
  resetOutboxRetry: (id: number) =>
    nativeOutbox()?.resetRetry?.(id) ?? nativeStore()?.resetOutboxRetry?.(id) ?? idb.resetOutboxRetry(id),
  outboxCounts: () =>
    nativeOutbox()?.counts?.() ?? nativeStore()?.outboxCounts?.() ?? idb.outboxCounts(),
  saveLastReceipt: (data: unknown) => nativeStore()?.saveLastReceipt(data) ?? idb.saveLastReceipt(data),
  loadLastReceipt: async <T>() =>
    ((await nativeStore()?.loadLastReceipt()) as T | null | undefined) ?? idb.loadLastReceipt<T>(),
  saveTodayReceipts: (list: unknown[]) =>
    nativeStore()?.saveTodayReceipts?.(list) ?? idb.saveTodayReceipts(list),
  loadTodayReceipts: async () =>
    ((await nativeStore()?.loadTodayReceipts?.()) as unknown[] | undefined) ?? idb.loadTodayReceipts(),
  saveDiscountQrPeople: (list: DiscountQrPerson[]) => idb.saveDiscountQrPeople(list),
  loadDiscountQrPeople: () => idb.loadDiscountQrPeople(),
};
