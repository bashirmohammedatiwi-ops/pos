import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { CashierVoidEventDto, CashierVoidSummaryDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { IconActivity } from '@/components/icons';
import { Badge, EmptyState, Loading } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import {
  ChartBlock,
  ChartToggle,
  ExcelBtn,
  HBarChart,
  Money,
  PeriodSelector,
  PrintBtn,
  ReportBanner,
  ReportError,
  ReportFill,
  ReportNote,
  ReportSplit,
  useChartDock,
  useReportPeriod,
} from './ReportKit';

function pretty(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'short' });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(source?: string | null) {
  return source === 'deferred' ? 'فاتورة مؤجلة' : 'فاتورة جارية';
}

function nameOf(raw?: string | null) {
  const fixed = fixEdariName(raw || '');
  return fixed || raw || 'كاشير';
}

const cashierColumns: GridColumn<CashierVoidSummaryDto>[] = [
  { key: 'cashierName', header: 'الكاشير', width: 200, sortValue: r => nameOf(r.cashierName), exportValue: r => nameOf(r.cashierName), render: r => <span className="font-semibold text-header">{nameOf(r.cashierName)}</span> },
  { key: 'deletedLines', header: 'بنود محذوفة', width: 120, mono: true, footer: 'sum' },
  { key: 'deletedAmount', header: 'قيمة المحذوف', width: 140, mono: true, footer: 'sum', render: r => formatCurrency(r.deletedAmount) },
  { key: 'cancelledInvoices', header: 'فواتير ملغاة', width: 120, mono: true, footer: 'sum' },
  { key: 'cancelledAmount', header: 'قيمة الإلغاء', width: 140, mono: true, footer: 'sum', render: r => <span className="font-semibold text-slate-700">{formatCurrency(r.cancelledAmount)}</span> },
];

