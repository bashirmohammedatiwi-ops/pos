const ECHO_MS = 350;

/** Cheap wedges sometimes emit the same code twice in one burst. */
export function collapseRepeatedScan(code: string): string {
  const text = code.trim();
  if (text.length >= 16 && text.length % 2 === 0) {
    const mid = text.length / 2;
    const left = text.slice(0, mid);
    const right = text.slice(mid);
    if (left === right && left.length >= 8) return left;
  }
  return text;
}

export function createScanEchoGuard(windowMs = ECHO_MS) {
  let lastKey = '';
  let lastAt = 0;
  return (code: string, qty = 1) => {
    const now = Date.now();
    const key = `${qty}\t${code}`;
    if (key === lastKey && now - lastAt < windowMs) return true;
    lastKey = key;
    lastAt = now;
    return false;
  };
}
