import { formatNum as sharedFormatNum } from '@fot/shared';

export { formatNum, getHwId, resolveHwId } from '@fot/shared';

/** Amount without currency suffix — single-currency POS. */
export function formatIqd(n: number) {
  return sharedFormatNum(Math.round(n));
}
