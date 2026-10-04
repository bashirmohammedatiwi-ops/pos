import { forceReleaseScrollLock } from '@/lib/scrollLock';

/** Clears transient UI locks that can block clicks/typing after navigation or a stuck overlay. */
export function resetTransientUiState() {
  forceReleaseScrollLock();
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.dispatchEvent(new CustomEvent('fot-admin-reset-overlays'));
}
