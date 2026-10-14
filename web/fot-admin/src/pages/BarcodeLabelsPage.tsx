import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatCurrency } from '@/api/client';
import type { ProductDto } from '@/api/types';
import { NumberDraftInput } from '@/components/NumberDraftInput';
import { useToast } from '@/components/Toast';
import { Btn, Checkbox, Input, Kbd, Select } from '@/components/ui';
import { IconAlert, IconBarcode, IconCheck, IconPrinter, IconSliders, IconTrash, IconX, IconZap } from '@/components/icons';
import {
  DEFAULT_SETUP,
  SIZE_PRESETS,
  renderCalibration,
  renderRow,
  rowWidthMm,
  toRows,
  type LabelContent,
  type LabelData,
  type LabelSetup,
  type LabelWarnings,
  type RenderedRow,
} from '@/lib/labels/labelRender';
import { fixEdariName } from '@/lib/text';

/* ─────────────────────────────────────────────────────────────────────────────
 * طباعة ملصقات الباركود — امسح أو ابحث، حدّد العدد، اطبع.
 * الرسم يتم بنقاط الطابعة نفسها (203/300 DPI)، فالمعاينة = المطبوع حرفياً.
 * ───────────────────────────────────────────────────────────────────────────── */

const STORE_KEY = 'fot-labels-v4';

type Prefs = LabelSetup & { printerName: string; defaultCopies: number; instantPrint: boolean };

type QueueItem = { key: string; productId: number; data: LabelData; copies: number };

const CONTENT_OPTIONS: { key: keyof LabelContent; label: string }[] = [
  { key: 'name', label: 'اسم المادة' },
  { key: 'price', label: 'السعر' },
  { key: 'oldPrice', label: 'السعر قبل الخصم' },
  { key: 'barcode', label: 'خطوط الباركود' },
  { key: 'digits', label: 'أرقام الباركود' },
  { key: 'shop', label: 'اسم المحل' },
];

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function loadPrefs(): Prefs {
  const base: Prefs = { ...DEFAULT_SETUP, content: { ...DEFAULT_SETUP.content }, printerName: '', defaultCopies: 1, instantPrint: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...base,
      widthMm: num(p.widthMm, base.widthMm, 15, 120),
      heightMm: num(p.heightMm, base.heightMm, 10, 100),
      columns: Math.round(num(p.columns, base.columns, 1, 4)),
      gapMm: num(p.gapMm, base.gapMm, 0, 10),
      sideMm: num(p.sideMm, base.sideMm, 0, 10),
      dpi: p.dpi === 300 ? 300 : 203,
      offsetXMm: num(p.offsetXMm, 0, -10, 10),
      offsetYMm: num(p.offsetYMm, 0, -10, 10),
      paddingMm: num(p.paddingMm, base.paddingMm, 0.6, 4),
      content: { ...base.content, ...(p.content ?? {}) },
      nameLines: p.nameLines === 1 ? 1 : 2,
      textScale: p.textScale === 'sm' || p.textScale === 'lg' ? p.textScale : 'md',
      currency: typeof p.currency === 'string' ? p.currency.slice(0, 8) : base.currency,
      printerName: typeof p.printerName === 'string' ? p.printerName : '',
      defaultCopies: Math.round(num(p.defaultCopies, 1, 1, 999)),
      instantPrint: Boolean(p.instantPrint),
    };
  } catch {
    return base;
  }
}

function savePrefs(p: Prefs) {
  try {
    const { shopName: _ignored, ...rest } = p;
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
  } catch {
    /* التخزين غير متاح — الإعدادات تبقى لهذه الجلسة */
  }
}

function toLabel(p: ProductDto): LabelData {
  const price = Number(p.price) || 0;
  const orig = Number(p.originalPrice) || 0;
  return {
    name: fixEdariName(p.name) || p.name || '',
    barcode: (p.barcode || p.num || '').trim(),
    price,
    oldPrice: orig > price ? orig : undefined,
  };
}

/** صورة الصف كما ستُطبع (data URL) — مع حماية من أخطاء الرسم. */
function rowsToPng(rows: RenderedRow[]) {
  return rows.map(r => r.canvas.toDataURL('image/png'));
}

