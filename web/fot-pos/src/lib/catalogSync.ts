import { isDiscountQrCode, normalizeDiscountQrCode, parseReceiptNumber, type DiscountQrPerson } from '@fot/shared';
import { api, ApiError, isPermanentReceiptError } from '@/api/client';
import type { AccountSummaryDto, ArticleGroupDto, ArticleGroupItemDto, ProductDto, SalesmanDto } from '@/api/types';
import { refreshAttributionCache } from '@/lib/attribution';
import { withOfferSalePrice, withOfferSalePrices } from '@/lib/offerPrice';
import { isServerUnreachable } from '@/lib/connectionGate';
import { fixEdariName } from '@/lib/text';
import { getHwId } from '@/lib/money';
import { rememberSale } from '@/lib/saleMirror';
import { seedDeferredHistory, withSoldAt, type ReceiptHistoryCarrier } from './receiptHistory';
import { db, type OutboxRow, type OutboxStatus } from './db';

export const OUTBOX_MAX_RETRIES = 8;

export type FlushOutboxResult = {
  uploaded: number;
  failed: number;
  dead: number;
  stopped: boolean;
  renumbered: Array<{ localNumber: number; newNumber: number; receiptId: number }>;
};

/** Advance the local counter so the next offline number stays after an official one. */
export async function rememberOfficialNumber(number: number) {
  const parsed = parseReceiptNumber(number);
  if (!parsed) return;
  await db.seedReceiptSeq(parsed.cashierCode, parsed.seq);
}

/**
 * Official number before print: reserve from the shop when online, otherwise a local
 * sequence that the server will adopt (or reject if stale, then we reprint).
 */
const NUMBER_BLOCK = 40;
const NUMBER_REFILL_AT = 8;

/** Sale click never waits on the server. The printed number comes from the local official sequence. */
export async function takeReceiptNumber(opts: {
  cashierId: number;
  cashierCode: number;
  online?: boolean;
}): Promise<number> {
  void opts.cashierId;
  void opts.online;
  return db.nextLocalNumber(opts.cashierCode);
}

/**
 * Tops up the reserved official-number block in the background.
 * The cashier never calls this while saving a sale.
 */
export async function ensureNumberBlock(cashierId: number, cashierCode: number) {
  if (cashierId <= 0 || isServerUnreachable()) return;
  const year = new Date().getFullYear();
  const code = cashierCode > 0 ? cashierCode : 9;
  const throughKey = `receipt_block_through_${year}_${code}`;
  const usedKey = `offline_receipt_seq_${year}_${code}`;
  const through = Number((await db.getMeta(throughKey)) ?? '0') || 0;
  const used = Number((await db.getMeta(usedKey)) ?? '0') || 0;
  if (through - used >= NUMBER_REFILL_AT) return;
  const reserved = await api.reserveReceiptNumbers({
    cashierId,
    count: NUMBER_BLOCK,
    hwId: getHwId() || undefined,
    clientSeq: used,
  });
  const reservedCode = reserved.cashierCode || code;
  const jumpKey = `receipt_seq_jump_${year}_${reservedCode}`;
  const ownedKey = `receipt_owned_through_${year}_${reservedCode}`;
  const stillPrinting = through > 0 && used < through;
  if (stillPrinting && reserved.fromSeq > through + 1) {
    // Finish the numbers this terminal already owns, then skip the gap another terminal reserved.
    await db.setMeta(ownedKey, String(through));
    await db.setMeta(jumpKey, String(reserved.fromSeq));
  } else {
    await db.setMeta(ownedKey, '');
    await db.setMeta(jumpKey, '');
    if (!stillPrinting && reserved.fromSeq > used + 1) {
      await db.seedReceiptSeq(reservedCode, reserved.fromSeq - 1);
    }
  }
  await db.setMeta(`receipt_block_through_${year}_${reservedCode}`, String(reserved.throughSeq));
}

