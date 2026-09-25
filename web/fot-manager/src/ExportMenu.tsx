import { useState } from 'react';
import { downloadText } from './api';
import { buildPeriodReport, reportExcel, reportHtml } from './reportFile';
import { useManager } from './store';
import { Sheet, useToast } from './ui';

export function ExportMenu({ title = 'تقرير المدير', pay = false }: { title?: string; pay?: boolean }) {
  const {
    period, payPeriod, periodTotals, payTotals, scopedSellers, paySellers, scopedCashiers, activityLines, payLines, dash,
  } = useManager();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const bounds = pay ? payPeriod : period;
  const totals = pay ? payTotals : periodTotals;
  const sellers = pay ? paySellers : scopedSellers;
  const lines = pay ? payLines : activityLines;

  function report() {
    return buildPeriodReport({
      title,
      period: bounds,
      totals,
      sellers,
      cashiers: scopedCashiers,
      lines,
      days: dash?.days,
    });
  }

  function excel() {
    const file = report();
    downloadText(`تقرير-${bounds.from}.xls`, reportExcel(file), 'application/vnd.ms-excel;charset=utf-8');
    toast('تم تنزيل ملف إكسل');
    setOpen(false);
  }

  function pdf() {
    const file = report();
    const host = document.createElement('div');
    host.className = 'fot-print-root';
    host.innerHTML = reportHtml(file);
    document.body.appendChild(host);
    document.body.classList.add('fot-printing');
    const done = () => {
      document.body.classList.remove('fot-printing');
      host.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setOpen(false);
    window.setTimeout(() => window.print(), 60);
  }

  return (
    <>
      <button type="button" className="pill" onClick={() => setOpen(true)}>تصدير</button>
      <Sheet open={open} title="تصدير التقرير" onClose={() => setOpen(false)}>
        <p className="text-sm font-bold text-muted">{bounds.label} · {bounds.from} — {bounds.to}</p>
        <div className="export-pick">
          <button type="button" className="export-card" onClick={pdf}>
            <span className="kicker">PDF</span>
            <strong>ملف أنيق للطباعة</strong>
            <span>احفظه كـ PDF من نافذة الطباعة. يشمل مبيعات المدة والبائعين والفواتير.</span>
          </button>
          <button type="button" className="export-card export-card-excel" onClick={excel}>
            <span className="kicker">Excel</span>
            <strong>جدول إكسل</strong>
            <span>ملف يفتح في إكسل بنفس المدة: الأيام، العمولات، المنتجات، والفواتير.</span>
          </button>
        </div>
      </Sheet>
    </>
  );
}
