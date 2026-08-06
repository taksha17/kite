import { GST_RATES, INDIA_STATES } from "../accounting/gst";
import type {
  DraftContext,
  DraftContextItem,
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
  /** When the AI named a party that isn't in the books — UI can offer create. */
  seedParty?: { name: string; gstin?: string; stateCode?: string };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    // Tolerate "₹70,000" / "70000 incl GST" that free models sometimes emit.
    const cleaned = value.replace(/[₹$,]/g, "").replace(/[^\d.\-].*$/, "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    const s = asString(v);
    if (s) return s;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = asNumber(v);
    if (n != null) return n;
  }
  return null;
}

/** Strip reasoning wrappers free/reasoning models love to emit. */
export function sanitizeAiText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/** Pull the outermost JSON object even when the model wraps it in prose. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = sanitizeAiText(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The AI reply was not valid JSON. Try rephrasing the entry.");
  }
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      throw new Error("shape");
    }
    return obj as Record<string, unknown>;
  } catch {
    throw new Error("The AI reply was not valid JSON. Try rephrasing the entry.");
  }
}

function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Fuzzy name match for free models that return names (or wrong ids).
 * Number tokens in the query are required (so "5070ti" won't match "5090").
 */
export function fuzzyMatchByName<T extends { name: string }>(
  query: string,
  candidates: T[],
): T | null {
  const qTokens = normalizeTokens(query);
  if (qTokens.length === 0 || candidates.length === 0) return null;
  const qNumbers = qTokens.filter((t) => /\d/.test(t));

  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const cTokens = new Set(normalizeTokens(c.name));
    if (cTokens.size === 0) continue;
    if (qNumbers.some((n) => ![...cTokens].some((ct) => ct.includes(n) || n.includes(ct)))) {
      continue;
    }
    const matched = qTokens.filter((t) =>
      [...cTokens].some((ct) => ct === t || ct.includes(t) || t.includes(ct)),
    ).length;
    const score = matched / qTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // At least half the query tokens must land, and at least one match.
  return bestScore >= 0.5 && best ? best : null;
}

function resolveParty(
  obj: Record<string, unknown>,
  ctx: DraftContext,
  warnings: string[],
): { partyId: number | null; seedParty?: ParsedDraft["seedParty"] } {
  const partyId = firstNumber(obj.partyId, obj.party_id, obj.ledgerId);
  const name = firstString(
    obj.partyName,
    obj.party_name,
    obj.party,
    typeof obj.party === "object" && obj.party
      ? (obj.party as { name?: unknown }).name
      : null,
  );
  const gstin = firstString(obj.partyGstin, obj.party_gstin, obj.gstin);
  const stateCode = firstString(
    obj.placeOfSupply,
    obj.partyState,
    obj.party_state,
  );

  if (partyId != null) {
    const party = ctx.parties.find((p) => p.id === partyId);
    if (party) return { partyId: party.id };
    warnings.push("The AI picked a party id that is not in your ledgers.");
  }

  // Prefer GSTIN exact match when the bill printed one.
  if (gstin) {
    const byGstin = ctx.parties.find(
      (p) => p.gstin && p.gstin.toUpperCase() === gstin.toUpperCase(),
    );
    if (byGstin) return { partyId: byGstin.id };
  }

  if (name) {
    const match = fuzzyMatchByName(name, ctx.parties);
    if (match) {
      if (partyId != null) warnings.push(`Matched party by name to “${match.name}”.`);
      return { partyId: match.id };
    }
    warnings.push(
      `No party matching “${name}” — create or pick one in the form.`,
    );
    return {
      partyId: null,
      seedParty: {
        name,
        gstin: gstin || undefined,
        stateCode:
          stateCode && stateCode.length === 2 ? stateCode : undefined,
      },
    };
  }
  return { partyId: null };
}

function resolveItem(
  line: Record<string, unknown>,
  ctx: DraftContext,
  warnings: string[],
): DraftContextItem | null {
  const itemId = firstNumber(line.itemId, line.item_id, line.id);
  const name = firstString(
    line.itemName,
    line.item_name,
    line.name,
    typeof line.item === "object" && line.item
      ? (line.item as { name?: unknown }).name
      : typeof line.item === "string"
        ? line.item
        : null,
    // description is a weak hint — only used when no better name field exists
    line.description,
  );

  const byName = name ? fuzzyMatchByName(name, ctx.items) : null;
  const byId =
    itemId != null ? ctx.items.find((i) => i.id === itemId) : undefined;

  if (byName && byId && byName.id !== byId.id) {
    warnings.push(
      `Matched item by name to “${byName.name}” (AI had id for “${byId.name}”).`,
    );
    return byName;
  }
  if (byName) {
    if (itemId != null && !byId) {
      warnings.push(`Matched item by name to “${byName.name}” (AI had a wrong id).`);
    }
    return byName;
  }
  if (byId) return byId;

  if (itemId != null) {
    warnings.push("Dropped a stock line with an item id that is not in your inventory.");
  } else if (name) {
    warnings.push(`No stock item matching “${name}” — create or pick one.`);
  }
  return null;
}

function taxableFromInclusive(
  inclusive: number,
  gstRate: number | null,
): number {
  const rate = gstRate != null && gstRate > 0 ? gstRate : 18;
  return Math.round((inclusive / (1 + rate / 100)) * 100) / 100;
}

/**
 * Parses the model's reply into a VoucherDraft, dropping anything that does
 * not check out against the real books. Free models often emit names instead
 * of ids, wrap JSON in prose, or pass tax-inclusive totals — all handled here.
 */
