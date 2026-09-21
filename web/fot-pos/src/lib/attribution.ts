import { api } from '@/api/client';
import type { ProductAttributionDto, ProductDto } from '@/api/types';
import { isServerUnreachable } from '@/lib/connectionGate';
import { db } from './db';

const META_KEY = 'attribution_articles_seq';

let memorySet: Set<number> | null = null;

const emptyAttr: ProductAttributionDto = {
  requiresSalesman: false,
  hasCommission: false,
  hasTarget: false,
  reason: null,
};

async function loadSet(): Promise<Set<number>> {
  if (memorySet) return memorySet;
  const raw = await db.getMeta(META_KEY);
  if (raw) {
    try {
      memorySet = new Set(JSON.parse(raw) as number[]);
      return memorySet;
    } catch { /* ignore */ }
  }
  memorySet = new Set();
  return memorySet;
}

function inCache(set: Set<number>, product: ProductDto) {
  return product.seq > 0 && set.has(product.seq);
}

export async function refreshAttributionCache(online: boolean): Promise<number> {
  if (!online || isServerUnreachable()) return (await loadSet()).size;
  try {
    const ids = await api.attributionArticles();
    memorySet = new Set(ids);
    await db.setMeta(META_KEY, JSON.stringify(ids));
    return ids.length;
  } catch {
    return (await loadSet()).size;
  }
}

export async function getProductAttribution(
  product: ProductDto,
  _online: boolean,
  flags?: { applyCommissions?: boolean; applyTargets?: boolean },
): Promise<ProductAttributionDto> {
  const applyC = flags?.applyCommissions !== false;
  const applyT = flags?.applyTargets !== false;
  if (!applyC && !applyT) return emptyAttr;

  const applyFlags = (attr: ProductAttributionDto): ProductAttributionDto => {
    const hasCommission = applyC && attr.hasCommission;
    const hasTarget = applyT && attr.hasTarget;
    return {
      ...attr,
      hasCommission,
      hasTarget,
      requiresSalesman: hasCommission || hasTarget,
    };
  };

  const set = await loadSet();
  if ((applyC || applyT) && inCache(set, product)) {
    return applyFlags({
      requiresSalesman: true,
      hasCommission: applyC,
      hasTarget: applyT,
      reason: applyC && applyT
        ? 'عمولة أو تاركت — اختر المندوب'
        : applyC
          ? 'عمولة — اختر المندوب'
          : 'تاركت — اختر المندوب',
    });
  }
  // Scan path must stay local. A live attribution call used to stall every add
  // for seconds when the LAN dropped while the UI still thought it was online.
  return emptyAttr;
}

export function resolveGroupSalesman(
  group: { salesmanId: number; salesmanName: string } | undefined,
  salesmen: { id: number; name: string }[],
): { id: number; name: string } | null {
  const sid = group?.salesmanId ?? 0;
  if (sid <= 0) return null;
  const name = group?.salesmanName || salesmen.find(s => s.id === sid)?.name || '';
  return { id: sid, name };
}
