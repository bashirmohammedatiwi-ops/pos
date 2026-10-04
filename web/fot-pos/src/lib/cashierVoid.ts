import { api } from '@/api/client';

export type CashierVoidLine = {
  name?: string | null;
  barcode?: string | null;
  quantity: number;
  amount: number;
};

export type CashierVoidBody = {
  kind: 'line' | 'invoice';
  productName?: string | null;
  barcode?: string | null;
  quantity?: number;
  amount?: number;
  lineCount?: number;
  receiptNum?: string | null;
  source?: string | null;
  lines?: CashierVoidLine[];
};

const KEY = 'fot-pos-void-queue';
let flushing = false;

function readQueue(): CashierVoidBody[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: CashierVoidBody[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(-200)));
}

/** Records a deleted line or a cancelled invoice. Offline posts wait and retry later. */
export function recordCashierVoid(body: CashierVoidBody) {
  writeQueue([...readQueue(), body]);
  void flushCashierVoids();
}

export async function flushCashierVoids() {
  if (flushing) return;
  flushing = true;
  try {
    while (readQueue().length > 0) {
      const next = readQueue()[0];
      await api.recordVoid(next);
      const current = readQueue();
      current.shift();
      writeQueue(current);
    }
  } catch {
    // Leave the queue. The next delete or the next app open retries.
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.setTimeout(() => { void flushCashierVoids(); }, 1500);
}
