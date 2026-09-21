import { useEffect, useState } from 'react';

const STORAGE_KEY = 'fot_admin_api_base';

/** Resolve API origin: env → localStorage override → same-origin (LAN via server port 5000). */
export function getApiBase(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored.replace(/\/$/, '');

  const env = import.meta.env.VITE_API_URL;
  if (env) return String(env).replace(/\/$/, '');

  if (typeof window !== 'undefined' && window.fotDesktop) {
    return 'http://127.0.0.1:5000';
  }

  return '';
}

export function setApiBase(url: string | null) {
  if (!url) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''));
}

export function persistApiBase(url: string) {
  const clean = url.replace(/\/$/, '');
  setApiBase(clean);
  void window.fotDesktop?.setApiBase?.(clean);
}

export async function hydrateApiBase(): Promise<string> {
  const fromDesktop = await window.fotDesktop?.getApiBase?.();
  if (fromDesktop) {
    setApiBase(fromDesktop);
    return fromDesktop.replace(/\/$/, '');
  }
  return getApiBase();
}

export function getHubUrl(): string {
  const base = getApiBase();
  return `${base}/hubs/pos`;
}

export function useApiBaseSync() {
  const [base, setBase] = useState(() => getApiBase());
  useEffect(() => {
    return window.fotDesktop?.onApiBaseChanged?.(url => {
      const clean = url.replace(/\/$/, '');
      setApiBase(clean);
      setBase(clean);
      window.dispatchEvent(new CustomEvent('fot-api-base-changed', { detail: clean }));
    });
  }, []);
  return base;
}
