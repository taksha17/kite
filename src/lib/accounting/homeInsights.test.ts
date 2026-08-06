import { describe, expect, it } from "vitest";
import {
  buildHomeInsightCards,
  closingNetDr,
  computeLowStock,
  computePartyBalances,
  monthBounds,
  salesDeltaPct,
} from "./homeInsights";
import type { LedgerBalanceInput } from "./reports";

function bal(
  partial: Partial<LedgerBalanceInput> & {
    ledgerName: string;
    groupName: string;
  },
): LedgerBalanceInput {
  return {
    ledgerId: 1,
    nature: "assets",
    openingDebit: 0,
    openingCredit: 0,
    periodDebit: 0,
    periodCredit: 0,
    ...partial,
  };
}

describe("monthBounds", () => {
  it("computes calendar months around mid-month", () => {
    const b = monthBounds("2026-08-06");
    expect(b.thisStart).toBe("2026-08-01");
    expect(b.nextStart).toBe("2026-09-01");
    expect(b.prevStart).toBe("2026-07-01");
    expect(b.agedBefore).toBe("2026-07-07");
  });
});

describe("computePartyBalances", () => {
  it("sums debtors debit and creditors credit balances", () => {
    const party = computePartyBalances([
      bal({
        ledgerName: "Agarwal",
        groupName: "Sundry Debtors",
        periodDebit: 10000,
        periodCredit: 2000,
      }),
      bal({
        ledgerName: "City Suppliers",
        groupName: "Sundry Creditors",
        periodCredit: 5000,
        periodDebit: 500,
      }),
      bal({
        ledgerName: "Cash",
        groupName: "Cash-in-Hand",
        periodDebit: 1000,
      }),
    ]);
    expect(party.receivables).toBe(8000);
    expect(party.payables).toBe(4500);
    expect(party.topDebtor).toEqual({ name: "Agarwal", amount: 8000 });
  });
});

describe("salesDeltaPct", () => {
  it("returns null when last month is zero", () => {
    expect(salesDeltaPct(100, 0)).toBeNull();
  });
  it("rounds to one decimal", () => {
    expect(salesDeltaPct(110, 100)).toBe(10);
    expect(salesDeltaPct(90, 100)).toBe(-10);
  });
});

describe("computeLowStock", () => {
  it("aggregates godowns and flags qty under threshold", () => {
    const r = computeLowStock(
      [
        { item_id: 1, item_name: "Mouse", qty: 2 },
        { item_id: 1, item_name: "Mouse", qty: 1 },
        { item_id: 2, item_name: "Cable", qty: 20 },
      ],
      5,
    );
    expect(r.lowCount).toBe(1);
    expect(r.lowNames).toEqual(["Mouse"]);
  });
});

describe("closingNetDr", () => {
  it("matches trial-balance closing", () => {
    expect(
      closingNetDr({
        openingDebit: 100,
        openingCredit: 20,
        periodDebit: 50,
        periodCredit: 10,
      }),
    ).toBe(120);
  });
});

describe("buildHomeInsightCards", () => {
  it("always includes core cards and optional aged/stock", () => {
    const cards = buildHomeInsightCards({
      today: "2026-08-06",
      party: {
        receivables: 8000,
        payables: 0,
        topDebtor: { name: "Agarwal", amount: 8000 },
        debtorCount: 1,
        creditorCount: 0,
      },
      gstNetThisMonth: 1800,
      salesThisMonth: 50000,
      salesLastMonth: 40000,
      salesOlderThan30: 12000,
      stock: { lowCount: 2, lowNames: ["Mouse", "Cable"] },
      formatInr: (n) => `₹${n}`,
    });
    const ids = cards.map((c) => c.id);
    expect(ids).toContain("receivables");
    expect(ids).toContain("payables");
    expect(ids).toContain("gst");
    expect(ids).toContain("sales");
    expect(ids).toContain("aged");
    expect(ids).toContain("stock");
    expect(cards.find((c) => c.id === "sales")?.detail).toMatch(/↑ 25%/);
  });
});
