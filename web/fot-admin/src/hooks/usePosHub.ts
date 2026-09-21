import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useEffect, useState } from 'react';
import { getToken } from '@/api/client';
import { getHubUrl, useApiBaseSync } from '@/lib/apiBase';
import {
  invalidateCatalogData,
  invalidateEdariLinkedData,
  invalidateEdariStatusData,
  invalidateReceiptLiveData,
} from '@/lib/queryClient';
import { useAuth } from '@/auth/AuthContext';
import { setSyncConnected } from '@/hooks/useSyncStatus';

export function usePosHub() {
  const { token } = useAuth();
  const apiBase = useApiBaseSync();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setConnected(false);
      setSyncConnected(false);
      return;
    }

    const hub = new HubConnectionBuilder()
      .withUrl(getHubUrl(), { accessTokenFactory: () => getToken() ?? '', withCredentials: false })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();

    hub.on('ReceiptCreated', (_id: number, num: number) => {
      setLastEvent(`فاتورة جديدة #${num}`);
      invalidateReceiptLiveData();
    });
    hub.on('CatalogUpdated', () => {
      setLastEvent('تم تحديث الكتالوج');
      invalidateCatalogData();
    });
    hub.on('EdariUpdated', (message?: string, dataChanged?: boolean) => {
      setLastEvent(typeof message === 'string' && message.trim() ? message : 'تحديث من الإداري');
      invalidateEdariStatusData();
      if (dataChanged) invalidateEdariLinkedData();
      else invalidateReceiptLiveData();
    });

    hub.onreconnected(() => {
      setConnected(true);
      setSyncConnected(true);
      // the connection was down for a while — refresh live data to catch missed pushes
      invalidateReceiptLiveData();
    });
    hub.onclose(() => {
      setConnected(false);
      setSyncConnected(false);
    });

    let cancelled = false;
    (async () => {
      try {
        await hub.start();
        if (cancelled) return;
        await hub.invoke('JoinAdmin');
        setConnected(true);
        setSyncConnected(true);
      } catch {
        setConnected(false);
        setSyncConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      hub.stop();
      setSyncConnected(false);
    };
  }, [token, apiBase]);

  return { connected, lastEvent };
}
