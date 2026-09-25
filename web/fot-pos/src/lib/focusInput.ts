import type { FocusEvent, MouseEvent } from 'react';

/** Caret at visual right: end for LTR numbers, start for RTL text. */
export function placeCaretAtVisualRight(el: HTMLInputElement | HTMLTextAreaElement | null | undefined) {
  if (!el) return;
  const len = el.value.length;
  const dir = el.dir || getComputedStyle(el).direction;
  const pos = dir === 'rtl' ? 0 : len;
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* some input types skip selection APIs */
  }
}

export function onInputFocusVisualRight(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  requestAnimationFrame(() => placeCaretAtVisualRight(el));
}

export function onInputClickVisualRight(e: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  requestAnimationFrame(() => placeCaretAtVisualRight(el));
}

export function focusInputVisualRight(el: HTMLInputElement | null | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  requestAnimationFrame(() => placeCaretAtVisualRight(el));
}