export function CashierVoidsApp({ onClose }: { onClose: () => void }) {
  const period = useReportPeriod({
    storageKey: 'cashier-voids',
    presets: ['today', 'yesterday', 'week', 'lastWeek', 'month', 'custom'],
    fallback: 'today',
  });
  const range = period.range;
  const [cashierId, setCashierId] = useState<number | null>(null);

  const summaryQ = useQuery({
    queryKey: ['cashier-voids', range.from, range.to],
    queryFn: () => api.cashierVoids(range.from, range.to),
  });

  const detailQ = useQuery({
    queryKey: ['cashier-voids', cashierId, range.from, range.to],
    queryFn: () => api.cashierVoidDetail(cashierId!, range.from, range.to),
    enabled: cashierId != null,
  });

  const cashiers = summaryQ.data?.cashiers ?? [];
  const selected = cashiers.find(c => c.cashierId === cashierId) ?? null;

  useEffect(() => {
    if (cashierId != null && summaryQ.isSuccess && !cashiers.some(c => c.cashierId === cashierId)) {
      setCashierId(null);
    }
  }, [cashierId, cashiers, summaryQ.isSuccess]);

  const days = useMemo(() => {
    const groups = new Map<string, CashierVoidEventDto[]>();
    for (const event of detailQ.data ?? []) {
      const key = dayKey(event.createdAt);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [detailQ.data]);

  function sheets(): ReportExcelSheet[] {
    const periodText = `${range.from}${range.from !== range.to ? ` → ${range.to}` : ''}`;
    const out: ReportExcelSheet[] = [{
      name: 'ملخص الكاشيرات',
      title: 'حذف وإلغاء — ملخص',
      subtitle: periodText,
      headers: ['الكاشير', 'بنود محذوفة', 'فواتير ملغاة', 'قيمة المحذوف', 'قيمة الإلغاء'],
      columnWidths: [140, 88, 88, 96, 96],
      rows: cashiers.map(c => [
        nameOf(c.cashierName),
        c.deletedLines,
        c.cancelledInvoices,
        c.deletedAmount,
        c.cancelledAmount,
      ]),
    }];
    if (detailQ.data?.length) {
      out.push({
        name: 'تفاصيل',
        title: `تفاصيل — ${nameOf(selected?.cashierName)}`,
        subtitle: periodText,
        headers: ['التاريخ', 'الوقت', 'النوع', 'الوصف', 'الكمية', 'المبلغ', 'رقم الفاتورة', 'المصدر'],
        columnWidths: [88, 56, 72, 180, 64, 88, 80, 72],
        rows: (detailQ.data ?? []).flatMap(event => {
          if (event.kind === 'invoice') {
            if (event.lines.length === 0) {
              return [[
                dayKey(event.createdAt),
                clock(event.createdAt),
                'فاتورة ملغاة',
                `فاتورة ${event.receiptNum ? `#${event.receiptNum}` : ''}`,
                event.lineCount,
                event.amount,
                event.receiptNum ?? '',
                sourceLabel(event.source),
              ]];
            }
            return event.lines.map(line => [
              dayKey(event.createdAt),
              clock(event.createdAt),
              'فاتورة ملغاة',
              line.name || line.barcode || 'بند',
              line.quantity,
              line.amount,
              event.receiptNum ?? '',
              sourceLabel(event.source),
            ]);
          }
          return [[
            dayKey(event.createdAt),
            clock(event.createdAt),
            'حذف بند',
            event.productName || event.barcode || 'بند',
            event.quantity,
            event.amount,
            event.receiptNum ?? '',
            sourceLabel(event.source),
          ]];
        }),
      });
    }
    if (!out[0].rows.length && !detailQ.data?.length) return [];
    return out;
  }

  const data = summaryQ.data;
  const loading = summaryQ.isLoading;
  const canExport = !!data && (cashiers.length > 0 || !!detailQ.data?.length);
  const dock = useChartDock();

  const chart = cashiers.length > 1 ? (
    <ChartBlock title="المقارنة بين الكاشيرات" subtitle="عدد العمليات — اضغط على كاشير للتفاصيل">
      <HBarChart
        series={[
          { key: 'lines', label: 'بنود محذوفة' },
          { key: 'invoices', label: 'فواتير ملغاة' },
        ]}
        onSelect={item => setCashierId(Number(item.id))}
        items={[...cashiers]
          .sort((a, b) => (b.deletedLines + b.cancelledInvoices) - (a.deletedLines + a.cancelledInvoices))
          .slice(0, 12)
          .map(c => ({
            id: c.cashierId,
            label: nameOf(c.cashierName),
            values: [c.deletedLines, c.cancelledInvoices],
            sub: `القيمة ${formatCurrency(c.deletedAmount + c.cancelledAmount)}`,
          }))}
      />
    </ChartBlock>
  ) : null;

  function renderDetail(c: CashierVoidSummaryDto) {
    if (c.cashierId !== cashierId) return null;
    return (
      <div className="max-h-[50vh] overflow-y-auto bg-white px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2">
          <IconActivity size={14} className="text-slate-400" />
          <p className="text-[12.5px] font-bold text-header">{nameOf(c.cashierName)}</p>
          <span className="text-[11.5px] text-slate-500">
            {formatNum(c.deletedLines)} بند محذوف · {formatNum(c.cancelledInvoices)} فاتورة ملغاة
          </span>
        </div>
        {detailQ.isLoading && <Loading />}
        {detailQ.isError && <ReportError error={detailQ.error} title="تعذّر جلب التفاصيل" onRetry={() => void detailQ.refetch()} />}
        {detailQ.isSuccess && days.length === 0 && <EmptyState compact title="لا تفاصيل في هذه المدة" />}
        <div className="space-y-3">
          {days.map(([day, events]) => {
            const invoices = events.filter(e => e.kind === 'invoice');
            const lines = events.filter(e => e.kind === 'line');
            return (
              <div key={day}>
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[12px] font-bold text-header">{pretty(day)}</p>
                  <span className="h-px flex-1 bg-slate-100" />
                  <span className="text-[11px] text-slate-400 num">{formatNum(events.length)} عملية</span>
                </div>
                {invoices.map(event => (
                  <article key={event.id} className="mt-1 rounded-md border border-red-100 bg-red-50/50 px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-[12.5px] font-bold text-header">
                        <Badge tone="danger">فاتورة ملغاة</Badge>
                        {event.receiptNum ? <span className="num">#{event.receiptNum}</span> : null}
                      </p>
                      <p className="text-[11.5px] text-slate-500">
                        <span className="num">{clock(event.createdAt)}</span> · {sourceLabel(event.source)} · <span className="num">{formatNum(event.lineCount)}</span> بند ·{' '}
                        <span className="font-semibold text-slate-700 num">{formatCurrency(event.amount)}</span>
                      </p>
                    </div>
                    {event.lines.length === 0 ? (
                      <p className="mt-1 text-[11.5px] text-slate-400">بدون بنود</p>
                    ) : (
                      <ul className="mt-1 divide-y divide-red-100/70">
                        {event.lines.map((line, index) => (
                          <li key={`${event.id}-${index}`} className="flex justify-between gap-3 py-0.5 text-[12px] text-slate-700">
                            <span className="truncate font-medium">
                              {line.name || line.barcode || 'بند'}
                              <span className="ms-2 text-slate-400 num">× {formatNum(line.quantity)}</span>
                            </span>
                            <span className="shrink-0 font-semibold num">{formatCurrency(line.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
                {lines.length > 0 && (
                  <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-100">
                    {lines.map(event => (
                      <li key={event.id} className="flex items-center justify-between gap-3 bg-slate-50/60 px-2.5 py-1 text-[12px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge tone="warn">حذف بند</Badge>
                          <span className="truncate font-medium text-slate-800">{event.productName || event.barcode || 'بند'}</span>
                          <span className="shrink-0 text-slate-400 num">
                            × {formatNum(event.quantity)} · {clock(event.createdAt)}
                            {event.source === 'deferred' ? ' · مؤجلة' : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold text-slate-600 num">{formatCurrency(event.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #fb7185 0%, #be123c 100%)"
      title="حذف وإلغاء"
      subtitle={`بنود محذوفة وفواتير ملغاة لكل كاشير · ${period.label}`}
      icon={<IconActivity size={16} />}
      toolbar={<PeriodSelector state={period} />}
      actions={
        <>
          <ExcelBtn fileName={`cashier-voids_${range.from}_${range.to}`} getSheets={sheets} disabled={!canExport} />
          <PrintBtn title={`حذف وإلغاء (${range.from} — ${range.to})`} getSheets={sheets} disabled={!canExport} />
        </>
      }
      onClose={onClose}
    >
      <ReportFill>
        {summaryQ.isError && (
          <ReportBanner><ReportError error={summaryQ.error} onRetry={() => void summaryQ.refetch()} /></ReportBanner>
        )}

        <SummaryStrip
          loading={loading}
          cells={[
            { label: 'بنود محذوفة', value: formatNum(data?.deletedLines ?? 0), tone: (data?.deletedLines ?? 0) > 0 ? 'warn' : undefined },
            { label: 'قيمة المحذوف', value: <Money value={data?.deletedAmount ?? 0} /> },
            { label: 'فواتير ملغاة', value: formatNum(data?.cancelledInvoices ?? 0), tone: (data?.cancelledInvoices ?? 0) > 0 ? 'danger' : undefined },
            { label: 'قيمة الإلغاء', value: <Money value={data?.cancelledAmount ?? 0} /> },
            { label: 'كاشيرات', value: formatNum(cashiers.length) },
          ]}
        />

        <ReportNote bar>العداد يبدأ من العمليات بعد تثبيت التحديث على نقاط البيع. اضغط على كاشير لعرض التفاصيل يوماً بيوم.</ReportNote>

        <ReportSplit chart={chart} open={dock.open}>
          <DataGrid
            variant="sheet"
            embedded
            fillHeight
            columns={cashierColumns}
            rows={cashiers}
            getRowId={r => r.cashierId}
            loading={loading}
            storageKey="cashier-voids-summary"
            exportName={`حذف-وإلغاء-${range.from}_${range.to}`}
            counterLabel="كاشير"
            emptyText={data ? 'لا حذف ولا إلغاء في هذه المدة' : 'لا بيانات'}
            selectedId={cashierId ?? undefined}
            expansion={{
              isExpanded: r => r.cashierId === cashierId,
              onToggle: r => setCashierId(id => (id === r.cashierId ? null : r.cashierId)),
              render: r => renderDetail(r),
            }}
            toolbar={chart ? <ChartToggle dock={dock} /> : undefined}
          />
        </ReportSplit>
      </ReportFill>
    </ReportAppWindow>
  );
}