const priceRefreshAt = new Map<string, number>();
const PRICE_REFRESH_MS = 3 * 60_000;

export async function findProductSmart(code: string, online: boolean): Promise<ProductDto | null> {
  const local = await db.findProduct(code);
  if (local) {
    const seen = priceRefreshAt.get(code) ?? 0;
    if (online && !isServerUnreachable() && Date.now() - seen > PRICE_REFRESH_MS) {
      priceRefreshAt.set(code, Date.now());
      void api.productByBarcode(code).then(remote => {
        if (remote) void db.upsertProducts([withOfferSalePrice(remote)]);
      }).catch(() => { /* price refresh is background-only */ });
    }
    return withOfferSalePrice(local);
  }
  if (!online || isServerUnreachable()) return null;
  try {
    const remote = await api.productByBarcode(code);
    if (!remote) return null;
    void db.upsertProducts([withOfferSalePrice(remote)]);
    return withOfferSalePrice(remote);
  } catch {
    return null;
  }
}

export async function findDiscountQr(code: string, online: boolean): Promise<DiscountQrPerson | null> {
  const normalized = normalizeDiscountQrCode(code);
  if (!isDiscountQrCode(normalized)) return null;
  const people = await db.loadDiscountQrPeople();
  const local = people.find(p => normalizeDiscountQrCode(p.code) === normalized);
  if (local) return local;
  if (!online || isServerUnreachable()) return null;
  try {
    const remote = await api.lookupDiscountQr(normalized);
    const person: DiscountQrPerson = { id: remote.id, name: remote.name, code: remote.code || normalized };
    await db.saveDiscountQrPeople([...people.filter(p => p.id !== person.id), person]);
    return person;
  } catch {
    return null;
  }
}

export async function searchProductsSmart(q: string, online: boolean): Promise<ProductDto[]> {
  const local = withOfferSalePrices(await db.searchProducts(q));
  if (online && !isServerUnreachable() && local.length === 0) {
    void api.searchProducts(q).then(remote => {
      const priced = withOfferSalePrices(remote);
      if (priced.length) void db.upsertProducts(priced);
    }).catch(() => { /* search stays on the local catalog */ });
  }
  return local;
}

export async function syncCatalog(): Promise<{ products: number; lastSeq: number; removed: number }> {
  const info = await api.catalogInfo();
  // last_change_ver tracks the server rowversion watermark (any article edit bumps it).
  // Fresh keys (new install or upgrade from the Seq-based watermark) start at 0 and re-pull once.
  const hwId = getHwId() || undefined;
  const pull = async () => {
    let since = Number((await db.getMeta('last_change_ver')) ?? '0');
    let added = 0;
    // Keep pulling until the server watermark is reached. A fixed batch cap left
    // terminals with a partial catalog, so a later offline restart missed most products.
    for (;;) {
      const batch = await api.catalogSync(since, hwId);
      if (batch.length === 0) break;
      await db.upsertProducts(withOfferSalePrices(batch));
      const next = Math.max(since, ...batch.map(p => p.changeVersion ?? p.seq));
      if (next <= since) break;
      since = next;
      added += batch.length;
      await db.setMeta('last_change_ver', String(since));
      if (since >= info.maxSeq) break;
    }
    return { added, since };
  };

  let { added, since } = await pull();
  let removed = await reconcileCatalog(info.totalProducts);
  let local = await db.productCount();
  if (local < info.totalProducts && (await db.getMeta('last_change_ver')) === '0') {
    const again = await pull();
    added += again.added;
    since = again.since;
    removed += await reconcileCatalog(info.totalProducts);
    local = await db.productCount();
  }
  await db.setMeta('catalog_complete', local >= info.totalProducts && info.totalProducts > 0 ? '1' : '0');
  await db.setMeta('catalog_expected', String(info.totalProducts));
  return { products: added, lastSeq: since, removed };
}

