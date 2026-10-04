import { fixEdariName } from '@/lib/text';

/** اسم للنطق فقط — بدون رقم في البداية وبدون أي أرقام. */
export function salesmanSpokenLabel(raw?: string | null): string {
  let name = fixEdariName(raw).trim();
  if (!name) return '';

  name = name.replace(/^\s*[#٪%]?\s*[\d\u0660-\u0669\u06F0-\u06F9]+\s*[-–—.:،/\\|]+\s*/u, '');
  name = name.replace(/^\s*[\d\u0660-\u0669\u06F0-\u06F9]+\s+/u, '');
  name = name.replace(/[\d\u0660-\u0669\u06F0-\u06F9]+/gu, '');
  name = name.replace(/[#٪%]/gu, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/^[-–—.:،/\\|]+|[-–—.:،/\\|]+$/g, '').trim();
  return name;
}

/** ينطق اسم البائع عبر Piper TTS المدمج في تطبيق Electron (لا يعتمد على Windows Speech). */
export function speakSalesmanName(rawName?: string | null) {
  const name = salesmanSpokenLabel(rawName);
  if (!name) return;
  void window.fotDesktop?.speakSalesmanName?.(name);
}

export function stopSpeaking() {
  void window.fotDesktop?.stopSpeaking?.();
}
