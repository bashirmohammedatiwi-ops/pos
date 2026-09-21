import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { getApiBase, persistApiBase, useApiBaseSync } from '@/lib/apiBase';
import {
  LAN_STATUS_EVENT,
  lastKnownReachable,
  markServerReachable,
  markServerUnreachable,
} from '@/lib/connectionGate';

const PING_INTERVAL_MS = 4_000;
/**
 * ensureApi on a cashier PC used to scan the subnet / spawn a local API (~10–45s).
 * Recovery only starts the bundled service on machines that actually host it.
 * Everyone else just health-checks the saved URL.
 */
const RECOVER_INTERVAL_MS = 60_000;

export function useLanConnection() {
  const apiBase = useApiBaseSync();
  const [online, setOnline] = useState(lastKnownReachable);
  const [reconnecting, setReconnecting] = useState(false);
  const pinging = useRef(false);
  const nextRecoverAt = useRef(0);

  useEffect(() => {
    const onLan = (event: Event) => {
      const ok = (event as CustomEvent<{ ok?: boolean }>).detail?.ok;
      if (typeof ok === 'boolean') {
        setOnline(ok);
        if (ok) setReconnecting(false);
      }
    };
    window.addEventListener(LAN_STATUS_EVENT, onLan);
    return () => window.removeEventListener(LAN_STATUS_EVENT, onLan);
  }, []);

  useEffect(() => {
    let cancelled = false;
    nextRecoverAt.current = 0;

    const ping = async () => {
      if (pinging.current) return;
      pinging.current = true;
      try {
        let ok = await api.health();
        if (!ok && Date.now() >= nextRecoverAt.current) {
          nextRecoverAt.current = Date.now() + RECOVER_INTERVAL_MS;
          let hostsApi = false;
          try {
            hostsApi = Boolean((await window.fotDesktop?.info?.())?.hasLocalApi);
          } catch {
            hostsApi = false;
          }
          if (hostsApi) {
            if (!cancelled) setReconnecting(true);
            const result = await window.fotDesktop?.ensureApi?.(getApiBase());
            if (result?.ok && result.url) void persistApiBase(result.url);
            ok = await api.health();
          }
        }
        if (ok) {
          nextRecoverAt.current = 0;
          markServerReachable();
        } else {
          markServerUnreachable();
        }
        if (!cancelled) {
          setOnline(ok);
          setReconnecting(false);
        }
      } finally {
        pinging.current = false;
      }
    };

    void ping();
    const t = window.setInterval(() => { void ping(); }, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [apiBase]);

  return { online, reconnecting, apiBase };
}
