import { useEffect, useState } from 'react';

/**
 * Shared live-sync status: while the SignalR hub is connected, pushes drive all
 * invalidation and periodic polling is suspended (only a slow safety refresh remains);
 * when the hub drops, consumers fall back to fast polling automatically.
 *
 * The hub connection owner (AppLayout/usePosHub) publishes state here; every
 * other component reads it without creating connections.
 */

type Listener = (connected: boolean) => void;

let connected = false;
const listeners = new Set<Listener>();

function publish(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const l of listeners) l(next);
}

/** Read the current hub connection state and re-render on change. */
export function useSyncStatus(): boolean {
  const [state, setState] = useState(connected);
  useEffect(() => {
    listeners.add(setState);
    setState(connected);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

/** For the connection owner only. */
export function setSyncConnected(value: boolean) {
  publish(value);
}

/**
 * Pick the polling interval based on live connectivity.
 * @param connectedInterval fast fallback while the hub is down
 * @param disconnectedInterval same as connectedInterval by convention
 */
export function syncAwareInterval(connectedHub: boolean, downMs: number, safetyMs = 300_000): number | undefined {
  // A non-undefined interval is still required as a safety net (missed pushes,
  // partial invalidations), so connected clients poll slowly instead of never.
  return connectedHub ? safetyMs : downMs;
}
