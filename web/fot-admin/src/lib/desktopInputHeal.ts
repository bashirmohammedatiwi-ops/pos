/** Electron on Windows can drop keyboard/caret focus after hide, sleep, or lock. */

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

function fieldFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const found = target.closest('input, textarea, select, [contenteditable="true"]');
  return found instanceof HTMLElement ? found : null;
}

export function installDesktopInputHeal() {
  if (typeof window === 'undefined' || !window.fotDesktop) return () => undefined;

  const restore = (field?: HTMLElement | null) => {
    try { window.focus(); } catch { /* ignore */ }
    const next = field ?? (isEditable(document.activeElement) ? document.activeElement : null);
    if (!next) return;
    try { next.focus({ preventScroll: true }); } catch { next.focus(); }
  };

  const onPointer = (event: PointerEvent) => {
    const field = fieldFrom(event.target);
    if (!field) return;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== field) restore(field);
    });
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') restore();
  };

  window.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);

  return () => {
    window.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onVisibility);
  };
}
