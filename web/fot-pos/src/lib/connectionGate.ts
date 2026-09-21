const KEY = 'fot_pos_lan_ok';
export const LAN_STATUS_EVENT = 'fot-pos-lan';

function readStored(): boolean | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {
    /* private mode */
  }
  return null;
}

function persist(ok: boolean) {
  try {
    localStorage.setItem(KEY, ok ? '1' : '0');
  } catch {
    /* private mode */
  }
}

function emit(ok: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LAN_STATUS_EVENT, { detail: { ok } }));
}

let unreachable = readStored() !== true;
let lastOkAt = 0;

/** Last persisted LAN result — used so a dead server does not start the UI as "online". */
export function lastKnownReachable(): boolean {
  return readStored() === true;
}

export function isServerUnreachable(): boolean {
  return unreachable;
}

/**
 * Cashier paths that already have a local mirror must not wait on a dead API.
 * A success this session is required — yesterday's "online" flag is not enough.
 */
export function canUseServer(online: boolean): boolean {
  if (!online || unreachable || lastOkAt <= 0) return false;
  return Date.now() - lastOkAt < 15_000;
}

export function markServerReachable() {
  lastOkAt = Date.now();
  if (!unreachable && readStored() === true) return;
  unreachable = false;
  persist(true);
  emit(true);
}

export function markServerUnreachable() {
  if (unreachable && readStored() === false) return;
  unreachable = true;
  persist(false);
  emit(false);
}
