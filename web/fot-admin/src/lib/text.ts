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

/** Clean NexusDB replacement chars and apply mojibake fix for Edari tree/account names */
export function fixEdariName(text?: string | null): string {
  if (!text) return '';
  const stripped = text.replace(/\uFFFD/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return fixUtf8Mojibake(stripped);
}

export function userDisplayLabel(user: { username: string; displayName?: string | null } | null | undefined): string {
  if (!user) return '';
  const fixed = fixUtf8Mojibake(user.displayName?.trim() ?? '');
  if (fixed && /[\u0600-\u06FFa-zA-Z]{2,}/u.test(fixed)) return fixed;
  return user.username;
}

export function normalizeUser<T extends { displayName?: string | null }>(user: T): T {
  const displayName = user.displayName?.trim();
  if (!displayName) return user;
  const fixed = fixUtf8Mojibake(displayName);
  return fixed === displayName ? user : { ...user, displayName: fixed };
}
