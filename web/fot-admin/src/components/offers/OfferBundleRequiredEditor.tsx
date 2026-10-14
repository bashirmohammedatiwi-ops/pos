import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDetailDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { Badge, Btn, Input } from '@/components/ui';
import { IconFolder, IconPlus, IconRefresh, IconSearch, IconShield, IconX } from '@/components/icons';
import { TreePickerDialog } from '@/components/TreePickerDialog';
import { useToast } from '@/components/Toast';
import type { TreeNodeDto } from '@/api/types';
import { productSeq } from '@/lib/catalogBrowse';

export type BundleRequiredOps = {
  /** tree: الشجرة التي أُضيف منها الصنف (إضافة شجرة كاملة) — للعرض المجمّع فقط. */
  add: { seq: number; name: string; barcode?: string; tree?: { seq: number; name: string } }[];
  removeRowIds: number[];
};

export function emptyBundleRequiredOps(): BundleRequiredOps {
  return { add: [], removeRowIds: [] };
}

export function bundleRequiredOpsCount(ops: BundleRequiredOps) {
  return ops.add.length + ops.removeRowIds.length;
}

export function OfferBundleRequiredEditor({
  existing,
  onOpsChange,
}: {
  existing: OfferDetailDto[];
  onOpsChange: (ops: BundleRequiredOps) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [add, setAdd] = useState<BundleRequiredOps['add']>([]);
  const [removeRowIds, setRemoveRowIds] = useState<number[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeLoading, setTreeLoading] = useState<string | null>(null);
  const [showAllExisting, setShowAllExisting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 280);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    onOpsChange({ add, removeRowIds });
  }, [add, removeRowIds, onOpsChange]);

  const searchQ = useQuery({
    queryKey: ['products-search', debounced],
    queryFn: () => api.searchProducts(debounced),
    enabled: debounced.length >= 2,
  });

  const requiredRows = useMemo(() => existing.filter(r => r.detailRole === 1), [existing]);
  const removed = useMemo(() => new Set(removeRowIds), [removeRowIds]);
  const visible = useMemo(() => requiredRows.filter(r => !removed.has(r.id)), [requiredRows, removed]);
  const removedRows = useMemo(() => requiredRows.filter(r => removed.has(r.id)), [requiredRows, removed]);

  const stagedSeqs = useMemo(() => new Set([
    ...visible.map(r => r.itemId).filter((x): x is number => x != null),
    ...add.map(a => a.seq),
  ]), [visible, add]);

  function stageProduct(p: { seq: number; id: number; name?: string | null; barcode?: string | null }) {
    const seq = productSeq(p);
    if (stagedSeqs.has(seq)) return;
    setAdd(list => [...list, {
      seq,
      name: fixEdariName(p.name) || p.barcode || `#${seq}`,
      barcode: p.barcode ?? undefined,
    }]);
    setSearch('');
  }

  /** إضافة كل أصناف شجرة (مع المجلدات الفرعية) كأصناف تفعيل. */
  async function stageTree(node: TreeNodeDto) {
    const treeName = fixEdariName(node.name) || node.num || `#${node.seq}`;
    setTreeLoading(treeName);
    try {
      const products = await api.treeProducts(node.seq);
      const taken = new Set(stagedSeqs);
      const fresh = products
        .filter(p => p.seq > 0 && !taken.has(p.seq) && taken.add(p.seq))
        .map(p => ({
          seq: p.seq,
          name: fixEdariName(p.name) || p.barcode || `#${p.seq}`,
          barcode: p.barcode ?? undefined,
          tree: { seq: node.seq, name: treeName },
        }));
      if (!products.length) toast.info(`الشجرة «${treeName}» لا تحتوي أصنافاً`);
      else if (!fresh.length) toast.info(`كل أصناف «${treeName}» مضافة مسبقاً`);
      else {
        setAdd(list => [...list, ...fresh]);
        toast.success(`أُضيف ${formatNum(fresh.length)} صنف من «${treeName}» — احفظ لتثبيتها`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر جلب أصناف الشجرة');
    } finally {
      setTreeLoading(null);
    }
  }

  const singlesAdded = useMemo(() => add.filter(a => !a.tree), [add]);
  const treeBatches = useMemo(() => {
    const map = new Map<number, { seq: number; name: string; count: number }>();
    for (const a of add) {
      if (!a.tree) continue;
      const cur = map.get(a.tree.seq) ?? { seq: a.tree.seq, name: a.tree.name, count: 0 };
      cur.count += 1;
      map.set(a.tree.seq, cur);
    }
    return [...map.values()];
  }, [add]);
  const EXISTING_PREVIEW = 24;
  const visibleShown = showAllExisting ? visible : visible.slice(0, EXISTING_PREVIEW);

  const results = searchQ.data ?? [];
  const total = visible.length + add.length;

  return (
    <section className="card p-3" dir="rtl">
      <div className="flex flex-wrap items-start gap-3">
        <span className="icon-tile h-9 w-9 shrink-0 rounded-xl bg-sky-50 text-sky-700"><IconShield size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-bold text-header">أصناف تفعيل العرض</h3>
            <Badge tone={total > 0 ? 'info' : 'warn'}>{total > 0 ? `${formatNum(total)} صنف مطلوب` : 'لا أصناف بعد'}</Badge>
            {bundleRequiredOpsCount({ add, removeRowIds }) > 0 && (
              <Badge tone="warn" dot>{formatNum(add.length + removeRowIds.length)} تعديل بانتظار الحفظ</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-5 text-slate-500">
            الأصناف التي يتوقف عليها العرض. متى يُفعَّل (كلها أو عدد منها) يُحدَّد في «شرط التفعيل» أدناه.
          </p>
        </div>

        <Btn
          size="sm"
          variant="outline"
          icon={<IconFolder size={14} />}
          loading={treeLoading != null}
          onClick={() => setTreeOpen(true)}
          title="إضافة كل أصناف شجرة (مع مجلداتها الفرعية) كأصناف تفعيل"
        >
          {treeLoading ? `جاري جلب «${treeLoading}»…` : 'إضافة شجرة كاملة'}
        </Btn>

        <div className="relative w-full sm:w-72">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
            <IconSearch size={14} />
          </span>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="أضف صنف تفعيل بالاسم أو الباركود…"
            className="!ps-8"
            data-keep-escape
          />
          {debounced.length >= 2 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-pop">
              {results.map(p => {
                const taken = stagedSeqs.has(productSeq(p));
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={taken}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[12.5px] hover:bg-slate-50 disabled:opacity-40"
                      onClick={() => stageProduct({ ...p, seq: productSeq(p) })}
                    >
                      <IconPlus size={13} className="shrink-0 text-brand-600" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-header">{fixEdariName(p.name) || p.barcode}</span>
                      <span className="num shrink-0 text-[11px] text-slate-400" dir="ltr">{taken ? 'مضاف' : p.barcode}</span>
                    </button>
                  </li>
                );
              })}
              {searchQ.isFetching && <li className="px-2 py-2 text-center text-[11.5px] text-slate-400">جاري البحث…</li>}
              {!searchQ.isFetching && results.length === 0 && (
                <li className="px-2 py-2 text-center text-[11.5px] text-slate-400">لا نتائج</li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {treeBatches.map(t => (
          <span
            key={`tree-${t.seq}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 py-0.5 pe-1 ps-2.5 text-[12px] font-bold text-amber-900"
            title="أصناف الشجرة ستُضاف عند الحفظ"
          >
            <IconFolder size={13} className="shrink-0" />
            <span className="truncate">{t.name}</span>
            <span className="rounded-full bg-amber-200/70 px-1.5 text-[10.5px] num">{formatNum(t.count)} صنف</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-amber-600 hover:bg-amber-100 hover:text-red-600"
              onClick={() => setAdd(list => list.filter(x => x.tree?.seq !== t.seq))}
              aria-label="إلغاء الشجرة"
              title="إلغاء إضافة الشجرة"
            >
              <IconX size={13} />
            </button>
          </span>
        ))}
        {visibleShown.map(r => (
          <span
            key={r.id}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pe-1 ps-2.5 text-[12px] font-semibold text-header"
          >
            <span className="truncate">{fixEdariName(r.itemName) || r.barcode || `#${r.itemId}`}</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => setRemoveRowIds(ids => [...ids, r.id])}
              aria-label="إزالة"
              title="إزالة (عند الحفظ)"
            >
              <IconX size={13} />
            </button>
          </span>
        ))}
        {visible.length > EXISTING_PREVIEW && (
          <button
            type="button"
            className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
            onClick={() => setShowAllExisting(v => !v)}
          >
            {showAllExisting ? 'عرض أقل' : `+ ${formatNum(visible.length - EXISTING_PREVIEW)} صنف آخر`}
          </button>
        )}
        {visible.length > 1 && (
          <button
            type="button"
            className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-red-600 hover:bg-red-50"
            onClick={() => setRemoveRowIds(ids => [...new Set([...ids, ...visible.map(v => v.id)])])}
            title="إزالة كل أصناف التفعيل الحالية (عند الحفظ)"
          >
            إزالة الكل
          </button>
        )}
        {singlesAdded.map(p => (
          <span
            key={`new-${p.seq}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-0.5 pe-1 ps-2.5 text-[12px] font-semibold text-amber-900"
            title="سيُضاف عند الحفظ"
          >
            <span className="truncate">{p.name}</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-amber-600 hover:bg-amber-100 hover:text-red-600"
              onClick={() => setAdd(list => list.filter(x => x.seq !== p.seq))}
              aria-label="إلغاء"
            >
              <IconX size={13} />
            </button>
          </span>
        ))}
        {removedRows.map(r => (
          <span
            key={`rm-${r.id}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-red-200 bg-red-50 py-0.5 pe-1 ps-2.5 text-[12px] font-semibold text-red-500"
            title="سيُزال عند الحفظ"
          >
            <span className="truncate line-through">{fixEdariName(r.itemName) || r.barcode || `#${r.itemId}`}</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-red-400 hover:bg-white hover:text-slate-700"
              onClick={() => setRemoveRowIds(ids => ids.filter(id => id !== r.id))}
              aria-label="تراجع"
              title="تراجع"
            >
              <IconRefresh size={12} />
            </button>
          </span>
        ))}
        {total === 0 && removedRows.length === 0 && (
          <span className="text-[12px] text-slate-400">لم تُضف أصناف تفعيل بعد — ابحث عن صنف، أو أضف شجرة كاملة.</span>
        )}
      </div>

      <TreePickerDialog
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        onSelect={node => void stageTree(node)}
      />
    </section>
  );
}
