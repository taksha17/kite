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
    "Reply with ONE raw JSON object only — no markdown, no explanation, no code fences, no thinking tags.",
    "Schema (use null when the sentence does not say; NEVER invent id numbers):",
    "{",
    '  "voucherType": "sales" | "purchase" | "payment" | "receipt" | "contra" | "journal" | null,',
    '  "date": "YYYY-MM-DD" | null,',
    '  "number": string | null,',
    '  "partyId": number | null,         // MUST be an id from the parties list',
    '  "partyName": string | null,       // the name as written, even if no partyId match',
    '  "placeOfSupply": string | null,   // 2-digit Indian state code, e.g. "29"',
    '  "hsn": string | null,',
    '  "gstRate": number | null,         // one of 0, 5, 12, 18, 28',
    '  "taxable": number | null,         // amount BEFORE tax',
    '  "totalInclTax": number | null,    // use this when the sentence says including/incl. tax',
    '  "stockLines": [ { "itemId": number | null, "itemName": string | null, "qty": number, "rate": number | null, "description": string | null } ],',
    '  "paymentMode": string | null,     // e.g. "UPI", "Cash", "NEFT", "Net Banking"',
    '  "narration": string | null',
    "}",
    "Rules:",
    "- partyId and itemId MUST be copied from the provided lists — never invent ids. If unsure, leave the id null and fill partyName / itemName.",
    "- Match names loosely (misspellings, Hinglish). Prefer the closest list entry; if nothing is close, leave id null.",
    "- Amounts are plain numbers in INR.",
    "- 'for 70000 including tax' / 'incl. GST' → totalInclTax=70000, taxable=null. The app peels GST off.",
    "- 'for 1598 plus GST' / 'before tax' → taxable=1598, totalInclTax=null.",
    "- If items are mentioned, put them in stockLines (qty defaults to 1). Put the unit rate BEFORE tax in rate when known.",
    "- If a rate is not stated, use null — the app fills the item's standard rate or derives it from taxable.",
    "- gstRate: from the sentence, else the item's default from the list, else 18 for GST sales.",
    "- placeOfSupply: infer from the party's state when obvious, else null.",
    "- Date words like 'today'/'yesterday' resolve against the provided today; otherwise null.",
    "- The sentence may be English, Hindi, or Hinglish. Verbs: becha/bikri = sales; kharida/liya = purchase; diya/bhara = payment; mila/aaya = receipt.",
    "- paymentMode: map 'net banking'/'NEFT'/'RTGS'/'IMPS'/'UPI'/'cash' accordingly.",
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
