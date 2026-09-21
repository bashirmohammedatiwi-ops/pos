import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCurrency, formatDate, formatNum } from '@/api/client';
import type { DiscountQrPersonDto, DiscountQrReceiptDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { Btn, Input } from '@/components/ui';
import { ClassicListShell, ClassicSummaryFooter, FilterField } from '@/components/classic/ClassicListLayout';
import { discountQrDataUrl, printDiscountQr } from '@/lib/qrPng';

export function DiscountQrPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  const peopleQ = useQuery({
    queryKey: ['discount-qr-people'],
    queryFn: api.discountQrPeople,
  });
  const people = peopleQ.data ?? [];
  const selected = people.find(p => p.id === selectedId) ?? people[0] ?? null;

  const receiptsQ = useQuery({
    queryKey: ['discount-qr-receipts', selected?.id],
    queryFn: () => api.discountQrReceipts(selected!.id),
    enabled: !!selected,
  });

  useEffect(() => {
    if (!selected) {
      setQrSrc(null);
      return;
    }
    let cancelled = false;
    void discountQrDataUrl(selected.code, 320).then(src => {
      if (!cancelled) setQrSrc(src);
    });
    return () => { cancelled = true; };
  }, [selected?.id, selected?.code]);

  const createM = useMutation({
    mutationFn: () => api.createDiscountQrPerson(name),
    onSuccess: created => {
      setName('');
      setSelectedId(created.id);
      toast.success(`تم توليد رمز لـ ${created.name}`);
      void qc.invalidateQueries({ queryKey: ['discount-qr-people'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateM = useMutation({
    mutationFn: (req: { id: number; active?: boolean; name?: string }) =>
      api.updateDiscountQrPerson(req.id, { active: req.active, name: req.name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['discount-qr-people'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = useMemo<GridColumn<DiscountQrPersonDto>[]>(() => [
    { key: 'name', header: 'الشخص', width: 180, render: p => <span className="font-semibold text-header">{p.name}</span> },
    {
      key: 'active',
      header: 'الحالة',
      width: 80,
      align: 'center',
      render: p => (
        <span className={p.active ? 'font-semibold text-emerald-700' : 'text-slate-400'}>
          {p.active ? 'فعال' : 'متوقف'}
        </span>
      ),
    },
    { key: 'receiptCount', header: 'فواتير', width: 70, mono: true, footer: 'sum', render: p => formatNum(p.receiptCount) },
    {
      key: 'totalDiscount',
      header: 'مجموع الخصم',
      width: 110,
      mono: true,
      footer: 'sum',
      render: p => (p.totalDiscount > 0 ? formatCurrency(p.totalDiscount) : '—'),
    },
  ], []);

  const receiptColumns = useMemo<GridColumn<DiscountQrReceiptDto>[]>(() => [
    { key: 'number', header: 'الفاتورة', width: 110, mono: true, render: r => <span className="font-bold">{r.number}</span> },
    { key: 'creationDate', header: 'التاريخ', width: 140, render: r => formatDate(r.creationDate) },
    { key: 'cashierName', header: 'الكاشير', width: 110, render: r => r.cashierName ?? '—' },
    { key: 'userDiscount', header: 'الخصم', width: 100, mono: true, footer: 'sum', render: r => formatCurrency(r.userDiscount) },
    { key: 'totalAmount', header: 'الصافي', width: 100, mono: true, footer: 'sum', render: r => formatCurrency(r.totalAmount) },
  ], []);

  const receipts = receiptsQ.data ?? [];

  return (
    <ClassicListShell
      filters={(
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label="اسم الشخص" className="w-[220px]">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="مثال: أحمد"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (name.trim()) createM.mutate();
                }
              }}
            />
          </FilterField>
          <Btn disabled={!name.trim() || createM.isPending} onClick={() => createM.mutate()}>
            توليد QR
          </Btn>
        </div>
      )}
      footer={(
        <ClassicSummaryFooter
          items={[
            { label: 'الأشخاص', value: formatNum(people.length) },
            { label: 'فعال', value: formatNum(people.filter(p => p.active).length) },
            { label: 'فواتير خصم', value: formatNum(people.reduce((s, p) => s + p.receiptCount, 0)) },
          ]}
        />
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      <div className="grid min-h-[320px] flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <DataGrid
            columns={columns}
            rows={people}
            getRowId={p => p.id}
            selectedId={selected?.id}
            onRowClick={p => setSelectedId(p.id)}
            maxHeight="100%"
            counterLabel="شخص"
            emptyText="لا أشخاص بعد — أضف اسماً وولّد له رمزاً"
            exportName="رموز-خصم-الفاتورة"
          />
        </div>

        <aside className="flex min-h-0 flex-col gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            {selected ? (
              <>
                <div className="text-[15px] font-bold text-header">{selected.name}</div>
                <p className="mb-2 text-[11px] text-slate-500">امسح هذا الرمز في نقطة البيع كمنتج لفتح خصم غير محدود</p>
                {qrSrc && <img src={qrSrc} alt={selected.code} className="mx-auto h-[220px] w-[220px]" />}
                <code className="mt-2 block text-[11px] tracking-wide text-slate-500" dir="ltr">{selected.code}</code>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Btn
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void printDiscountQr(selected.name, selected.code).catch(e => {
                        toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
                      });
                    }}
                  >
                    طباعة الرمز
                  </Btn>
                  <Btn
                    size="sm"
                    variant="secondary"
                    onClick={() => updateM.mutate({ id: selected.id, active: !selected.active })}
                  >
                    {selected.active ? 'إيقاف' : 'تفعيل'}
                  </Btn>
                </div>
              </>
            ) : (
              <p className="py-10 text-[12px] text-slate-500">اختر شخصاً لعرض رمزه</p>
            )}
          </div>
        </aside>
      </div>

      {selected && (
        <div className="mt-3 min-h-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2 text-[13px] font-bold text-header">
            فواتير خُصمت بواسطة {selected.name}
          </div>
          <DataGrid
            columns={receiptColumns}
            rows={receipts}
            getRowId={r => r.id}
            maxHeight="260px"
            counterLabel="فاتورة"
            emptyText="لا فواتير خصم بعد لهذا الشخص"
            exportName={`خصم-${selected.name}`}
          />
        </div>
      )}
      </div>
    </ClassicListShell>
  );
}

export default DiscountQrPage;
