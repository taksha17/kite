import { getActiveCompanyDb } from "../db/active";
import { insertVoucher } from "../db/client";
import { normalizeNarration } from "./rules";
import type { ParsedTxn } from "./parse";

export const BANK_IMPORT_SOURCE = "bank_statement";

/**
 * Stable identity for a statement row, used to skip re-imports.
 * FNV-1a — fast, sync, and good enough for dedup (not security).
 */
export function txnHash(txn: ParsedTxn): string {
  const key = [
    txn.date,
    (txn.deposit || txn.withdrawal).toFixed(2),
    normalizeNarration(txn.narration).slice(0, 80),
    normalizeNarration(txn.reference).slice(0, 40),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** external_ids of vouchers already imported from bank statements. */
export async function fetchImportedHashes(): Promise<Set<string>> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ external_id: string }[]>(
    "SELECT external_id FROM voucher WHERE external_source = $1",
    [BANK_IMPORT_SOURCE],
  );
  return new Set(rows.map((r) => r.external_id));
}

export interface ImportRow extends ParsedTxn {
  /** Counter-ledger (party/expense/income) chosen for this row. */
  ledgerId: number | null;
  hash: string;
  duplicate: boolean;
  excluded: boolean;
  /** Sales invoice this deposit was matched to (receipt narration). */
  matchedInvoiceId?: number | null;
  matchedInvoiceLabel?: string | null;
}

export interface ImportSummary {
  posted: number;
  skipped: number;
  errors: { narration: string; message: string }[];
}

/**
 * Post the chosen rows: withdrawal → Payment (party dr, bank cr),
 * deposit → Receipt (bank dr, party cr). Sequential to keep audit order.
 */
export async function importRows(
  rows: ImportRow[],
  bankLedgerId: number,
): Promise<ImportSummary> {
  const summary: ImportSummary = { posted: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    if (row.excluded || row.duplicate || !row.ledgerId) {
      summary.skipped++;
      continue;
    }
    const isReceipt = row.deposit > 0;
    const amount = isReceipt ? row.deposit : row.withdrawal;
    const lines = isReceipt
      ? [
          { ledgerId: bankLedgerId, debit: amount, credit: 0 },
          { ledgerId: row.ledgerId, debit: 0, credit: amount },
        ]
      : [
          { ledgerId: row.ledgerId, debit: amount, credit: 0 },
          { ledgerId: bankLedgerId, debit: 0, credit: amount },
        ];
    try {
      const invoiceNote =
        isReceipt && row.matchedInvoiceLabel
          ? `Against ${row.matchedInvoiceLabel}`
          : "";
      const narration = [row.narration, invoiceNote].filter(Boolean).join(" · ");
      await insertVoucher({
        voucherType: isReceipt ? "receipt" : "payment",
        date: row.date,
        number: row.reference || undefined,
        narration,
        totalAmount: amount,
        lines,
        partyLedgerId: row.ledgerId,
        external: { source: BANK_IMPORT_SOURCE, id: row.hash },
      });
      summary.posted++;
    } catch (e) {
      summary.errors.push({
        narration: row.narration,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return summary;
}
