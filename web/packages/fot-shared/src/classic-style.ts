import type { PrintSettingsDto } from './print-types';

export type ReceiptAlign = 'right' | 'center' | 'left';
export type ClassicDateFormat = 'datetime' | 'date' | 'time' | 'split';
export type ClassicTableCol = 'product' | 'qty' | 'unit' | 'disc' | 'total';

export const CLASSIC_BLOCK_IDS = [
  'logo',
  'title',
  'subtitle',
  'sepA',
  'invoice',
  'kind',
  'datetime',
  'pos',
  'cashier',
  'salesman',
  'cashbox',
  'sepB',
  'table',
  'sepC',
  'totals',
  'footer',
  'qr',
  'barcode',
] as const;

export type ClassicBlockId = (typeof CLASSIC_BLOCK_IDS)[number];

export const CLASSIC_PART_IDS = [
  'title',
  'subtitle',
  'invoice',
  'kind',
  'datetime',
  'pos',
  'cashier',
  'salesman',
  'cashbox',
  'tableHead',
  'tableProduct',
  'tableValues',
  'tableDisc',
  'totals',
  'totalStrong',
  'footer',
] as const;

export type ClassicPartId = (typeof CLASSIC_PART_IDS)[number];

export type ClassicStylePart = {
  size: number;
  weight: number;
  align: ReceiptAlign;
  show: boolean;
};

export type ClassicStyleDto = {
  title?: Partial<ClassicStylePart>;
  subtitle?: Partial<ClassicStylePart>;
  invoice?: Partial<ClassicStylePart>;
  kind?: Partial<ClassicStylePart>;
  datetime?: Partial<ClassicStylePart>;
  pos?: Partial<ClassicStylePart>;
  cashier?: Partial<ClassicStylePart>;
  salesman?: Partial<ClassicStylePart>;
  cashbox?: Partial<ClassicStylePart>;
  tableHead?: Partial<ClassicStylePart>;
  tableProduct?: Partial<ClassicStylePart>;
  tableValues?: Partial<ClassicStylePart>;
  tableDisc?: Partial<ClassicStylePart>;
  totals?: Partial<ClassicStylePart>;
  totalStrong?: Partial<ClassicStylePart>;
  footer?: Partial<ClassicStylePart>;
  order?: ClassicBlockId[];
  dateFormat?: ClassicDateFormat;
  cashierLabel?: string;
  salesmanLabel?: string;
  cashboxLabel?: string;
  showTableHead?: boolean;
  showDiscountColumn?: boolean;
  colProduct?: number;
  colQty?: number;
  colUnit?: number;
  colDisc?: number;
  colTotal?: number;
  tableColOrder?: ClassicTableCol[];
  hiddenBlocks?: ClassicBlockId[];
};

export type ResolvedClassicStyle = {
  parts: Record<ClassicPartId, ClassicStylePart>;
  order: ClassicBlockId[];
  dateFormat: ClassicDateFormat;
  cashierLabel: string;
  salesmanLabel: string;
  cashboxLabel: string;
  showTableHead: boolean;
  showDiscountColumn: boolean;
  cols: Record<ClassicTableCol, number>;
  tableColOrder: ClassicTableCol[];
  hiddenBlocks: ClassicBlockId[];
};

export const CLASSIC_BLOCK_LABELS: Record<ClassicBlockId, string> = {
  logo: 'الشعار',
  title: 'اسم المتجر',
  subtitle: 'السطر تحت الاسم',
  sepA: 'فاصل 1',
  invoice: 'رقم الفاتورة',
  kind: 'نوع الفاتورة',
  datetime: 'التاريخ والوقت',
  pos: 'نقطة البيع',
  cashier: 'الكاشير',
  salesman: 'البائع',
  cashbox: 'الصندوق',
  sepB: 'فاصل 2',
  table: 'جدول الأصناف',
  sepC: 'فاصل 3',
  totals: 'الإجماليات',
  footer: 'ذيل الصفحة',
  qr: 'رمز QR',
  barcode: 'باركود الفاتورة',
};

export const CLASSIC_PART_LABELS: Record<ClassicPartId, string> = {
  title: 'اسم المتجر',
  subtitle: 'السطر تحت الاسم',
  invoice: 'رقم الفاتورة',
  kind: 'نوع الفاتورة',
  datetime: 'التاريخ والوقت',
  pos: 'نقطة البيع',
  cashier: 'الكاشير',
  salesman: 'البائع',
  cashbox: 'الصندوق',
  tableHead: 'عناوين الجدول',
  tableProduct: 'اسم المادة',
  tableValues: 'أرقام الجدول',
  tableDisc: 'تفاصيل خصم الصنف',
  totals: 'الإجماليات',
  totalStrong: 'سطر الإجمالي النهائي',
  footer: 'ذيل الصفحة',
};

