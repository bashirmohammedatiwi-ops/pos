/**
 * Lightweight client-side error reporter for both the admin dashboard and POS terminals.
 *
 * - Errors are queued in localStorage (survives reloads/crashes) and flushed in batches.
 * - Rate capped so a render loop bug can never flood the server.
 * - Silent in development and whenever no API base is resolvable.
 */

const QUEUE_KEY = 'fot_error_queue_v1';
const MAX_QUEUE = 60;
const MAX_PER_MINUTE = 50;
const FLUSH_INTERVAL_MS = 30_000;

export interface ErrorReport {
  message: string;
  stack?: string;
  context?: string;
  terminal?: string;
  appVersion?: string;
}

interface QueuedError extends ErrorReport {
  at: number;
}

export interface ErrorReporterOptions {
  source: 'admin' | 'pos';
  getApiBase: () => string;
  getToken?: () => string | null;
  getTerminal?: () => string | null;
  getAppVersion?: () => string;
  isDev?: boolean;
}

let flushTimer: number | ReturnType<typeof setInterval> | null = null;
let sentThisMinute = 0;
let minuteWindowStart = Date.now();
let options: ErrorReporterOptions | null = null;

function loadQueue(): QueuedError[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as QueuedError[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedError[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* storage full or unavailable — drop silently */
  }
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** Initialize the reporter and install global handlers. Safe to call more than once. */
export function initErrorReporter(opts: ErrorReporterOptions) {
  options = opts;

  if (opts.isDev) return; // noisy in dev — errors stay in the console
  if (typeof window === 'undefined') return;

  window.addEventListener('error', event => {
    reportError(event.error ?? event.message, {
      context: `${event.filename}:${event.lineno}:${event.colno}`,
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    reportError(
      reason instanceof Error ? reason : String(reason ?? 'unhandled rejection'),
    );
  });

  if (flushTimer == null) {
    flushTimer = setInterval(() => void flushErrors(), FLUSH_INTERVAL_MS);
    // also flush when the tab closes gracefully
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushErrors();
    });
  }
}

/** Queue an error for reporting (manual call sites: ErrorBoundary, caught edge cases). */
export function reportError(error: unknown, extra?: { context?: string; stack?: string }) {
  if (!options || options.isDev) return;

  const message =
    error instanceof Error ? error.message : truncate(String(error ?? 'unknown'), 2000) ?? 'unknown';
  const stack = extra?.stack ?? (error instanceof Error ? error.stack : undefined);

  const queue = loadQueue();
  // dedupe identical consecutive messages within the last minute
  const now = Date.now();
  const dup = queue.some(q => q.message === message && now - q.at < 60_000);
  if (dup) return;

  queue.push({
    message: truncate(message, 2000) ?? 'unknown',
    stack: truncate(stack ?? extra?.context, 16_000),
    context: truncate(extra?.context, 4000),
    terminal: options.getTerminal?.() ?? undefined,
    appVersion: options.getAppVersion?.(),
    at: now,
  });
  saveQueue(queue);
}

/** Send queued errors now; rate capped and failure-tolerant (keeps the queue). */
export async function flushErrors(): Promise<void> {
  if (!options) return;

  // rate cap: no more than MAX_PER_MINUTE reports per minute
  const now = Date.now();
  if (now - minuteWindowStart > 60_000) {
    minuteWindowStart = now;
    sentThisMinute = 0;
  }
  if (sentThisMinute >= MAX_PER_MINUTE) return;

  const queue = loadQueue();
  if (queue.length === 0) return;

  const errors = queue.splice(0, 20).map(({ at: _at, ...rest }) => rest);
  saveQueue(queue);

  try {
    const base = options.getApiBase().replace(/\/$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-FOT-Source': options.source,
    };
    const token = options.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${base}/api/telemetry/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ errors }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      sentThisMinute += errors.length;
    } else {
      // server rejected — re-queue at the back, but avoid infinite growth
      const remaining = loadQueue();
      saveQueue([...remaining, ...errors.map(e => ({ ...e, at: Date.now() }))].slice(-MAX_QUEUE));
    }
  } catch {
    // network down — re-queue for the next flush
    const remaining = loadQueue();
    saveQueue([...remaining, ...errors.map(e => ({ ...e, at: Date.now() }))].slice(-MAX_QUEUE));
  }
}
