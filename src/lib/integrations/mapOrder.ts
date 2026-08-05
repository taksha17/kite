/**
 * Maps a NormalizedOrder into Kite sales vouchers.
 * Scaffold: not implemented yet — import reports stub status.
 */
import type { ImportOrdersResult, NormalizedOrder } from "./types";

export async function importNormalizedOrders(
  _orders: NormalizedOrder[],
): Promise<ImportOrdersResult> {
  return {
    created: 0,
    skipped: 0,
    failed: 0,
    messages: [
      "Order → voucher import is scaffolded. Connect and Test work now; mapping ships next.",
    ],
  };
}