/**
 * The delta feed can only add and update, so a product deleted in Edari stays on the terminal
 * forever. Whenever the local row count disagrees with the server's live total we pull the
 * authoritative id list and drop whatever is no longer there — this also repairs duplicates left
 * behind when a material is deleted and re-created (it comes back under a new article id) and
 * products that fell out of the feed because their price was zeroed.
 */
export async function reconcileCatalog(serverTotal?: number): Promise<number> {
  try {
    const expected = serverTotal ?? (await api.catalogInfo()).totalProducts;
    const local = await db.productCount();
    if (local === expected) {
      await db.setMeta('catalog_replay_pending', '0');
      return 0;
    }

    if (local < expected) {
      // Behind, not stale: replay from scratch once, then let the current sync fill the gap.
      // Repeating the reset every cycle would reload the whole catalog forever.
      const pending = (await db.getMeta('catalog_replay_pending')) === '1';
      if (!pending) {
        await db.setMeta('catalog_replay_pending', '1');
        await db.setMeta('last_change_ver', '0');
      }
      return 0;
    }
    await db.setMeta('catalog_replay_pending', '0');

    const { ids } = await api.catalogIds();
    if (!ids?.length) return 0;
    return await db.pruneProducts(ids);
  } catch {
    // Never let reconciliation break a sync cycle — the next pass retries.
    return 0;
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 0)) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      if (current !== undefined) await fn(current);
    }
  });
  await Promise.all(workers);
}

export async function cacheReferenceData(force = false) {
  if (isServerUnreachable()) return;
  if (!force) {
    const cachedAt = Number((await db.getMeta('ref_data_at')) ?? '0');
    if (cachedAt && Date.now() - cachedAt < 20_000) return;
  }
  const [groupsRes, salesmenRes, printRes, accountsRes, qrRes] = await Promise.all([
    api.groups().then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] as ArticleGroupDto[] })),
    api.salesmen().then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] as SalesmanDto[] })),
    api.printSettings().then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: null })),
    api.creditAccounts().then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] as AccountSummaryDto[] })),
    api.discountQrPeople().then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] as DiscountQrPerson[] })),
  ]);
  if (!groupsRes.ok && !salesmenRes.ok && !printRes.ok && !accountsRes.ok && !qrRes.ok) return;

  if (groupsRes.ok) {
    const itemsByGroup: Record<number, ArticleGroupItemDto[]> = {};
    await mapPool(groupsRes.value, 6, async g => {
      try {
        itemsByGroup[g.id] = withOfferSalePrices(await api.groupItems(g.id));
      } catch {
        itemsByGroup[g.id] = [];
      }
    });
    await db.saveGroups(groupsRes.value, itemsByGroup);
  }
  if (salesmenRes.ok) {
    const list = Array.isArray(salesmenRes.value) ? salesmenRes.value : [];
    await db.saveSalesmen(list.map(s => ({ ...s, name: fixEdariName(s.name) || `${s.id}` })));
  }
  if (accountsRes.ok && Array.isArray(accountsRes.value)) await db.saveAccounts(accountsRes.value);
  if (qrRes.ok) {
    const people = Array.isArray(qrRes.value) ? qrRes.value : [];
    await db.saveDiscountQrPeople(people.map(p => ({ id: p.id, name: p.name, code: p.code })));
  }
  if (printRes.ok && printRes.value) await db.savePrintSettings(printRes.value);
  await db.setMeta('ref_data_at', String(Date.now()));
  await refreshAttributionCache(true);
}

export function isDeadOutboxRow(row: OutboxRow) {
  return (row.retryCount ?? 0) >= OUTBOX_MAX_RETRIES;
}

export async function outboxStats() {
  return db.outboxCounts();
}

/** Invoices parked for manual transfer — editable locally until the cashier posts them. */
export async function deferredRows(): Promise<OutboxRow[]> {
  const rows = await db.pending();
  return rows.filter(r => r.status === 'deferred' && !isDeadOutboxRow(r));
}

