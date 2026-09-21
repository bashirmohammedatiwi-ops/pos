import { useEffect, useRef } from 'react';

/** USB scanner: rapid keystrokes outside inputs, same 80ms flush as WPF. */
export function useBarcodeCapture(active: boolean, onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return;
    let buffer = '';
    let last = 0;
    let timer = 0;

    const flush = () => {
      window.clearTimeout(timer);
      const code = buffer.trim();
      buffer = '';
      if (code.length < 3) return;
      onScanRef.current(code);
    };

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.startsWith('F') && e.key.length <= 3) return;

      const now = Date.now();
      if (now - last > 140) buffer = '';
      last = now;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          e.preventDefault();
          flush();
        }
        return;
      }
      if (e.key.length !== 1) return;
      buffer += e.key;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 80);
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
    };
  }, [active]);
}
