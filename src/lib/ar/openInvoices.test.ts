import { describe, expect, it } from "vitest";
import {
  fifoAllocateInvoices,
  oldestOpenByParty,
  sumOpenOlderThan,
  type PartyCreditRow,
  type SaleInvoiceRow,
} from "./openInvoices";

const sales: SaleInvoiceRow[] = [
  {
    id: 1,
    number: "INV-1",
    date: "2026-06-01",
    totalAmount: 10000,
    partyLedgerId: 10,
    partyName: "Acme",
  },
  {
    id: 2,
    number: "INV-2",
    date: "2026-07-01",
    totalAmount: 5000,
    partyLedgerId: 10,
    partyName: "Acme",
  },
  {
    id: 3,
    number: "INV-3",
    date: "2026-07-15",
    totalAmount: 8000,
    partyLedgerId: 11,
    partyName: "Other",
  },
];

describe("fifoAllocateInvoices", () => {
  it("clears oldest invoice first within a party", () => {
    const credits: PartyCreditRow[] = [
      { voucherId: 50, date: "2026-06-15", amount: 10000, partyLedgerId: 10 },
      { voucherId: 51, date: "2026-07-20", amount: 2000, partyLedgerId: 10 },
    ];
    const out = fifoAllocateInvoices(sales, credits);
    const a = out.find((i) => i.id === 1)!;
    const b = out.find((i) => i.id === 2)!;
    const c = out.find((i) => i.id === 3)!;
    expect(a.openAmount).toBe(0);
    expect(a.allocatedAmount).toBe(10000);
    expect(b.openAmount).toBe(3000);
    expect(b.allocatedAmount).toBe(2000);
    expect(c.openAmount).toBe(8000); // other party untouched
  });

  it("supports partial settlement of a single invoice", () => {
    const credits: PartyCreditRow[] = [
      { voucherId: 1, date: "2026-06-10", amount: 2500, partyLedgerId: 10 },
    ];
    const out = fifoAllocateInvoices(sales, credits);
    expect(out.find((i) => i.id === 1)!.openAmount).toBe(7500);
  });
});

describe("sumOpenOlderThan / oldestOpenByParty", () => {
  it("aggregates aged open AR", () => {
    const credits: PartyCreditRow[] = [
      { voucherId: 50, date: "2026-06-15", amount: 10000, partyLedgerId: 10 },
      { voucherId: 51, date: "2026-07-20", amount: 2000, partyLedgerId: 10 },
    ];
    const opens = fifoAllocateInvoices(sales, credits).filter(
      (i) => i.openAmount > 0,
    );
    expect(sumOpenOlderThan(opens, "2026-07-10")).toBe(3000); // INV-2 only
    expect(sumOpenOlderThan(opens, "2026-08-01")).toBe(11000); // INV-2 + INV-3
    const oldest = oldestOpenByParty(opens);
    expect(oldest.get(10)?.date).toBe("2026-07-01");
    expect(oldest.get(11)?.date).toBe("2026-07-15");
  });
});
