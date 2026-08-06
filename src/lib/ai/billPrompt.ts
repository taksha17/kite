import type { DraftContext } from "./types";

/**
 * Vision prompt for Indian tax invoices / purchase bills.
 * Same JSON schema as text drafting so parseVoucherDraft can reuse it.
 */
export function buildBillCapturePrompt(ctx: DraftContext): {
  system: string;
  user: string;
} {
  const system = [
    "You read Indian GST tax invoices / purchase bills from a photo and extract a purchase voucher draft.",
    "Reply with ONE raw JSON object only — no markdown, no explanation, no code fences, no thinking tags.",
    "Schema (use null when not readable; NEVER invent id numbers):",
    "{",
    '  "voucherType": "purchase",',
    '  "date": "YYYY-MM-DD" | null,',
    '  "number": string | null,          // invoice / bill number',
    '  "partyId": number | null,         // supplier id from parties list if matched',
    '  "partyName": string | null,       // supplier name as printed',
    '  "partyGstin": string | null,      // supplier GSTIN if printed',
    '  "placeOfSupply": string | null,   // 2-digit state code',
    '  "hsn": string | null,',
    '  "gstRate": number | null,         // 0, 5, 12, 18, or 28',
    '  "taxable": number | null,         // taxable BEFORE tax (sum of lines if multi)',
    '  "totalInclTax": number | null,    // grand total including tax if that is clearer',
    '  "stockLines": [ { "itemId": number | null, "itemName": string | null, "qty": number, "rate": number | null, "description": string | null, "hsn": string | null } ],',
    '  "paymentMode": string | null,',
    '  "narration": string | null',
    "}",
    "Rules:",
    "- This is always a purchase (we bought from the supplier on the bill).",
    "- partyId / itemId MUST come from the provided lists — never invent ids. Prefer partyName/itemName when unsure.",
    "- Match supplier name / GSTIN loosely to parties; match line items loosely to stock items.",
    "- Amounts are plain INR numbers. Prefer per-line qty + rate (before tax).",
    "- If only a grand total including GST is clear, set totalInclTax and leave taxable null.",
    "- Ignore seller letterhead decoration; read the totals table carefully.",
    "- If the photo is unreadable, return voucherType=purchase and everything else null.",
  ].join("\n");

  const user = JSON.stringify({
    today: ctx.today,
    companyStateCode: ctx.companyStateCode,
    gstEnabled: ctx.gstEnabled,
    parties: ctx.parties,
    items: ctx.items.map((i) => ({
      id: i.id,
      name: i.name,
      purchaseRate: i.purchaseRate,
      defaultGstRate: i.gstRate,
      hsn: i.hsn,
    })),
    task: "Extract the purchase voucher from the attached bill photo.",
  });

  return { system, user };
}
