import { describe, expect, it } from "vitest";
import {
  buildOnboardingPrompt,
  parseOnboardingProposal,
  type OnboardingContext,
} from "./onboarding";

const CTX: OnboardingContext = {
  companyName: "Test Traders",
  groups: [
    { id: 1, name: "Sundry Debtors" },
    { id: 2, name: "Expenses (Indirect)" },
    { id: 3, name: "Bank Accounts" },
  ],
  units: [
    { id: 1, name: "Nos", symbol: "Nos" },
    { id: 2, name: "Box", symbol: "Box" },
  ],
  existingLedgers: ["Sales", "Purchase"],
  existingItems: ["Wireless Mouse"],
};

const GOOD = JSON.stringify({
  gstEnabled: true,
  ledgers: [
    { name: "Rent Paid", group: "Expenses (Indirect)", opening: null },
    { name: "HDFC Current A/c", group: "bank accounts", opening: 5000 },
    { name: "Sales", group: "Sundry Debtors", opening: null },
    { name: "Mystery Ledger", group: "Not A Group", opening: null },
  ],
  items: [
    { name: "Phone Charger", unit: "Nos", salesRate: 499, purchaseRate: 300, gstRate: 18, hsn: "8504" },
    { name: "Wireless Mouse", unit: "Nos", salesRate: 799, purchaseRate: 500, gstRate: 18, hsn: null },
    { name: "Gift Box", unit: "box", salesRate: 99, purchaseRate: null, gstRate: 99, hsn: null },
  ],
});

describe("buildOnboardingPrompt", () => {
  it("includes groups, units, and existing masters in the user payload", () => {
    const { system, user } = buildOnboardingPrompt(CTX, "kirana shop");
    const payload = JSON.parse(user);
    expect(payload.accountGroups).toContain("Sundry Debtors");
    expect(payload.units).toContain("Nos");
    expect(payload.existingLedgers).toContain("Sales");
    expect(system).toContain("Hinglish");
  });
});

describe("parseOnboardingProposal", () => {
  it("maps valid entries to real group/unit ids", () => {
    const p = parseOnboardingProposal(GOOD, CTX);
    expect(p.gstEnabled).toBe(true);
    expect(p.ledgers).toHaveLength(2);
    expect(p.ledgers[0]).toMatchObject({
      name: "Rent Paid",
      groupId: 2,
      groupName: "Expenses (Indirect)",
      openingDebit: 0,
    });
    // group name match is case-insensitive; opening balance kept
    expect(p.ledgers[1]).toMatchObject({ groupId: 3, openingDebit: 5000 });
  });

  it("drops unknown groups with a warning", () => {
    const p = parseOnboardingProposal(GOOD, CTX);
    expect(
      p.warnings.some((w) => w.includes("Mystery Ledger")),
    ).toBe(true);
  });

  it("skips names that already exist", () => {
    const p = parseOnboardingProposal(GOOD, CTX);
    expect(p.ledgers.find((l) => l.name === "Sales")).toBeUndefined();
    expect(p.items.find((i) => i.name === "Wireless Mouse")).toBeUndefined();
  });

  it("falls back to the default unit and invalidates bad GST rates", () => {
    const p = parseOnboardingProposal(GOOD, CTX);
    const gift = p.items.find((i) => i.name === "Gift Box")!;
    // "box" matched case-insensitively
    expect(gift.unitId).toBe(2);
    // 99 is not a valid GST slab
    expect(gift.gstRate).toBeNull();
  });

  it("tolerates markdown-fenced JSON", () => {
    const fenced = "```json\n" + GOOD + "\n```";
    const p = parseOnboardingProposal(fenced, CTX);
    expect(p.ledgers.length).toBeGreaterThan(0);
  });

  it("throws on junk", () => {
    expect(() => parseOnboardingProposal("not json at all", CTX)).toThrow();
    expect(() =>
      parseOnboardingProposal('{"ledgers": [], "items": []}', CTX),
    ).toThrow(/empty/);
  });
});
