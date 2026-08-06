export interface OnboardingContext {
  companyName: string;
  groups: { id: number; name: string }[];
  units: { id: number; name: string; symbol: string }[];
  existingLedgers: string[];
  existingItems: string[];
}

export interface ProposedLedger {
  name: string;
  groupId: number;
  groupName: string;
  openingDebit: number;
}

export interface ProposedItem {
  name: string;
  unitId: number;
  unitName: string;
  salesRate: number;
  purchaseRate: number;
  gstRate: number | null;
  hsn: string | null;
}

export interface OnboardingProposal {
  gstEnabled: boolean | null;
  ledgers: ProposedLedger[];
  items: ProposedItem[];
  warnings: string[];
}

const GST_RATES = new Set([0, 5, 12, 18, 28]);

export function buildOnboardingPrompt(
  ctx: OnboardingContext,
  description: string,
): { system: string; user: string } {
  const system = [
    "You propose a starter bookkeeping setup for an Indian small business, based on the owner's description.",
    "Reply with ONE raw JSON object only — no markdown, no explanation, no code fences.",
    "Schema:",
    "{",
    '  "gstEnabled": true | false | null,   // true if the business clearly sells GST-taxable goods/services',
    '  "ledgers": [ { "name": string, "group": string, "opening": number | null } ],',
    '  "items": [ { "name": string, "unit": string, "salesRate": number | null, "purchaseRate": number | null, "gstRate": number | null, "hsn": string | null } ]',
    "}",
    "Rules:",
    "- 'group' MUST be copied exactly from the provided account groups list — pick the closest fit.",
    "- 'unit' MUST be copied exactly from the provided units list.",
    "- Propose only what the description clearly implies: typical parties are NOT known yet, so prefer expense/income/asset ledgers the business will actually use (e.g. Rent, Freight, Salary) and its main stock items/services.",
    "- At most 12 ledgers and 20 items. Fewer, relevant entries beat long generic lists.",
    "- Do NOT propose ledgers or items that already exist (provided lists).",
    "- 'opening' is an opening balance only if the owner stated one, else null.",
    "- gstRate must be one of 0, 5, 12, 18, 28 or null.",
    "- If the description says nothing about goods, keep items empty.",
    "- The description may be in English or Hinglish — understand both.",
  ].join("\n");

  const user = JSON.stringify({
    companyName: ctx.companyName,
    accountGroups: ctx.groups.map((g) => g.name),
    units: ctx.units.map((u) => u.name),
    existingLedgers: ctx.existingLedgers,
    existingItems: ctx.existingItems,
    description,
  });

  return { system, user };
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 60 ? s : null;
}

function cleanAmount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n * 100) / 100 : 0;
}

/**
 * Tolerant parser: validates the proposal against the real groups/units and
 * existing masters. Anything unverifiable is dropped with a warning —
 * proposals are additive only and never touch existing records.
 */
export function parseOnboardingProposal(
  raw: string,
  ctx: OnboardingContext,
): OnboardingProposal {
  const warnings: string[] = [];
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("The AI didn't return a setup proposal — try rephrasing.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The AI returned malformed JSON — try again.");
  }

  const groupByName = new Map(
    ctx.groups.map((g) => [g.name.toLowerCase(), g]),
  );
  const unitByName = new Map(ctx.units.map((u) => [u.name.toLowerCase(), u]));
  const defaultUnit = ctx.units[0];
  const existingLedgerNames = new Set(
    ctx.existingLedgers.map((n) => n.toLowerCase()),
  );
  const existingItemNames = new Set(
    ctx.existingItems.map((n) => n.toLowerCase()),
  );

  const ledgers: ProposedLedger[] = [];
  const seenLedgers = new Set<string>();
  const rawLedgers = Array.isArray(parsed.ledgers) ? parsed.ledgers : [];
  for (const entry of rawLedgers.slice(0, 12)) {
    if (typeof entry !== "object" || entry == null) continue;
    const e = entry as Record<string, unknown>;
    const name = cleanName(e.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (existingLedgerNames.has(key) || seenLedgers.has(key)) {
      warnings.push(`Skipped ledger "${name}" — already exists.`);
      continue;
    }
    const group =
      typeof e.group === "string"
        ? groupByName.get(e.group.trim().toLowerCase())
        : undefined;
    if (!group) {
      warnings.push(`Dropped ledger "${name}" — unknown group "${String(e.group)}".`);
      continue;
    }
    seenLedgers.add(key);
    ledgers.push({
      name,
      groupId: group.id,
      groupName: group.name,
      openingDebit: cleanAmount(e.opening),
    });
  }

  const items: ProposedItem[] = [];
  const seenItems = new Set<string>();
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  for (const entry of rawItems.slice(0, 20)) {
    if (typeof entry !== "object" || entry == null) continue;
    const e = entry as Record<string, unknown>;
    const name = cleanName(e.name);
    if (!name || !defaultUnit) continue;
    const key = name.toLowerCase();
    if (existingItemNames.has(key) || seenItems.has(key)) {
      warnings.push(`Skipped item "${name}" — already exists.`);
      continue;
    }
    const unit =
      typeof e.unit === "string"
        ? unitByName.get(e.unit.trim().toLowerCase())
        : undefined;
    const gstRate =
      typeof e.gstRate === "number" && GST_RATES.has(e.gstRate)
        ? e.gstRate
        : null;
    seenItems.add(key);
    items.push({
      name,
      unitId: (unit || defaultUnit).id,
      unitName: (unit || defaultUnit).name,
      salesRate: cleanAmount(e.salesRate),
      purchaseRate: cleanAmount(e.purchaseRate),
      gstRate,
      hsn: typeof e.hsn === "string" && e.hsn.trim() ? e.hsn.trim() : null,
    });
  }

  const gstEnabled =
    typeof parsed.gstEnabled === "boolean" ? parsed.gstEnabled : null;
  if (ledgers.length === 0 && items.length === 0) {
    throw new Error(
      "The proposal was empty after checks — describe your business in a bit more detail.",
    );
  }
  return { gstEnabled, ledgers, items, warnings };
}