export const CLASSIC_TABLE_COL_LABELS: Record<ClassicTableCol, string> = {
  product: 'المادة',
  qty: 'الكمية',
  unit: 'الإفرادي',
  disc: 'الحسم',
  total: 'الإجمالي',
};

const DEFAULT_TABLE_COLS: Record<ClassicTableCol, number> = {
  product: 2.1,
  qty: 0.72,
  unit: 0.9,
  disc: 0.78,
  total: 0.95,
};

const DEFAULT_TABLE_COL_ORDER: ClassicTableCol[] = ['product', 'qty', 'unit', 'disc', 'total'];

export const TABLE_PART_IDS = ['tableHead', 'tableProduct', 'tableValues', 'tableDisc'] as const;
export type ClassicTablePartId = (typeof TABLE_PART_IDS)[number];

export const TABLE_SIZE_MIN = 5;
export const TABLE_SIZE_MAX = 16;

function isTablePart(id?: string | null): id is ClassicTablePartId {
  return TABLE_PART_IDS.includes(id as ClassicTablePartId);
}

function clampSize(n: number, min = 8, max = 22) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampPartSize(id: ClassicPartId | undefined, n: number) {
  return isTablePart(id) ? clampSize(n, TABLE_SIZE_MIN, TABLE_SIZE_MAX) : clampSize(n);
}

function clampWeight(n: number) {
  if (n <= 300) return 300;
  if (n <= 400) return 400;
  if (n <= 500) return 500;
  if (n <= 600) return 600;
  return 700;
}

function clampAlign(value?: string | null): ReceiptAlign {
  if (value === 'left' || value === 'right' || value === 'center') return value;
  return 'center';
}

function clampCol(n: number, fallback: number) {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(8, Math.max(0.3, Math.round(n * 100) / 100));
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseClassicStyle(raw?: PrintSettingsDto['classicStyle']): ClassicStyleDto {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const obj = asPlainObject(parsed);
    return obj ? { ...obj } as ClassicStyleDto : {};
  } catch {
    return {};
  }
}

