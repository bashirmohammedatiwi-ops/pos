import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCommissionLabel, formatDate, formatNum, todayIso } from '@/api/client';
import type { CommissionRuleDto, CreateCommissionRuleRequest } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Btn, Checkbox, Field, Input, Loading, Select } from '@/components/ui';
import {
  EmptyWorkspace,
  FilterChip,
  RailCard,
  RailItem,
  RailList,
  RailTools,
  SettingsStrip,
  SoftChip,
  SplitWorkspace,
  StatusChip,
  UnsavedBar,
  WorkspacePanel,
} from '@/components/workspace';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { isLikelyBarcode, productSeq } from '@/lib/catalogBrowse';

export function CommissionRulesPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'on' | 'off'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'percentage' | 'fixed'>('all');
  const [editing, setEditing] = useState<CommissionRuleDto | 'new' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState<number | null>(null);
  const [prodQuery, setProdQuery] = useState('');
  const [type, setType] = useState('percentage');
  const [value, setValue] = useState('5');
  const [salesmanId, setSalesmanId] = useState('');
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState('');
  const [active, setActive] = useState(true);
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeErr, setBarcodeErr] = useState('');

  const rulesQ = useQuery({ queryKey: ['commission-rules'], queryFn: api.commissionRules });
  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen() });
  const productsQ = useQuery({
    queryKey: ['product-search', prodQuery],
    queryFn: () => api.searchProducts(prodQuery),
    enabled: prodQuery.trim().length >= 2 && !isLikelyBarcode(prodQuery),
  });

  const rules = useMemo(() => {
    const list = rulesQ.data ?? [];
    const s = search.trim().toLowerCase();
    return list.filter(r => {
      if (statusFilter === 'on' && !r.isActive) return false;
      if (statusFilter === 'off' && r.isActive) return false;
      if (typeFilter !== 'all' && (r.commissionType || '').toLowerCase() !== typeFilter) return false;
      if (!s) return true;
      return (
        (r.productName || '').toLowerCase().includes(s)
        || (r.barcode || '').toLowerCase().includes(s)
        || (r.salesmanName || '').toLowerCase().includes(s)
        || (r.label || '').toLowerCase().includes(s)
      );
    });
  }, [rulesQ.data, search, statusFilter, typeFilter]);

  function mark(next: () => void) {
    next();
    setDirty(true);
  }

  function resetForm() {
    setBarcode('');
    setProductId(null);
    setProductName('');
    setProductPrice(null);
    setProdQuery('');
    setType('percentage');
    setValue('5');
    setSalesmanId('');
    setLabel('');
    setFrom(todayIso());
    setTo('');
    setActive(true);
    setBarcodeErr('');
    setDirty(false);
  }

  function pickProduct(p: { id: number; seq: number; name?: string; barcode?: string; originalPrice?: number; price?: number }) {
    mark(() => {
      setProductId(productSeq(p));
      setProductName(p.name ?? '');
      setProductPrice(p.originalPrice ?? p.price ?? null);
      setBarcode(p.barcode ?? '');
      setProdQuery('');
      setBarcodeErr('');
    });
  }

  async function lookupBarcode(code = barcode) {
    const v = code.trim();
    if (!v) return;
    setBarcodeBusy(true);
    setBarcodeErr('');
    try {
      const p = await api.productByBarcode(v);
      pickProduct(p);
    } catch {
      setProductId(null);
      setProductName('');
      setProductPrice(null);
      setBarcodeErr('لا منتج بهذا الباركود');
    } finally {
      setBarcodeBusy(false);
    }
  }

  function confirmLeave() {
    if (!dirty) return true;
    return confirm('هناك تغييرات غير محفوظة. المتابعة بدون حفظ؟');
  }

  function openNew() {
    if (!confirmLeave()) return;
    resetForm();
    setEditing('new');
  }

  function openEdit(r: CommissionRuleDto) {
    if (editing !== 'new' && (editing as CommissionRuleDto | null)?.id === r.id) return;
    if (!confirmLeave()) return;
    setEditing(r);
    setBarcode(r.barcode ?? '');
    setProductId(r.productId ?? null);
    setProductName(r.productName ?? '');
    setProductPrice(null);
    setProdQuery('');
    setType(r.commissionType || 'percentage');
    setValue(String(r.commissionValue));
    setSalesmanId(r.salesmanId ? String(r.salesmanId) : '');
    setLabel(r.label ?? '');
    setFrom(r.effectiveFrom?.slice(0, 10) || todayIso());
    setTo(r.effectiveTo?.slice(0, 10) || '');
    setActive(r.isActive);
    setBarcodeErr('');
    setDirty(false);
  }

  useEffect(() => {
    if (editing === 'new' || dirty || !rules.length) return;
    if (editing && rules.some(r => r.id === (editing as CommissionRuleDto).id)) return;
    openEdit(rules[0]);
  }, [rules, editing, dirty]);

  function body(): CreateCommissionRuleRequest {
    return {
      productId,
      barcode: barcode.trim() || null,
      commissionType: type,
      commissionValue: Number(value) || 0,
      effectiveFrom: from || null,
      effectiveTo: to || null,
      salesmanId: salesmanId ? Number(salesmanId) : null,
      label: label.trim() || null,
    };
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!productId && !barcode.trim()) throw new Error('حدد منتجاً أو امسح باركوداً');
      if (editing === 'new') {
        await api.createCommissionRule(body());
        return;
      }
      if (editing) {
        await api.updateCommissionRule(editing.id, { ...body(), isActive: active });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-rules'] });
      setDirty(false);
      if (editing === 'new') {
        resetForm();
        setEditing(null);
      }
      toast.success('تم حفظ قاعدة العمولة');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  useSaveShortcut(() => {
    if (editing != null && !save.isPending) save.mutate();
  }, editing != null);

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteCommissionRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-rules'] });
      setEditing(null);
      resetForm();
      toast.success('تم حذف القاعدة');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحذف'),
  });

  const editorTitle = editing === 'new'
    ? 'قاعدة جديدة'
    : editing
      ? (productName || label || editing.productName || 'تعديل القاعدة')
      : '';

  return (
    <>
      {rulesQ.isLoading && <Loading />}

      {!rulesQ.isLoading && !rules.length && editing !== 'new' && (
        <EmptyWorkspace
          title={search || statusFilter !== 'all' || typeFilter !== 'all' ? 'لا نتائج مطابقة' : 'لا قواعد بعد'}
          hint="قاعدة لمنتج واحد تتجاوز عمولة المجموعة. امسح باركوداً أو ابحث عن المنتج."
          action={!search && statusFilter === 'all' && typeFilter === 'all' ? <Btn onClick={openNew}>+ قاعدة</Btn> : undefined}
        />
      )}

      {(!rulesQ.isLoading && (!!rules.length || editing === 'new')) && (
        <SplitWorkspace
          compact
          rail={
            <RailCard compact title={`القواعد (${rules.length})`} actions={<Btn size="sm" onClick={openNew}>+ قاعدة</Btn>}>
              <RailTools>
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث…" />
                <div className="flex flex-wrap gap-1">
                  <FilterChip active={statusFilter === 'all' && typeFilter === 'all'} onClick={() => { setStatusFilter('all'); setTypeFilter('all'); }}>الكل</FilterChip>
                  <FilterChip active={statusFilter === 'on'} onClick={() => setStatusFilter('on')}>نشطة</FilterChip>
                  <FilterChip active={statusFilter === 'off'} onClick={() => setStatusFilter('off')}>متوقفة</FilterChip>
                  <FilterChip active={typeFilter === 'percentage'} onClick={() => setTypeFilter('percentage')}>نسبة</FilterChip>
                  <FilterChip active={typeFilter === 'fixed'} onClick={() => setTypeFilter('fixed')}>مبلغ</FilterChip>
                </div>
              </RailTools>
              <RailList>
                {rules.map(r => (
                  <li key={r.id}>
                    <RailItem
                      active={editing !== 'new' && (editing as CommissionRuleDto | null)?.id === r.id}
                      title={r.productName || r.label || r.barcode || '—'}
                      meta={`${formatCommissionLabel(r.commissionType, r.commissionValue)} · ${r.salesmanName || 'الكل'} · ${formatDate(r.effectiveFrom)}`}
                      badge={<StatusChip active={r.isActive} onLabel="نشطة" offLabel="متوقفة" />}
                      onClick={() => openEdit(r)}
                    />
                  </li>
                ))}
                {!rules.length && (
                  <li className="px-3 py-6 text-center text-[12px] text-slate-400">لا نتائج — أنشئ قاعدة جديدة</li>
                )}
              </RailList>
            </RailCard>
          }
        >
          {editing == null ? (
            <EmptyWorkspace title="اختر قاعدة" hint="من القائمة اليمنى، أو أنشئ قاعدة جديدة." action={<Btn onClick={openNew}>+ قاعدة</Btn>} />
          ) : (
            <WorkspacePanel
              flush
              title={editorTitle}
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <SoftChip tone="brand">{formatCommissionLabel(type, Number(value) || 0)}</SoftChip>
                  {barcode && <span>{barcode}</span>}
                  <span>{salesmanId ? (salesmenQ.data?.items.find(s => String(s.id) === salesmanId)?.name ?? 'مندوب') : 'كل المندوبين'}</span>
                  {dirty && <SoftChip tone="brand">غير محفوظ</SoftChip>}
                </span>
              }
              actions={
                <>
                  {editing !== 'new' && (
                    <Btn
                      size="sm"
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => confirm('حذف قاعدة العمولة؟') && remove.mutate(editing.id)}
                    >
                      حذف
                    </Btn>
                  )}
                  <Btn size="sm" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                    {save.isPending ? 'جاري الحفظ…' : 'حفظ'}
                  </Btn>
                </>
              }
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <SettingsStrip>
                  <p className="text-[12px] font-semibold text-header">المنتج</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="بحث منتج">
                      <Input
                        value={prodQuery}
                        onChange={e => setProdQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (isLikelyBarcode(prodQuery)) {
                            setBarcode(prodQuery.trim());
                            void lookupBarcode(prodQuery);
                          }
                        }}
                        placeholder="اسم (حرفان) أو باركود ثم Enter"
                      />
                    </Field>
                    <Field label="باركود">
                      <div className="flex gap-2">
                        <Input
                          value={barcode}
                          onChange={e => mark(() => { setBarcode(e.target.value); setBarcodeErr(''); })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void lookupBarcode();
                            }
                          }}
                          placeholder="امسح أو اكتب ثم Enter"
                        />
                        <Btn size="sm" variant="secondary" disabled={barcodeBusy || !barcode.trim()} onClick={() => void lookupBarcode()}>
                          {barcodeBusy ? '…' : 'جلب'}
                        </Btn>
                      </div>
                    </Field>
                  </div>
                  {!!productsQ.data?.length && (
                    <ul className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      {productsQ.data.map(p => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-right text-[13px] hover:bg-slate-50"
                            onClick={() => pickProduct(p)}
                          >
                            <span className="min-w-0 truncate">{p.name}</span>
                            <span className="shrink-0 text-slate-500">
                              {p.barcode ? `${p.barcode} · ` : ''}
                              {formatNum(p.originalPrice)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(productName || barcode) && !barcodeErr && (
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
                      المحدد: {productName || '—'} {barcode ? `· ${barcode}` : ''}
                      {productPrice != null ? ` · السعر ${formatNum(productPrice)}` : ''}
                    </p>
                  )}
                  {barcodeErr && <p className="text-[12px] text-red-600">{barcodeErr}</p>}
                </SettingsStrip>

                <div className="space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="نوع العمولة">
                      <Select value={type} onChange={e => mark(() => setType(e.target.value))}>
                        <option value="percentage">نسبة مئوية</option>
                        <option value="fixed">مبلغ ثابت / قطعة</option>
                      </Select>
                    </Field>
                    <Field label={type === 'percentage' ? 'النسبة %' : 'د.ع / قطعة'}>
                      <Input type="number" value={value} onChange={e => mark(() => setValue(e.target.value))} />
                    </Field>
                    <Field label="المندوب">
                      <Select value={salesmanId} onChange={e => mark(() => setSalesmanId(e.target.value))}>
                        <option value="">كل المندوبين</option>
                        {(salesmenQ.data?.items ?? []).map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="تسمية داخلية">
                      <Input value={label} onChange={e => mark(() => setLabel(e.target.value))} placeholder="اختياري" />
                    </Field>
                    <Field label="من تاريخ">
                      <Input type="date" value={from} onChange={e => mark(() => setFrom(e.target.value))} />
                    </Field>
                    <Field label="إلى تاريخ">
                      <Input type="date" value={to} onChange={e => mark(() => setTo(e.target.value))} />
                    </Field>
                    {editing !== 'new' && (
                      <div className="flex items-end pb-1">
                        <Checkbox label="القاعدة نشطة" checked={active} onChange={v => mark(() => setActive(v))} />
                      </div>
                    )}
                  </div>
                </div>

                {dirty && (
                  <div className="mt-auto shrink-0 px-4 pb-3">
                    <UnsavedBar text="تغييرات غير محفوظة" onSave={() => save.mutate()} pending={save.isPending} />
                  </div>
                )}
              </div>
            </WorkspacePanel>
          )}
        </SplitWorkspace>
      )}
    </>
  );
}
