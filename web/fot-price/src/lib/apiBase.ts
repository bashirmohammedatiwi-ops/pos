const STORAGE_KEY = 'fot_price_api_base';
export const DEFAULT_API_PORT = '5000';

export type ApiBaseParts = {
  host: string;
  port: string;
};

export function parseApiBase(url: string): ApiBaseParts {
  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`);
    return {
      host: parsed.hostname || '',
      port: parsed.port || DEFAULT_API_PORT,
    };
  } catch {
    return { host: '', port: DEFAULT_API_PORT };
  }
}

export function buildApiBase(parts: ApiBaseParts): string {
  const host = parts.host.trim();
  if (!host) return '';
  const port = (parts.port.trim() || DEFAULT_API_PORT).replace(/\D/g, '').slice(0, 5) || DEFAULT_API_PORT;
  return `http://${host}:${port}`;
}

export function canonicalizeApiBase(url: string): string {
  return buildApiBase(parseApiBase(url));
}

function sameOriginHosted(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  if (protocol === 'file:') return false;
  if (hostname === 'appassets.androidplatform.net') return false;
  return protocol === 'http:' || protocol === 'https:';
}

export function needsServerSetup(): boolean {
  if (getApiBase()) return false;
  return !import.meta.env.DEV && !sameOriginHosted();
}

export function getApiBase(): string {
  try {
    const native = window.fotPriceNative?.getApiBase?.();
    if (native) return canonicalizeApiBase(native);
  } catch {
    /* ignore */
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return canonicalizeApiBase(stored);
  const env = import.meta.env.VITE_API_URL;
  if (env) return canonicalizeApiBase(String(env));
  if (import.meta.env.DEV || sameOriginHosted()) return '';
  return '';
}

export function setApiBase(url: string | null) {
  if (!url) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const clean = canonicalizeApiBase(url);
  localStorage.setItem(STORAGE_KEY, clean);
  try {
    window.fotPriceNative?.setApiBase?.(clean);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('fot-price-api-changed', { detail: clean }));
}

export async function testApiConnection(url?: string): Promise<{ ok: boolean; url: string; message: string }> {
  const target = canonicalizeApiBase(url || getApiBase());
  if (!target) return { ok: false, url: '', message: 'أدخل عنوان الخادم أولاً' };
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', target + '/health', true);
      xhr.timeout = 2500;
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(String(xhr.status)));
      };
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.onerror = () => reject(new Error('net'));
      xhr.send();
    });
    return { ok: true, url: target, message: 'الاتصال ناجح' };
  } catch (e) {
    const msg = e instanceof Error && /^\d+$/.test(e.message)
      ? ('الخادم ردّ برمز ' + e.message)
      : 'تعذر الوصول — تأكد من IP والمنفذ وأن الخادم يعمل';
    return { ok: false, url: target, message: msg };
  }
}
