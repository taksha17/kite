import type { DraftContext } from "./types";

/**
 * Builds the prompt pair for voucher drafting. The model only ever sees the
 * candidate parties/items — never raw books — and answers with strict JSON
 * that parse.ts then validates against the same lists.
 */
export function buildDraftPrompt(
  ctx: DraftContext,
  sentence: string,
): { system: string; user: string } {
  const system = [
    "You extract accounting voucher drafts from natural language for an Indian GST bookkeeping app.",
    "Reply with ONE raw JSON object only — no markdown, no explanation, no code fences.",
    "Schema (use null when the sentence does not say; NEVER invent values):",
    "{",
    '  "voucherType": "sales" | "purchase" | "payment" | "receipt" | "contra" | "journal" | null,',
    '  "date": "YYYY-MM-DD" | null,',
    '  "number": string | null,          // invoice/voucher number if stated',
    '  "partyId": number | null,         // id from the parties list, or null if no match',
    '  "placeOfSupply": string | null,   // 2-digit Indian state code, e.g. "29"',
    '  "hsn": string | null,',
    '  "gstRate": number | null,         // one of 0, 5, 12, 18, 28',
    '  "taxable": number | null,         // taxable amount BEFORE tax, no currency symbols',
    '  "stockLines": [ { "itemId": number, "qty": number, "rate": number | null, "description": string | null } ],',
    '  "paymentMode": string | null,     // e.g. "UPI", "Cash", "NEFT"',
    '  "narration": string | null        // one short line',
    "}",
    "Rules:",
    "- partyId and itemId MUST be copied from the provided lists — never make up ids.",
    "- Amounts are plain numbers in INR. If the sentence says 'for 1598 plus GST', taxable=1598.",
    "- If items are mentioned, put them in stockLines (qty defaults to 1) and leave taxable null.",
    "- If a rate is not stated, use null — the app fills the item's standard rate.",
    "- gstRate: from the sentence, else the item's default from the list, else null.",
    "- placeOfSupply: infer from the party's state when obvious, else null.",
    "- Date words like 'today'/'yesterday' resolve against the provided today; otherwise null.",
    "- If nothing sensible can be extracted, answer with every field null.",
  ].join("\n");

  const user = JSON.stringify({
    today: ctx.today,
    companyStateCode: ctx.companyStateCode,
    gstEnabled: ctx.gstEnabled,
    parties: ctx.parties,
    items: ctx.items.map((i) => ({
      id: i.id,
      name: i.name,
      salesRate: i.salesRate,
      purchaseRate: i.purchaseRate,
      defaultGstRate: i.gstRate,
      hsn: i.hsn,
    })),
    sentence,
  });

  return { system, user };
}
