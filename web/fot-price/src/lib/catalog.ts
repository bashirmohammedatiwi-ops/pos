import type { ProductDto } from '@fot/shared';
import { api } from '@/api/client';
import { db } from './db';

export async function findProduct(code: string, online: boolean): Promise<ProductDto | null> {
  const local = await db.findProduct(code);
  if (local) return local;
  if (!online) return null;
  try {
    const remote = await api.productByBarcode(code);
    if (remote) void db.upsertProducts([remote]);
    return remote;
  } catch {
    return null;
  }
}

export async function syncCatalog(): Promise<{ added: number; lastSeq: number }> {
  const info = await api.catalogInfo();
  let since = Number((await db.getMeta('last_change_ver')) ?? '0');
  let added = 0;
  for (;;) {
    const batch = await api.catalogSync(since);
    if (batch.length === 0) break;
    await db.upsertProducts(batch);
    const next = Math.max(since, ...batch.map(p => p.changeVersion ?? p.seq));
    if (next <= since) break;
    since = next;
    added += batch.length;
    await db.setMeta('last_change_ver', String(since));
    if (since >= info.maxSeq) break;
  }
  try {
    const local = await db.productCount();
    if (local > info.totalProducts) {
      const { ids } = await api.catalogIds();
      if (ids?.length) await db.pruneProducts(ids);
    }
  } catch {
    /* keep local catalog if prune fails */
  }
  return { added, lastSeq: since };
}
