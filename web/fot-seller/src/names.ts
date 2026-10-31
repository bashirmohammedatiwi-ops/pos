/** أسماء الموظفين في النظام تبدأ أحياناً برقم («1- شيماء»): يُخفى في واجهة التطبيق */
export const cleanName = (name?: string | null) => (name || '').replace(/^\s*\d+\s*-\s*/, '').trim() || name || '';

/** يطبّق cleanName على ردود الخادم: أسماء الأشخاص فقط، لا المنتجات والشبكات */
export function cleanNames<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cleanNames) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  const person = 'staffId' in src || 'salesmanId' in src || 'key' in src || 'code' in src;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string' && (k === 'staffName' || k === 'salesmanName' || k === 'senderName' || (k === 'name' && person))) out[k] = cleanName(v);
    else out[k] = v && typeof v === 'object' ? cleanNames(v) : v;
  }
  return out as T;
}
