import type { CatalogInfoDto, ProductDto } from '@fot/shared';
import { getApiBase } from '@/lib/apiBase';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function request<T>(path: string, timeoutMs = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const base = getApiBase();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', (base || '') + path, true);
    xhr.timeout = timeoutMs;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 404) {
        reject(new ApiError(404, 'غير موجود'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new ApiError(xhr.status, 'تعذر الطلب'));
        }
        return;
      }
      reject(new ApiError(xhr.status || 0, xhr.status ? 'تعذر الطلب' : 'تعذر الاتصال بالخادم'));
    };
    xhr.ontimeout = () => reject(new ApiError(0, 'تعذر الاتصال بالخادم'));
    xhr.onerror = () => reject(new ApiError(0, 'تعذر الاتصال بالخادم'));
    xhr.send();
  });
}

type StoreProduct = {
  id: number;
  sku?: string | null;
  barcode?: string | null;
  name?: string | null;
  quantity?: number;
  listPrice?: number;
  salePrice?: number;
  offerPercent?: number;
  offerName?: string | null;
  revision?: number;
  originalPrice?: number;
  price?: number;
  seq?: number;
  changeVersion?: number;
};

function asProduct(raw: StoreProduct): ProductDto {
  if (raw.originalPrice != null && raw.listPrice == null) return raw as ProductDto;
  return {
    id: raw.id,
    seq: raw.seq || raw.id,
    num: raw.sku ?? null,
    name: raw.name ?? null,
    barcode: raw.barcode ?? null,
    originalPrice: Number(raw.listPrice ?? raw.salePrice ?? 0),
    price: Number(raw.salePrice ?? raw.listPrice ?? 0),
    stock: Number(raw.quantity ?? 0),
    discountPercent: Number(raw.offerPercent ?? 0),
    offerName: raw.offerName ?? null,
    changeVersion: Number(raw.revision ?? raw.changeVersion ?? 0),
  };
}

async function prefer<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status >= 500)) return fallback();
    throw error;
  }
}

export const api = {
  health: () => request<{ status?: string }>('/health', 800),
  productByBarcode: (code: string) =>
    prefer(
      () => request<StoreProduct>('/api/v1/catalog/lookup?code=' + encodeURIComponent(code), 1200).then(asProduct),
      () => request<ProductDto>('/api/price-checker/product?code=' + encodeURIComponent(code), 1200),
    ),
  catalogInfo: () =>
    prefer(
      () => request<{ revision: number; productCount: number }>('/api/v1/catalog/version', 4000).then(v => ({
        totalProducts: v.productCount,
        maxSeq: v.revision,
      })),
      () => request<CatalogInfoDto>('/api/price-checker/catalog/info', 4000),
    ),
  catalogSync: (sinceSeq: number) =>
    prefer(
      () => request<{ items?: StoreProduct[] }>('/api/v1/catalog/changes?since=' + sinceSeq + '&limit=2000', 20_000)
        .then(page => (page.items ?? []).map(asProduct)),
      () => request<ProductDto[]>('/api/price-checker/catalog/sync?sinceSeq=' + sinceSeq + '&pageSize=500', 20_000),
    ),
  catalogIds: () =>
    prefer(
      () => request<{ total: number; ids: number[] }>('/api/v1/catalog/ids', 20_000),
      () => request<{ total: number; ids: number[] }>('/api/price-checker/catalog/ids', 20_000),
    ),
};
