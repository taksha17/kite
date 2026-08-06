import { formatInr } from "../accounting/engine";
import { closingNetDr } from "../accounting/homeInsights";
import type { LedgerBalanceInput } from "../accounting/reports";
import type { LedgerRow } from "../db/types";

export interface FollowUpTarget {
  ledgerId: number;
  name: string;
  amount: number;
  email: string | null;
  phone: string | null;
  /** Oldest unpaid invoice date (FIFO open AR). */
  oldestOpenDate: string | null;
  daysOverdue: number | null;
  oldestOpenNumber: string | null;
}

export interface ReminderDraft {
  subject: string;
  body: string;
  whatsappText: string;
}

/** Digits only; strip leading 0 / +91 for wa.me. */
export function normalizePhoneForWhatsApp(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) d = `91${d}`;
  if (d.length === 11 && d.startsWith("0")) d = `91${d.slice(1)}`;
  if (d.length < 10) return null;
  return d;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00`);
  const b = Date.parse(`${toIso}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Open Sundry Debtor balances joined with contact + oldest unpaid invoice.
 * Sorted largest balance first.
 */
export function buildFollowUpTargets(
  balances: LedgerBalanceInput[],
  ledgers: LedgerRow[],
  oldestOpen: Map<
    number,
    { date: string; openAmount: number; number: string | null }
  >,
  today: string,
): FollowUpTarget[] {
  const byId = new Map(ledgers.map((l) => [l.id, l]));
  const out: FollowUpTarget[] = [];

  for (const b of balances) {
    if (b.groupName !== "Sundry Debtors") continue;
    const net = closingNetDr(b);
    if (net <= 0.005) continue;
    const ledger = byId.get(b.ledgerId);
    const open = oldestOpen.get(b.ledgerId) || null;
    out.push({
      ledgerId: b.ledgerId,
      name: b.ledgerName,
      amount: Math.round(net * 100) / 100,
      email: ledger?.email || null,
      phone: ledger?.phone || null,
      oldestOpenDate: open?.date || null,
      daysOverdue: open ? daysBetween(open.date, today) : null,
      oldestOpenNumber: open?.number || null,
    });
  }

  return out.sort((a, b) => b.amount - a.amount);
}

/** Human-approved reminder copy — amounts come from books, not the AI. */
export function draftPaymentReminder(input: {
  companyName: string;
  partyName: string;
  amount: number;
  daysOverdue: number | null;
  oldestOpenNumber?: string | null;
}): ReminderDraft {
  const amt = formatInr(input.amount);
  const inv =
    input.oldestOpenNumber && input.oldestOpenNumber.trim()
      ? ` (oldest open invoice ${input.oldestOpenNumber.trim()})`
      : "";
  const age =
    input.daysOverdue != null && input.daysOverdue > 0
      ? ` — oldest unpaid bill is about ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} old${inv}`
      : inv;

  const subject = `Payment reminder — ${amt} outstanding`;
  const body = [
    `Dear ${input.partyName},`,
    "",
    `This is a friendly reminder from ${input.companyName} that ${amt} is outstanding on your account${age}.`,
    "",
    "Please arrange payment at your earliest convenience. If you have already paid, kindly share the reference so we can update our books.",
    "",
    "Thank you,",
    input.companyName,
  ].join("\n");

  const whatsappText = [
    `Hi ${input.partyName},`,
    `Friendly reminder from ${input.companyName}: ${amt} is outstanding on your account${age}.`,
    `Please arrange payment when you can — thank you!`,
  ].join("\n");

  return { subject, body, whatsappText };
}

export function mailtoHref(email: string, draft: ReminderDraft): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

export function whatsappHref(phone: string, draft: ReminderDraft): string | null {
  const n = normalizePhoneForWhatsApp(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(draft.whatsappText)}`;
}
