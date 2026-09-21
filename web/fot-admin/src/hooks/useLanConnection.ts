import { useEffect, useState } from 'react';

import { api } from '@/api/client';

import { getApiBase, persistApiBase, useApiBaseSync } from '@/lib/apiBase';



export function useLanConnection() {

  const apiBase = useApiBaseSync();

  const [online, setOnline] = useState(true);

  const [reconnecting, setReconnecting] = useState(false);



  useEffect(() => {

    let cancelled = false;

    let intervalMs = 15_000;

    let timer = 0;



    const schedule = (ms: number) => {

      window.clearTimeout(timer);

      timer = window.setTimeout(() => { void ping(); }, ms);

    };



    const ping = async () => {

      if (document.hidden) {

        schedule(Math.max(intervalMs, 45_000));

        return;

      }

      let ok = await api.health();

      if (!ok) {

        if (!cancelled) setReconnecting(true);

        const result = await window.fotDesktop?.ensureApi?.(getApiBase());

        if (result?.ok && result.url) persistApiBase(result.url);

        ok = await api.health();

      }

      if (!cancelled) {

        setOnline(ok);

        setReconnecting(false);

        intervalMs = ok ? Math.min(intervalMs + 5000, 45_000) : 10_000;

      }

      schedule(intervalMs);

    };



    void ping();

    return () => {

      cancelled = true;

      window.clearTimeout(timer);

    };

  }, [apiBase]);



  return { online, reconnecting, apiBase };

}

