/** Reference-counted body scroll lock — avoids stuck overflow when nested modals close out of order. */

let lockCount = 0;
let savedOverflow = '';

export function acquireScrollLock(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow;
    }
  };
}

export function forceReleaseScrollLock() {
  lockCount = 0;
  document.body.style.overflow = '';
}