export function normalizeClassicOrder(order?: ClassicBlockId[] | null): ClassicBlockId[] {
  const seen = new Set<ClassicBlockId>();
  const next: ClassicBlockId[] = [];
  const list = Array.isArray(order) ? order : [];
  for (const id of list) {
    if (!CLASSIC_BLOCK_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of CLASSIC_BLOCK_IDS) {
    if (seen.has(id)) continue;
    next.push(id);
  }
  return next;
}

export function normalizeTableColOrder(order?: ClassicTableCol[] | null): ClassicTableCol[] {
  const seen = new Set<ClassicTableCol>();
  const next: ClassicTableCol[] = [];
  const list = Array.isArray(order) ? order : [];
  for (const id of list) {
    if (!DEFAULT_TABLE_COL_ORDER.includes(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of DEFAULT_TABLE_COL_ORDER) {
    if (seen.has(id)) continue;
    next.push(id);
  }
  return next;
}

function defaultPart(size: number, weight: number, align: ReceiptAlign = 'center', id?: ClassicPartId): ClassicStylePart {
  return { size: clampPartSize(id, size), weight: clampWeight(weight), align, show: true };
}

function mergePart(raw: Partial<ClassicStylePart> | undefined, fallback: ClassicStylePart, id?: ClassicPartId): ClassicStylePart {
  return {
    size: raw?.size != null ? clampPartSize(id, Number(raw.size)) : fallback.size,
    weight: raw?.weight != null ? clampWeight(Number(raw.weight)) : fallback.weight,
    align: raw?.align ? clampAlign(raw.align) : fallback.align,
    show: raw?.show !== false,
  };
}

export function defaultClassicParts(fontSize = 13, fontWeight = 400): Record<ClassicPartId, ClassicStylePart> {
  const size = clampSize(fontSize);
  const weight = clampWeight(fontWeight);
  const stronger = clampWeight(weight + 100);
  const strongest = clampWeight(weight + 200);
  const lighter = clampWeight(weight - 100);
  return {
    title: defaultPart(size + 4, stronger, 'center'),
    subtitle: defaultPart(size - 2, lighter, 'center'),
    invoice: defaultPart(size + 2, stronger, 'center'),
    kind: defaultPart(size, stronger, 'center'),
    datetime: defaultPart(size - 2, lighter, 'center'),
    pos: defaultPart(size - 2, lighter, 'center'),
    cashier: defaultPart(size - 1, weight, 'right'),
    salesman: defaultPart(size - 1, weight, 'right'),
    cashbox: defaultPart(size - 1, weight, 'right'),
    tableHead: defaultPart(size - 4, stronger, 'center', 'tableHead'),
    tableProduct: defaultPart(size - 3, weight, 'right', 'tableProduct'),
    tableValues: defaultPart(size - 3, weight, 'center', 'tableValues'),
    tableDisc: defaultPart(size - 5, weight, 'right', 'tableDisc'),
    totals: defaultPart(size, weight, 'right'),
    totalStrong: defaultPart(size + 3, strongest, 'right'),
    footer: defaultPart(size - 2, lighter, 'center'),
  };
}

function safeLabel(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
}

export function resolveClassicStyle(settings: Pick<PrintSettingsDto, 'fontSize' | 'fontWeight' | 'classicStyle'>): ResolvedClassicStyle {
  try {
    const stored = parseClassicStyle(settings.classicStyle);
    const defaults = defaultClassicParts(Number(settings.fontSize) || 13, Number(settings.fontWeight) || 400);
    const parts = {} as Record<ClassicPartId, ClassicStylePart>;
    for (const id of CLASSIC_PART_IDS) {
      const raw = asPlainObject((stored as Record<string, unknown>)[id]);
      parts[id] = mergePart(raw as Partial<ClassicStylePart> | undefined, defaults[id], id);
    }
    const dateFormat: ClassicDateFormat = stored.dateFormat === 'date' || stored.dateFormat === 'time' || stored.dateFormat === 'split'
      ? stored.dateFormat
      : 'datetime';
    const hidden = Array.isArray(stored.hiddenBlocks) ? stored.hiddenBlocks : [];
    return {
      parts,
      order: normalizeClassicOrder(stored.order),
      dateFormat,
      cashierLabel: safeLabel(stored.cashierLabel, 'كاشير'),
      salesmanLabel: safeLabel(stored.salesmanLabel, 'بائع'),
      cashboxLabel: safeLabel(stored.cashboxLabel, 'الصندوق'),
      showTableHead: stored.showTableHead !== false,
      showDiscountColumn: stored.showDiscountColumn === true,
      cols: {
        product: clampCol(Number(stored.colProduct), DEFAULT_TABLE_COLS.product),
        qty: clampCol(Number(stored.colQty), DEFAULT_TABLE_COLS.qty),
        unit: clampCol(Number(stored.colUnit), DEFAULT_TABLE_COLS.unit),
        disc: clampCol(Number(stored.colDisc), DEFAULT_TABLE_COLS.disc),
        total: clampCol(Number(stored.colTotal), DEFAULT_TABLE_COLS.total),
      },
      tableColOrder: normalizeTableColOrder(stored.tableColOrder),
      hiddenBlocks: hidden.filter((id, i, arr): id is ClassicBlockId =>
        CLASSIC_BLOCK_IDS.includes(id) && arr.indexOf(id) === i),
    };
  } catch {
    const defaults = defaultClassicParts(13, 400);
    return {
      parts: defaults,
      order: [...CLASSIC_BLOCK_IDS],
      dateFormat: 'datetime',
      cashierLabel: 'كاشير',
      salesmanLabel: 'بائع',
      cashboxLabel: 'الصندوق',
      showTableHead: true,
      showDiscountColumn: true,
      cols: { ...DEFAULT_TABLE_COLS },
      tableColOrder: [...DEFAULT_TABLE_COL_ORDER],
      hiddenBlocks: [],
    };
  }
}

export function classicStyleToDto(style: ResolvedClassicStyle): ClassicStyleDto {
  const dto: ClassicStyleDto = {
    order: [...style.order],
    dateFormat: style.dateFormat,
    cashierLabel: style.cashierLabel,
    salesmanLabel: style.salesmanLabel,
    cashboxLabel: style.cashboxLabel,
    showTableHead: style.showTableHead,
    showDiscountColumn: style.showDiscountColumn,
    colProduct: style.cols.product,
    colQty: style.cols.qty,
    colUnit: style.cols.unit,
    colDisc: style.cols.disc,
    colTotal: style.cols.total,
    tableColOrder: [...style.tableColOrder],
    hiddenBlocks: [...style.hiddenBlocks],
  };
  for (const id of CLASSIC_PART_IDS) {
    const part = style.parts[id];
    if (!part) continue;
    dto[id] = {
      size: part.size,
      weight: part.weight,
      align: part.align,
      show: part.show,
    };
  }
  return dto;
}

export function isClassicBlockVisible(style: ResolvedClassicStyle, id: ClassicBlockId) {
  if (style.hiddenBlocks?.includes(id)) return false;
  if ((CLASSIC_PART_IDS as readonly string[]).includes(id)) {
    return style.parts?.[id as ClassicPartId]?.show !== false;
  }
  return true;
}

export function moveClassicItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const next = index + dir;
  if (next < 0 || next >= list.length) return list;
  const copy = list.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item!);
  return copy;
}
