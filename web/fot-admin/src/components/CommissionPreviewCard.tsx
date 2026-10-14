import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, formatCommissionLabel, formatNum } from '@/api/client';
import type { CommissionPreviewDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Btn, Field, Input, Select } from '@/components/ui';
import { IconCheckCircle, IconAlert, IconX } from '@/components/icons';
import { isLikelyBarcode, productSeq } from '@/lib/catalogBrowse';

/** محاكاة عمولة: منتج + بائع + كمية ⟵ ما سيُحسب فعلاً عند البيع. */
export function CommissionPreviewCard({
  defaultSalesmanId = '',
  embedded,
}: {
  defaultSalesmanId?: string;
  /** داخل لوحة أخرى — بلا إطار أو عنوان. */
  embedded?: boolean;
}) {
  const toast = useToast();
  const [barcode, setBarcode] = useState('');
  const [articleId, setArticleId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [salesmanId, setSalesmanId] = useState(defaultSalesmanId);
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [prodQuery, setProdQuery] = useState('');
  const [result, setResult] = useState<CommissionPreviewDto | null>(null);

  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen() });
  const productsQ = useQuery({
    queryKey: ['product-search', prodQuery],
    queryFn: () => api.searchProducts(prodQuery),
    enabled: prodQuery.trim().length >= 2 && !isLikelyBarcode(prodQuery),
  });

  const preview = useMutation({
    mutationFn: () =>
      api.previewCommission({
        articleId,
        barcode: barcode.trim() || null,
        salesmanId: salesmanId ? Number(salesmanId) : 0,
        quantity: Number(qty) || 1,
        price: Number(price) || 0,
      }),
    onSuccess: setResult,
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل المحاكاة'),
  });

  async function lookupBarcode(code = barcode) {
    const value = code.trim();
    if (!value) return;
    try {
      const p = await api.productByBarcode(value);
      setArticleId(productSeq(p));
      setProductName(p.name ?? '');
      setBarcode(p.barcode ?? value);
      setProdQuery('');
      if (p.price) setPrice(String(p.price));
    } catch {
      toast.error('لا منتج بهذا الباركود');
    }
  }

  function clearProduct() {
    setArticleId(null);
    setProductName('');
    setBarcode('');
    setProdQuery('');
    setResult(null);
  }

  const canRun = !!articleId || !!barcode.trim();

  const body = (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (canRun) preview.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_90px_130px_auto]">
        <Field label="المنتج (اسم أو باركود)">
          <div className="relative">
            <Input
              value={prodQuery || barcode}
              onChange={e => {
                setProdQuery(e.target.value);
                setBarcode(e.target.value);
                setArticleId(null);
                setResult(null);
              }}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                const v = prodQuery || barcode;
                if (isLikelyBarcode(v) && !articleId) {
                  e.preventDefault();
                  void lookupBarcode(v);
                }
              }}
              placeholder="اسم أو باركود ثم Enter"
              className={productName ? 'pe-8' : ''}
            />
            {(prodQuery || barcode) && (
              <button
                type="button"
                onClick={clearProduct}
                className="absolute inset-y-0 left-2 flex items-center px-1 text-slate-400 hover:text-slate-700"
                aria-label="مسح المنتج"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        </Field>
        <Field label="البائع">
          <Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)}>
            <option value="">بدون / تلقائي</option>
            {(salesmenQ.data?.items ?? []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="الكمية">
          <Input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} className="num" />
        </Field>
        <Field label="سعر القطعة (IQD)">
          <Input type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} className="num" />
        </Field>
        <div className="flex items-end">
          <Btn type="submit" className="w-full" loading={preview.isPending} disabled={!canRun}>احسب</Btn>
        </div>
      </div>

      {!!productsQ.data?.length && !articleId && (
        <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {productsQ.data.map(p => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-right text-[13px] hover:bg-slate-50"
                onClick={() => {
                  setArticleId(productSeq(p));
                  setProductName(p.name ?? '');
                  setBarcode(p.barcode ?? '');
                  setProdQuery('');
                  if (p.price) setPrice(String(p.price));
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className="num shrink-0 text-[11.5px] text-slate-400">{p.barcode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(productName || result?.productName) && (
        <p className="mt-2 text-[12px] text-slate-600">المنتج: <span className="font-semibold text-header">{result?.productName ?? productName}</span></p>
      )}

      {result && (
        <div className={`mt-3 flex items-start gap-3 rounded-lg border px-3 py-3 ${result.matched ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70'}`}>
          <span className={`mt-0.5 ${result.matched ? 'text-emerald-600' : 'text-amber-600'}`}>
            {result.matched ? <IconCheckCircle size={18} /> : <IconAlert size={18} />}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-header">{result.message}</p>
            {result.matched && (
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="num text-[20px] font-bold text-emerald-800">{formatNum(result.commissionAmount)}</span>
                <span className="text-[12px] text-slate-500">IQD</span>
                <span className="text-[12px] text-slate-600">
                  {formatCommissionLabel(result.commissionType ?? 'fixed', result.commissionValue)}
                  {result.groupName ? ` · ${result.groupName}` : ''}
                  {result.source === 'rule' ? ' · قاعدة فردية' : ''}
                </span>
              </p>
            )}
            {result.resolvedSalesmanId > 0 && (
              <p className="mt-1 text-[11.5px] text-slate-500">بائع الحساب #{formatNum(result.resolvedSalesmanId)}</p>
            )}
          </div>
        </div>
      )}
    </form>
  );

  if (embedded) return <div dir="rtl">{body}</div>;

  return (
    <section className="card p-4" dir="rtl">
      <h3 className="text-[14px] font-bold text-header">محاكاة عمولة</h3>
      <p className="mb-3 text-[12px] text-slate-500">جرّب منتجاً وبائعاً لمعرفة ما سيُحسب عند البيع.</p>
      {body}
    </section>
  );
}
