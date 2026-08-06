import { aiChat } from "../ai/client";
import { aiConfigured, getAiSettings } from "../db/ai";
import { extractJsonObject } from "../ai/parse";
import type { LedgerRow } from "../db/client";
import type { ImportRow } from "./import";

export interface AiBankSuggestion {
  hash: string;
  ledgerId: number;
  label: string;
}

/**
 * Ask the AI to pick a counter-ledger for bank rows that rules couldn't map.
 * Batches up to 25 narrations per call to stay within free-tier budgets.
 * Every ledgerId is re-validated against the real books.
 */
export async function aiSuggestBankLedgers(
  rows: ImportRow[],
  ledgers: LedgerRow[],
): Promise<{ suggestions: AiBankSuggestion[]; warnings: string[] }> {
  const settings = await getAiSettings();
  if (!aiConfigured(settings)) {
    throw new Error(
      "AI is not set up — add a free OpenRouter key under Companies → AI quick entry.",
    );
  }

  const targets = rows
    .filter((r) => !r.excluded && !r.duplicate && !r.ledgerId)
    .slice(0, 25);
  if (targets.length === 0) {
    return { suggestions: [], warnings: ["Nothing left to suggest."] };
  }

  const ledgerList = ledgers
    .filter((l) => !l.is_cash_bank)
    .slice(0, 80)
    .map((l) => ({
      id: l.id,
      name: l.name,
      party: Boolean(l.is_party),
      group: l.group_name || "",
    }));

  const system = [
    "You classify Indian bank-statement narrations into bookkeeping ledgers.",
    "Reply with ONE raw JSON object only — no markdown, no explanation.",
    'Schema: { "items": [ { "i": number, "ledgerId": number | null } ] }',
    "Rules:",
    "- i is the index from the input rows array.",
    "- ledgerId MUST be copied from the provided ledgers list, or null if unsure.",
    "- Deposits (direction=in) usually map to a customer/party or income ledger.",
    "- Withdrawals (direction=out) usually map to a supplier/party or expense ledger.",
    "- Prefer parties when a name appears in the narration.",
    "- Never invent ledger ids.",
  ].join("\n");

  const user = JSON.stringify({
    ledgers: ledgerList,
    rows: targets.map((r, i) => ({
      i,
      date: r.date,
      direction: r.deposit > 0 ? "in" : "out",
      amount: r.deposit || r.withdrawal,
      narration: r.narration.slice(0, 160),
      reference: r.reference.slice(0, 40),
    })),
  });

  const raw = await aiChat(settings, system, user);
  const obj = extractJsonObject(raw);
  const items = Array.isArray(obj.items) ? obj.items : [];
  const byId = new Map(ledgerList.map((l) => [l.id, l]));
  const suggestions: AiBankSuggestion[] = [];
  const warnings: string[] = [];

  for (const entry of items) {
    if (typeof entry !== "object" || entry == null) continue;
    const e = entry as Record<string, unknown>;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (!Number.isInteger(i) || i < 0 || i >= targets.length) continue;
    const ledgerId =
      typeof e.ledgerId === "number"
        ? e.ledgerId
        : e.ledgerId == null
          ? null
          : Number(e.ledgerId);
    if (ledgerId == null || !Number.isFinite(ledgerId)) continue;
    const ledger = byId.get(ledgerId);
    if (!ledger) {
      warnings.push(`Dropped an unknown ledger id (${ledgerId}).`);
      continue;
    }
    suggestions.push({
      hash: targets[i].hash,
      ledgerId: ledger.id,
      label: `AI · ${ledger.name}`,
    });
  }

  if (suggestions.length === 0) {
    warnings.push("The AI couldn't confidently map those narrations.");
  }
  return { suggestions, warnings };
}
