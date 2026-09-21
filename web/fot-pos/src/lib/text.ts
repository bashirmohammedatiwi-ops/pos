/** UTF-8 Arabic misread as Latin-1 (e.g. ظ…ط¯ظٹط± → مدير) */
export function fixUtf8Mojibake(text: string): string {
  if (!text) return text;
  if (/^[\u0600-\u06FF\s\u0660-\u0669.,\-_]+$/u.test(text)) return text;

  try {
    const bytes = Uint8Array.from(text, ch => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8').decode(bytes);
    if (decoded !== text && /[\u0600-\u06FF]{2,}/u.test(decoded)) return decoded;
  } catch {
    /* keep original */
  }
  return text;
}

export function fixEdariName(text?: string | null): string {
  if (!text) return '';
  const stripped = text.replace(/\uFFFD/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return fixUtf8Mojibake(stripped);
}

/**
 * Local-time ISO-like string (no timezone suffix). toISOString() shifts to UTC, which
 * moves the local midnight boundary back 3 hours and leaks yesterday's evening
 * receipts into "today" queries against the server's local-time creation_date.
 */
export function localDateTimeIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
