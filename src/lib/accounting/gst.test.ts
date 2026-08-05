import { describe, expect, it } from "vitest";
import {
  buildGstAccountingLines,
  computeGst,
  isInterstateSupply,
} from "./gst";

describe("isInterstateSupply", () => {
  it("is intra when states match", () => {
    expect(isInterstateSupply("29", "29")).toBe(false);
  });
  it("is inter when states differ", () => {
    expect(isInterstateSupply("29", "27")).toBe(true);
  });
});

describe("computeGst", () => {
  it("splits CGST/SGST for intra-state 18%", () => {
    const b = computeGst({
      taxableValue: 1000,
      rate: 18,
      companyState: "29",
      placeOfSupply: "29",
    });
    expect(b.isInterstate).toBe(false);
    expect(b.cgst).toBe(90);
    expect(b.sgst).toBe(90);
    expect(b.igst).toBe(0);
    expect(b.invoiceTotal).toBe(1180);
  });

  it("uses IGST for inter-state 18%", () => {
    const b = computeGst({
      taxableValue: 1000,
      rate: 18,
      companyState: "29",
      placeOfSupply: "27",
    });
    expect(b.isInterstate).toBe(true);
    expect(b.igst).toBe(180);
    expect(b.cgst).toBe(0);
    expect(b.sgst).toBe(0);
    expect(b.invoiceTotal).toBe(1180);
  });
});

describe("buildGstAccountingLines", () => {
  it("builds balanced sales lines", () => {
    const b = computeGst({
      taxableValue: 1000,
      rate: 18,
      companyState: "29",
      placeOfSupply: "29",
    });
    const lines = buildGstAccountingLines({
      voucherType: "sales",
      partyLedgerId: 1,
      incomeExpenseLedgerId: 2,
      cgstLedgerId: 3,
      sgstLedgerId: 4,
      igstLedgerId: 5,
      breakdown: b,
    });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(1180);
  });

  it("builds balanced purchase lines (inter-state)", () => {
    const b = computeGst({
      taxableValue: 500,
      rate: 12,
      companyState: "29",
      placeOfSupply: "07",
    });
    const lines = buildGstAccountingLines({
      voucherType: "purchase",
      partyLedgerId: 1,
      incomeExpenseLedgerId: 2,
      cgstLedgerId: 3,
      sgstLedgerId: 4,
      igstLedgerId: 5,
      breakdown: b,
    });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(b.igst).toBe(60);
  });
});
