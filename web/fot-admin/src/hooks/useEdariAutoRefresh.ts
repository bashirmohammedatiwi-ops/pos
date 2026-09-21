import { useEffect } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';



/** Poll Edari status only — data arrives via SignalR when hub is connected. */

export function useEdariAutoRefresh(apiOnline: boolean, hubConnected = false) {

  const qc = useQueryClient();



  const settingsQ = useQuery({

    queryKey: ['edari-settings'],

    queryFn: api.edariSettings,

    staleTime: 60_000,

    enabled: apiOnline,

  });



  const enabled = apiOnline && settingsQ.data?.enabled && settingsQ.data.autoSyncEnabled;

  const intervalMs = !enabled ? null : hubConnected ? 60_000 : 20_000;



  useEffect(() => {

    if (!intervalMs) return;

    const tick = () => {

      qc.invalidateQueries({ queryKey: ['edari-status'] });

      if (!hubConnected) qc.invalidateQueries({ queryKey: ['edari-settings'] });

    };

    tick();

    const id = window.setInterval(tick, intervalMs);

    return () => window.clearInterval(id);

  }, [intervalMs, hubConnected, qc]);

}



export function edariPullIntervalMs(settings: { enabled: boolean; autoSyncEnabled: boolean; autoSyncIntervalSeconds: number } | undefined) {

  if (!settings?.enabled || !settings.autoSyncEnabled) return null;

  return Math.min(3600, Math.max(15, settings.autoSyncIntervalSeconds)) * 1000;

}

