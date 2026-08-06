import { createParty, findLedgerByName } from "../db/client";
import { createStockItem, listStockItems, listUnits } from "../db/inventory";
import {
  assertGstinOrEmpty,
  stateCodeFromGstin,
} from "../accounting/gstin";
import type { SeedItem, SeedParty } from "./parse";

export interface CreateMastersResult {
  partyId: number | null;
  /** item name (trimmed) → new id */
  itemIds: Map<string, number>;
  warnings: string[];
}

/**
 * Create party + stock items proposed from a captured bill / AI draft.
 * Invalid GSTIN is dropped (party still created) rather than blocking the flow.
 */
export async function createMastersFromSeeds(input: {
  party?: SeedParty | null;
  items: SeedItem[];
  kind: "debtor" | "creditor";
  /** Prefer purchase rate on purchase vouchers. */
  asPurchase: boolean;
}): Promise<CreateMastersResult> {
  const warnings: string[] = [];
  let partyId: number | null = null;

  if (input.party?.name.trim()) {
    let gstin: string | undefined;
    if (input.party.gstin?.trim()) {
      try {
        gstin = assertGstinOrEmpty(input.party.gstin);
      } catch {
        warnings.push(
          `Skipped invalid GSTIN “${input.party.gstin}” on party “${input.party.name}”.`,
        );
      }
    }
    const stateCode =
      input.party.stateCode ||
      (gstin ? stateCodeFromGstin(gstin) || undefined : undefined);

    await createParty({
      name: input.party.name.trim(),
      kind: input.kind,
      gstin,
      stateCode,
    });
    const row = await findLedgerByName(input.party.name.trim());
    if (!row) throw new Error(`Created party “${input.party.name}” but could not reload it.`);
    partyId = row.id;
  }

  const itemIds = new Map<string, number>();
  if (input.items.length === 0) {
    return { partyId, itemIds, warnings };
  }

  const units = await listUnits();
  const unitId = units[0]?.id;
  if (!unitId) {
    warnings.push("No units defined — could not create stock items.");
    return { partyId, itemIds, warnings };
  }

  for (const seed of input.items) {
    const name = seed.name.trim();
    if (!name) continue;
    const rate = seed.rate != null && seed.rate >= 0 ? seed.rate : 0;
    const gstRate =
      seed.gstRate != null && seed.gstRate >= 0 ? seed.gstRate : 18;
    await createStockItem({
      name,
      unitId,
      hsnSac: seed.hsn || undefined,
      gstRate,
      purchaseRate: input.asPurchase ? rate : 0,
      salesRate: input.asPurchase ? 0 : rate,
    });
  }

  const all = await listStockItems();
  for (const seed of input.items) {
    const name = seed.name.trim();
    if (!name) continue;
    const row = all.find((i) => i.name === name);
    if (row) itemIds.set(name, row.id);
    else warnings.push(`Created item “${name}” but could not reload it.`);
  }

  return { partyId, itemIds, warnings };
}
