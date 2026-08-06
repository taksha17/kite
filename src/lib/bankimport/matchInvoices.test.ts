import { describe, expect, it } from "vitest";
import {
  matchDepositToInvoice,
  type OpenInvoice,
} from "./matchInvoices";

const INVOICES: OpenInvoice[] = [
  {
    id: 1,
    number: "INV-45",
    date: "2026-07-01",
    totalAmount: 10000,
    openAmount: 10000,
    partyLedgerId: 10,
    partyName: "Acme Traders",
  },
  {
    id: 2,
    number: "INV-46",
    date: "2026-07-10",
    totalAmount: 10000,
    openAmount: 10000,
    partyLedgerId: 11,
    partyName: "Shree Ganesh Stores",
  },
  {
    id: 3,
    number: "S-99",
    date: "2026-01-01",
    totalAmount: 5000,
    openAmount: 5000,
    partyLedgerId: 10,
    partyName: "Acme Traders",
  },
];

describe("matchDepositToInvoice", () => {
  it("matches amount + party name", () => {
    const used = new Set<number>();
    const m = matchDepositToInvoice(
      10000,
      "NEFT CR-HDFC-ACME TRADERS-INV",
      "2026-07-12",
      INVOICES,
      used,
    );
    expect(m?.id).toBe(1);
  });

  it("prefers an invoice number mentioned in the narration", () => {
    const used = new Set<number>();
    const m = matchDepositToInvoice(
      10000,
      "UPI-PAYMENT INV-46 SHREE",
      "2026-07-15",
      INVOICES,
      used,
    );
    expect(m?.id).toBe(2);
  });

  it("does not reuse an already claimed invoice", () => {
    const used = new Set<number>([1]);
    const m = matchDepositToInvoice(
      10000,
      "NEFT ACME TRADERS",
      "2026-07-12",
      INVOICES,
      used,
    );
    // amount still matches #2, but party tokens don't — may be null or 2
    expect(m?.id === 1).toBe(false);
  });

  it("rejects amount mismatches and ancient invoices", () => {
    const used = new Set<number>();
    expect(
      matchDepositToInvoice(9000, "ACME", "2026-07-12", INVOICES, used),
    ).toBeNull();
    expect(
      matchDepositToInvoice(5000, "ACME", "2026-08-01", INVOICES, used),
    ).toBeNull(); // S-99 is >120 days before Aug in this fixture... Jan to Aug is >120
  });

  it("allows 1-rupee rounding differences", () => {
    const used = new Set<number>();
    const m = matchDepositToInvoice(
      10000.5,
      "ACME TRADERS",
      "2026-07-05",
      INVOICES,
      used,
    );
    expect(m?.id).toBe(1);
  });

  it("matches against remaining open amount after partial payment", () => {
    const used = new Set<number>();
    const partial: OpenInvoice = {
      ...INVOICES[0],
      openAmount: 4000,
    };
    expect(
      matchDepositToInvoice(10000, "ACME TRADERS", "2026-07-12", [partial], used),
    ).toBeNull();
    expect(
      matchDepositToInvoice(4000, "ACME TRADERS", "2026-07-12", [partial], used)
        ?.id,
    ).toBe(1);
  });
});
