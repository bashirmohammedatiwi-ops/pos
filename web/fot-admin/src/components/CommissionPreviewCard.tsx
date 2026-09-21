import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, formatCommissionLabel, formatCurrency, formatNum } from '@/api/client';
import type { CommissionPreviewDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Btn, Field, Input, Select } from '@/components/ui';
import { isLikelyBarcode, productSeq } from '@/lib/catalogBrowse';

export function CommissionPreviewCard({ defaultSalesmanId = '' }: { defaultSalesmanId?: string }) {
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
      if (p.price) setPrice(String(p.price));
    } catch {
      toast.error('لا منتج بهذا الباركود');
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-bold text-header">محاكاة عمولة</h3>
          <p className="text-[12px] text-slate-500">جرّب منتجاً ومندوباً لمعرفة ما سيُحسب عند البيع.</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Field label="بحث / باركود">
          <Input
            value={prodQuery || barcode}
            onChange={e => {
              setProdQuery(e.target.value);
              setBarcode(e.target.value);
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (isLikelyBarcode(prodQuery || barcode)) void lookupBarcode(prodQuery || barcode);
              else preview.mutate();
            }}
            placeholder="اسم أو باركود ثم Enter"
          />
        </Field>
        <Field label="المندوب">
          <Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)}>
            <option value="">بدون / تلقائي</option>
            {(salesmenQ.data?.items ?? []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="كمية">
          <Input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} />
        </Field>
        <Field label="سعر القطعة">
          <Input type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Btn className="w-full" disabled={preview.isPending || (!articleId && !barcode.trim())} onClick={() => preview.mutate()}>
            {preview.isPending ? 'جاري…' : 'احسب'}
          </Btn>
        </div>
      </div>
      {!!productsQ.data?.length && (
        <ul className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-border">
          {productsQ.data.map(p => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between px-3 py-1.5 text-right text-[13px] hover:bg-slate-50"
                onClick={() => {
                  setArticleId(productSeq(p));
                  setProductName(p.name ?? '');
                  setBarcode(p.barcode ?? '');
                  setProdQuery('');
                  if (p.price) setPrice(String(p.price));
                }}
              >
                <span>{p.name}</span>
                <span className="text-slate-400">{p.barcode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(productName || result?.productName) && (
        <p className="mt-2 text-[12px] text-slate-600">المنتج: {result?.productName ?? productName}</p>
      )}
      {result && (
        <div className={`mt-3 rounded-xl border px-3 py-3 ${result.matched ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className="text-[13px] font-semibold">{result.message}</p>
          {result.matched && (
            <p className="mt-1 text-[18px] font-bold tabular-nums text-emerald-800">
              {formatCurrency(result.commissionAmount)}
              <span className="ms-2 text-[12px] font-medium text-slate-600">
                {formatCommissionLabel(result.commissionType ?? 'fixed', result.commissionValue)}
                {result.groupName ? ` · ${result.groupName}` : ''}
                {result.source === 'rule' ? ' · قاعدة فردية' : ''}
              </span>
            </p>
          )}
          {result.resolvedSalesmanId > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">مندوب الحساب #{formatNum(result.resolvedSalesmanId)}</p>
          )}
        </div>
      )}
    </div>
  );
}
