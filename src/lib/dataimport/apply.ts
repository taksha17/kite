import { createLedger, findLedgerByName } from "../db/client";
import {
  createStockItem,
  createUnit,
  listStockItems,
  listUnits,
} from "../db/inventory";
import type {
  ImportSummary,
  PreparedLedgerRow,
  PreparedStockRow,
} from "./types";

export async function applyLedgerImport(
  rows: PreparedLedgerRow[],
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, skipped: 0, failed: 0, errors: [] };

  for (const row of rows) {
    if (row.status === "skip") {
      summary.skipped++;
      continue;
    }
    if (row.status === "error" || row.groupId == null) {
      summary.failed++;
      summary.errors.push(`${row.name}: ${row.reason || "missing group"}`);
      continue;
    }
    try {
      const existing = await findLedgerByName(row.name);
      if (existing) {
        summary.skipped++;
        continue;
      }
      await createLedger({
        name: row.name,
        groupId: row.groupId,
        openingDebit: row.openingDebit,
        openingCredit: row.openingCredit,
        isParty: row.isParty,
        isCashBank: row.isCashBank,
        gstin: row.gstin || undefined,
        stateCode: row.stateCode || undefined,
        email: row.email || undefined,
        phone: row.phone || undefined,
        address: row.address || undefined,
        city: row.city || undefined,
        pin: row.pin || undefined,
      });
      summary.created++;
    } catch (e) {
      summary.failed++;
      summary.errors.push(
        `${row.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return summary;
}

async function resolveUnitId(label: string): Promise<number> {
  const units = await listUnits();
  const key = label.trim().toLowerCase();
  const hit = units.find(
    (u) =>
      u.symbol.toLowerCase() === key ||
      u.name.toLowerCase() === key ||
      u.symbol.toLowerCase() === key.slice(0, 3),
  );
  if (hit) return hit.id;

  const symbol = label.trim().slice(0, 6) || "Nos";
  const name = label.trim() || "Numbers";
  try {
    await createUnit(name, symbol);
  } catch {
    // race / duplicate — reload
  }
  const again = await listUnits();
  const created = again.find(
    (u) => u.symbol.toLowerCase() === symbol.toLowerCase() || u.name.toLowerCase() === name.toLowerCase(),
  );
  if (!created) throw new Error(`Could not create unit “${label}”`);
  return created.id;
}

export async function applyStockImport(
  rows: PreparedStockRow[],
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, skipped: 0, failed: 0, errors: [] };
  const existing = new Set(
    (await listStockItems()).map((i) => i.name.toLowerCase()),
  );

  for (const row of rows) {
    if (row.status === "skip") {
      summary.skipped++;
      continue;
    }
    if (row.status === "error") {
      summary.failed++;
      summary.errors.push(`${row.name}: ${row.reason || "invalid"}`);
      continue;
    }
    if (existing.has(row.name.toLowerCase())) {
      summary.skipped++;
      continue;
    }
    try {
      const unitId = await resolveUnitId(row.unitLabel);
      await createStockItem({
        name: row.name,
        unitId,
        hsnSac: row.hsn || undefined,
        sku: row.sku || undefined,
        gstRate: row.gstRate,
        purchaseRate: row.purchaseRate,
        salesRate: row.salesRate,
        openingQty: row.openingQty,
      });
      existing.add(row.name.toLowerCase());
      summary.created++;
    } catch (e) {
      summary.failed++;
      summary.errors.push(
        `${row.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return summary;
}
