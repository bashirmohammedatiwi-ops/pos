const BANNED_KEY = /cashier|كاشير|cash_name|cashiername|cashierid|mallname|mallcount|^malls$|sectionname|sectionid|branchname/i;

export function scrubSellerPayload<T>(value: T): T {
  return scrub(value) as T;
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (BANNED_KEY.test(key)) continue;
    if (key === 'salesAmount' || key === 'SalesAmount') {
      out[key] = 0;
      continue;
    }
    out[key] = scrub(raw);
  }
  return out;
}
