import { describe, expect, it } from "vitest";
import { matchGroupId, normalizeGroupKey } from "./mapGroups";
import {
  guessColumnMap,
  guessSheetKind,
  openingToDrCr,
  parseAmount,
  parseStateCode,
} from "./parse";
import type { AccountGroupRow } from "../db/types";

const groups: AccountGroupRow[] = [
  { id: 1, name: "Sundry Debtors", parent_id: null, nature: "assets", normal_balance: "debit", is_primary: 0 },
  { id: 2, name: "Sundry Creditors", parent_id: null, nature: "liabilities", normal_balance: "credit", is_primary: 0 },
  { id: 3, name: "Bank Accounts", parent_id: null, nature: "assets", normal_balance: "debit", is_primary: 0 },
  { id: 4, name: "Indirect Expenses", parent_id: null, nature: "expenses", normal_balance: "debit", is_primary: 0 },
];

describe("dataimport parse", () => {
  it("parses Dr/Cr amounts", () => {
    expect(parseAmount("1,250.50 Dr")).toBe(1250.5);
    expect(parseAmount("500 Cr")).toBe(-500);
    expect(parseAmount("(200)")).toBe(-200);
  });

  it("splits opening to debit/credit", () => {
    expect(openingToDrCr(100)).toEqual({ debit: 100, credit: 0 });
    expect(openingToDrCr(-40)).toEqual({ debit: 0, credit: 40 });
  });

  it("parses state codes", () => {
    expect(parseStateCode("29")).toBe("29");
    expect(parseStateCode("Karnataka")).toBe("29");
    expect(parseStateCode("29 — Karnataka")).toBe("29");
  });

  it("guesses parties sheet and columns", () => {
    const rows = [
      ["Party Name", "Kind", "Opening Balance", "GSTIN", "State"],
      ["Agarwal", "Debtor", "1000", "29BBCDE4321G1Z3", "29"],
    ];
    expect(guessSheetKind(rows)).toBe("parties");
    const map = guessColumnMap(rows, "parties");
    expect(map?.name).toBe(0);
    expect(map?.kind).toBe(1);
    expect(map?.opening).toBe(2);
    expect(map?.gstin).toBe(3);
  });

  it("guesses stock sheet", () => {
    const rows = [
      ["Item Name", "Unit", "HSN", "Opening Qty"],
      ["Mouse", "Nos", "8471", "10"],
    ];
    expect(guessSheetKind(rows)).toBe("stock");
  });
});

describe("mapGroups", () => {
  it("maps Tally-ish aliases", () => {
    expect(normalizeGroupKey("Sundry Debtors")).toBe("sundry debtors");
    expect(matchGroupId("Debtors", groups)).toBe(1);
    expect(matchGroupId("Sundry Creditor", groups)).toBe(2);
    expect(matchGroupId("Bank Accounts", groups)).toBe(3);
    expect(matchGroupId("Totally Unknown XYZ", groups)).toBeNull();
  });
});
