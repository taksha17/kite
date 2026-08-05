import { describe, expect, it } from "vitest";
import { indianFyStartFor, sumLines, validateVoucher } from "./engine";
import type { DraftVoucher } from "./types";

function sample(overrides: Partial<DraftVoucher> = {}): DraftVoucher {
  return {
    voucherType: "journal",
    date: "2026-04-05",
    lines: [
      { ledgerId: 1, debit: 1000, credit: 0 },
      { ledgerId: 2, debit: 0, credit: 1000 },
    ],
    ...overrides,
  };
}

describe("validateVoucher", () => {
  it("accepts a balanced voucher", () => {
    const result = validateVoucher(sample());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(1000);
    }
  });

  it("rejects unbalanced vouchers", () => {
    const result = validateVoucher(
      sample({
        lines: [
          { ledgerId: 1, debit: 500, credit: 0 },
          { ledgerId: 2, debit: 0, credit: 400 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects dual-sided lines", () => {
    const result = validateVoucher(
      sample({
        lines: [{ ledgerId: 1, debit: 10, credit: 10 }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("sums money safely", () => {
    const totals = sumLines(
      sample({
        lines: [
          { ledgerId: 1, debit: 10.1, credit: 0 },
          { ledgerId: 3, debit: 20.2, credit: 0 },
          { ledgerId: 2, debit: 0, credit: 30.3 },
        ],
      }),
    );
    expect(totals.totalDebit).toBe(30.3);
    expect(totals.totalCredit).toBe(30.3);
  });
});

describe("indianFyStartFor", () => {
  it("returns Apr 1 of current FY after March", () => {
    expect(indianFyStartFor(new Date("2026-08-03"))).toBe("2026-04-01");
  });

  it("returns previous year before April", () => {
    expect(indianFyStartFor(new Date("2026-02-10"))).toBe("2025-04-01");
  });
});