export async function enqueueReceipt(
  payload: { clientReceiptId: string; [key: string]: unknown },
  cashierCode = 0,
  status: OutboxStatus = 'queued',
  preallocatedNumber?: number,
) {
  const localNumber = preallocatedNumber ?? await db.nextLocalNumber(cashierCode);
  const parked = status === 'deferred' ? seedDeferredHistory(payload as unknown as ReceiptHistoryCarrier) : payload;
  await db.enqueue({
    payload: parked,
    clientReceiptId: payload.clientReceiptId,
    localNumber,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
    status,
  });
  await rememberSale(parked, localNumber);
  return localNumber;
}

/** Seeds the local receipt counter from the server so printed numbers match after upload. */
export async function seedLocalReceiptSeq(year: number, serverSeq: number, cashierCode = 0) {
  if (!year || !serverSeq) return;
  await db.seedReceiptSeq(cashierCode, serverSeq);
}

export async function updateDeferredPayload(id: number, payload: unknown) {
  await db.updateOutbox(id, { payload });
}

export async function removeLocalReceipt(id: number) {
  await db.removeOutbox(id);
}

export async function resetDeadReceipt(id: number) {
  await db.resetOutboxRetry(id);
}

/** Moves deferred invoices into the upload queue (manual transfer button). */
export async function transferDeferred(ids?: number[]): Promise<number> {
  const rows = await db.pending();
  const targets = rows.filter(r => r.status === 'deferred' && (ids == null || ids.includes(r.id ?? -1)));
  for (const row of targets) {
    if (row.id == null) continue;
    await db.updateOutbox(row.id, { status: 'queued' });
  }
  return targets.length;
}

function outboxTime(row: OutboxRow) {
  const t = Date.parse(row.createdAt);
  return Number.isFinite(t) ? t : 0;
}

let flushChain: Promise<unknown> = Promise.resolve();

export async function flushOutbox(): Promise<FlushOutboxResult> {
  const run = flushChain.then(() => flushOutboxOnce(), () => flushOutboxOnce());
  flushChain = run.then(() => undefined, () => undefined);
  return run;
}

async function flushOutboxOnce(): Promise<FlushOutboxResult> {
  const result: FlushOutboxResult = { uploaded: 0, failed: 0, dead: 0, stopped: false, renumbered: [] };
  if (isServerUnreachable()) return result;
  const rows = (await db.pending()).slice().sort((a, b) => outboxTime(a) - outboxTime(b) || (a.id ?? 0) - (b.id ?? 0));
  for (const row of rows) {
    if (row.id == null) continue;
    // Deferred invoices wait for the explicit transfer button; dead ones wait for manual retry.
    if (row.status === 'deferred') continue;
    if (isDeadOutboxRow(row)) {
      result.dead++;
      continue;
    }
    try {
      const res = await api.createReceipt(withSoldAt(row.payload, row.createdAt));
      if (res.number > 0) await rememberOfficialNumber(res.number);
      if (row.localNumber > 0 && res.number !== row.localNumber) {
        result.renumbered.push({
          localNumber: row.localNumber,
          newNumber: res.number,
          receiptId: res.receiptId,
        });
      }
      // Only removed after the server confirms — nothing is ever dropped on failure.
      await db.removeOutbox(row.id);
      result.uploaded++;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 0 || e.status === 408 || e.status === 401)) {
        result.stopped = true;
        result.failed++;
        break;
      }
      const message = e instanceof Error ? e.message : 'فشل الرفع';
      // The original sale is still in this queue — retry the return next cycle, don't kill it.
      if (message.includes('لم تُرفع بعد')) {
        result.failed++;
        continue;
      }
      await db.markOutboxError(row.id, message, isPermanentReceiptError(e));
      if (isPermanentReceiptError(e) || (row.retryCount ?? 0) + 1 >= OUTBOX_MAX_RETRIES) result.dead++;
      else result.failed++;
    }
  }
  return result;
}
