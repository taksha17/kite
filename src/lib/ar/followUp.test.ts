import { describe, expect, it } from "vitest";
import {
  buildFollowUpTargets,
  daysBetween,
  draftPaymentReminder,
  mailtoHref,
  normalizePhoneForWhatsApp,
  whatsappHref,
} from "./followUp";
import type { LedgerBalanceInput } from "../accounting/reports";
import type { LedgerRow } from "../db/types";

function bal(
  id: number,
  name: string,
  debit: number,
): LedgerBalanceInput {
  return {
    ledgerId: id,
    ledgerName: name,
    groupName: "Sundry Debtors",
    nature: "assets",
    openingDebit: 0,
    openingCredit: 0,
    periodDebit: debit,
    periodCredit: 0,
  };
}

function ledger(id: number, name: string, email?: string, phone?: string): LedgerRow {
  return {
    id,
    name,
    group_id: 1,
    group_name: "Sundry Debtors",
    opening_debit: 0,
    opening_credit: 0,
    is_cash_bank: 0,
    is_party: 1,
    gstin: null,
    state_code: null,
    email: email || null,
    address: null,
    city: null,
    pin: null,
    phone: phone || null,
    notes: null,
  };
}

describe("normalizePhoneForWhatsApp", () => {
  it("adds 91 for 10-digit Indian mobiles", () => {
    expect(normalizePhoneForWhatsApp("98765 43210")).toBe("919876543210");
    expect(normalizePhoneForWhatsApp("+91 9876543210")).toBe("919876543210");
  });
});

describe("buildFollowUpTargets", () => {
  it("keeps only debtors with positive balance, largest first", () => {
    const targets = buildFollowUpTargets(
      [
        bal(1, "Agarwal", 5000),
        bal(2, "Small", 500),
        {
          ...bal(3, "Cleared", 1000),
          periodCredit: 1000,
        },
      ],
      [
        ledger(1, "Agarwal", "a@x.com", "9876543210"),
        ledger(2, "Small"),
        ledger(3, "Cleared"),
      ],
      new Map([
        [1, { date: "2026-06-01", openAmount: 5000, number: "INV-1" }],
      ]),
      "2026-08-06",
    );
    expect(targets).toHaveLength(2);
    expect(targets[0].name).toBe("Agarwal");
    expect(targets[0].amount).toBe(5000);
    expect(targets[0].daysOverdue).toBe(daysBetween("2026-06-01", "2026-08-06"));
    expect(targets[0].oldestOpenNumber).toBe("INV-1");
    expect(targets[0].email).toBe("a@x.com");
  });
});

describe("draftPaymentReminder", () => {
  it("embeds amount and company name", () => {
    const d = draftPaymentReminder({
      companyName: "Kite Demo",
      partyName: "Agarwal",
      amount: 1500,
      daysOverdue: 40,
      oldestOpenNumber: "INV-9",
    });
    expect(d.subject).toMatch(/outstanding/i);
    expect(d.body).toContain("Kite Demo");
    expect(d.body).toContain("Agarwal");
    expect(d.whatsappText).toContain("40");
    expect(d.body).toContain("INV-9");
  });
});

describe("mailto / whatsapp hrefs", () => {
  it("builds openable links", () => {
    const d = draftPaymentReminder({
      companyName: "Co",
      partyName: "P",
      amount: 100,
      daysOverdue: null,
    });
    expect(mailtoHref("a@b.com", d)).toMatch(/^mailto:/);
    expect(whatsappHref("9876543210", d)).toMatch(/^https:\/\/wa\.me\/919876543210/);
  });
});
