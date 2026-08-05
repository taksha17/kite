import { describe, expect, it } from "vitest";
import { parseVoucherDraft, draftIsEmpty } from "./parse";
import { buildDraftPrompt } from "./prompt";
import type { DraftContext } from "./types";

const ctx: DraftContext = {
  today: "2026-08-04",
  companyStateCode: "29",
  gstEnabled: true,
  parties: [
    { id: 5, name: "Agarwal Electronics", gstin: "29BBCDE4321G1Z3" },
    { id: 7, name: "City Suppliers", gstin: null },
  ],
  items: [
    { id: 11, name: "Wireless Mouse", salesRate: 799, purchaseRate: 450, gstRate: 18, hsn: "8471" },
    { id: 12, name: "USB-C Cable", salesRate: 199, purchaseRate: 90, gstRate: 18, hsn: "8544" },
  ],
};

describe("buildDraftPrompt", () => {
  it("embeds the real parties and items so the model can map to them", () => {
    const { system, user } = buildDraftPrompt(ctx, "sold 2 mice to agarwal");
    expect(system).toContain("JSON");
    expect(user).toContain("Agarwal Electronics");
    expect(user).toContain("Wireless Mouse");
    expect(user).toContain("2026-08-04");
    expect(user).toContain("sold 2 mice to agarwal");
  });
});

describe("parseVoucherDraft", () => {
  it("parses a clean sales draft", () => {
    const raw = JSON.stringify({
      voucherType: "sales",
      date: "2026-08-04",
      partyId: 5,
      placeOfSupply: "29",
      gstRate: 18,
      stockLines: [{ itemId: 11, qty: 2, rate: 799, description: null }],
      paymentMode: "UPI",
      narration: "Sale to Agarwal",
    });
    const { draft, warnings } = parseVoucherDraft(raw, ctx);
    expect(warnings).toEqual([]);
    expect(draft.voucherType).toBe("sales");
    expect(draft.partyId).toBe(5);
    expect(draft.stockLines).toHaveLength(1);
    expect(draft.stockLines[0]).toMatchObject({ itemId: 11, qty: 2, rate: 799 });
    expect(draft.paymentMode).toBe("UPI");
  });

  it("tolerates markdown code fences around the JSON", () => {
    const raw = "```json\n{\"voucherType\":\"receipt\",\"taxable\":500}\n```";
    const { draft } = parseVoucherDraft(raw, ctx);
    expect(draft.voucherType).toBe("receipt");
    expect(draft.taxable).toBe(500);
  });

  it("drops hallucinated party and item ids with warnings", () => {
    const raw = JSON.stringify({
      voucherType: "sales",
      partyId: 999,
      stockLines: [
        { itemId: 11, qty: 1 },
        { itemId: 777, qty: 3 },
      ],
    });
    const { draft, warnings } = parseVoucherDraft(raw, ctx);
    expect(draft.partyId).toBeNull();
    expect(draft.stockLines).toHaveLength(1);
    expect(draft.stockLines[0].itemId).toBe(11);
    expect(warnings.length).toBe(2);
  });

  it("rejects invalid GST rates, state codes, and dates", () => {
    const raw = JSON.stringify({
      gstRate: 17,
      placeOfSupply: "XX",
      date: "4 Aug 2026",
    });
    const { draft, warnings } = parseVoucherDraft(raw, ctx);
    expect(draft.gstRate).toBeNull();
    expect(draft.placeOfSupply).toBeNull();
    expect(draft.date).toBeNull();
    expect(warnings.length).toBe(3);
  });

  it("defaults missing qty to 1 and missing rate to null", () => {
    const raw = JSON.stringify({ stockLines: [{ itemId: 12 }] });
    const { draft } = parseVoucherDraft(raw, ctx);
    expect(draft.stockLines[0]).toMatchObject({ itemId: 12, qty: 1, rate: null });
  });

  it("throws a friendly error on non-JSON replies", () => {
    expect(() => parseVoucherDraft("Sorry, I cannot help.", ctx)).toThrow(/not valid JSON/);
  });

  it("detects an empty draft", () => {
    const raw = JSON.stringify({ voucherType: null, partyId: null });
    const { draft } = parseVoucherDraft(raw, ctx);
    expect(draftIsEmpty(draft)).toBe(true);
    expect(draftIsEmpty({ ...draft, narration: "something" })).toBe(false);
  });
});
