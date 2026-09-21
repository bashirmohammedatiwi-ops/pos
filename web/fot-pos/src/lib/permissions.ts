import type { CashierPermissionsDto } from '@/api/types';

/** Resolved cashier permissions — matches admin defaults when a field is absent. */
export type ResolvedCashierPermissions = {
  makeDiscount: boolean;
  viewReceipts: boolean;
  cashReport: boolean;
  deleteItem: boolean;
  duplicateItem: boolean;
  offlineLogin: boolean;
  discardReceipt: boolean;
  allowCreditReceipt: boolean;
  allowSalesReturn: boolean;
  allowGiftReceipt: boolean;
  allowSearchArticles: boolean;
  allowPriceChange: boolean;
  allowEditReceipt: boolean;
  manualTransfer: boolean;
  allowProductDiscount: boolean;
  /** One salesman for the whole invoice instead of a salesman per cart group. */
  hideSalesmanGroups: boolean;
  invoiceBoundReturn: boolean;
  itemDiscountLimit: number;
  userDiscountLimit: number;
  maxHoldReceipts: number;
  invoiceSlotCount: number;
};

export function resolveCashierPermissions(
  perms: CashierPermissionsDto | null | undefined,
): ResolvedCashierPermissions {
  const maxHold = Math.max(0, perms?.numberOfHoldReceipts ?? 5);
  return {
    makeDiscount: perms?.makeDiscount ?? true,
    viewReceipts: perms?.viewReceipts ?? true,
    cashReport: perms?.cashReport ?? true,
    deleteItem: perms?.deleteItem ?? true,
    duplicateItem: perms?.duplicateItem ?? false,
    offlineLogin: perms?.offlineLogin ?? true,
    discardReceipt: perms?.discardReceipt ?? true,
    allowCreditReceipt: perms?.allowCreditReceipt ?? false,
    allowSalesReturn: perms?.allowSalesReturn ?? true,
    allowGiftReceipt: perms?.allowGiftReceipt ?? true,
    allowSearchArticles: perms?.allowSearchArticles ?? true,
    allowPriceChange: perms?.allowPriceChange ?? false,
    allowEditReceipt: perms?.allowEditReceipt ?? false,
    manualTransfer: perms?.manualTransfer ?? false,
    allowProductDiscount: perms?.allowProductDiscount ?? false,
    hideSalesmanGroups: perms?.hideSalesmanGroups ?? false,
    invoiceBoundReturn: perms?.invoiceBoundReturn ?? false,
    itemDiscountLimit: perms?.itemDiscountLimit ?? 0,
    userDiscountLimit: perms?.userDiscountLimit ?? 0,
    maxHoldReceipts: maxHold,
    invoiceSlotCount: maxHold <= 0 ? 1 : Math.min(3, maxHold),
  };
}

export function maxUserDiscountAmount(
  perms: ResolvedCashierPermissions,
  subtotal: number,
): number {
  const limit = perms.userDiscountLimit;
  if (limit <= 0) return subtotal;
  return Math.min(subtotal, limit);
}
