const LOCALE = 'en-US';

export function formatNum(n: number, maxDecimals = 0) {
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: maxDecimals > 0 ? 0 : undefined,
  }).format(Number.isFinite(n) ? n : 0);
}

export function formatIqd(n: number) {
  return `${formatNum(Math.round(n))} د.ع`;
}

const HW_KEY = 'fot_pos_hwid';

export async function resolveHwId(): Promise<string> {
  const desktop = typeof window !== 'undefined'
    ? (window as Window & { fotDesktop?: { hwId?: () => Promise<string> } }).fotDesktop
    : undefined;
  if (desktop?.hwId) {
    const id = await desktop.hwId();
    if (id) {
      localStorage.setItem(HW_KEY, id);
      return id;
    }
  }
  let id = localStorage.getItem(HW_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(HW_KEY, id);
  }
  return id;
}

/** Cached / local fallback. Prefer resolveHwId() when a machine id is required. */
export function getHwId() {
  return localStorage.getItem(HW_KEY) ?? '';
}
