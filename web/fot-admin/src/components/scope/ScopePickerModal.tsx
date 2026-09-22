import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { useToast } from '@/components/Toast';
import { Btn, Input, Loading } from '@/components/ui';
import {
  IconCheckCircle,
  IconFolderClosed,
  IconPackage,
  IconPlus,
  IconSearch,
  IconX,
} from '@/components/icons';
import type { ScopeStandaloneItem, ScopeTreeCard } from '@/components/scope/TreeScopeEditor';
import { CommissionGroupPills, otherCommissionMemberships } from '@/components/commissions/CommissionGroupPills';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ScopePickerModal — النافذة المنبثقة الاحترافية لإضافة/إزالة الأصناف والأشجار.
 *
 *   الجهة اليمنى: تصفّح الكتالوج — بحث فوري + باركود (Enter يؤشّر ولا يضيف
 *                 أبداً — متوافق مع قارئ الباركود الذي يرسل Enter تلقائياً).
 *   الجهة اليسرى: المحتوى الحالي + التعديلات المؤشّرة.
 *
 *   الألوان:  أحمر  = الصنف موجود أصلاً داخل النطاق (مع علامة «مضاف»).
 *             أصفر = مؤشَّر للإضافة (تأشير بالضغط أو كلك-يمين ← إضافة).
 *             أحمر مشطوب = مؤشَّر للإزالة.
 *   كل لوحة تتحرك (scroll) بشكل مستقل، ولا يُحفظ أي شيء قبل زر «حفظ».
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ScopePickerOps {
  addTrees: { seq: number; name: string }[];
  addProducts: { seq: number; name: string; barcode?: string; price?: number }[];
  removeTreeSeqs: number[];
  removeRowIds: number[];
  /** منتجات داخل شجرة كاملة بلا سطر تفصيل — تُستبعد ولا تُحذف الشجرة */
  excludeProductSeqs: number[];
}

export interface ScopePickerScope {
  /** أشجار (وأشجار-شبه للمنتجات المفردة في الأهداف) موجودة في النطاق. */
  treeSeqs: Set<number>;
  /** seq المنتج ← معرّف سطر التفصيل/العنصر — لإزالة أصناف بعينها. */
  seqRowIds: Map<number, number>;
}

export interface ScopePickerModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  scopeName: string;
  trees: ScopeTreeCard[];
  standalone: ScopeStandaloneItem[];
  inScope: ScopePickerScope;
  /** يُنفَّذ عند الضغط على حفظ — يطبّق كل التعديلات المؤشّرة دفعة واحدة. */
  onCommit: (ops: ScopePickerOps) => Promise<void>;
  /** عند التعيين: تنبيه إذا كان المنتج موجوداً في مجموعة عمولات أخرى. */
  commissionGroupId?: number;
}

type RowState = 'normal' | 'in-scope' | 'staged-add' | 'staged-remove';

interface MenuState {
  x: number;
  y: number;
  target:
    | { kind: 'product'; seq: number; name: string; barcode?: string; price?: number }
    | { kind: 'folder'; seq: number; name: string };
}

