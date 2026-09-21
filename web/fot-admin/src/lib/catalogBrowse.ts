import { api } from '@/api/client';
import type { ProductDto, TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';

export type CatalogKind = 'product' | 'folder';

export type CatalogRow = {
  key: string;
  seq: number;
  name: string;
  barcode?: string;
  num?: string;
  kind: CatalogKind;
  productCount?: number;
};

export function productKey(seq: number) {
  return `p-${seq}`;
}

export function folderKey(seq: number) {
  return `f-${seq}`;
}

export function productSeq(p: Pick<ProductDto, 'id' | 'seq'>) {
  return p.seq || p.id;
}

export function rowFromProduct(p: ProductDto): CatalogRow {
  const seq = productSeq(p);
  return {
    key: productKey(seq),
    seq,
    name: p.name || p.barcode || p.num || `#${seq}`,
    barcode: p.barcode,
    num: p.num,
    kind: 'product',
  };
}

export function rowFromTree(n: TreeNodeDto, productCount?: number): CatalogRow {
  return {
    key: folderKey(n.seq),
    seq: n.seq,
    name: fixEdariName(n.name) || n.num || `شجرة #${n.seq}`,
    barcode: n.barcode,
    num: n.num,
    kind: 'folder',
    productCount,
  };
}

export function isDigits(term: string) {
  return /^\d+$/.test(term.trim());
}

export function isLikelyBarcode(term: string) {
  const t = term.trim();
  return t.length >= 6 && /^\d+$/.test(t);
}

export function isTreeQuery(term: string) {
  const t = term.trim();
  if (!t) return false;
  if (isDigits(t)) return true;
  return t.length >= 2;
}

const MAX_LEAVES = 4000;
const MAX_FOLDER_FETCHES = 200;
const TREE_CHILD_LIMIT = 2000;

export async function fetchTreeChildren(seq: number): Promise<TreeNodeDto[]> {
  try {
    const edari = await api.edariTree(seq, undefined, TREE_CHILD_LIMIT);
    if (edari.length) return edari;
  } catch {
    /* local tree */
  }
  return api.articleTree(seq, undefined, TREE_CHILD_LIMIT).catch(() => [] as TreeNodeDto[]);
}

export async function collectTreeLeaves(rootSeq: number): Promise<{ items: CatalogRow[]; truncated: boolean }> {
  const items: CatalogRow[] = [];
  const seen = new Set<number>([rootSeq]);
  const frontier = [rootSeq];
  let fetches = 0;
  let truncated = false;

  while (frontier.length && items.length < MAX_LEAVES && fetches < MAX_FOLDER_FETCHES) {
    const batch = frontier.splice(0, 8);
    fetches += batch.length;
    const results = await Promise.all(batch.map(seq => fetchTreeChildren(seq)));
    for (const kids of results) {
      for (const n of kids) {
        if (seen.has(n.seq)) continue;
        seen.add(n.seq);
        if (n.isFolder || n.hasChildren) {
          frontier.push(n.seq);
          continue;
        }
        items.push({
          key: productKey(n.seq),
          seq: n.seq,
          name: fixEdariName(n.name) || n.barcode || n.num || `#${n.seq}`,
          barcode: n.barcode,
          num: n.num,
          kind: 'product',
        });
        if (items.length >= MAX_LEAVES) {
          truncated = true;
          break;
        }
      }
      if (items.length >= MAX_LEAVES) break;
    }
  }

  if (frontier.length) truncated = true;
  return { items, truncated };
}

export function treeLabel(n: Pick<TreeNodeDto, 'seq' | 'name' | 'num'>) {
  return fixEdariName(n.name) || n.num || `شجرة #${n.seq}`;
}

export async function loadTreeFolders(search?: string): Promise<TreeNodeDto[]> {
  const q = search?.trim() || undefined;
  try {
    const edari = await api.edariTree(undefined, q, 400);
    if (edari.length) return edari.filter(n => n.isFolder || n.hasChildren);
  } catch {
    /* local tree */
  }
  const local = await api.articleTree(undefined, q, 400);
  return local.filter(n => n.isFolder || n.hasChildren);
}

export async function resolveTreeSearch(term: string): Promise<TreeNodeDto[]> {
  const t = term.trim();
  if (!t) return [];
  const nodes = await api.articleTree(undefined, t);
  const exact = nodes.filter(n => String(n.seq) === t || n.num === t);
  const pool = exact.length ? exact : nodes;
  const folders = pool.filter(n => n.isFolder || n.hasChildren);

  if (!folders.length && isDigits(t)) {
    const seq = Number(t);
    const kids = await api.articleTree(seq).catch(() => [] as TreeNodeDto[]);
    if (kids.length) {
      return [{ seq, name: `شجرة #${seq}`, num: t, isFolder: true, hasChildren: true }];
    }
  }

  return folders;
}

export function mergeCatalogRows(
  folders: CatalogRow[],
  barcodeHit: ProductDto | undefined,
  products: ProductDto[],
  treeLeaves: CatalogRow[],
): CatalogRow[] {
  const out: CatalogRow[] = [];
  const seen = new Set<string>();

  function push(row: CatalogRow) {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    out.push(row);
  }

  for (const f of folders) push(f);
  if (barcodeHit) push(rowFromProduct(barcodeHit));
  for (const leaf of treeLeaves) push(leaf);
  for (const p of products) push(rowFromProduct(p));
  return out;
}
