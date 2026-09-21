import type { CardChargeResult } from '@/api/types';

export async function chargeCard(
  amount: number,
  service?: string | null,
  comPort?: string | null,
): Promise<CardChargeResult> {
  if (window.fotDesktop?.cardCharge) {
    return window.fotDesktop.cardCharge({ amount, service, comPort }) as Promise<CardChargeResult>;
  }
  return { ok: false, message: 'الدفع بالبطاقة متاح من تطبيق Electron فقط' };
}

export function formatCardError(message: string, cancelledByDevice?: boolean): string {
  if (cancelledByDevice) return 'تم إلغاء العملية من جهاز الدفع';
  const m = message.trim();
  if (!m) return 'تعذّر إتمام الدفع — تحقق من جهاز PAX والاتصال';
  if (m.includes('Electron') || m.includes('electron')) {
    return 'الدفع بالبطاقة يعمل من تطبيق الكاشير المثبّت فقط';
  }
  if (/connect\s*device|device\s*(is\s*)?not\s*connect|not\s*connected|no\s*device/i.test(m)) {
    return 'جهاز الدفع غير مرتبط بالخدمة — تحقق من كبل USB وتشغيل خدمة PAX ثم أعد المحاولة';
  }
  if (m.includes('timeout') || m.toLowerCase().includes('timeout') || m.includes('انتهت')) {
    return 'انتهت مهلة جهاز الدفع — أعد المحاولة أو تحقق من الجهاز';
  }
  if (m.toLowerCase().includes('cancel') || m.includes('إلغ')) {
    return 'تم إلغاء العملية من جهاز الدفع';
  }
  return m;
}

export function cardPayDelay(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms));
}

/** Long enough for the cashier to register the approval, short enough not to stall the sale. */
export const CARD_APPROVED_HOLD_MS = 250;