export function ScopePickerModal({
  open,
  onClose,
  title,
  scopeName,
  trees,
  standalone,
  inScope,
  onCommit,
  commissionGroupId,
}: ScopePickerModalProps) {
  const toast = useToast();
  const [parent, setParent] = useState<number | undefined>();
  const [path, setPath] = useState<{ seq: number; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [barcodeHit, setBarcodeHit] = useState<TreeNodeDto | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [saving, setSaving] = useState(false);
  const firstResultRef = useRef<HTMLDivElement | null>(null);

  // ── التأشير (staging) ──
  const [addTrees, setAddTrees] = useState<Map<number, { seq: number; name: string }>>(new Map());
  const [addProducts, setAddProducts] = useState<Map<number, { seq: number; name: string; barcode?: string; price?: number }>>(new Map());
  const [removeTrees, setRemoveTrees] = useState<Set<number>>(new Set());
  const [removeRows, setRemoveRows] = useState<Map<number, number>>(new Map()); // seq → rowId
  const [excludeSeqs, setExcludeSeqs] = useState<Set<number>>(new Set());

  const stagedCount = addTrees.size + addProducts.size + removeTrees.size + removeRows.size + excludeSeqs.size;

  // قفل تمرير الصفحة خلف النافذة + إغلاق قائمة الكلك-يمين عند أي تفاعل
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setParent(undefined); setPath([]); setSearch(''); setDebounced(''); setBarcodeHit(null);
      setAddTrees(new Map()); setAddProducts(new Map()); setRemoveTrees(new Set()); setRemoveRows(new Map()); setExcludeSeqs(new Set());
      setMenu(null);
      return;
    }
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !saving && !menu) {
        if (stagedCount > 0 && !window.confirm('هناك تعديلات مؤشَّرة غير محفوظة — إغلاق دون حفظ؟')) return;
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, stagedCount, menu, onClose]);

  const nodesQ = useQuery({
    queryKey: ['scope-picker-browse', parent, debounced, open],
    queryFn: async () => {
      try {
        const edari = await api.edariTree(parent, debounced || undefined);
        if (edari.length) return { nodes: edari, source: 'edari' as const };
      } catch { /* local fallback */ }
      const local = await api.articleTree(parent, debounced || undefined);
      return { nodes: local, source: 'local' as const };
    },
    enabled: open,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const list = barcodeHit ? [barcodeHit, ...(nodesQ.data?.nodes ?? []).filter(n => n.seq !== barcodeHit.seq)] : (nodesQ.data?.nodes ?? []);
    return {
      folders: list.filter(n => n.isFolder || n.hasChildren),
      products: list.filter(n => !n.isFolder && !n.hasChildren),
    };
  }, [nodesQ.data, barcodeHit]);

  const productSeqs = useMemo(() => rows.products.map(n => n.seq), [rows.products]);
  const membershipsQ = useQuery({
    queryKey: ['commission-memberships-picker', commissionGroupId, productSeqs.join(',')],
    queryFn: () => api.commissionMemberships(productSeqs),
    enabled: open && commissionGroupId != null && productSeqs.length > 0,
    staleTime: 15_000,
  });
  const othersBySeq = useMemo(() => {
    const map = new Map<number, ReturnType<typeof otherCommissionMemberships>>();
    for (const row of membershipsQ.data ?? []) {
      const others = otherCommissionMemberships(row.groups, commissionGroupId);
      if (others.length) map.set(row.itemId, others);
    }
    return map;
  }, [membershipsQ.data, commissionGroupId]);

  // ── حالات الصفوف ──
  function treeState(seq: number): RowState {
    if (removeTrees.has(seq)) return 'staged-remove';
    if (inScope.treeSeqs.has(seq)) return 'in-scope';
    if (addTrees.has(seq)) return 'staged-add';
    return 'normal';
  }

  function productState(seq: number): RowState {
    if (removeRows.has(seq) || excludeSeqs.has(seq)) return 'staged-remove';
    if (inScope.seqRowIds.has(seq) || inScope.treeSeqs.has(seq)) return 'in-scope';
    if (addProducts.has(seq)) return 'staged-add';
    return 'normal';
  }

  function toggleProduct(seq: number, name: string, barcode?: string, price?: number) {
    const st = productState(seq);
    if (st === 'normal') {
      const others = othersBySeq.get(seq) ?? [];
      if (others.length) {
        toast.info(`موجود مسبقاً في: ${others.map(g => g.groupName).join('، ')}`);
      }
      setAddProducts(m => new Map(m).set(seq, { seq, name, barcode, price }));
    } else if (st === 'staged-add') {
      setAddProducts(m => { const n = new Map(m); n.delete(seq); return n; });
    } else if (st === 'in-scope') {
      const rowId = inScope.seqRowIds.get(seq);
      if (rowId == null) {
        setExcludeSeqs(s => new Set(s).add(seq));
        return;
      }
      setRemoveRows(m => new Map(m).set(seq, rowId));
    } else {
      setExcludeSeqs(s => { const n = new Set(s); n.delete(seq); return n; });
      setRemoveRows(m => { const n = new Map(m); n.delete(seq); return n; });
    }
  }

  function toggleTree(seq: number, name: string) {
    const st = treeState(seq);
    if (st === 'normal') {
      setAddTrees(m => new Map(m).set(seq, { seq, name }));
    } else if (st === 'staged-add') {
      setAddTrees(m => { const n = new Map(m); n.delete(seq); return n; });
    } else if (st === 'in-scope') {
      setRemoveTrees(s => new Set(s).add(seq));
    } else {
      setRemoveTrees(s => { const n = new Set(s); n.delete(seq); return n; });
    }
  }

  function toggleStandalone(item: ScopeStandaloneItem) {
    const seq = item.seq;
    if (seq == null) return;
    if (removeRows.has(seq)) {
      setRemoveRows(m => { const n = new Map(m); n.delete(seq); return n; });
    } else {
      setRemoveRows(m => new Map(m).set(seq, item.id));
    }
  }

  // ── بحث/باركود: Enter لا يضيف أبداً — يؤشّر النتيجة الأولى فقط ──
  async function onSearchEnter() {
    const term = search.trim();
    if (term.length >= 6 && /^\d+$/.test(term)) {
      try {
        const p = await api.productByBarcode(term);
        setBarcodeHit({
          seq: p.seq || p.id,
          name: p.name,
          barcode: p.barcode,
          isFolder: false,
          hasChildren: false,
          price: p.originalPrice,
        } as TreeNodeDto);
        window.setTimeout(() => firstResultRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
        return;
      } catch {
        toast.info('لا منتج بهذا الباركود');
        return;
      }
    }
    firstResultRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function save() {
    if (stagedCount === 0) return;
    setSaving(true);
    try {
      await onCommit({
        addTrees: [...addTrees.values()],
        addProducts: [...addProducts.values()],
        removeTreeSeqs: [...removeTrees],
        removeRowIds: [...removeRows.values()],
        excludeProductSeqs: [...excludeSeqs],
      });
      toast.success(`طُبِّقت التعديلات — ${formatNum(addTrees.size + addProducts.size)} إضافة و${formatNum(removeTrees.size + removeRows.size)} إزالة`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر حفظ التعديلات');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const stateClasses: Record<RowState, string> = {
    normal: 'hover:bg-slate-50',
    'in-scope': 'bg-red-50/80 ring-1 ring-inset ring-red-200',
    'staged-add': 'bg-amber-100/90 ring-2 ring-inset ring-amber-400',
    'staged-remove': 'bg-red-100 ring-2 ring-inset ring-red-400',
  };

  function StateBadge({ state }: { state: RowState }) {
    if (state === 'in-scope') {
      return (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
          <IconCheckCircle size={11} /> مضاف
        </span>
      );
    }
    if (state === 'staged-add') {
      return <span className="shrink-0 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-900">✓ سيُضاف</span>;
    }
    if (state === 'staged-remove') {
      return <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">✕ سيُزال</span>;
    }
    return null;
  }

  function renderMenu() {
    if (!menu) return null;
    const style = { left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 150) };
    const isProduct = menu.target.kind === 'product';
    const seq = menu.target.seq;
    const st = isProduct ? productState(seq) : treeState(seq);
    return (
      <div
        dir="rtl"
        style={style}
        className="fixed z-[80] w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {menu.target.kind === 'folder' && (
          <MenuItem label="فتح المجلد" onClick={() => { enterFolder(menu.target as { seq: number; name: string }); setMenu(null); }} />
        )}
        {(st === 'normal' || st === 'staged-add') && (
          <MenuItem
            label={isProduct ? 'إضافة (تأشير أصفر)' : 'إضافة الشجرة كاملة'}
            icon={<IconPlus size={12} />}
            onClick={() => {
              if (isProduct) {
                const t = menu.target as { seq: number; name: string; barcode?: string; price?: number };
                toggleProduct(t.seq, t.name, t.barcode, t.price);
              }
              else toggleTree(menu.target.seq, menu.target.name);
              setMenu(null);
            }}
          />
        )}
        {(st === 'in-scope' || st === 'staged-remove') && (
          <MenuItem
            label={isProduct ? 'إزالة من ' + scopeName : 'إزالة الشجرة'}
            icon={<IconX size={12} />}
            danger
            onClick={() => {
              if (isProduct) {
                const t = menu.target as { seq: number; name: string; barcode?: string; price?: number };
                toggleProduct(t.seq, t.name, t.barcode, t.price);
              }
              else toggleTree(menu.target.seq, menu.target.name);
              setMenu(null);
            }}
          />
        )}
        {st === 'staged-add' && (
          <MenuItem
            label="إلغاء التأشير"
            onClick={() => {
              if (isProduct) {
                const t = menu.target as { seq: number; name: string; barcode?: string; price?: number };
                toggleProduct(t.seq, t.name, t.barcode, t.price);
              }
              else toggleTree(menu.target.seq, menu.target.name);
              setMenu(null);
            }}
          />
        )}
        {st === 'staged-remove' && (
          <MenuItem
            label="إلغاء التأشير"
            onClick={() => {
              if (isProduct) {
                const t = menu.target as { seq: number; name: string; barcode?: string; price?: number };
                toggleProduct(t.seq, t.name, t.barcode, t.price);
              }
              else toggleTree(menu.target.seq, menu.target.name);
              setMenu(null);
            }}
          />
        )}
      </div>
    );
  }

  function enterFolder(node: { seq: number; name?: string }) {
    setPath(p => [...p, { seq: node.seq, name: fixEdariName(node.name) || `#${node.seq}` }]);
    setParent(node.seq);
    setSearch('');
    setDebounced('');
    setBarcodeHit(null);
  }

  function goUp() {
    const next = path.slice(0, -1);
    setPath(next);
    setParent(next.length ? next[next.length - 1].seq : undefined);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3"
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) { if (stagedCount === 0 || window.confirm('إغلاق دون حفظ التعديلات المؤشَّرة؟')) onClose(); } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        dir="rtl"
        className="flex h-[min(880px,92vh)] w-[min(1280px,95vw)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-2xl"
      >
        {/* ── الرأس ── */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-header">{title}</h2>
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-700">{scopeName}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 text-[10.5px] font-semibold sm:flex">
              <span className="flex items-center gap-1.5 text-red-600"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> مضاف حالياً</span>
              <span className="flex items-center gap-1.5 text-amber-700"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> مؤشَّر للإضافة</span>
              <span className="flex items-center gap-1.5 text-red-700"><span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-red-200" /> مؤشَّر للإزالة</span>
            </div>
            <button
              type="button"
              onClick={() => { if (!saving && (stagedCount === 0 || window.confirm('إغلاق دون حفظ التعديلات المؤشَّرة؟'))) onClose(); }}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
              title="إغلاق"
            >
              <IconX size={16} />
            </button>
          </div>
        </header>

        {/* ── الجسم: لوحتان كلٌّ مستقلة التمرير ── */}
        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-2">
          {/* الجهة اليمنى — الكتالوج */}
          <section className="flex min-h-0 flex-col overflow-hidden border-e border-slate-200 bg-white">
            <div className="shrink-0 space-y-2 border-b border-slate-100 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-bold text-header">الكتالوج</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${nodesQ.data?.source === 'edari' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                  {nodesQ.data?.source === 'edari' ? 'شجرة الإداري' : 'محلي'}
                </span>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                  <IconSearch size={14} />
                </span>
                <Input
                  autoFocus
                  value={search}
                  onChange={e => { setSearch(e.target.value); setBarcodeHit(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void onSearchEnter(); } }}
                  placeholder="بحث بالاسم/الباركود — Enter لا يضيف، فقط يؤشّر النتيجة"
                  className="py-1.5 pe-3 ps-8"
                />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <button type="button" onClick={goUp} disabled={path.length === 0}
                  className="rounded-lg px-2 py-1 font-semibold transition enabled:hover:bg-slate-100 disabled:opacity-40">
                  ↑ الجذر
                </button>
                <span className="truncate">/ {path.map(p => p.name).join(' / ')}</span>
              </div>
            </div>

            {/* تمرير مستقل — الكتالوج */}
            <div className="min-h-0 flex-1 overflow-y-auto" onScroll={() => setMenu(null)}>
              {nodesQ.isLoading && <Loading />}
              {!nodesQ.isLoading && rows.folders.length === 0 && rows.products.length === 0 && (
                <p className="p-8 text-center text-[12.5px] text-muted">لا نتائج — جرّب مصطلحاً أقصر أو امسح باركوداً</p>
              )}
              {rows.folders.map((n, idx) => {
                const st = treeState(n.seq);
                const name = fixEdariName(n.name) ?? n.num ?? `#${n.seq}`;
                return (
                  <div
                    key={n.seq}
                    ref={idx === 0 ? firstResultRef : undefined}
                    className={`group flex items-center gap-2 border-b border-slate-50 px-3.5 py-2 transition ${stateClasses[st]}`}
                    onContextMenu={e => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', seq: n.seq, name } });
                    }}
                  >
                    <button type="button" onClick={() => enterFolder(n)} className="flex min-w-0 flex-1 items-center gap-2.5 text-right">
                      <span className={`icon-tile h-8 w-8 ${st === 'in-scope' || st === 'staged-remove' ? 'bg-red-100 text-red-600' : st === 'staged-add' ? 'bg-amber-200 text-amber-800' : 'bg-amber-50 text-amber-600'}`}>
                        <IconFolderClosed size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className={`block truncate text-[13px] font-semibold ${st === 'staged-remove' ? 'text-red-400 line-through' : st === 'in-scope' ? 'text-red-700' : 'text-header'}`}>{name}</span>
                        <span className="block text-[10px] text-slate-400">
                          {st === 'in-scope' ? 'الشجرة مضافة — منتجاتها الجديدة تدخل تلقائياً' : 'شجرة — اضغط للدخول أو أضِف كامل منتجاتها'}
                        </span>
                      </span>
                    </button>
                    <StateBadge state={st} />
                    <button
                      type="button"
                      onClick={() => toggleTree(n.seq, name)}
                      title={st === 'normal' || st === 'staged-add' ? 'تأشير الشجرة للإضافة' : st === 'in-scope' ? 'تأشير الشجرة للإزالة' : 'إلغاء التأشير'}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                        st === 'normal' ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        : st === 'staged-add' ? 'bg-amber-300 text-amber-900 hover:bg-amber-400'
                        : st === 'in-scope' ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-red-500 text-white hover:bg-red-600'
                      }`}
                    >
                      {st === 'normal' || st === 'staged-add' ? '+ الشجرة' : st === 'in-scope' ? 'إزالة' : '✕ تراجع'}
                    </button>
                  </div>
                );
              })}
              {rows.products.map((n, idx) => {
                const st = productState(n.seq);
                const name = fixEdariName(n.name) ?? n.barcode ?? `#${n.seq}`;
                return (
                  <div
                    key={n.seq}
                    ref={rows.folders.length === 0 && idx === 0 ? firstResultRef : undefined}
                    className={`group flex cursor-pointer items-center gap-2 border-b border-slate-50 px-3.5 py-2 transition ${stateClasses[st]}`}
                    onClick={() => toggleProduct(n.seq, name, n.barcode ?? undefined, n.price ?? undefined)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'product', seq: n.seq, name, barcode: n.barcode ?? undefined, price: n.price ?? undefined } });
                    }}
                  >
                    <span className={`icon-tile h-8 w-8 ${st === 'in-scope' || st === 'staged-remove' ? 'bg-red-100 text-red-500' : st === 'staged-add' ? 'bg-amber-200 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      <IconPackage size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${st === 'staged-remove' ? 'font-medium text-red-400 line-through' : st === 'in-scope' ? 'font-semibold text-red-700' : 'font-medium text-header'}`}>
                        {name}
                      </span>
                      {n.barcode && <span className="block font-mono text-[10px] text-slate-400">{n.barcode}</span>}
                      {commissionGroupId != null && (
                        <CommissionGroupPills groups={othersBySeq.get(n.seq)} currentGroupId={commissionGroupId} mode="others" />
                      )}
                    </span>
                    {(n.price ?? 0) > 0 && (
                      <span className="shrink-0 text-[12px] font-bold tabular-nums text-slate-700">{formatNum(n.price ?? 0)}</span>
                    )}
                    <StateBadge state={st} />
                    <span className={`shrink-0 text-[10.5px] font-bold ${st === 'normal' || st === 'staged-add' ? 'text-brand-600 opacity-0 transition group-hover:opacity-100' : 'text-slate-400'}`}>
                      {st === 'normal' || st === 'staged-add' ? 'اضغط للتأشير' : st === 'in-scope' ? 'اضغط للإزالة' : 'اضغط للتراجع'}
                    </span>
                  </div>
                );
              })}
            </div>
            <footer className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-3.5 py-1.5 text-[10.5px] leading-4 text-slate-500">
              إضافة شجرة تُدخل كل منتجاتها الحالية — وأي منتج يُضاف لاحقاً لها في الإداري يدخل تلقائياً · كلك-يمين للقائمة
            </footer>
          </section>

          {/* الجهة اليسرى — المحتوى والتعديلات */}
          <section className="flex min-h-0 flex-col overflow-hidden bg-white">
            <div className="shrink-0 border-b border-slate-100 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-bold text-header">المحتوى الحالي</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {formatNum(trees.reduce((n, t) => n + t.count, 0) + standalone.length)} صنف · {formatNum(trees.length)} شجرة
                </span>
                {stagedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-800 ring-1 ring-amber-300">
                    {formatNum(stagedCount)} تعديل مؤشَّر — بانتظار الحفظ
                  </span>
                )}
              </div>
            </div>

            {/* تمرير مستقل — المحتوى */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {/* الأشجار الحالية */}
              {trees.map(t => {
                const st = removeTrees.has(t.treeSeq) ? 'staged-remove' : 'in-scope';
                return (
                  <div
                    key={t.treeSeq}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition ${st === 'staged-remove' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-red-200'}`}
                    onContextMenu={e => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', seq: t.treeSeq, name: t.treeName } });
                    }}
                  >
                    <span className={`icon-tile h-8 w-8 ${st === 'staged-remove' ? 'bg-red-100 text-red-500' : 'bg-amber-100 text-amber-700'}`}>
                      <IconFolderClosed size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] font-bold ${st === 'staged-remove' ? 'text-red-400 line-through' : 'text-header'}`}>{t.treeName}</span>
                      <span className="block text-[10.5px] text-slate-500">
                        {formatNum(t.count)} صنف داخل النطاق{t.excludedCount > 0 && ` · ${formatNum(t.excludedCount)} مستبعد`}
                        {t.discount != null && t.discount > 0 && ` · خصم ${formatNum(t.discount)}%`}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleTree(t.treeSeq, t.treeName)}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${st === 'staged-remove' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                    >
                      {st === 'staged-remove' ? '✕ تراجع' : 'تأشير للإزالة'}
                    </button>
                  </div>
                );
              })}

              {/* المنتجات المفردة */}
              {standalone.map(item => {
                const removing = item.seq != null && removeRows.has(item.seq);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition ${removing ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-red-200'}`}
                    onContextMenu={e => {
                      e.preventDefault();
                      if (item.seq == null) return;
                      setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'product', seq: item.seq, name: item.name, barcode: item.barcode, price: item.price } });
                    }}
                  >
                    <span className={`icon-tile h-7 w-7 ${removing ? 'bg-red-100 text-red-500' : 'bg-slate-100 text-slate-500'}`}><IconPackage size={13} /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12.5px] font-medium ${removing ? 'text-red-400 line-through' : 'text-header'}`}>{item.name}</span>
                      {(item.barcode || item.meta) && <span className="block truncate font-mono text-[10px] text-slate-400">{item.barcode ?? item.meta}</span>}
                    </span>
                    {(item.price ?? 0) > 0 && (
                      <span className="shrink-0 text-[12px] font-bold tabular-nums text-slate-700">{formatNum(item.price ?? 0)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleStandalone(item)}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${removing ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                    >
                      {removing ? '✕ تراجع' : 'تأشير للإزالة'}
                    </button>
                  </div>
                );
              })}

              {/* مؤشَّرات الإضافة */}
              {addTrees.size > 0 && (
                <div className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/70">
                  <p className="border-b border-amber-200 bg-amber-100/70 px-3 py-1.5 text-[11px] font-bold text-amber-800">
                    سيُضاف — أشجار ({formatNum(addTrees.size)})
                  </p>
                  {[...addTrees.values()].map(t => (
                    <div key={t.seq} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="icon-tile h-7 w-7 bg-amber-200 text-amber-800"><IconFolderClosed size={13} /></span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-amber-900">{t.name}</span>
                      <span className="text-[10px] text-slate-400">بكامل منتجاتها</span>
                      <button type="button" onClick={() => toggleTree(t.seq, t.name)} className="rounded-lg p-1 text-amber-600 transition hover:bg-amber-200 hover:text-amber-900">
                        <IconX size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {addProducts.size > 0 && (
                <div className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/70">
                  <p className="border-b border-amber-200 bg-amber-100/70 px-3 py-1.5 text-[11px] font-bold text-amber-800">
                    سيُضاف — منتجات ({formatNum(addProducts.size)})
                  </p>
                  {[...addProducts.values()].map(p => (
                    <div key={p.seq} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="icon-tile h-7 w-7 bg-amber-200 text-amber-800"><IconPackage size={13} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-amber-900">{p.name}</span>
                        {p.barcode && <span className="block font-mono text-[10px] text-amber-700/70">{p.barcode}</span>}
                      </span>
                      {(p.price ?? 0) > 0 && (
                        <span className="shrink-0 text-[12px] font-bold tabular-nums text-amber-900">{formatNum(p.price ?? 0)}</span>
                      )}
                      <button type="button" onClick={() => toggleProduct(p.seq, p.name, p.barcode, p.price)} className="rounded-lg p-1 text-amber-600 transition hover:bg-amber-200 hover:text-amber-900">
                        <IconX size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {trees.length === 0 && standalone.length === 0 && addTrees.size === 0 && addProducts.size === 0 && (
                <p className="p-8 text-center text-[12.5px] text-muted">
                  لا محتوى بعد — تأشّر الأصناف من الكتالوج (تصفر لأصفر) ثم اضغط حفظ
                </p>
              )}
            </div>
          </section>
        </div>

        {/* ── التذييل: لا حفظ إلا من هنا ── */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <p className="text-[11.5px] font-semibold text-slate-500">
            لا يُحفظ أي تعديل قبل الضغط على «حفظ» — التأشير قابل للتراجع بالضغط مجدداً
          </p>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" disabled={saving} onClick={() => { if (stagedCount === 0 || window.confirm('إغلاق دون حفظ التعديلات المؤشَّرة؟')) onClose(); }}>
              إلغاء
            </Btn>
            <Btn loading={saving} disabled={stagedCount === 0} onClick={() => void save()}>
              حفظ التعديلات{stagedCount > 0 ? ` (${formatNum(stagedCount)})` : ''}
            </Btn>
          </div>
        </footer>
      </div>

      {renderMenu()}
    </div>
  );
}

function MenuItem({ label, icon, danger, onClick }: { label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-right text-[12.5px] font-semibold transition ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