/** طباعة من المتصفح (بدون تطبيق سطح المكتب): صفحة لكل صف بالحجم الحقيقي. */
function browserPrint(pngs: string[], widthMm: number, heightMm: number) {
  const w = window.open('', '_blank', 'width=720,height=640');
  if (!w) throw new Error('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة');
  const imgs = pngs.map(src => `<img src="${src}" />`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ملصقات</title><style>
@page{size:${widthMm}mm ${heightMm}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
img{display:block;width:${widthMm}mm;height:${heightMm}mm;page-break-after:always;break-after:page;image-rendering:pixelated}
img:last-child{page-break-after:auto;break-after:auto}
</style></head><body>${imgs}<script>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))).then(()=>{print();setTimeout(()=>close(),300)})</script></body></html>`);
  w.document.close();
}

export function BarcodeLabelsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [term, setTerm] = useState('');
  const [looking, setLooking] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showSettings, setShowSettings] = useState(true);
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const settingsQ = useQuery({ queryKey: ['print-settings'], queryFn: api.printSettings, staleTime: 120_000 });
  const shopName = (settingsQ.data?.headerText || settingsQ.data?.name || '').trim();
  const setup: LabelSetup = useMemo(() => ({ ...prefs, shopName }), [prefs, shopName]);

  const desktop = typeof window !== 'undefined' ? window.fotDesktop : undefined;
  const printersQ = useQuery({
    queryKey: ['desktop-printers'],
    queryFn: () => desktop!.listPrinters!(),
    enabled: Boolean(desktop?.listPrinters),
    staleTime: 60_000,
  });

  useEffect(() => savePrefs(prefs), [prefs]);

  const update = (patch: Partial<Prefs>) => setPrefs(p => ({ ...p, ...patch }));
  const setContent = (key: keyof LabelContent, v: boolean) => setPrefs(p => ({ ...p, content: { ...p.content, [key]: v } }));

  /* ── البحث ── */
  const trimmed = term.trim();
  const looksLikeCode = /^\S+$/.test(trimmed) && /\d{4,}/.test(trimmed);
  const searchQ = useQuery({
    queryKey: ['label-search', trimmed],
    queryFn: () => api.searchProducts(trimmed),
    enabled: trimmed.length >= 2 && !looksLikeCode,
    staleTime: 30_000,
  });
  const results = trimmed.length >= 2 && !looksLikeCode ? (searchQ.data ?? []).slice(0, 12) : [];
  useEffect(() => setActiveIdx(0), [trimmed]);

  async function printRows(rows: RenderedRow[], label: string) {
    if (!rows.length) return;
    setPrinting(true);
    try {
      const pngs = rowsToPng(rows);
      const { widthMm, heightMm } = rows[0];
      if (desktop?.printRaster) {
        const res = await desktop.printRaster(pngs, {
          widthMm,
          heightMm,
          dpi: prefs.dpi,
          printerName: prefs.printerName || null,
        });
        if (!res.ok) throw new Error(res.message || 'تعذرت الطباعة');
      } else {
        browserPrint(pngs, widthMm, heightMm);
      }
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function printItems(items: { data: LabelData; copies: number }[]) {
    const total = items.reduce((s, i) => s + Math.max(0, Math.round(i.copies)), 0);
    if (!total) return;
    const rows = toRows(items, setup.columns).map(r => renderRow(r, setup));
    void printRows(rows, `أُرسل ${total} ملصق للطابعة (${rows.length} صف)`);
  }

  function addProduct(p: ProductDto, copies = prefs.defaultCopies) {
    const data = toLabel(p);
    if (!data.barcode) {
      toast.error('هذه المادة بلا باركود ولا رقم مادة');
      return;
    }
    setTerm('');
    if (prefs.instantPrint) {
      printItems([{ data, copies }]);
      return;
    }
    const key = `${p.id}`;
    setQueue(q => {
      const i = q.findIndex(x => x.key === key);
      if (i >= 0) {
        const next = [...q];
        next[i] = { ...next[i], data, copies: Math.min(999, next[i].copies + copies) };
        // المادة الممسوحة تصعد للأعلى
        const [moved] = next.splice(i, 1);
        return [moved, ...next];
      }
      return [{ key, productId: p.id, data, copies }, ...q];
    });
    setLastAddedKey(key);
  }

  async function lookup(raw: string) {
    const code = raw.trim();
    if (!code) return;
    if (results.length && !looksLikeCode) {
      addProduct(results[Math.min(activeIdx, results.length - 1)]);
      return;
    }
    setLooking(true);
    try {
      const p = await api.productByBarcode(code);
      addProduct(p);
    } catch {
      // ليس باركوداً معروفاً — جرّب البحث بالاسم/الرقم
      try {
        const list = await api.searchProducts(code);
        const exact = list.find(x => x.barcode === code || x.num === code);
        if (exact) addProduct(exact);
        else if (list.length === 1) addProduct(list[0]);
        else toast.error(list.length ? 'عدة مواد مطابقة — اختر من القائمة' : `لا توجد مادة بالباركود ${code}`);
      } catch {
        toast.error(`لا توجد مادة بالباركود ${code}`);
      }
    } finally {
      setLooking(false);
    }
  }

  // ?q= من صفحة المواد
  const initialQ = params.get('q');
  useEffect(() => {
    if (!initialQ) return;
    const next = new URLSearchParams(params);
    next.delete('q');
    setParams(next, { replace: true });
    void lookup(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  useEffect(() => {
    if (!lastAddedKey) return;
    const t = setTimeout(() => setLastAddedKey(null), 900);
    return () => clearTimeout(t);
  }, [lastAddedKey]);

  /* ── المعاينة والتحذيرات ── */
  const previewItem: LabelData = queue[0]?.data ?? { name: 'كريم مرطب للبشرة الجافة 50 مل', barcode: '4007817327555', price: 12500, oldPrice: 15000 };
  const preview = useMemo(() => {
    try {
      const row = renderRow(Array.from({ length: setup.columns }, () => previewItem), setup, { outline: true });
      return { src: row.canvas.toDataURL('image/png'), warnings: row.warnings, widthMm: row.widthMm };
    } catch {
      return null;
    }
  }, [setup, previewItem]);

  const itemWarnings = useMemo(() => {
    const map = new Map<string, LabelWarnings>();
    for (const it of queue.slice(0, 200)) {
      try {
        map.set(it.key, renderRow([it.data], { ...setup, columns: 1, sideMm: 0, gapMm: 0 }).warnings);
      } catch {
        /* ignore */
      }
    }
    return map;
  }, [queue, setup]);

  const totalLabels = queue.reduce((s, i) => s + i.copies, 0);
  const totalRows = Math.ceil(totalLabels / setup.columns);
  const presetId = SIZE_PRESETS.find(p => p.w === prefs.widthMm && p.h === prefs.heightMm && p.cols === prefs.columns)?.id ?? 'custom';
  const printers = printersQ.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      {/* ── العمود الرئيسي: المسح + قائمة الطباعة ── */}
      <section className="card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white p-4">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-slate-400">
              {looking ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" /> : <IconBarcode size={22} />}
            </span>
            <input
              ref={inputRef}
              autoFocus
              value={term}
              onChange={e => setTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void lookup(term);
                } else if (e.key === 'ArrowDown' && results.length) {
                  e.preventDefault();
                  setActiveIdx(i => Math.min(results.length - 1, i + 1));
                } else if (e.key === 'ArrowUp' && results.length) {
                  e.preventDefault();
                  setActiveIdx(i => Math.max(0, i - 1));
                } else if (e.key === 'Escape') {
                  setTerm('');
                }
              }}
              placeholder="امسح الباركود أو اكتب اسم المادة…"
              className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-white ps-12 pe-4 text-[17px] font-semibold text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
            {results.length > 0 && (
              <div className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {results.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={e => {
                      e.preventDefault();
                      addProduct(p);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start ${i === activeIdx ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-slate-800">{fixEdariName(p.name)}</span>
                      <span className="num block text-[11.5px] text-slate-500" dir="ltr">{p.barcode || p.num || '—'}</span>
                    </span>
                    <span className="num shrink-0 text-[13px] font-extrabold text-brand-800">{formatCurrency(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-slate-600">
            <label className="flex items-center gap-2">
              <span className="font-semibold">عدد النسخ لكل مسح</span>
              <NumberDraftInput
                value={prefs.defaultCopies}
                onValueChange={n => update({ defaultCopies: n })}
                min={1}
                max={999}
                integer
                className="!h-8 !w-20 text-center num"
              />
            </label>
            <Checkbox
              checked={prefs.instantPrint}
              onChange={v => update({ instantPrint: v })}
              label={<span className="inline-flex items-center gap-1"><IconZap size={13} className="text-amber-500" />طباعة فورية عند المسح</span>}
            />
            <span className="ms-auto hidden items-center gap-1.5 text-slate-400 md:inline-flex">
              <Kbd>Enter</Kbd> إضافة · <Kbd>↑</Kbd><Kbd>↓</Kbd> اختيار · <Kbd>Esc</Kbd> مسح
            </span>
          </div>
        </div>

        {/* قائمة الطباعة */}
        <div className="min-h-0 flex-1 overflow-auto">
          {queue.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <IconBarcode size={32} />
              </div>
              <div className="text-[16px] font-extrabold text-slate-800">{prefs.instantPrint ? 'الطباعة الفورية مفعّلة' : 'قائمة الطباعة فارغة'}</div>
              <p className="max-w-sm text-[13px] leading-6 text-slate-500">
                {prefs.instantPrint
                  ? 'كل مادة تمسحها تُطبع مباشرة بعدد النسخ المحدد.'
                  : 'امسح باركود المادة أو ابحث باسمها. مسح نفس المادة مرة أخرى يزيد عدد نسخها.'}
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-[2] bg-slate-50 text-[11.5px] font-bold text-slate-500 shadow-[inset_0_-1px_0_#e2e8f0]">
                <tr>
                  <th className="w-10 px-3 py-2 text-center">#</th>
                  <th className="px-3 py-2 text-start">المادة</th>
                  <th className="px-3 py-2 text-start">الباركود</th>
                  <th className="px-3 py-2 text-start">السعر</th>
                  <th className="w-[150px] px-3 py-2 text-center">عدد الملصقات</th>
                  <th className="w-[120px] px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {queue.map((it, idx) => {
                  const w = itemWarnings.get(it.key);
                  const problem = w?.invalidBarcode
                    ? 'الباركود يحتوي رموزاً لا تُطبع'
                    : w?.barcodeTooLong
                      ? 'الباركود أطول من عرض الملصق — اختر ملصقاً أعرض'
                      : w?.barcodeThin
                        ? 'خطوط الباركود رفيعة جداً على هذا العرض — قد يصعب مسحها'
                        : null;
                  return (
                    <tr key={it.key} className={`border-b border-slate-100 transition-colors ${lastAddedKey === it.key ? 'bg-emerald-50' : 'hover:bg-slate-50/70'}`}>
                      <td className="num px-3 py-2 text-center text-slate-400">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-800">{it.data.name}</div>
                        {problem && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-amber-700">
                            <IconAlert size={12} />
                            {problem}
                          </div>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-slate-600" dir="ltr" style={{ textAlign: 'right' }}>{it.data.barcode}</td>
                      <td className="px-3 py-2">
                        <span className="num font-extrabold text-brand-800">{formatCurrency(it.data.price)}</span>
                        {it.data.oldPrice ? <span className="num ms-2 text-[11.5px] text-slate-400 line-through">{formatCurrency(it.data.oldPrice)}</span> : null}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <StepBtn onClick={() => setQueue(q => q.map(x => (x.key === it.key ? { ...x, copies: Math.max(1, x.copies - 1) } : x)))}>−</StepBtn>
                          <NumberDraftInput
                            value={it.copies}
                            onValueChange={n => setQueue(q => q.map(x => (x.key === it.key ? { ...x, copies: n } : x)))}
                            min={1}
                            max={999}
                            integer
                            className="!h-8 !w-16 text-center num font-bold"
                          />
                          <StepBtn onClick={() => setQueue(q => q.map(x => (x.key === it.key ? { ...x, copies: Math.min(999, x.copies + 1) } : x)))}>+</StepBtn>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <Btn size="xs" variant="ghost" icon={<IconPrinter size={13} />} disabled={printing} onClick={() => printItems([it])}>
                            طباعة
                          </Btn>
                          <button
                            type="button"
                            title="إزالة"
                            onClick={() => setQueue(q => q.filter(x => x.key !== it.key))}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <IconX size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* شريط الطباعة */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-4 py-3">
          <div className="text-[13px] text-slate-600">
            <span className="num font-extrabold text-slate-900">{queue.length}</span> مادة ·{' '}
            <span className="num font-extrabold text-slate-900">{totalLabels}</span> ملصق ·{' '}
            <span className="num font-extrabold text-slate-900">{totalRows}</span> صف
          </div>
          <div className="ms-auto flex items-center gap-2">
            {queue.length > 0 && (
              <Btn variant="ghost" size="md" icon={<IconTrash size={15} />} onClick={() => setQueue([])}>
                تفريغ
              </Btn>
            )}
            <Btn
              size="lg"
              icon={<IconPrinter size={17} />}
              loading={printing}
              disabled={!totalLabels || printing}
              onClick={() => printItems(queue)}
            >
              طباعة الكل ({totalLabels})
            </Btn>
          </div>
        </div>
      </section>

      {/* ── اللوحة الجانبية: المعاينة + الإعداد ── */}
      <aside className="card flex min-h-0 w-[330px] shrink-0 flex-col overflow-hidden max-lg:hidden 2xl:w-[380px]">
        <div className="border-b border-slate-100 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-extrabold text-slate-800">معاينة بالحجم الفعلي للطباعة</div>
            <span className="num rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500" dir="ltr">
              {prefs.widthMm}×{prefs.heightMm} mm · {prefs.dpi}dpi
            </span>
          </div>
          <div className="flex items-center justify-center rounded-xl bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:14px_14px] p-3 ring-1 ring-slate-200">
            {preview ? (
              <img
                src={preview.src}
                alt="معاينة الملصق"
                className="max-w-full bg-white shadow-sm ring-1 ring-slate-300"
                style={{ width: `${Math.min(330, preview.widthMm * (330 / Math.max(rowWidthMm(setup), 40)))}px` }}
              />
            ) : (
              <div className="py-8 text-[12px] text-rose-600">تعذر رسم المعاينة</div>
            )}
          </div>
          {preview?.warnings.barcodeTooLong && <Warn>الباركود لا يتسع في هذا العرض — اختر ملصقاً أعرض أو أقل أعمدة.</Warn>}
          {preview && !preview.warnings.barcodeTooLong && preview.warnings.barcodeThin && (
            <Warn>خطوط الباركود بعرض نقطة واحدة — يُقرأ بماسح جيد، والأفضل ملصق أعرض أو دقة 300.</Warn>
          )}
          <div className="mt-3 flex gap-2">
            <Btn
              variant="secondary"
              size="sm"
              className="flex-1"
              icon={<IconCheck size={14} />}
              disabled={printing}
              onClick={() => void printRows([renderCalibration(setup)], 'أُرسل ملصق المعايرة — تأكد أن الإطار على حافة الملصق تماماً')}
            >
              ملصق معايرة
            </Btn>
            <Btn variant="ghost" size="sm" icon={<IconSliders size={14} />} onClick={() => setShowSettings(v => !v)}>
              {showSettings ? 'إخفاء الإعداد' : 'الإعداد'}
            </Btn>
          </div>
        </div>

        {showSettings && (
          <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
            <Section title="حجم الملصق">
              <div className="grid grid-cols-2 gap-1.5">
                {SIZE_PRESETS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => update({ widthMm: p.w, heightMm: p.h, columns: p.cols, gapMm: p.gap })}
                    className={`rounded-lg border px-2 py-1.5 text-[12px] font-bold transition ${presetId === p.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="العرض (مم)">
                  <NumberDraftInput value={prefs.widthMm} onValueChange={n => update({ widthMm: n })} min={15} max={120} step={0.5} />
                </Field>
                <Field label="الارتفاع (مم)">
                  <NumberDraftInput value={prefs.heightMm} onValueChange={n => update({ heightMm: n })} min={10} max={100} step={0.5} />
                </Field>
                <Field label="الأعمدة في الصف">
                  <Select value={prefs.columns} onChange={e => update({ columns: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </Field>
                <Field label="الفراغ بين الملصقات">
                  <NumberDraftInput value={prefs.gapMm} onValueChange={n => update({ gapMm: n })} min={0} max={10} step={0.5} disabled={prefs.columns === 1} />
                </Field>
                <Field label="هامش الرول (يمين/يسار)">
                  <NumberDraftInput value={prefs.sideMm} onValueChange={n => update({ sideMm: n })} min={0} max={10} step={0.5} />
                </Field>
                <Field label="حشوة داخلية">
                  <NumberDraftInput value={prefs.paddingMm} onValueChange={n => update({ paddingMm: n })} min={0.6} max={4} step={0.1} />
                </Field>
              </div>
              <div className="mt-1.5 text-[11.5px] text-slate-500">
                عرض الصف الكامل: <span className="num font-bold text-slate-700">{Math.round(rowWidthMm(setup) * 10) / 10} مم</span> — يجب أن يطابق عرض الرول في تعريف الطابعة.
              </div>
            </Section>

            <Section title="محتوى الملصق">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {CONTENT_OPTIONS.map(o => (
                  <Checkbox
                    key={o.key}
                    checked={prefs.content[o.key]}
                    onChange={v => setContent(o.key, v)}
                    label={o.label}
                    disabled={o.key === 'shop' && !shopName}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Field label="أسطر الاسم">
                  <Select value={prefs.nameLines} onChange={e => update({ nameLines: e.target.value === '1' ? 1 : 2 })}>
                    <option value={1}>سطر</option>
                    <option value={2}>سطران</option>
                  </Select>
                </Field>
                <Field label="حجم النص">
                  <Select value={prefs.textScale} onChange={e => update({ textScale: e.target.value as Prefs['textScale'] })}>
                    <option value="sm">صغير</option>
                    <option value="md">متوسط</option>
                    <option value="lg">كبير</option>
                  </Select>
                </Field>
                <Field label="العملة">
                  <Input value={prefs.currency} maxLength={8} onChange={e => update({ currency: e.target.value })} />
                </Field>
              </div>
            </Section>

            <Section title="الطابعة">
              {desktop?.printRaster ? (
                <Field label="طابعة الملصقات">
                  <Select value={prefs.printerName} onChange={e => update({ printerName: e.target.value })}>
                    <option value="">الطابعة الافتراضية</option>
                    {printers.map(p => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                        {p.isDefault ? ' (افتراضية)' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
                  تعمل من المتصفح: ستظهر نافذة الطباعة — اختر طابعة الملصقات واضبط الهوامش على «بلا».
                </div>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label="دقة الطابعة">
                  <Select value={prefs.dpi} onChange={e => update({ dpi: e.target.value === '300' ? 300 : 203 })}>
                    <option value={203}>203 dpi</option>
                    <option value={300}>300 dpi</option>
                  </Select>
                </Field>
                <Field label="إزاحة أفقية">
                  <NumberDraftInput value={prefs.offsetXMm} onValueChange={n => update({ offsetXMm: n })} min={-10} max={10} step={0.5} />
                </Field>
                <Field label="إزاحة عمودية">
                  <NumberDraftInput value={prefs.offsetYMm} onValueChange={n => update({ offsetYMm: n })} min={-10} max={10} step={0.5} />
                </Field>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-5 text-slate-500">
                اطبع «ملصق معايرة»: إن خرج الإطار مزاحاً عن حافة الملصق، صحّحه بالإزاحة (بالمليمتر، موجب = يمين/أسفل).
              </p>
            </Section>
          </div>
        )}
      </aside>
    </div>
  );
}

function StepBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-[16px] font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100"
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11.5px] font-extrabold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold leading-5 text-amber-800">
      <IconAlert size={13} className="mt-0.5 shrink-0" />
      {children}
    </div>
  );
}

export default BarcodeLabelsPage;
