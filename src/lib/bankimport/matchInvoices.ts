import { normalizeNarration } from "./rules";
import {
  fetchOpenSalesInvoices,
  type OpenSalesInvoice,
} from "../ar/openInvoices";

/** Bank-match view of an unpaid (or partially paid) sales invoice. */
export interface OpenInvoice {
  id: number;
  number: string | null;
  date: string;
  /** Original invoice total. */
  totalAmount: number;
  /** Remaining unpaid after FIFO receipts. */
  openAmount: number;
  partyLedgerId: number;
  partyName: string;
}

/** Unpaid sales after FIFO allocation — candidates for deposit matching. */
export async function fetchRecentSalesInvoices(
  _limit = 200,
): Promise<OpenInvoice[]> {
  const opens = await fetchOpenSalesInvoices();
  // Newest first for matching preference when scores tie on recency.
  return opens
    .map((inv) => toOpenInvoice(inv))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}

function toOpenInvoice(inv: OpenSalesInvoice): OpenInvoice {
  return {
    id: inv.id,
    number: inv.number,
    date: inv.date,
    totalAmount: inv.totalAmount,
    openAmount: inv.openAmount,
    partyLedgerId: inv.partyLedgerId,
    partyName: inv.partyName,
  };
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
 * Match a bank deposit to an open sales invoice by remaining open amount
 * (+ optional party/invoice hints). Each invoice can only be claimed once.
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
    const open = inv.openAmount > 0 ? inv.openAmount : inv.totalAmount;
    if (open <= 0.005) continue;
    if (!amountsClose(deposit, open)) continue;
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
