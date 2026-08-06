import { describe, expect, it } from "vitest";
import { normalizeNarration, suggestLedger, type BankRule } from "./rules";
import { txnHash } from "./import";
import type { ParsedTxn } from "./parse";
import type { LedgerRow } from "../db/client";

function ledger(id: number, name: string, isParty = 1): LedgerRow {
  return {
    id,
    name,
    group_id: 1,
    opening_debit: 0,
    opening_credit: 0,
    is_cash_bank: 0,
    is_party: isParty,
    gstin: null,
    state_code: null,
    email: null,
    address: null,
    city: null,
    pin: null,
    phone: null,
    notes: null,
  };
}

const LEDGERS = [
  ledger(1, "Shree Ganesh Stores"),
  ledger(2, "Acme Traders"),
  ledger(3, "Rent Expense", 0),
  ledger(4, "HDFC Bank", 0),
];

describe("normalizeNarration", () => {
  it("normalizes case and punctuation", () => {
    expect(normalizeNarration("UPI-SHREE  GANESH  STORES-98765")).toBe(
      "upi shree ganesh stores 98765",
    );
  });
});

describe("suggestLedger", () => {
  it("learned rule beats name matching", () => {
    const rules: BankRule[] = [{ pattern: "upi shree ganesh", ledgerId: 3 }];
    const s = suggestLedger("UPI-SHREE GANESH STORES-123", rules, LEDGERS);
    expect(s).toMatchObject({ ledgerId: 3, via: "rule" });
  });

  it("picks the longest matching rule", () => {
    const rules: BankRule[] = [
      { pattern: "acme", ledgerId: 3 },
      { pattern: "acme traders inv", ledgerId: 2 },
    ];
    const s = suggestLedger("NEFT CR ACME TRADERS INV 45", rules, LEDGERS);
    expect(s?.ledgerId).toBe(2);
  });

  it("matches party names by token overlap", () => {
    const s = suggestLedger("NEFT CR-HDFC0000123-ACME TRADERS-INV 45", [], LEDGERS);
    expect(s).toMatchObject({ ledgerId: 2, via: "party" });
  });

  it("matches non-party ledgers too", () => {
    const s = suggestLedger("ACH-D-RENT EXPENSE-JULY", [], LEDGERS);
    expect(s).toMatchObject({ ledgerId: 3, via: "party" });
  });

  it("returns null for unknown narrations", () => {
    expect(suggestLedger("RANDOM XYZ 999", [], LEDGERS)).toBeNull();
  });
});

describe("txnHash dedup identity", () => {
  const base: ParsedTxn = {
    date: "2026-07-31",
    narration: "UPI-SHREE GANESH STORES",
    reference: "000123",
    withdrawal: 1250,
    deposit: 0,
    rawIndex: 1,
  };

  it("is stable across re-parses of the same row", () => {
    const again: ParsedTxn = { ...base, rawIndex: 40 };
    expect(txnHash(again)).toBe(txnHash(base));
  });

  it("ignores narration case/punctuation noise", () => {
    const noisy: ParsedTxn = { ...base, narration: "upi shree ganesh stores" };
    expect(txnHash(noisy)).toBe(txnHash(base));
  });

  it("changes when amount or date changes", () => {
    expect(txnHash({ ...base, withdrawal: 1251 })).not.toBe(txnHash(base));
    expect(txnHash({ ...base, date: "2026-08-01" })).not.toBe(txnHash(base));
  });
});
