import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useEffect, useRef, useState } from 'react';
import { getToken, TOKEN_REFRESHED_EVENT } from '@/api/client';
import { getHubUrl, useApiBaseSync } from '@/lib/apiBase';

export const POS_CATALOG_VERSION_KEY = 'fot_pos_catalog_version';

/** Read the last catalog version this terminal saw (for heartbeat reporting). */
export function lastSeenCatalogVersion(): number | undefined {
  const raw = localStorage.getItem(POS_CATALOG_VERSION_KEY);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Scope-aware catalog updates: the server tags each change (products/offers/
 * accounts/settings/all). Reference-only scopes run the quick sync without
 * dragging every terminal into a full catalog delta scan.
 */
export function usePosHub(
  enabled: boolean,
  onFullSync: () => void,
  onQuickSync?: () => void,
) {
  const apiBase = useApiBaseSync();
  const [connected, setConnected] = useState(false);
  const [tokenTick, setTokenTick] = useState(0);
  const full = useRef(onFullSync);
  const quick = useRef(onQuickSync);
  full.current = onFullSync;
  quick.current = onQuickSync;

  useEffect(() => {
    const onRefreshed = () => setTokenTick(n => n + 1);
    window.addEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
  }, []);

  useEffect(() => {
    if (!enabled || !getToken()) {
      setConnected(false);
      return;
    }

    const hub = new HubConnectionBuilder()
      .withUrl(getHubUrl(), { accessTokenFactory: () => getToken() ?? '', withCredentials: false })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();

    const onSignal = (version?: number, scope?: string) => {
      if (version && version > 0) localStorage.setItem(POS_CATALOG_VERSION_KEY, String(version));
      // Permission edits arrive as the settings scope, cash box changes as accounts —
      // AuthContext listens and re-pulls both so admin changes apply to the logged-in
      // cashier instantly instead of on the next poll.
      if (scope === 'settings' || scope === 'accounts' || scope === 'all') {
        window.dispatchEvent(new Event('fot-pos-refresh-permissions'));
      }
      const referenceOnly = scope === 'offers' || scope === 'accounts' || scope === 'settings' || scope === 'groups';
      if (referenceOnly) {
        quick.current?.();
      } else {
        quick.current?.();
        full.current();
      }
    };

    hub.on('CatalogUpdated', onSignal);
    hub.onreconnected(() => {
      setConnected(true);
      // missed pushes while disconnected — full catch-up
      full.current();
    });
    hub.onclose(() => setConnected(false));

    let cancelled = false;
    void hub.start().then(async () => {
      if (cancelled) return;
      try {
        await hub.invoke('JoinPos');
      } catch {
        /* optional on older servers */
      }
      setConnected(true);
    }).catch(() => setConnected(false));

    return () => {
      cancelled = true;
      void hub.stop();
    };
  }, [enabled, apiBase, tokenTick]);

  return connected;
}
