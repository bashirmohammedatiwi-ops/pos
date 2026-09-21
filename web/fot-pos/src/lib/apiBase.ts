import { useEffect, useState } from 'react';
import { db } from './db';

const STORAGE_KEY = 'fot_pos_api_base';
const PARTS_KEY = 'fot_pos_api_parts';
export const DEFAULT_API_PORT = '5000';

export type ApiBaseParts = {
  protocol: 'http' | 'https';
  host: string;
  port: string;
};

export function parseApiBase(url: string): ApiBaseParts {
  const fallback: ApiBaseParts = { protocol: 'http', host: '127.0.0.1', port: DEFAULT_API_PORT };
  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`);
    const protocol = parsed.protocol === 'https:' ? 'https' : 'http';
    return {
      protocol,
      host: parsed.hostname || fallback.host,
      port: parsed.port || (protocol === 'https' ? '443' : DEFAULT_API_PORT),
    };
  } catch {
    return fallback;
  }
}

/** Always keep the port in the saved URL so it never collapses to browser-default 80. */
export function buildApiBase(parts: ApiBaseParts): string {
  const host = parts.host.trim();
  if (!host) return '';
  const protocol = parts.protocol === 'https' ? 'https' : 'http';
  const port = (parts.port.trim() || DEFAULT_API_PORT).replace(/\D/g, '').slice(0, 5) || DEFAULT_API_PORT;
  return `${protocol}://${host}:${port}`;
}

export function canonicalizeApiBase(url: string): string {
  return buildApiBase(parseApiBase(url || `http://127.0.0.1:${DEFAULT_API_PORT}`));
}

export function getApiBase(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return canonicalizeApiBase(stored);

  try {
    const raw = localStorage.getItem(PARTS_KEY);
    if (raw) {
      const built = buildApiBase(JSON.parse(raw) as ApiBaseParts);
      if (built) return built;
    }
  } catch {
    /* ignore */
  }

  const env = import.meta.env.VITE_API_URL;
  if (env) return canonicalizeApiBase(String(env));

  if (typeof window !== 'undefined' && window.fotDesktop) {
    return `http://127.0.0.1:${DEFAULT_API_PORT}`;
  }

  return '';
}

export function setApiBase(url: string | null) {
  if (!url) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PARTS_KEY);
    return;
  }
  const clean = canonicalizeApiBase(url);
  localStorage.setItem(STORAGE_KEY, clean);
  localStorage.setItem(PARTS_KEY, JSON.stringify(parseApiBase(clean)));
}

export async function persistApiBase(url: string): Promise<string> {
  const clean = canonicalizeApiBase(url);
  if (!clean) return '';
  setApiBase(clean);
  try {
    await window.fotDesktop?.setApiBase?.(clean);
  } catch {
    /* disk write is best-effort; localStorage already has the value */
  }
  try {
    await db.setMeta('api_base', clean);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('fot-api-base-changed', { detail: clean }));
  return clean;
}

export async function hydrateApiBase(): Promise<string> {
  let desktop: string | null = null;
  try {
    desktop = (await window.fotDesktop?.getApiBase?.()) ?? null;
  } catch {
    desktop = null;
  }
  let meta: string | null = null;
  try {
    meta = await db.getMeta('api_base');
  } catch {
    meta = null;
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  let fromParts = '';
  try {
    const raw = localStorage.getItem(PARTS_KEY);
    if (raw) fromParts = buildApiBase(JSON.parse(raw) as ApiBaseParts);
  } catch {
    fromParts = '';
  }

  const chosen = stored || fromParts || desktop || meta || getApiBase() || `http://127.0.0.1:${DEFAULT_API_PORT}`;
  return persistApiBase(chosen);
}

export async function testApiConnection(url?: string): Promise<{
  ok: boolean;
  url: string;
  ms: number;
  message: string;
}> {
  const target = canonicalizeApiBase(url || getApiBase());
  const started = Date.now();
  try {
    const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(4000) });
    const ms = Date.now() - started;
    if (res.ok) {
      return { ok: true, url: target, ms, message: `الاتصال ناجح — ${ms} مللي ثانية` };
    }
    return { ok: false, url: target, ms, message: `الخادم ردّ برمز ${res.status}` };
  } catch {
    return {
      ok: false,
      url: target,
      ms: Date.now() - started,
      message: 'تعذر الوصول — تأكد من عنوان IP والمنفذ 5000 وأن الخادم يعمل',
    };
  }
}

export function getHubUrl(): string {
  return `${getApiBase()}/hubs/pos`;
}

export function useApiBaseSync() {
  const [base, setBase] = useState(() => getApiBase());
  useEffect(() => {
    const apply = (url: string) => {
      const clean = canonicalizeApiBase(url);
      setApiBase(clean);
      setBase(clean);
    };
    const onCustom = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (url) apply(url);
    };
    window.addEventListener('fot-api-base-changed', onCustom);
    const unsub = window.fotDesktop?.onApiBaseChanged?.(url => apply(url));
    return () => {
      window.removeEventListener('fot-api-base-changed', onCustom);
      unsub?.();
    };
  }, []);
  return base;
}
