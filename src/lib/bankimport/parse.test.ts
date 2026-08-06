import { describe, expect, it } from "vitest";
import {
  applyMapping,
  guessMapping,
  parseStatementAmount,
  parseStatementDate,
  type SheetRows,
} from "./parse";

describe("parseStatementDate", () => {
  it("parses ISO dates", () => {
    expect(parseStatementDate("2026-07-31")).toBe("2026-07-31");
  });
  it("parses dd/mm/yyyy day-first (Indian convention)", () => {
    expect(parseStatementDate("05/07/2026")).toBe("2026-07-05");
    expect(parseStatementDate("31-03-2026")).toBe("2026-03-31");
    expect(parseStatementDate("05.07.26")).toBe("2026-07-05");
  });
  it("parses dd-MMM-yyyy", () => {
    expect(parseStatementDate("05-Jul-2026")).toBe("2026-07-05");
    expect(parseStatementDate("5 Jul 2026")).toBe("2026-07-05");
    expect(parseStatementDate("31-Dec-25")).toBe("2025-12-31");
  });
  it("parses Excel date serials", () => {
    // 2026-07-05 is serial 46208
    expect(parseStatementDate(46208)).toBe("2026-07-05");
  });
  it("parses Date objects", () => {
    expect(parseStatementDate(new Date(2026, 6, 5))).toBe("2026-07-05");
  });
  it("rejects garbage", () => {
    expect(parseStatementDate("hello")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
    expect(parseStatementDate(null)).toBeNull();
    expect(parseStatementDate(123)).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("parses plain and Indian-comma amounts", () => {
    expect(parseStatementAmount("1,23,456.78")).toBe(123456.78);
    expect(parseStatementAmount("1500")).toBe(1500);
    expect(parseStatementAmount("₹ 2,500.00")).toBe(2500);
  });
  it("handles negatives and Dr/Cr suffixes", () => {
    expect(parseStatementAmount("(1,000.00)")).toBe(-1000);
    expect(parseStatementAmount("500.00 Dr")).toBe(-500);
    expect(parseStatementAmount("500.00 CR")).toBe(500);
    expect(parseStatementAmount(-250.5)).toBe(-250.5);
  });
  it("rejects blanks and text", () => {
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("N/A")).toBeNull();
    expect(parseStatementAmount(null)).toBeNull();
  });
});

const HDFC_STYLE: SheetRows = [
  ["Date", "Narration", "Chq/Ref No", "Value Dt", "Withdrawal Amt", "Deposit Amt", "Closing Balance"],
  ["31/07/26", "UPI-SHREE GANESH STORES-9876543210", "000123456789", "31/07/26", "1,250.00", null, "48,750.00"],
  ["01/08/26", "NEFT CR-HDFC0000123-ACME TRADERS-INV 45", "UTR123456", "01/08/26", null, "10,000.00", "58,750.00"],
];

const SBI_STYLE: SheetRows = [
  ["State Bank of India"],
  ["Account: 12345678901"],
  ["Txn Date", "Description", "Ref No./Cheque No.", "Debit", "Credit", "Balance"],
  ["05 Jul 2026", "TO TRANSFER-UPI/DR/123456/RENT", "U123", "8,000.00", null, "92,000.00"],
  ["07 Jul 2026", "BY TRANSFER-NEFT*RAJESH KUMAR", "N456", null, "15,500.50", "1,07,500.50"],
];

const SIGNED_STYLE: SheetRows = [
  ["Transaction Date", "Particulars", "Amount"],
  ["2026-07-05", "POS PURCHASE AT SHELL PETROL", "-450.00"],
  ["2026-07-06", "SALARY CREDIT JULY", "75,000.00"],
];

describe("guessMapping + applyMapping", () => {
  it("detects HDFC-style headers and parses rows", () => {
    const mapping = guessMapping(HDFC_STYLE)!;
    expect(mapping).not.toBeNull();
    expect(mapping.headerRow).toBe(1);
    const { txns, skipped } = applyMapping(HDFC_STYLE, mapping);
    expect(skipped).toHaveLength(0);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({
      date: "2026-07-31",
      withdrawal: 1250,
      deposit: 0,
      reference: "000123456789",
    });
    expect(txns[1]).toMatchObject({ date: "2026-08-01", deposit: 10000 });
  });

  it("handles preamble rows (SBI-style) and word dates", () => {
    const mapping = guessMapping(SBI_STYLE)!;
    expect(mapping).not.toBeNull();
    expect(mapping.headerRow).toBe(3);
    const { txns } = applyMapping(SBI_STYLE, mapping);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ date: "2026-07-05", withdrawal: 8000 });
    expect(txns[1]).toMatchObject({ date: "2026-07-07", deposit: 15500.5 });
  });

  it("supports a single signed amount column", () => {
    const mapping = guessMapping(SIGNED_STYLE)!;
    expect(mapping).not.toBeNull();
    const { txns } = applyMapping(SIGNED_STYLE, mapping);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ withdrawal: 450, deposit: 0 });
    expect(txns[1]).toMatchObject({ deposit: 75000, withdrawal: 0 });
  });

  it("skips totals and balance rows", () => {
    const rows: SheetRows = [
      ["Date", "Narration", "Debit", "Credit"],
      ["01/07/2026", "Opening Balance", null, null],
      ["02/07/2026", "UPI-PAYMENT", "100", null],
      ["", "", "", ""],
    ];
    const mapping = guessMapping(rows)!;
    const { txns } = applyMapping(rows, mapping);
    expect(txns).toHaveLength(1);
    expect(txns[0].withdrawal).toBe(100);
  });
});
