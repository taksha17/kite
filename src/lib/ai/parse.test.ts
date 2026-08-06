import { describe, expect, it } from "vitest";
import {
  draftIsEmpty,
  extractJsonObject,
  fuzzyMatchByName,
  parseVoucherDraft,
  sanitizeAiText,
} from "./parse";
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
    { id: 13, name: "Nvidia RTX 5090", salesRate: 0, purchaseRate: 0, gstRate: 18, hsn: "123456" },
    { id: 14, name: "Nvidia RTX 5070 Ti", salesRate: 0, purchaseRate: 0, gstRate: 18, hsn: "8473" },
  ],
};

describe("buildDraftPrompt", () => {
  it("embeds the real parties and items so the model can map to them", () => {
    const { system, user } = buildDraftPrompt(ctx, "sold 2 mice to agarwal");
    expect(system).toContain("totalInclTax");
    expect(user).toContain("Agarwal Electronics");
    expect(user).toContain("Wireless Mouse");
  });
});

describe("sanitizeAiText + extractJsonObject", () => {
  it("strips think tags and prose wrappers", () => {
    const raw =
      '<think>hmm</think>\nSure, here you go:\n```json\n{"voucherType":"sales","taxable":100}\n```\n';
    expect(sanitizeAiText(raw)).toContain("voucherType");
    expect(extractJsonObject(raw)).toMatchObject({ voucherType: "sales", taxable: 100 });
  });
});

describe("fuzzyMatchByName", () => {
  it("matches loose names but refuses wrong model numbers", () => {
    expect(fuzzyMatchByName("rtx 5070ti", ctx.items)?.id).toBe(14);
    expect(fuzzyMatchByName("rtx 5090", ctx.items)?.id).toBe(13);
    // Must not confuse 5070 with 5090
    expect(fuzzyMatchByName("rtx 5070ti", [ctx.items[2]])).toBeNull();
  });

  it("matches party nicknames", () => {
    expect(fuzzyMatchByName("agarwal", ctx.parties)?.id).toBe(5);
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
  });

  it("resolves free-model name fields and tax-inclusive totals", () => {
    const raw = JSON.stringify({
      voucherType: "sales",
      partyName: "manu bhikhari",
      itemName: "rtx 5070ti",
      qty: 1,
      totalInclTax: 70000,
      gstRate: 18,
      paymentMode: "Net Banking",
      narration: "Sold 1 rtx 5070ti to manu bhikhari",
    });
    const { draft, warnings } = parseVoucherDraft(raw, ctx);
    expect(draft.partyId).toBeNull(); // party doesn't exist
    expect(warnings.some((w) => /manu bhikhari/i.test(w))).toBe(true);
    expect(draft.stockLines).toHaveLength(1);
    expect(draft.stockLines[0].itemId).toBe(14);
    // 70000 / 1.18 ≈ 59322.03
    expect(draft.taxable).toBeCloseTo(70000 / 1.18, 1);
    expect(draft.stockLines[0].rate).toBeCloseTo(70000 / 1.18, 1);
    expect(draft.paymentMode).toBe("Net Banking");
  });

  it("fixes a wrong item id when the name is right", () => {
    const raw = JSON.stringify({
      voucherType: "sales",
      stockLines: [{ itemId: 13, itemName: "rtx 5070 ti", qty: 1, rate: 50000 }],
    });
    const { draft, warnings } = parseVoucherDraft(raw, ctx);
    expect(draft.stockLines[0].itemId).toBe(14);
    expect(warnings.some((w) => /Matched item by name/i.test(w))).toBe(true);
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
    expect(warnings.length).toBeGreaterThanOrEqual(2);
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

  it("seeds a new party when the bill names an unknown supplier", () => {
    const raw = JSON.stringify({
      voucherType: "purchase",
      partyName: "Manu Bhikhari Traders",
      partyGstin: "24ABCDE1234F1Z5",
      placeOfSupply: "24",
      totalInclTax: 1180,
      gstRate: 18,
    });
    const { draft, seedParty, warnings } = parseVoucherDraft(raw, ctx);
    expect(draft.partyId).toBeNull();
    expect(seedParty).toMatchObject({
      name: "Manu Bhikhari Traders",
      gstin: "24ABCDE1234F1Z5",
      stateCode: "24",
    });
    expect(warnings.some((w) => /Manu Bhikhari/i.test(w))).toBe(true);
  });

  it("matches a party by GSTIN from the bill", () => {
    const raw = JSON.stringify({
      voucherType: "purchase",
      partyName: "Someone Else",
      partyGstin: "29BBCDE4321G1Z3",
    });
    const { draft, seedParty } = parseVoucherDraft(raw, ctx);
    expect(draft.partyId).toBe(5);
    expect(seedParty).toBeUndefined();
  });

  it("detects an empty draft", () => {
    const raw = JSON.stringify({ voucherType: null, partyId: null });
    const { draft } = parseVoucherDraft(raw, ctx);
    expect(draftIsEmpty(draft)).toBe(true);
    expect(draftIsEmpty({ ...draft, narration: "something" })).toBe(false);
  });
});
