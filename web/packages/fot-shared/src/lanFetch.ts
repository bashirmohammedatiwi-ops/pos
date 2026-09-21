export async function fetchLan(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  retries = 1,
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 30_000;
  const rest = { ...init };
  delete rest.timeoutMs;
  const method = (rest.method || 'GET').toUpperCase();
  const max = method === 'GET' || method === 'HEAD' ? Math.max(0, retries) : 0;
  let last: unknown;

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        credentials: rest.credentials ?? 'omit',
        signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 502 && res.status <= 504 && attempt < max) {
        await delay(250 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      if (attempt >= max) throw e;
      await delay(250 * (attempt + 1));
    }
  }

  throw last instanceof Error ? last : new Error('تعذر الاتصال بالخادم');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
