import type { AccountGroupRow } from "../db/types";
import {
  defaultGroupForCashBank,
  defaultGroupForParty,
  matchGroupId,
} from "./mapGroups";
import {
  cellText,
  openingToDrCr,
  parseAmount,
  parseGstin,
  partyKindFromValue,
  stateFromGstinOrCell,
  truthyFlag,
} from "./parse";
import type {
  MastersColumnMap,
  PreparedLedgerRow,
  PreparedStockRow,
  SheetRows,
} from "./types";

function cell(row: unknown[], idx: number | null | undefined): unknown {
  if (idx == null || idx < 0) return "";
  return row[idx];
}

export function prepareLedgerRows(
  rows: SheetRows,
  map: MastersColumnMap,
  kind: "ledgers" | "parties",
  groups: AccountGroupRow[],
  existingNames: Set<string>,
): PreparedLedgerRow[] {
  const out: PreparedLedgerRow[] = [];
  const defaults = defaultGroupForCashBank(groups);

  for (let i = map.headerRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cellText(cell(row, map.name));
    if (!name) continue;

    let openingDebit = 0;
    let openingCredit = 0;
    if (map.openingDebit != null || map.openingCredit != null) {
      openingDebit = Math.abs(parseAmount(cell(row, map.openingDebit)) ?? 0);
      openingCredit = Math.abs(parseAmount(cell(row, map.openingCredit)) ?? 0);
    } else if (map.opening != null) {
      const signed = parseAmount(cell(row, map.opening)) ?? 0;
      const split = openingToDrCr(signed);
      openingDebit = split.debit;
      openingCredit = split.credit;
    }

    const gstinRaw = parseGstin(cell(row, map.gstin));
    const stateCode = stateFromGstinOrCell(gstinRaw, cell(row, map.state));

    let isParty = kind === "parties";
    let isCashBank = truthyFlag(cell(row, map.isCashBank));
    let groupName = cellText(cell(row, map.group));
    let groupId = groupName ? matchGroupId(groupName, groups) : null;

    if (kind === "parties") {
      const pKind = partyKindFromValue(cell(row, map.kind) || groupName);
      if (!groupId) {
        groupId = defaultGroupForParty(pKind, groups);
        groupName = pKind === "debtor" ? "Sundry Debtors" : "Sundry Creditors";
      }
      isParty = true;
      isCashBank = false;
    } else if (isCashBank && !groupId) {
      const gName = /cash/i.test(name) ? "Cash-in-Hand" : "Bank Accounts";
      groupId = gName === "Cash-in-Hand" ? defaults.cash : defaults.bank;
      groupName = gName;
    }

    // Infer party from group name
    if (!isParty && groupId) {
      const g = groups.find((x) => x.id === groupId);
      if (g && /sundry debtors|sundry creditors/i.test(g.name)) isParty = true;
    }

    const lower = name.toLowerCase();
    let status: PreparedLedgerRow["status"] = "ready";
    let reason: string | undefined;

    if (existingNames.has(lower)) {
      status = "skip";
      reason = "Already exists";
    } else if (!groupId) {
      status = "error";
      reason = groupName
        ? `Unknown group “${groupName}” — pick one in review`
        : "Group required";
    }

    out.push({
      name,
      groupName: groupName || groups.find((g) => g.id === groupId)?.name || "",
      groupId,
      openingDebit,
      openingCredit,
      isParty,
      isCashBank,
      gstin: gstinRaw,
      stateCode,
      email: cellText(cell(row, map.email)),
      phone: cellText(cell(row, map.phone)),
      address: cellText(cell(row, map.address)),
      city: cellText(cell(row, map.city)),
      pin: cellText(cell(row, map.pin)),
      status,
      reason,
      rawIndex: i,
    });
  }
  return out;
}

export function prepareStockRows(
  rows: SheetRows,
  map: MastersColumnMap,
  existingNames: Set<string>,
): PreparedStockRow[] {
  const out: PreparedStockRow[] = [];
  for (let i = map.headerRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cellText(cell(row, map.name));
    if (!name) continue;

    const unitLabel = cellText(cell(row, map.unit)) || "Nos";
    const gstRaw = parseAmount(cell(row, map.gstRate));
    const gstRate = gstRaw != null ? Math.abs(gstRaw) : 18;
    const purchaseRate = Math.abs(parseAmount(cell(row, map.purchaseRate)) ?? 0);
    const salesRate = Math.abs(parseAmount(cell(row, map.salesRate)) ?? 0);
    const openingQty = Math.abs(parseAmount(cell(row, map.openingQty)) ?? 0);

    let status: PreparedStockRow["status"] = "ready";
    let reason: string | undefined;
    if (existingNames.has(name.toLowerCase())) {
      status = "skip";
      reason = "Already exists";
    }

    out.push({
      name,
      unitLabel,
      hsn: cellText(cell(row, map.hsn)),
      sku: cellText(cell(row, map.sku)),
      gstRate,
      purchaseRate,
      salesRate,
      openingQty,
      status,
      reason,
      rawIndex: i,
    });
  }
  return out;
}

export function recountStatuses(
  rows: { status: string }[],
): { ready: number; skip: number; error: number } {
  let ready = 0;
  let skip = 0;
  let error = 0;
  for (const r of rows) {
    if (r.status === "ready") ready++;
    else if (r.status === "skip") skip++;
    else error++;
  }
  return { ready, skip, error };
}
