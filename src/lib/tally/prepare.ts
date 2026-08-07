import type { AccountGroupRow } from "../db/types";
import { openingToDrCr } from "../dataimport/parse";
import {
  defaultGroupForCashBank,
  defaultGroupForParty,
  matchGroupId,
} from "../dataimport/mapGroups";
import type {
  PreparedLedgerRow,
  PreparedStockRow,
} from "../dataimport/types";
import {
  isValidGstin,
  normalizeGstin,
  stateCodeFromGstin,
} from "../accounting/gstin";
import { parseStateCode } from "../dataimport/parse";
import type { TallyLedger, TallyStockItem } from "./types";

/** Skip Tally reserved / P&amp;L style heads that shouldn't become Kite ledgers. */
const SKIP_LEDGER_NAMES = new Set(
  [
    "profit & loss a/c",
    "profit and loss a/c",
    "primary",
  ].map((s) => s.toLowerCase()),
);

function stateCode(ledger: TallyLedger): string {
  const g = ledger.gstin ? normalizeGstin(ledger.gstin) : "";
  if (g && isValidGstin(g)) return stateCodeFromGstin(g) || "";
  return parseStateCode(ledger.state);
}

export function prepareTallyLedgers(
  ledgers: TallyLedger[],
  groups: AccountGroupRow[],
  existingNames: Set<string>,
): PreparedLedgerRow[] {
  const defaults = defaultGroupForCashBank(groups);
  const out: PreparedLedgerRow[] = [];

  ledgers.forEach((led, i) => {
    const name = led.name.trim();
    if (!name) return;
    if (SKIP_LEDGER_NAMES.has(name.toLowerCase())) return;

    const { debit: openingDebit, credit: openingCredit } = openingToDrCr(
      led.opening,
    );

    let groupName = led.parent.trim();
    let groupId = groupName ? matchGroupId(groupName, groups) : null;
    let isParty = false;
    let isCashBank = false;

    const parentKey = groupName.toLowerCase();
    if (/sundry debtors/.test(parentKey)) {
      isParty = true;
      if (!groupId) groupId = defaultGroupForParty("debtor", groups);
    } else if (/sundry creditors/.test(parentKey)) {
      isParty = true;
      if (!groupId) groupId = defaultGroupForParty("creditor", groups);
    } else if (/cash-in-hand|cash in hand/.test(parentKey)) {
      isCashBank = true;
      if (!groupId) groupId = defaults.cash;
    } else if (/bank accounts|bank od|bank occ/.test(parentKey)) {
      isCashBank = true;
      if (!groupId) groupId = defaults.bank;
    }

    if (groupId && !isParty) {
      const g = groups.find((x) => x.id === groupId);
      if (g && /sundry debtors|sundry creditors/i.test(g.name)) isParty = true;
    }

    const gstinRaw = led.gstin ? normalizeGstin(led.gstin) : "";
    const gstin =
      gstinRaw && isValidGstin(gstinRaw)
        ? gstinRaw
        : led.gstin.replace(/\s+/g, "").toUpperCase();

    let status: PreparedLedgerRow["status"] = "ready";
    let reason: string | undefined;
    const lower = name.toLowerCase();
    if (existingNames.has(lower)) {
      status = "skip";
      reason = "Already exists";
    } else if (!groupId) {
      status = "error";
      reason = groupName
        ? `Unknown group “${groupName}” — pick one in review`
        : "Group (Parent) missing from Tally";
    }

    out.push({
      name,
      groupName: groupName || groups.find((g) => g.id === groupId)?.name || "",
      groupId,
      openingDebit,
      openingCredit,
      isParty,
      isCashBank,
      gstin,
      stateCode: stateCode(led),
      email: led.email.trim(),
      phone: led.phone.trim(),
      address: led.address.trim(),
      city: "",
      pin: led.pin.trim(),
      status,
      reason,
      rawIndex: i,
    });
  });

  return out;
}

export function prepareTallyStock(
  items: TallyStockItem[],
  existingNames: Set<string>,
): PreparedStockRow[] {
  return items.map((item, i) => {
    const name = item.name.trim();
    let status: PreparedStockRow["status"] = "ready";
    let reason: string | undefined;
    if (!name) {
      status = "error";
      reason = "Missing name";
    } else if (existingNames.has(name.toLowerCase())) {
      status = "skip";
      reason = "Already exists";
    }
    return {
      name,
      unitLabel: item.unit || "Nos",
      hsn: item.hsn.trim(),
      sku: "",
      gstRate: item.gstRate || 18,
      purchaseRate: item.purchaseRate,
      salesRate: item.salesRate,
      openingQty: item.openingQty,
      status,
      reason,
      rawIndex: i,
    };
  });
}
