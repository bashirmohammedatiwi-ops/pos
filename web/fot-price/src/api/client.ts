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

export const api = {
  health: () => request<{ status?: string }>('/health', 800),
  productByBarcode: (code: string) =>
    request<ProductDto>('/api/price-checker/product?code=' + encodeURIComponent(code), 1200),
  catalogInfo: () => request<CatalogInfoDto>('/api/price-checker/catalog/info', 4000),
  catalogSync: (sinceSeq: number) =>
    request<ProductDto[]>('/api/price-checker/catalog/sync?sinceSeq=' + sinceSeq + '&pageSize=500', 20_000),
  catalogIds: () => request<{ total: number; ids: number[] }>('/api/price-checker/catalog/ids', 20_000),
};
