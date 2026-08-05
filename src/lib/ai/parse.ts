import { GST_RATES, INDIA_STATES } from "../accounting/gst";
import type {
  DraftContext,
  DraftStockLine,
  VoucherDraft,
} from "./types";

const VOUCHER_TYPES = new Set([
  "sales",
  "purchase",
  "payment",
  "receipt",
  "contra",
  "journal",
]);

export interface ParsedDraft {
  draft: VoucherDraft;
  /** Human-readable notes about fields that had to be dropped or fixed. */
  warnings: string[];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Parses the model's reply into a VoucherDraft, dropping anything that does
 * not check out against the real books. Every party/item id is validated
 * against the candidate lists — a hallucinated id can never reach the editor.
 */
export function parseVoucherDraft(raw: string, ctx: DraftContext): ParsedDraft {
  const warnings: string[] = [];
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new Error("The AI reply was not valid JSON. Try rephrasing the entry.");
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("The AI reply had an unexpected shape. Try rephrasing the entry.");
  }

  const draft: VoucherDraft = {
    voucherType: null,
    date: null,
    number: asString(obj.number),
    partyId: null,
    placeOfSupply: null,
    hsn: asString(obj.hsn),
    gstRate: null,
    taxable: null,
    stockLines: [],
    paymentMode: asString(obj.paymentMode),
    narration: asString(obj.narration),
  };

  if (typeof obj.voucherType === "string" && VOUCHER_TYPES.has(obj.voucherType)) {
    draft.voucherType = obj.voucherType as VoucherDraft["voucherType"];
  } else if (obj.voucherType != null) {
    warnings.push("Ignored an unknown voucher type from the AI.");
  }

  const date = asString(obj.date);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) {
    draft.date = date;
  } else if (date) {
    warnings.push(`Ignored an unparseable date (“${date}”).`);
  }

  const partyId = asNumber(obj.partyId);
  if (partyId != null) {
    const party = ctx.parties.find((p) => p.id === partyId);
    if (party) {
      draft.partyId = party.id;
    } else {
      warnings.push("The AI picked a party that is not in your ledgers — choose it yourself.");
    }
  }

  const pos = asString(obj.placeOfSupply);
  if (pos && INDIA_STATES.some((s) => s.code === pos)) {
    draft.placeOfSupply = pos;
  } else if (pos) {
    warnings.push(`Ignored an unknown place-of-supply code (“${pos}”).`);
  }

  const gstRate = asNumber(obj.gstRate);
  if (gstRate != null && (GST_RATES as readonly number[]).includes(gstRate)) {
    draft.gstRate = gstRate;
  } else if (gstRate != null) {
    warnings.push(`Ignored an invalid GST rate (${gstRate}%).`);
  }

  const taxable = asNumber(obj.taxable);
  if (taxable != null && taxable >= 0) {
    draft.taxable = taxable;
  }

  if (Array.isArray(obj.stockLines)) {
    for (const line of obj.stockLines as Record<string, unknown>[]) {
      const itemId = asNumber(line?.itemId);
      const item = itemId != null ? ctx.items.find((i) => i.id === itemId) : undefined;
      if (!item) {
        warnings.push("Dropped a stock line with an item that is not in your inventory.");
        continue;
      }
      const qty = asNumber(line.qty);
      const rate = asNumber(line.rate);
      const parsedLine: DraftStockLine = {
        itemId: item.id,
        qty: qty != null && qty > 0 ? qty : 1,
        rate: rate != null && rate >= 0 ? rate : null,
        description: asString(line.description),
      };
      draft.stockLines.push(parsedLine);
    }
  }

  return { draft, warnings };
}

/** True when the draft contains nothing usable at all. */
export function draftIsEmpty(draft: VoucherDraft): boolean {
  return (
    !draft.voucherType &&
    !draft.partyId &&
    !draft.taxable &&
    draft.stockLines.length === 0 &&
    !draft.narration
  );
}
