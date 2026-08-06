import { describe, expect, it } from "vitest";
import {
  buildPeriodCloseChecklist,
  monthLabelFromIso,
} from "./periodClose";
import type { LedgerBalanceInput } from "./reports";

describe("monthLabelFromIso", () => {
  it("formats en-IN month year", () => {
    expect(monthLabelFromIso("2026-08-06")).toMatch(/August/);
    expect(monthLabelFromIso("2026-08-06")).toMatch(/2026/);
  });
});

describe("buildPeriodCloseChecklist", () => {
  it("flags missing HSN and open receivables", () => {
    const balances: LedgerBalanceInput[] = [
      {
        ledgerId: 1,
        ledgerName: "Agarwal",
        groupName: "Sundry Debtors",
        nature: "assets",
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 10000,
        periodCredit: 0,
      },
      {
        ledgerId: 2,
        ledgerName: "HDFC",
        groupName: "Bank Accounts",
        nature: "assets",
        openingDebit: 50000,
        openingCredit: 0,
        periodDebit: 0,
        periodCredit: 0,
      },
    ];
    const items = buildPeriodCloseChecklist({
      companyName: "Demo",
      monthLabel: "August 2026",
      gstEnabled: true,
      balances,
      gstRowsThisMonth: [],
      salesMissingHsn: 2,
      purchasesMissingHsn: 0,
      gstSalesMissingPartyGstin: 1,
      bankLedgerCount: 1,
    });
    expect(items.find((i) => i.id === "receivables")?.status).toBe("warn");
    expect(items.find((i) => i.id === "hsn-sales")?.status).toBe("warn");
    expect(items.find((i) => i.id === "hsn-purchase")?.status).toBe("ok");
    expect(items.find((i) => i.id === "party-gstin")?.status).toBe("warn");
  });
});
