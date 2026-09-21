import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Alert, Btn, Checkbox, Field, Input, Modal } from '@/components/ui';
import { CatalogPicker, type CatalogCommitChange, type CatalogPickerHandle, type CatalogSelectedItem } from '@/components/CatalogPicker';
import { collectTreeLeaves, folderKey, productKey } from '@/lib/catalogBrowse';

const PRESETS = [5, 10, 15, 20, 25, 30, 50];

export type OfferLandTab = 'setup' | 'content';

type QueueItem = { seq: number; name: string; barcode?: string; role: 0 | 1 };
type TreePick = { seq: number; name: string; count?: number };

function parseDiscount(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function datePayload(unlimited: boolean, fromDate: string, toDate: string) {
  return {
    unlimited,
    fromDate: unlimited || !fromDate ? null : fromDate,
    toDate: unlimited || !toDate ? null : toDate,
  };
}

export function OfferCreateWizard({
  open,
  onClose,
  nextPriority,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  nextPriority: number;
  onCreated: (id: number, land: OfferLandTab) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [type, setType] = useState(0);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [priority, setPriority] = useState(String(nextPriority));
  const [enabled, setEnabled] = useState(true);
  const [discountPct, setDiscountPct] = useState('10');
  const [unlimited, setUnlimited] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [trees, setTrees] = useState<TreePick[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [addRole, setAddRole] = useState<0 | 1>(0);
  const [error, setError] = useState('');
  const [treeBusy, setTreeBusy] = useState(false);
  const pickerRef = useRef<CatalogPickerHandle>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setType(0);
    setName('');
    setNameTouched(false);
    setPriority(String(nextPriority));
    setEnabled(true);
    setDiscountPct('10');
    setUnlimited(true);
    setFromDate('');
    setToDate('');
    setTrees([]);
    setQueue([]);
    setAddRole(0);
    setError('');
    setTreeBusy(false);
  }, [open, nextPriority]);

  const suggested = type === 0 ? `خصم ${discountPct || '0'}%` : 'مجموعة عرض';
  const displayName = nameTouched ? name : name || suggested;
  const requiredQ = queue.filter(p => p.role === 1);
  const discountedQ = queue.filter(p => p.role === 0);
  const discount = parseDiscount(discountPct);
  const datesOk = unlimited || (!!fromDate && !!toDate && fromDate <= toDate);
  const canStep2 = displayName.trim().length >= 2 && discount != null && datesOk && (type === 1 || discount > 0);
  const canEnable = type === 0
    ? !!(trees.length || discountedQ.length)
    : requiredQ.length > 0 && discountedQ.length > 0;

  const create = useMutation({
    mutationFn: async (payload?: { trees: TreePick[]; queue: QueueItem[] }) => {
      if (!canStep2) throw new Error('أكمل الاسم والنسبة والتاريخ أولاً');
      const useTrees = payload?.trees ?? trees;
      const useQueue = payload?.queue ?? queue;
      const ready = type === 0
        ? !!(useTrees.length || useQueue.filter(p => p.role === 0).length)
        : useQueue.some(p => p.role === 1) && useQueue.some(p => p.role === 0);
      const created = await api.createOffer({
        name: displayName.trim(),
        priority: Number(priority) || nextPriority,
        type,
        enabled: enabled && ready,
      });
      const dates = datePayload(unlimited, fromDate, toDate);
      for (const tree of useTrees) {
        await api.addOfferTree(created.id, {
          treeSeq: tree.seq,
          discountPercent: discount!,
          ...dates,
        });
      }
      for (const p of useQueue) {
        await api.addOfferDetail(created.id, {
          itemId: p.seq,
          discount: p.role === 0 ? discount! : 0,
          discountType: 0,
          ...dates,
          detailRole: p.role,
        });
      }
      return created.id;
    },
    onSuccess: id => onCreated(id, canEnable ? 'content' : 'setup'),
    onError: e => setError(e instanceof Error ? e.message : 'فشل إنشاء العرض'),
  });

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (type === 0) {
      for (const t of trees) keys.add(folderKey(t.seq));
      for (const p of queue) keys.add(productKey(p.seq));
    } else {
      for (const p of queue) {
        if (p.role === addRole) keys.add(productKey(p.seq));
      }
    }
    return keys;
  }, [type, trees, queue, addRole]);

  const selectedItems = useMemo((): CatalogSelectedItem[] => {
    const items: CatalogSelectedItem[] = [];
    if (type === 0) {
      for (const t of trees) {
        items.push({
          key: folderKey(t.seq),
          title: t.name,
          subtitle: t.count != null ? `${t.count} صنف · خصم ${discountPct}%` : `شجرة #${t.seq} · خصم ${discountPct}%`,
          badge: 'شجرة',
          onRemove: () => setTrees(list => list.filter(x => x.seq !== t.seq)),
        });
      }
    }
    for (const p of queue) {
      items.push({
        key: `${p.role}-${p.seq}`,
        title: p.name,
        subtitle: p.barcode,
        badge: p.role === 1 ? 'مطلوب' : `خصم ${discountPct}%`,
        onRemove: () => setQueue(list => list.filter(x => !(x.seq === p.seq && x.role === p.role))),
      });
    }
    return items;
  }, [type, trees, queue, discountPct]);

  async function applyWizardCatalog(
    change: CatalogCommitChange,
    currentTrees = trees,
    currentQueue = queue,
  ): Promise<{ trees: TreePick[]; queue: QueueItem[] }> {
    let nextTrees = [...currentTrees];
    let nextQueue = [...currentQueue];
    const role: 0 | 1 = type === 1 ? addRole : 0;

    for (const row of change.add) {
      if (row.kind === 'folder') {
        if (type === 0) {
          if (!nextTrees.some(t => t.seq === row.seq)) {
            nextTrees = [...nextTrees, { seq: row.seq, name: row.name, count: row.productCount }];
          }
        } else {
          const { items } = await collectTreeLeaves(row.seq);
          const have = new Set(nextQueue.filter(x => x.role === role).map(x => x.seq));
          const extra = items
            .filter(i => !have.has(i.seq))
            .map(i => ({ seq: i.seq, name: i.name, barcode: i.barcode, role }));
          if (extra.length) nextQueue = [...nextQueue, ...extra];
        }
      } else if (!nextQueue.some(x => x.seq === row.seq && x.role === role)) {
        nextQueue = [...nextQueue, { seq: row.seq, name: row.name, barcode: row.barcode, role }];
      }
    }

    for (const item of change.remove) {
      if (item.key.startsWith('f-')) {
        const seq = Number(item.key.slice(2));
        nextTrees = nextTrees.filter(t => t.seq !== seq);
        continue;
      }
      const parts = item.key.split('-');
      if (parts.length === 2) {
        const itemRole = Number(parts[0]);
        const seq = Number(parts[1]);
        nextQueue = nextQueue.filter(x => !(x.seq === seq && x.role === itemRole));
      }
    }

    return { trees: nextTrees, queue: nextQueue };
  }

  async function persistWizardContent() {
    const change = pickerRef.current?.peek() ?? { add: [], remove: [] };
    if (!change.add.length && !change.remove.length) {
      return { trees, queue };
    }
    setTreeBusy(true);
    try {
      const next = await applyWizardCatalog(change);
      setTrees(next.trees);
      setQueue(next.queue);
      pickerRef.current?.discard();
      return next;
    } finally {
      setTreeBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      full
      title={`عرض جديد — الخطوة ${step} من 3`}
      onClose={create.isPending ? () => undefined : onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 gap-1">
          {(['النوع', 'الإعداد', 'المحتوى'] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            return (
              <div
                key={label}
                className={`flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-medium ${
                  step === n ? 'bg-teal-600 text-white' : step > n ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {n}. {label}
              </div>
            );
          })}
        </div>

        {error && <Alert>{error}</Alert>}

        {step === 1 && (
          <div className="mx-auto my-auto grid w-full max-w-3xl flex-1 content-center gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => { setType(0); setAddRole(0); }}
              className={`rounded-lg border-2 p-4 text-right ${type === 0 ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <div className="text-[15px] font-bold text-slate-900">خصم نسبة</div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                يُطبَّق الخصم مباشرة على كل صنف. أشّر شجرة مواد كاملة أو منتجات مفردة من الكتالوج.
              </p>
            </button>
            <button
              type="button"
              onClick={() => { setType(1); setAddRole(1); }}
              className={`rounded-lg border-2 p-4 text-right ${type === 1 ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <div className="text-[15px] font-bold text-slate-900">مجموعة مطلوبة</div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                لا يُفعَّل الخصم إلا إذا اشترى الزبون صنفاً مطلوباً. ثم تُخفَّض الأصناف المخفّضة فقط.
              </p>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="mx-auto my-auto w-full max-w-3xl flex-1 space-y-3">
            <Field label="اسم العرض">
              <Input
                value={nameTouched ? name : displayName}
                onChange={e => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder={suggested}
                autoFocus
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الأولوية (الأعلى يُطبَّق أولاً)">
                <Input type="number" min={0} value={priority} onChange={e => setPriority(e.target.value)} />
              </Field>
              <Field label="نسبة الخصم %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct}
                  onChange={e => setDiscountPct(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(n => (
                <Btn key={n} size="sm" variant={discountPct === String(n) ? 'primary' : 'secondary'} onClick={() => setDiscountPct(String(n))}>
                  {n}%
                </Btn>
              ))}
            </div>
            <Checkbox label="بدون تاريخ انتهاء" checked={unlimited} onChange={setUnlimited} />
            {!unlimited && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="من">
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                </Field>
                <Field label="إلى">
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
                </Field>
              </div>
            )}
            {!datesOk && <Alert>حدّد تاريخ بداية ونهاية صحيحين، أو فعّل «بدون تاريخ انتهاء».</Alert>}
            {type === 0 && discount === 0 && <Alert>خصم 0% لا يغيّر السعر — استخدم نسبة أكبر من صفر.</Alert>}
            <Checkbox
              label="تفعيل فور الإنشاء (إن وُجد محتوى)"
              checked={enabled}
              onChange={setEnabled}
            />
          </div>
        )}

        {step === 3 && (
          <div className="flex min-h-0 flex-1 flex-col">
          <CatalogPicker
            ref={pickerRef}
            resetKey={open ? 'wizard' : 'closed'}
            selectedKeys={selectedKeys}
            selected={selectedItems}
            allowFolders
            fill
            busy={create.isPending || treeBusy}
            onCommit={async change => {
              const next = await applyWizardCatalog(change);
              setTrees(next.trees);
              setQueue(next.queue);
            }}
            addActionLabel="إضافة للعرض"
            removeActionLabel="إزالة من العرض"
            leftTitle="الكتالوج"
            rightTitle="محتوى العرض"
            hint={
              type === 0
                ? 'الباركود يظهر يساراً دون إضافة. أشّر ثم زر أيمن لإضافة العرض. الإنشاء من الزر السفلي يحفظ المحتوى.'
                : 'بدّل مطلوب/مخفّض، أشّر، ثم زر أيمن. الإنشاء من الزر السفلي يحفظ المحتوى.'
            }
            toolbar={
              type === 1 ? (
                <div className="flex flex-wrap gap-1">
                  <Btn size="sm" variant={addRole === 1 ? 'primary' : 'secondary'} onClick={() => setAddRole(1)}>
                    إضافة كمطلوب ({requiredQ.length})
                  </Btn>
                  <Btn size="sm" variant={addRole === 0 ? 'primary' : 'secondary'} onClick={() => setAddRole(0)}>
                    إضافة كمخفّض ({discountedQ.length})
                  </Btn>
                </div>
              ) : undefined
            }
          />
          </div>
        )}

        {step === 3 && !canEnable && (
          <Alert type="info">
            {type === 0
              ? 'بدون شجرة أو منتج سيُحفظ العرض متوقفاً حتى تضيف محتوى.'
              : 'ينقص صنف مطلوب أو صنف مخفّض — سيُحفظ العرض متوقفاً.'}
          </Alert>
        )}

        <div className="flex shrink-0 justify-between gap-2 pt-1">
          <Btn
            variant="secondary"
            onClick={async () => {
              if (step === 1) {
                onClose();
                return;
              }
              if (step === 3) await persistWizardContent();
              setStep(s => (s === 3 ? 2 : 1));
            }}
            disabled={create.isPending || treeBusy}
          >
            {step === 1 ? 'إلغاء' : 'رجوع'}
          </Btn>
          {step < 3 ? (
            <Btn
              onClick={() => {
                if (step === 2 && !canStep2) {
                  setError('أدخل اسماً ونسبة خصم صحيحة، وتحقق من التواريخ.');
                  return;
                }
                setError('');
                setStep(s => (s === 1 ? 2 : 3));
              }}
            >
              التالي
            </Btn>
          ) : (
            <Btn
              onClick={async () => {
                const next = await persistWizardContent();
                create.mutate(next);
              }}
              disabled={create.isPending || treeBusy}
            >
              {create.isPending || treeBusy ? 'جاري الإنشاء…' : 'إنشاء العرض'}
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}