export function parseVoucherDraft(raw: string, ctx: DraftContext): ParsedDraft {
  const warnings: string[] = [];
  const obj = extractJsonObject(raw);

  const draft: VoucherDraft = {
    voucherType: null,
    date: null,
    number: firstString(obj.number, obj.invoiceNumber, obj.voucherNumber),
    partyId: null,
    placeOfSupply: null,
    hsn: firstString(obj.hsn, obj.hsnSac, obj.hsn_sac),
    gstRate: null,
    taxable: null,
    stockLines: [],
    paymentMode: firstString(
      obj.paymentMode,
      obj.payment_mode,
      obj.mode,
      obj.payment,
    ),
    narration: firstString(obj.narration, obj.notes, obj.note),
  };

  const voucherType = firstString(obj.voucherType, obj.voucher_type, obj.type);
  if (voucherType && VOUCHER_TYPES.has(voucherType.toLowerCase())) {
    draft.voucherType = voucherType.toLowerCase() as VoucherDraft["voucherType"];
  } else if (voucherType) {
    warnings.push("Ignored an unknown voucher type from the AI.");
  }

  const date = firstString(obj.date, obj.voucherDate);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) {
    draft.date = date;
  } else if (date) {
    warnings.push(`Ignored an unparseable date (“${date}”).`);
  }

  const partyResolved = resolveParty(obj, ctx, warnings);
  draft.partyId = partyResolved.partyId;

  const pos = firstString(obj.placeOfSupply, obj.place_of_supply, obj.stateCode);
  if (pos && INDIA_STATES.some((s) => s.code === pos)) {
    draft.placeOfSupply = pos;
  } else if (pos) {
    warnings.push(`Ignored an unknown place-of-supply code (“${pos}”).`);
  }

  const gstRate = firstNumber(obj.gstRate, obj.gst_rate, obj.taxRate);
  if (gstRate != null && (GST_RATES as readonly number[]).includes(gstRate)) {
    draft.gstRate = gstRate;
  } else if (gstRate != null) {
    warnings.push(`Ignored an invalid GST rate (${gstRate}%).`);
  }

  const taxable = firstNumber(obj.taxable, obj.taxableValue, obj.taxable_value, obj.amount);
  const inclusive = firstNumber(
    obj.totalInclTax,
    obj.totalIncludingTax,
    obj.amountIncludingTax,
    obj.inclusiveAmount,
    obj.invoiceTotal,
    obj.grandTotal,
  );
  if (taxable != null && taxable >= 0) {
    draft.taxable = taxable;
  } else if (inclusive != null && inclusive > 0) {
    draft.taxable = taxableFromInclusive(inclusive, draft.gstRate);
    warnings.push(
      `Converted tax-inclusive ₹${inclusive} → taxable ₹${draft.taxable} at ${draft.gstRate ?? 18}%.`,
    );
  }

  const rawLines = Array.isArray(obj.stockLines)
    ? obj.stockLines
    : Array.isArray(obj.items)
      ? obj.items
      : Array.isArray(obj.lines)
        ? obj.lines
        : [];

  for (const entry of rawLines) {
    if (typeof entry !== "object" || entry == null) continue;
    const line = entry as Record<string, unknown>;
    const item = resolveItem(line, ctx, warnings);
    if (!item) continue;
    const qty = firstNumber(line.qty, line.quantity, line.qty_out) ?? 1;
    let rate = firstNumber(line.rate, line.price, line.unitPrice, line.salesRate);
    // If the model put a tax-inclusive unit price, peel GST off when asked.
    const rateIncl = firstNumber(line.rateInclTax, line.priceIncludingTax);
    if (rate == null && rateIncl != null) {
      rate = taxableFromInclusive(rateIncl, draft.gstRate ?? item.gstRate);
    }
    const parsedLine: DraftStockLine = {
      itemId: item.id,
      qty: qty > 0 ? qty : 1,
      rate: rate != null && rate >= 0 ? rate : null,
      description: firstString(line.description, line.lineDescription),
    };
    draft.stockLines.push(parsedLine);
  }

  // Single named item with no stockLines array — common free-model shape.
  if (draft.stockLines.length === 0) {
    const loneName = firstString(obj.itemName, obj.item_name, obj.item);
    if (loneName) {
      const match = fuzzyMatchByName(loneName, ctx.items);
      if (match) {
        const qty = firstNumber(obj.qty, obj.quantity) ?? 1;
        let rate = firstNumber(obj.rate, obj.price);
        if (rate == null && draft.taxable != null && qty > 0) {
          rate = Math.round((draft.taxable / qty) * 100) / 100;
        }
        draft.stockLines.push({
          itemId: match.id,
          qty,
          rate,
          description: null,
        });
      } else {
        warnings.push(`No stock item matching “${loneName}” — create or pick one.`);
      }
    }
  }

  // If we have stock lines but no per-line rate, and taxable is known, spread it.
  if (draft.stockLines.length === 1 && draft.stockLines[0].rate == null && draft.taxable != null) {
    const qty = draft.stockLines[0].qty || 1;
    draft.stockLines[0].rate = Math.round((draft.taxable / qty) * 100) / 100;
  }

  // Sentence-level fallback: try to pick the item mentioned in narration/sentence
  // fields when the model returned a sales voucher with nothing matched.
  if (
    draft.stockLines.length === 0 &&
    (draft.voucherType === "sales" || draft.voucherType === "purchase") &&
    ctx.items.length > 0
  ) {
    const hint = firstString(obj.narration, obj.itemHint) || "";
    if (hint) {
      const match = fuzzyMatchByName(hint, ctx.items);
      if (match) {
        draft.stockLines.push({
          itemId: match.id,
          qty: 1,
          rate: draft.taxable,
          description: null,
        });
        warnings.push(`Inferred stock item “${match.name}” from the narration.`);
      }
    }
  }

  return { draft, warnings, seedParty: partyResolved.seedParty };
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
