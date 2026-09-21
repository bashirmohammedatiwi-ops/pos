import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useToast } from '@/components/Toast';
import { useSyncStatus } from './useSyncStatus';

/**
 * Minimal data for the clean admin home page: integration status (Edari + POS terminals)
 * plus the three manual sync actions. Everything refreshes fast while the SignalR hub is
 * down and relaxes once live events drive the updates.
 */
export function useHomeStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  const hubConnected = useSyncStatus();

  const edariQ = useQuery({
    queryKey: ['edari-status'],
    queryFn: () => api.edariStatus(),
    refetchInterval: hubConnected ? 20_000 : 10_000,
    retry: 1,
  });

  const terminalsQ = useQuery({
    queryKey: ['terminal-monitor'],
    queryFn: () => api.terminalMonitor(),
    refetchInterval: hubConnected ? 30_000 : 15_000,
    retry: 1,
    select: groups => (groups ?? []).flatMap(g => g.terminals ?? []),
  });

  const refreshEdari = () => {
    void qc.invalidateQueries({ queryKey: ['edari-status'] });
    void qc.invalidateQueries({ queryKey: ['edari-settings'] });
  };

  // Edari → لوحة التحكم: pull articles/salesmen/branches (+ offers stay on their own cadence).
  const pullFromEdari = useMutation({
    mutationFn: () => api.syncEdariPull(false),
    onSuccess: r => {
      toast.success(r.message || 'تم الجلب من الأداري');
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['salesmen'] });
      void qc.invalidateQueries({ queryKey: ['sections'] });
      refreshEdari();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الجلب من الأداري'),
  });

  // لوحة التحكم → الأداري: drain the receipt posting queue.
  const syncReceipts = useMutation({
    mutationFn: () => api.syncEdariReceipts(true, 50),
    onSuccess: r => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      refreshEdari();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر ترحيل الفواتير'),
  });

  // لوحة التحكم → نقاط البيع: nudge every connected terminal to refresh its catalog now.
  const pushToPos = useMutation({
    mutationFn: () => api.pushPosUpdates(),
    onSuccess: () => {
      toast.success('أُرسل تحديث لكل نقاط البيع المتصلة');
      void qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر رفع التحديثات'),
  });

  return { edariQ, terminalsQ, pullFromEdari, syncReceipts, pushToPos };
}
