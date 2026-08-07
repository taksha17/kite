import type { AccountGroupRow } from "../db/types";

/** Normalize for fuzzy group matching. */
export function normalizeGroupKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIASES: Record<string, string> = {
  "sundry debtor": "sundry debtors",
  debtors: "sundry debtors",
  "accounts receivable": "sundry debtors",
  "sundry creditor": "sundry creditors",
  creditors: "sundry creditors",
  "accounts payable": "sundry creditors",
  bank: "bank accounts",
  banks: "bank accounts",
  "bank account": "bank accounts",
  "cash in hand": "cash in hand",
  cash: "cash in hand",
  "duties and taxes": "duties taxes",
  "sales account": "sales accounts",
  "purchase account": "purchase accounts",
  "fixed asset": "fixed assets",
  "current asset": "current assets",
  "current liability": "current liabilities",
  capital: "capital account",
};

/**
 * Map an imported "Under" / group name to a seeded account_group id.
 * Returns null if no confident match.
 */
export function matchGroupId(
  importedName: string,
  groups: AccountGroupRow[],
): number | null {
  const raw = importedName.trim();
  if (!raw) return null;

  const key = normalizeGroupKey(raw);
  const aliased = ALIASES[key] || key;

  const byNorm = new Map(
    groups.map((g) => [normalizeGroupKey(g.name), g.id] as const),
  );

  if (byNorm.has(aliased)) return byNorm.get(aliased)!;
  if (byNorm.has(key)) return byNorm.get(key)!;

  // Exact case-insensitive
  const exact = groups.find((g) => g.name.toLowerCase() === raw.toLowerCase());
  if (exact) return exact.id;

  // Contains / contained (prefer longer group names)
  const ranked = groups
    .map((g) => {
      const gn = normalizeGroupKey(g.name);
      let score = 0;
      if (gn === aliased || gn === key) score = 100;
      else if (aliased.includes(gn) || gn.includes(aliased)) score = Math.min(gn.length, aliased.length);
      return { id: g.id, score };
    })
    .filter((x) => x.score >= 8)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.id ?? null;
}

export function defaultGroupForParty(
  kind: "debtor" | "creditor",
  groups: AccountGroupRow[],
): number | null {
  const want = kind === "debtor" ? "Sundry Debtors" : "Sundry Creditors";
  return groups.find((g) => g.name === want)?.id ?? null;
}

export function defaultGroupForCashBank(groups: AccountGroupRow[]): {
  cash: number | null;
  bank: number | null;
} {
  return {
    cash: groups.find((g) => g.name === "Cash-in-Hand")?.id ?? null,
    bank: groups.find((g) => g.name === "Bank Accounts")?.id ?? null,
  };
}
