/** Coalesce rapid SignalR catalog events into one POS sync run. */
export function createDebouncedSync(run: () => void | Promise<void>, delayMs = 1200) {
  let timer: number | null = null;
  let pending = false;

  return () => {
    pending = true;
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      if (!pending) return;
      pending = false;
      void run();
    }, delayMs);
  };
}
