import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDto, OfferFolderDto } from '@/api/types';
import { IconFolder, IconFolderClosed, IconInbox, IconPanel, IconPencil, IconPlus, IconTrash } from '@/components/icons';
import { Btn, Field, Input, Modal, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';

export type OfferFolderFilter = 'all' | 'ungrouped' | number;

type Props = {
  offers: OfferDto[];
  value: OfferFolderFilter;
  onChange: (v: OfferFolderFilter) => void;
  /** عمود مطوي (شريط أيقونات ضيّق). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
  actions,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`group relative flex items-center rounded-md transition ${
        active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-white hover:text-header'
      }`}
    >
      {active && <span className="absolute inset-y-1 start-0 w-[3px] rounded-full bg-brand-600" />}
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        title={label}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-right text-[12.5px] font-semibold"
      >
        <span className={`shrink-0 ${active ? 'text-brand-600' : 'text-slate-400'}`}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span
          className={`num shrink-0 rounded-full px-1.5 text-[10.5px] font-bold ${
            active ? 'bg-brand-100 text-brand-700' : 'text-slate-400'
          } ${actions ? 'group-hover:hidden group-focus-within:hidden' : ''}`}
        >
          {formatNum(count)}
        </span>
      </button>
      {actions && (
        <div className="hidden shrink-0 items-center pe-0.5 group-hover:flex group-focus-within:flex">{actions}</div>
      )}
    </div>
  );
}

/**
 * عمود المجلدات المدمج داخل لوحة العروض — ضيّق وقابل للطي.
 * يُخفى تحت lg (يحل محله فلتر «المجلد» في شريط الفلاتر).
 */
export function OfferFoldersSidebar({ offers, value, onChange, collapsed = false, onToggleCollapsed }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameTarget, setRenameTarget] = useState<OfferFolderDto | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<OfferFolderDto | null>(null);

  const foldersQ = useQuery({
    queryKey: ['offer-folders'],
    queryFn: () => api.offerFolders(),
    staleTime: 30_000,
  });

  const folders = foldersQ.data ?? [];
  const ungroupedCount = offers.filter(o => !o.folderId).length;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['offer-folders'] });
    await qc.invalidateQueries({ queryKey: ['offers'] });
  };

  const createM = useMutation({
    mutationFn: () => api.createOfferFolder(newName.trim()),
    onSuccess: async r => {
      toast.success('أُنشئ المجلد');
      setCreateOpen(false);
      setNewName('');
      await invalidate();
      onChange(r.id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإنشاء'),
  });

  const renameM = useMutation({
    mutationFn: () => api.renameOfferFolder(renameTarget!.id, renameName.trim()),
    onSuccess: async () => {
      toast.success('حُدّث اسم المجلد');
      setRenameTarget(null);
      await invalidate();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التحديث'),
  });

  const deleteM = useMutation({
    mutationFn: () => api.deleteOfferFolder(deleteTarget!.id),
    onSuccess: async () => {
      toast.success('حُذف المجلد — بقيت عروضه بدون مجلد');
      if (value === deleteTarget?.id) onChange('all');
      setDeleteTarget(null);
      await invalidate();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  function openRename(f: OfferFolderDto) {
    setRenameTarget(f);
    setRenameName(f.name);
  }

  function openCreate() {
    setNewName('');
    setCreateOpen(true);
  }

  const canCreate = newName.trim().length > 0 && !createM.isPending;
  const canRename = renameName.trim().length > 0 && !renameM.isPending;
  const activeFolderName = typeof value === 'number' ? folders.find(f => f.id === value)?.name : undefined;

  // النوافذ خارج العمود — العمود مخفي على الشاشات الصغيرة
  const modals = (
    <>
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="مجلد عروض جديد"
        size="sm"
        icon={<IconFolder size={18} />}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Btn>
            <Btn loading={createM.isPending} disabled={!newName.trim()} onClick={() => createM.mutate()}>إنشاء</Btn>
          </>
        }
      >
        <form onSubmit={e => { e.preventDefault(); if (canCreate) createM.mutate(); }}>
          <Field label="اسم المجلد" hint="مثال: عروض رمضان، تصفيات نهاية الموسم">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="اسم المجلد" autoFocus />
          </Field>
        </form>
      </Modal>

      <Modal
        open={renameTarget != null}
        onClose={() => setRenameTarget(null)}
        title="إعادة تسمية المجلد"
        size="sm"
        icon={<IconPencil size={18} />}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setRenameTarget(null)}>إلغاء</Btn>
            <Btn loading={renameM.isPending} disabled={!renameName.trim()} onClick={() => renameM.mutate()}>حفظ</Btn>
          </>
        }
      >
        <form onSubmit={e => { e.preventDefault(); if (canRename) renameM.mutate(); }}>
          <Field label="اسم المجلد">
            <Input value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
          </Field>
        </form>
      </Modal>

      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="حذف المجلد؟"
        size="sm"
        icon={<IconTrash size={18} />}
        subtitle={deleteTarget ? `«${deleteTarget.name}»` : ''}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setDeleteTarget(null)}>إلغاء</Btn>
            <Btn variant="danger" loading={deleteM.isPending} onClick={() => deleteM.mutate()}>حذف المجلد</Btn>
          </>
        }
      >
        <p className="text-[13px] leading-6 text-slate-600">
          لن يُحذف أي عرض — تبقى عروض هذا المجلد في القائمة تحت «بدون مجلد».
        </p>
      </Modal>
    </>
  );

  if (collapsed) {
    const currentLabel = value === 'all' ? 'كل العروض' : value === 'ungrouped' ? 'بدون مجلد' : activeFolderName ?? 'مجلد';
    return (
      <>
        <aside className="hidden w-9 shrink-0 flex-col items-center gap-1 border-e border-slate-200 bg-slate-50/60 py-1.5 lg:flex" aria-label="مجلدات العروض">
          <button
            type="button"
            title="إظهار المجلدات"
            aria-label="إظهار المجلدات"
            onClick={onToggleCollapsed}
            className="rounded-md p-1.5 text-slate-500 transition hover:bg-white hover:text-brand-700"
          >
            <IconPanel size={15} />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={`المجلد الحالي: ${currentLabel}`}
            aria-label={`المجلد الحالي: ${currentLabel}`}
            className={`rounded-md p-1.5 transition ${value === 'all' ? 'text-slate-400 hover:bg-white' : 'bg-brand-50 text-brand-700'}`}
          >
            {value === 'ungrouped' ? <IconInbox size={15} /> : value === 'all' ? <IconFolder size={15} /> : <IconFolderClosed size={15} />}
          </button>
          <button
            type="button"
            title="مجلد جديد"
            aria-label="مجلد جديد"
            onClick={openCreate}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-brand-700"
          >
            <IconPlus size={15} />
          </button>
        </aside>
        {modals}
      </>
    );
  }

  return (
    <>
      <aside className="hidden w-[200px] shrink-0 flex-col border-e border-slate-200 bg-slate-50/60 lg:flex" aria-label="مجلدات العروض">
        <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-200 px-2 py-1.5">
          <span className="flex-1 text-[11px] font-bold text-slate-500">المجلدات</span>
          <button
            type="button"
            title="مجلد جديد"
            aria-label="مجلد جديد"
            onClick={openCreate}
            className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-brand-700"
          >
            <IconPlus size={14} />
          </button>
          {onToggleCollapsed && (
            <button
              type="button"
              title="طي المجلدات"
              aria-label="طي المجلدات"
              onClick={onToggleCollapsed}
              className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-slate-700"
            >
              <IconPanel size={14} />
            </button>
          )}
        </div>

        <nav className="min-h-0 flex-1 space-y-px overflow-y-auto p-1.5" aria-label="قائمة المجلدات">
          <NavItem
            active={value === 'all'}
            icon={<IconFolder size={14} />}
            label="كل العروض"
            count={offers.length}
            onClick={() => onChange('all')}
          />
          <NavItem
            active={value === 'ungrouped'}
            icon={<IconInbox size={14} />}
            label="بدون مجلد"
            count={ungroupedCount}
            onClick={() => onChange('ungrouped')}
          />

          {(foldersQ.isLoading || folders.length > 0) && <div className="mx-1.5 my-1 border-t border-slate-200/70" />}

          {foldersQ.isLoading && (
            <div className="space-y-2 px-2 py-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          )}
          {foldersQ.isError && (
            <button
              type="button"
              onClick={() => void foldersQ.refetch()}
              className="w-full px-2 py-1.5 text-right text-[11.5px] text-red-600 hover:underline"
            >
              تعذّر تحميل المجلدات — إعادة المحاولة
            </button>
          )}
          {folders.map(f => (
            <NavItem
              key={f.id}
              active={value === f.id}
              icon={<IconFolderClosed size={14} />}
              label={f.name}
              count={offers.filter(o => o.folderId === f.id).length}
              onClick={() => onChange(f.id)}
              actions={
                <>
                  <button
                    type="button"
                    title="إعادة تسمية"
                    aria-label={`إعادة تسمية ${f.name}`}
                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                    onClick={() => openRename(f)}
                  >
                    <IconPencil size={12} />
                  </button>
                  <button
                    type="button"
                    title="حذف المجلد"
                    aria-label={`حذف ${f.name}`}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setDeleteTarget(f)}
                  >
                    <IconTrash size={12} />
                  </button>
                </>
              }
            />
          ))}
          {!foldersQ.isLoading && folders.length === 0 && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-[11.5px] font-semibold text-slate-500 transition hover:border-brand-300 hover:text-brand-700"
            >
              <IconPlus size={13} />
              مجلد لتنظيم العروض
            </button>
          )}
        </nav>

        <p className="shrink-0 border-t border-slate-200 px-2 py-1.5 text-[10.5px] leading-4 text-slate-400">
          للتنظيم فقط — لا تؤثر على نقاط البيع.
        </p>
      </aside>
      {modals}
    </>
  );
}

export function OfferFolderSelect({
  offerId,
  folderId,
  onChanged,
  compact,
}: {
  offerId: number;
  folderId?: number | null;
  onChanged: () => void | Promise<void>;
  /** بلا عنوان — للأشرطة المضغوطة. */
  compact?: boolean;
}) {
  const toast = useToast();
  const foldersQ = useQuery({
    queryKey: ['offer-folders'],
    queryFn: () => api.offerFolders(),
  });
  const folders = foldersQ.data ?? [];

  const moveM = useMutation({
    mutationFn: (next: number | null) => api.moveOfferToFolder(offerId, next),
    onSuccess: async () => {
      toast.success('نُقل العرض إلى المجلد');
      await onChanged();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر النقل'),
  });

  const select = (
    <Select
      value={folderId ?? ''}
      disabled={moveM.isPending}
      aria-label="المجلد"
      onChange={e => {
        const v = e.target.value;
        moveM.mutate(v === '' ? null : Number(v));
      }}
    >
      <option value="">بدون مجلد</option>
      {folders.map(f => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </Select>
  );

  if (compact) return select;
  return (
    <Field label="المجلد" hint="للتنظيم فقط — يُحفظ فوراً">
      {select}
    </Field>
  );
}
