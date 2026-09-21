import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Loading } from '@/components/ui';
import { EmptyWorkspace } from '@/components/workspace';
import { OfferEditorModal } from '@/pages/OffersPage';
import { GroupEditorModal } from '@/components/CommissionGroupsPanel';
import { TargetEditor } from '@/pages/TargetEditor';
import { closeEditorWindow, notifyOpenerRefresh } from '@/lib/editorWindow';
import { IconCoins, IconPercent, IconTarget } from '@/components/icons';

/**
 * محررات الأقسام الثلاثة في نوافذ نظام منفصلة تماماً عن التطبيق —
 * تُفتح عبر «تعديل» من الصفحات الرئيسية (window.open) وتُغلق بـ«رجوع»
 * أو Escape أو زر النافذة، مع إبلاغ التطبيق الأب بأي تغيير.
 */

/** إبلاغ الأب عند إغلاق النافذة (يلتقط أي تغيير لم يُبلَّغ عنه). */
function useNotifyOnUnload() {
  useEffect(() => {
    const handler = () => notifyOpenerRefresh();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}

export function OfferEditorWindow() {
  useNotifyOnUnload();
  const { id } = useParams();
  const offerId = Number(id);
  const qc = useQueryClient();

  const offersQ = useQuery({
    queryKey: ['offers'],
    queryFn: () => api.offers(),
    staleTime: 0,
  });

  const offer = (offersQ.data?.items ?? []).find(o => o.id === offerId) ?? null;

  if (offersQ.isLoading) return <WindowLoading label="تحميل العرض…" icon={<IconPercent size={22} />} />;
  if (!offer) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-100">
        <EmptyWorkspace title="العرض غير موجود" hint="ربما حُذف — أغلق النافذة." icon={<IconPercent size={24} />} />
        <button type="button" onClick={() => window.close()} className="ms-3 rounded-xl bg-header px-4 py-2 text-white">إغلاق</button>
      </div>
    );
  }

  return (
    <OfferEditorModal
      key={offer.id}
      offer={offer}
      open
      autoOpenPicker={false}
      onClose={closeEditorWindow}
      onChanged={async () => {
        await qc.invalidateQueries({ queryKey: ['offers'] });
        await qc.invalidateQueries({ queryKey: ['offer-scope'] });
        await qc.invalidateQueries({ queryKey: ['offers-stats'] });
        notifyOpenerRefresh();
      }}
    />
  );
}

export function GroupEditorWindow() {
  useNotifyOnUnload();
  const { id } = useParams();
  const groupId = Number(id);
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ['commission-group', groupId],
    queryFn: () => api.commissionGroup(groupId),
  });
  const groupsQ = useQuery({ queryKey: ['commission-groups'], queryFn: () => api.commissionGroups() });

  if (detailQ.isLoading || groupsQ.isLoading) {
    return <WindowLoading label="تحميل المجموعة…" icon={<IconCoins size={22} />} />;
  }
  if (!detailQ.data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-100">
        <EmptyWorkspace title="المجموعة غير موجودة" hint="ربما حُذفت — أغلق النافذة." icon={<IconCoins size={24} />} />
        <button type="button" onClick={() => window.close()} className="ms-3 rounded-xl bg-header px-4 py-2 text-white">إغلاق</button>
      </div>
    );
  }

  return (
    <GroupEditorModal
      key={detailQ.data.id}
      detail={detailQ.data}
      open
      autoOpenPicker={false}
      onClose={closeEditorWindow}
      onChanged={async () => {
        await qc.invalidateQueries({ queryKey: ['commission-group', groupId] });
        await qc.invalidateQueries({ queryKey: ['commission-groups'] });
        await qc.invalidateQueries({ queryKey: ['commission-group-report'] });
        notifyOpenerRefresh();
      }}
      onDeleted={closeEditorWindow}
      allGroups={groupsQ.data ?? []}
    />
  );
}

export function TargetEditorWindow() {
  useNotifyOnUnload();
  const { id } = useParams();
  const isNew = id === 'new';
  const ruleId = id != null && /^\d+$/.test(id) ? Number(id) : null;

  if (id != null && !isNew && ruleId == null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-100">
        <EmptyWorkspace title="معرّف هدف غير صالح" hint="أغلق النافذة وافتح الهدف من القائمة." icon={<IconTarget size={24} />} />
      </div>
    );
  }

  return <TargetEditor ruleId={ruleId} onClose={closeEditorWindow} autoOpenPicker={false} />;
}

function WindowLoading({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-slate-100">
      <span className="icon-tile h-12 w-12 bg-white text-brand-600 shadow-card">{icon}</span>
      <Loading />
      <p className="text-[13px] font-semibold text-slate-500">{label}</p>
    </div>
  );
}
