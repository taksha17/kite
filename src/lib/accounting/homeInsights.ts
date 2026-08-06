import type { LedgerBalanceInput } from "./reports";

export interface MonthBounds {
  thisStart: string;
  nextStart: string;
  prevStart: string;
  agedBefore: string;
}

/** Calendar month bounds around an ISO date (local YYYY-MM-DD). */
export function monthBounds(today: string): MonthBounds {
  const [y, m] = today.split("-").map(Number);
  const thisStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const nextStart = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;

  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 30);
  const agedBefore = d.toISOString().slice(0, 10);

  return { thisStart, nextStart, prevStart, agedBefore };
}

export function closingNetDr(b: {
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
}): number {
  return (
    b.openingDebit +
    b.periodDebit -
    (b.openingCredit + b.periodCredit)
  );
}

export interface PartyBalanceInsight {
  receivables: number;
  payables: number;
  topDebtor: { name: string; amount: number } | null;
  debtorCount: number;
  creditorCount: number;
}

export function computePartyBalances(
  balances: LedgerBalanceInput[],
): PartyBalanceInsight {
  let receivables = 0;
  let payables = 0;
  let topDebtor: { name: string; amount: number } | null = null;
  let debtorCount = 0;
  let creditorCount = 0;

  for (const b of balances) {
    const net = closingNetDr(b);
    if (b.groupName === "Sundry Debtors") {
      if (net > 0.005) {
        receivables += net;
        debtorCount += 1;
        if (!topDebtor || net > topDebtor.amount) {
          topDebtor = { name: b.ledgerName, amount: net };
        }
      }
    } else if (b.groupName === "Sundry Creditors") {
      if (net < -0.005) {
        payables += -net;
        creditorCount += 1;
      }
    }
  }

  return {
    receivables: Math.round(receivables * 100) / 100,
    payables: Math.round(payables * 100) / 100,
    topDebtor: topDebtor
      ? {
          name: topDebtor.name,
          amount: Math.round(topDebtor.amount * 100) / 100,
        }
      : null,
    debtorCount,
    creditorCount,
  };
}

export function salesDeltaPct(
  thisMonth: number,
  lastMonth: number,
): number | null {
  if (Math.abs(lastMonth) < 0.005) return null;
  return Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10;
}

export interface StockAlertInsight {
  lowCount: number;
  lowNames: string[];
}

/** Aggregate godown rows → items with 0 < qty < threshold. */
export function computeLowStock(
  rows: { item_id: number; item_name: string; qty: number }[],
  threshold = 5,
): StockAlertInsight {
  const byItem = new Map<number, { name: string; qty: number }>();
  for (const r of rows) {
    const cur = byItem.get(r.item_id) || { name: r.item_name, qty: 0 };
    cur.qty += Number(r.qty) || 0;
    byItem.set(r.item_id, cur);
  }
  const low = [...byItem.values()]
    .filter((i) => i.qty > 0 && i.qty < threshold)
    .sort((a, b) => a.qty - b.qty);
  return {
    lowCount: low.length,
    lowNames: low.slice(0, 3).map((i) => i.name),
  };
}

export type InsightTone = "neutral" | "good" | "warn";

export interface HomeInsightCard {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: InsightTone;
  href: string;
}

export interface HomeInsightInput {
  today: string;
  party: PartyBalanceInsight;
  gstNetThisMonth: number;
  salesThisMonth: number;
  salesLastMonth: number;
  salesOlderThan30: number;
  stock: StockAlertInsight;
  formatInr: (n: number) => string;
}

/** Turn computed facts into dashboard cards (rules only — no AI). */
export function buildHomeInsightCards(
  input: HomeInsightInput,
): HomeInsightCard[] {
  const {
    party,
    gstNetThisMonth,
    salesThisMonth,
    salesLastMonth,
    salesOlderThan30,
    stock,
    formatInr,
  } = input;
  const cards: HomeInsightCard[] = [];
  const delta = salesDeltaPct(salesThisMonth, salesLastMonth);

  cards.push({
    id: "receivables",
    label: "Receivables",
    value: formatInr(party.receivables),
    detail: party.topDebtor
      ? `Top: ${party.topDebtor.name} · ${formatInr(party.topDebtor.amount)}`
      : party.debtorCount
        ? `${party.debtorCount} customer${party.debtorCount === 1 ? "" : "s"} with balance`
        : "No open customer balances",
    tone: party.receivables > 0 ? "warn" : "neutral",
    href: "/reports",
  });

  cards.push({
    id: "payables",
    label: "Payables",
    value: formatInr(party.payables),
    detail: party.creditorCount
      ? `${party.creditorCount} supplier${party.creditorCount === 1 ? "" : "s"} to pay`
      : "No open supplier balances",
    tone: party.payables > 0 ? "warn" : "good",
    href: "/reports",
  });

  cards.push({
    id: "gst",
    label: "GST net this month",
    value: formatInr(gstNetThisMonth),
    detail:
      gstNetThisMonth > 0
        ? "Approx. payable (outward − ITC)"
        : gstNetThisMonth < 0
          ? "ITC exceeds outward tax this month"
          : "No GST vouchers this month yet",
    tone: gstNetThisMonth > 0 ? "warn" : "neutral",
    href: "/reports",
  });

  let salesDetail = `Last month ${formatInr(salesLastMonth)}`;
  if (delta != null) {
    salesDetail =
      delta >= 0
        ? `↑ ${delta}% vs last month (${formatInr(salesLastMonth)})`
        : `↓ ${Math.abs(delta)}% vs last month (${formatInr(salesLastMonth)})`;
  } else if (salesLastMonth < 0.005 && salesThisMonth > 0) {
    salesDetail = "No sales recorded last month";
  }

  cards.push({
    id: "sales",
    label: "Sales this month",
    value: formatInr(salesThisMonth),
    detail: salesDetail,
    tone:
      delta != null && delta < -10
        ? "warn"
        : delta != null && delta > 10
          ? "good"
          : "neutral",
    href: "/vouchers",
  });

  if (salesOlderThan30 > 0.005) {
    cards.push({
      id: "aged",
      label: "Sales older than 30 days",
      value: formatInr(salesOlderThan30),
      detail: "By invoice date — not true overdue (no due dates yet)",
      tone: "warn",
      href: "/ask?q=" + encodeURIComponent("Which customers still owe me?"),
    });
  }

  if (stock.lowCount > 0) {
    cards.push({
      id: "stock",
      label: "Low stock",
      value: String(stock.lowCount),
      detail: stock.lowNames.length
        ? `Under 5 units: ${stock.lowNames.join(", ")}`
        : "Items with qty under 5",
      tone: "warn",
      href: "/reports",
    });
  }

  return cards;
}
