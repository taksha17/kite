import { getActiveCompanyDb } from "../db/active";
import { normalizeNarration } from "./rules";

export interface OpenInvoice {
  id: number;
  number: string | null;
  date: string;
  totalAmount: number;
  partyLedgerId: number;
  partyName: string;
}

/** Recent sales with a party — candidates for deposit matching. */
export async function fetchRecentSalesInvoices(
  limit = 200,
): Promise<OpenInvoice[]> {
  const db = getActiveCompanyDb();
  const rows = await db.select<
    {
      id: number;
      number: string | null;
      date: string;
      total_amount: number;
      party_ledger_id: number;
      party_name: string | null;
    }[]
  >(
    `SELECT v.id, v.number, v.date, v.total_amount, v.party_ledger_id, p.name as party_name
     FROM voucher v
     LEFT JOIN ledger p ON p.id = v.party_ledger_id
     WHERE v.voucher_type = 'sales' AND v.party_ledger_id IS NOT NULL
     ORDER BY v.date DESC, v.id DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    date: r.date,
    totalAmount: Number(r.total_amount) || 0,
    partyLedgerId: r.party_ledger_id,
    partyName: r.party_name || "Party",
  }));
}

function amountsClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= 1 || diff / Math.max(a, b, 1) <= 0.005;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(ms) ? ms / 86_400_000 : 9999;
}

/**
 * Match a bank deposit to an open sales invoice by amount (+ optional
 * party/invoice hints in the narration). Each invoice can only be claimed once.
 */
export function matchDepositToInvoice(
  deposit: number,
  narration: string,
  date: string,
  invoices: OpenInvoice[],
  usedInvoiceIds: Set<number>,
): OpenInvoice | null {
  if (deposit <= 0) return null;
  const norm = normalizeNarration(narration);
  const tokens = new Set(norm.split(" ").filter((t) => t.length >= 3));

  let best: OpenInvoice | null = null;
  let bestScore = 0;

  for (const inv of invoices) {
    if (usedInvoiceIds.has(inv.id)) continue;
    if (!amountsClose(deposit, inv.totalAmount)) continue;
    // Deposit should not precede the invoice by more than a day.
    if (date < inv.date && daysBetween(date, inv.date) > 1) continue;
    if (daysBetween(date, inv.date) > 120) continue;

    let score = 1; // amount match
    const partyTokens = normalizeNarration(inv.partyName)
      .split(" ")
      .filter((t) => t.length >= 3);
    const partyHits = partyTokens.filter((t) => tokens.has(t)).length;
    if (partyTokens.length && partyHits / partyTokens.length >= 0.5) score += 3;
    if (inv.number) {
      const num = normalizeNarration(inv.number).replace(/\s/g, "");
      if (num && norm.replace(/\s/g, "").includes(num)) score += 4;
    }
    // Prefer closer dates
    score += Math.max(0, 2 - daysBetween(date, inv.date) / 60);

    if (score > bestScore) {
      bestScore = score;
      best = inv;
    }
  }
  return best;
}
