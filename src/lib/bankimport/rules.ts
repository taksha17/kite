import { getActiveCompanyDb } from "../db/active";
import type { LedgerRow } from "../db/client";

export interface BankRule {
  /** Normalized substring that identifies the counter-ledger. */
  pattern: string;
  ledgerId: number;
}

const META_KEY = "bank_import_rules";

export function normalizeNarration(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getBankRules(): Promise<BankRule[]> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [META_KEY],
  );
  if (!rows[0]?.value) return [];
  try {
    const parsed = JSON.parse(rows[0].value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRules(rules: BankRule[]): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [META_KEY, JSON.stringify(rules)],
  );
}

/** Learn (or refresh) a mapping from a narration pattern to a ledger. */
export async function saveBankRule(
  pattern: string,
  ledgerId: number,
): Promise<void> {
  const norm = normalizeNarration(pattern);
  if (norm.length < 3 || !ledgerId) return;
  const rules = await getBankRules();
  const next = rules.filter((r) => r.pattern !== norm);
  next.push({ pattern: norm, ledgerId });
  // Keep the table bounded — drop the oldest learned rules first.
  await writeRules(next.slice(-200));
}

export interface Suggestion {
  ledgerId: number;
  via: "rule" | "party";
  label: string;
}

/**
 * Suggest the counter-ledger for a narration:
 * 1. A learned rule whose pattern appears in the narration (longest wins).
 * 2. Token overlap with a ledger name (parties preferred).
 */
export function suggestLedger(
  narration: string,
  rules: BankRule[],
  ledgers: LedgerRow[],
): Suggestion | null {
  const norm = normalizeNarration(narration);
  if (!norm) return null;

  let best: BankRule | null = null;
  for (const rule of rules) {
    if (rule.pattern && norm.includes(rule.pattern)) {
      if (!best || rule.pattern.length > best.pattern.length) best = rule;
    }
  }
  if (best) {
    return { ledgerId: best.ledgerId, via: "rule", label: "learned" };
  }

  const tokens = new Set(norm.split(" ").filter((t) => t.length >= 3));
  if (tokens.size === 0) return null;

  let bestLedger: LedgerRow | null = null;
  let bestScore = 0;
  for (const ledger of ledgers) {
    const nameTokens = normalizeNarration(ledger.name)
      .split(" ")
      .filter((t) => t.length >= 3);
    if (nameTokens.length === 0) continue;
    const matched = nameTokens.filter((t) => tokens.has(t)).length;
    const score = matched / nameTokens.length;
    if (score >= 0.6 && matched > 0) {
      const weighted = score + (ledger.is_party ? 0.05 : 0);
      if (weighted > bestScore) {
        bestScore = weighted;
        bestLedger = ledger;
      }
    }
  }
  if (bestLedger) {
    return {
      ledgerId: bestLedger.id,
      via: "party",
      label: "name match",
    };
  }
  return null;
}
