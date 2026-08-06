import { getActiveCompanyDb } from "../db/active";

export interface SaleInvoiceRow {
  id: number;
  number: string | null;
  date: string;
  totalAmount: number;
  partyLedgerId: number;
  partyName: string;
}

export interface PartyCreditRow {
  voucherId: number;
  date: string;
  amount: number;
  partyLedgerId: number;
}

export interface OpenSalesInvoice extends SaleInvoiceRow {
  allocatedAmount: number;
  openAmount: number;
}

/**
 * FIFO: apply party credits (receipts etc.) to oldest sales first.
 * Returns every invoice with remaining openAmount (may be 0 — filter callers).
 */
export function fifoAllocateInvoices(
  invoicesOldestFirst: SaleInvoiceRow[],
  creditsOldestFirst: PartyCreditRow[],
): OpenSalesInvoice[] {
  const out: OpenSalesInvoice[] = invoicesOldestFirst.map((inv) => ({
    ...inv,
    allocatedAmount: 0,
    openAmount: Math.round(inv.totalAmount * 100) / 100,
  }));

  // Index queues per party
  const byParty = new Map<number, OpenSalesInvoice[]>();
  for (const inv of out) {
    const list = byParty.get(inv.partyLedgerId) || [];
    list.push(inv);
    byParty.set(inv.partyLedgerId, list);
  }
  const cursor = new Map<number, number>();

  for (const credit of creditsOldestFirst) {
    let left = Math.round(credit.amount * 100) / 100;
    if (left <= 0.005) continue;
    const list = byParty.get(credit.partyLedgerId);
    if (!list) continue;
    let i = cursor.get(credit.partyLedgerId) || 0;
    while (left > 0.005 && i < list.length) {
      const inv = list[i];
      if (inv.openAmount <= 0.005) {
        i += 1;
        continue;
      }
      const apply = Math.min(inv.openAmount, left);
      inv.allocatedAmount =
        Math.round((inv.allocatedAmount + apply) * 100) / 100;
      inv.openAmount = Math.round((inv.openAmount - apply) * 100) / 100;
      left = Math.round((left - apply) * 100) / 100;
      if (inv.openAmount <= 0.005) i += 1;
    }
    cursor.set(credit.partyLedgerId, i);
  }

  return out;
}

export async function fetchSalesInvoicesForAr(): Promise<SaleInvoiceRow[]> {
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
     ORDER BY v.date ASC, v.id ASC`,
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

/**
 * Credits that clear AR: any credit on the party ledger except sales
 * (receipts, journals, credit notes posted as credit on debtor).
 */
export async function fetchPartyArCredits(): Promise<PartyCreditRow[]> {
  const db = getActiveCompanyDb();
  const rows = await db.select<
    {
      voucher_id: number;
      date: string;
      amount: number;
      party_ledger_id: number;
    }[]
  >(
    `SELECT v.id as voucher_id, v.date, vl.credit as amount, vl.ledger_id as party_ledger_id
     FROM voucher_line vl
     JOIN voucher v ON v.id = vl.voucher_id
     JOIN ledger l ON l.id = vl.ledger_id
     JOIN account_group g ON g.id = l.group_id
     WHERE vl.credit > 0.005
       AND v.voucher_type != 'sales'
       AND g.name = 'Sundry Debtors'
     ORDER BY v.date ASC, v.id ASC, vl.id ASC`,
  );
  return rows.map((r) => ({
    voucherId: r.voucher_id,
    date: r.date,
    amount: Number(r.amount) || 0,
    partyLedgerId: r.party_ledger_id,
  }));
}

/** Open (unpaid) sales after FIFO allocation — oldest first. */
export async function fetchOpenSalesInvoices(): Promise<OpenSalesInvoice[]> {
  const [invoices, credits] = await Promise.all([
    fetchSalesInvoicesForAr(),
    fetchPartyArCredits(),
  ]);
  return fifoAllocateInvoices(invoices, credits).filter(
    (inv) => inv.openAmount > 0.005,
  );
}

/** Σ open amounts on invoices older than `agedBefore` (ISO date). */
export function sumOpenOlderThan(
  opens: OpenSalesInvoice[],
  agedBefore: string,
): number {
  const sum = opens
    .filter((inv) => inv.date < agedBefore)
    .reduce((s, inv) => s + inv.openAmount, 0);
  return Math.round(sum * 100) / 100;
}

/** Oldest open invoice date per party. */
export function oldestOpenByParty(
  opens: OpenSalesInvoice[],
): Map<number, { date: string; openAmount: number; number: string | null }> {
  const map = new Map<
    number,
    { date: string; openAmount: number; number: string | null }
  >();
  for (const inv of opens) {
    const cur = map.get(inv.partyLedgerId);
    if (!cur || inv.date < cur.date) {
      map.set(inv.partyLedgerId, {
        date: inv.date,
        openAmount: inv.openAmount,
        number: inv.number,
      });
    }
  }
  return map;
}
