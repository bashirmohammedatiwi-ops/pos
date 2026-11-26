import { reportCall } from '@/api/cash';

/* تقرير مبيعات «إداري» — أشجار المواد والفروع والأيام من سيرفر المحل (قراءة فقط). */

export interface SalesCat {
  salesQty: number;
  sales: number;
  /** القطع المهداة: فواتير الهدايا + البونص على فواتير البيع */
  giftsQty: number;
  gifts: number;
  returnsQty: number;
  returns: number;
  /** المبيعات − المردود */
  net: number;
  /** صافي الفترة السابقة المماثلة (مع المقارنة فقط) */
  prevNet?: number | null;
}
export interface SalesDay {
  date: string;
  sales: number;
  returns: number;
  gifts: number;
  net: number;
  invoices: number;
}
export interface SalesBranch {
  /** فارغ = فواتير بلا فرع (حسابات أخرى) */
  code: string;
  label: string;
  numbered: boolean;
  sales: number;
  returns: number;
  gifts: number;
  net: number;
  invoices: number;
}
export interface SalesNodeRef {
  seq: number;
  num: string;
  name: string;
}
export interface SalesItem extends SalesCat {
  seq: number;
  num: string;
  name: string;
  /** مادة (وليست شجرة) */
  leaf: boolean;
  barcode?: string | null;
  tree?: string | null;
  /** شجرة خارج إجمالي النظام */
  excluded: boolean;
}
export interface SalesLine {
  date: string;
  invNum: string;
  kind: number;
  kindLabel: string;
  branch: string;
  account?: string | null;
  seller?: string | null;
  mat: number;
  matNum: string;
  matName: string;
  qty: number;
  bonus: number;
  price: number;
  total: number;
}
export interface EdariSalesReport {
  from: string;
  to: string;
  at: string;
  branchFilter: string[];
  totals: SalesCat;
  invoices: number;
  excludedNet: number;
  days: SalesDay[];
  branches: SalesBranch[];
  node: SalesNodeRef | null;
  path: SalesNodeRef[];
  nodeTotals: SalesCat;
  items: SalesItem[];
  topMaterials: SalesItem[];
  lines: SalesLine[] | null;
  linesTruncated: boolean;
  search: string | null;
  prevFrom?: string | null;
  prevTo?: string | null;
  prevTotals?: SalesCat | null;
  prevNodeTotals?: SalesCat | null;
  prevDays?: SalesDay[] | null;
}

export interface EdariSalesParams {
  from: string;
  to: string;
  branches?: string[];
  node?: number | null;
  q?: string;
  lines?: boolean;
  fresh?: boolean;
  compare?: boolean;
}

export const EDARI_SALES_MAX_DAYS = 93;

export const edariSalesApi = {
  report: (p: EdariSalesParams) => {
    const qs = new URLSearchParams({ from: p.from, to: p.to });
    if (p.branches?.length) qs.set('branches', p.branches.join(','));
    if (p.node) qs.set('node', String(p.node));
    if (p.q?.trim()) qs.set('q', p.q.trim());
    if (p.lines) qs.set('lines', 'true');
    if (p.fresh) qs.set('fresh', 'true');
    if (p.compare) qs.set('compare', 'true');
    return reportCall<EdariSalesReport>(`/api/reports/edari-sales?${qs}`);
  },
};
