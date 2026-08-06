import { summarizeGstr3b } from "./gstReports";
import type { GstInvoiceRow } from "../db/types";
import type { LedgerBalanceInput } from "./reports";
import { closingNetDr } from "./homeInsights";

export type ChecklistStatus = "ok" | "warn" | "todo";

export interface PeriodCloseItem {
  id: string;
  title: string;
  detail: string;
  status: ChecklistStatus;
  href: string;
}

export interface PeriodCloseInput {
  companyName: string;
  monthLabel: string;
  gstEnabled: boolean;
  balances: LedgerBalanceInput[];
  gstRowsThisMonth: GstInvoiceRow[];
  salesMissingHsn: number;
  purchasesMissingHsn: number;
  gstSalesMissingPartyGstin: number;
  bankLedgerCount: number;
}

export function buildPeriodCloseChecklist(
  input: PeriodCloseInput,
): PeriodCloseItem[] {
  const items: PeriodCloseItem[] = [];
  const g3 = summarizeGstr3b(input.gstRowsThisMonth);
  const gstNet = g3.netCgst + g3.netSgst + g3.netIgst;

  let receivables = 0;
  let payables = 0;
  let cashBank = 0;
  for (const b of input.balances) {
    const net = closingNetDr(b);
    if (b.groupName === "Sundry Debtors" && net > 0) receivables += net;
    if (b.groupName === "Sundry Creditors" && net < 0) payables += -net;
    if (
      b.groupName === "Cash-in-Hand" ||
      b.groupName === "Bank Accounts"
    ) {
      cashBank += net;
    }
  }
  receivables = Math.round(receivables * 100) / 100;
  payables = Math.round(payables * 100) / 100;
  cashBank = Math.round(cashBank * 100) / 100;

  items.push({
    id: "cash",
    title: "Cash & bank on hand",
    detail: `Books show ₹${cashBank.toLocaleString("en-IN")} — reconcile with your bank statement.`,
    status: input.bankLedgerCount > 0 ? "todo" : "warn",
    href: "/bank-import",
  });

  items.push({
    id: "receivables",
    title: "Collect open receivables",
    detail:
      receivables > 0
        ? `₹${receivables.toLocaleString("en-IN")} outstanding — send reminders if needed.`
        : "No open customer balances.",
    status: receivables > 0 ? "warn" : "ok",
    href: "/follow-up",
  });

  items.push({
    id: "payables",
    title: "Review supplier payables",
    detail:
      payables > 0
        ? `₹${payables.toLocaleString("en-IN")} owed to suppliers.`
        : "No open supplier balances.",
    status: payables > 0 ? "todo" : "ok",
    href: "/reports",
  });

  if (input.gstEnabled) {
    items.push({
      id: "hsn-sales",
      title: "HSN on sales invoices",
      detail:
        input.salesMissingHsn > 0
          ? `${input.salesMissingHsn} sales voucher${input.salesMissingHsn === 1 ? "" : "s"} missing HSN/SAC.`
          : "All GST sales this month have HSN/SAC.",
      status: input.salesMissingHsn > 0 ? "warn" : "ok",
      href: "/vouchers",
    });

    items.push({
      id: "hsn-purchase",
      title: "HSN on purchase invoices",
      detail:
        input.purchasesMissingHsn > 0
          ? `${input.purchasesMissingHsn} purchase voucher${input.purchasesMissingHsn === 1 ? "" : "s"} missing HSN/SAC.`
          : "All GST purchases this month have HSN/SAC.",
      status: input.purchasesMissingHsn > 0 ? "warn" : "ok",
      href: "/vouchers",
    });

    items.push({
      id: "party-gstin",
      title: "Party GSTIN on B2B sales",
      detail:
        input.gstSalesMissingPartyGstin > 0
          ? `${input.gstSalesMissingPartyGstin} GST sale${input.gstSalesMissingPartyGstin === 1 ? "" : "s"} without party GSTIN.`
          : "GST sales parties have GSTIN filled in.",
      status: input.gstSalesMissingPartyGstin > 0 ? "warn" : "ok",
      href: "/ledgers",
    });

    items.push({
      id: "gstr3b",
      title: `GSTR-3B prep — ${input.monthLabel}`,
      detail: `Net GST (outward − ITC) ≈ ₹${Math.round(gstNet).toLocaleString("en-IN")} · review the GSTR-3B report before filing.`,
      status: input.gstRowsThisMonth.length > 0 ? "todo" : "ok",
      href: "/reports",
    });
  } else {
    items.push({
      id: "gst-off",
      title: "GST",
      detail: "GST is off for this company — skip return prep.",
      status: "ok",
      href: "/companies",
    });
  }

  items.push({
    id: "ask",
    title: "Spot-check with Ask",
    detail: `Ask “What were my sales in ${input.monthLabel}?” and compare with reports.`,
    status: "todo",
    href: `/ask?q=${encodeURIComponent(`What were my sales in ${input.monthLabel}?`)}`,
  });

  return items;
}

export function monthLabelFromIso(today: string): string {
  const d = new Date(`${today}T12:00:00`);
  return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
}
