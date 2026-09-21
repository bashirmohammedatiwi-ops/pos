import type { ProductDto } from '@fot/shared';

const DB_NAME = 'fot-price';
const DB_VERSION = 1;

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
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
  });
  return openingDb;
}

function cursorFirst<T>(index: IDBIndex, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const r = index.openCursor(key);
    r.onsuccess = () => resolve((r.result?.value as T) ?? null);
    r.onerror = () => reject(r.error);
  });
}

function cursorKeys(store: IDBObjectStore): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const keys: IDBValidKey[] = [];
    const r = store.openCursor();
    r.onsuccess = () => {
      const cursor = r.result;
      if (!cursor) {
        resolve(keys);
        return;
      }
      keys.push(cursor.key);
      cursor.continue();
    };
    r.onerror = () => reject(r.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const db = {
  async getMeta(key: string): Promise<string | null> {
    const conn = await openDb();
    const v = await req(conn.transaction('meta').objectStore('meta').get(key));
    return typeof v === 'string' ? v : v == null ? null : String(v);
  },

  async setMeta(key: string, value: string) {
    const conn = await openDb();
    await req(conn.transaction('meta', 'readwrite').objectStore('meta').put(value, key));
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
  },

  async findProduct(code: string): Promise<ProductDto | null> {
    const trimmed = code.trim();
    const conn = await openDb();
    const store = conn.transaction('products').objectStore('products');
    const byBarcode = await cursorFirst<ProductDto>(store.index('barcode'), trimmed);
    if (byBarcode) return byBarcode;
    return cursorFirst<ProductDto>(store.index('num'), trimmed);
  },

  async productCount(): Promise<number> {
    const conn = await openDb();
    return req(conn.transaction('products').objectStore('products').count());
  },

  async pruneProducts(liveIds: number[]): Promise<number> {
    const keep = new Set(liveIds.map(Number));
    const conn = await openDb();
    const tx = conn.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    const existing = await cursorKeys(store);
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
    return removed;
  },
};
