import { roundMoney } from "./engine";
import type { DraftLine } from "./types";

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

/** Common Indian GST state codes */
export const INDIA_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
];

export interface GstBreakdown {
  taxableValue: number;
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  invoiceTotal: number;
  isInterstate: boolean;
}

export function isInterstateSupply(
  companyState: string | null | undefined,
  placeOfSupply: string | null | undefined,
): boolean {
  const a = (companyState || "").trim();
  const b = (placeOfSupply || "").trim();
  if (!a || !b) return false;
  return a !== b;
}

export function computeGst(input: {
  taxableValue: number;
  rate: number;
  companyState?: string | null;
  placeOfSupply?: string | null;
}): GstBreakdown {
  const taxableValue = roundMoney(Math.max(0, input.taxableValue || 0));
  const rate = Number(input.rate) || 0;
  const interstate = isInterstateSupply(input.companyState, input.placeOfSupply);
  const taxTotal = roundMoney((taxableValue * rate) / 100);

  if (interstate) {
    return {
      taxableValue,
      rate,
      cgst: 0,
      sgst: 0,
      igst: taxTotal,
      taxTotal,
      invoiceTotal: roundMoney(taxableValue + taxTotal),
      isInterstate: true,
    };
  }

  const half = roundMoney(taxTotal / 2);
  // Ensure halves sum to total (handle 0.01 split)
  const cgst = half;
  const sgst = roundMoney(taxTotal - half);
  return {
    taxableValue,
    rate,
    cgst,
    sgst,
    igst: 0,
    taxTotal: roundMoney(cgst + sgst),
    invoiceTotal: roundMoney(taxableValue + cgst + sgst),
    isInterstate: false,
  };
}

export function buildGstAccountingLines(input: {
  voucherType: "sales" | "purchase";
  partyLedgerId: number;
  incomeExpenseLedgerId: number;
  cgstLedgerId: number;
  sgstLedgerId: number;
  igstLedgerId: number;
  breakdown: GstBreakdown;
}): DraftLine[] {
  const { breakdown: b } = input;
  const lines: DraftLine[] = [];

  if (input.voucherType === "sales") {
    // Dr Party (invoice total)
    lines.push({
      ledgerId: input.partyLedgerId,
      debit: b.invoiceTotal,
      credit: 0,
    });
    // Cr Sales (taxable)
    lines.push({
      ledgerId: input.incomeExpenseLedgerId,
      debit: 0,
      credit: b.taxableValue,
    });
    if (b.isInterstate) {
      if (b.igst > 0) {
        lines.push({
          ledgerId: input.igstLedgerId,
          debit: 0,
          credit: b.igst,
        });
      }
    } else {
      if (b.cgst > 0) {
        lines.push({
          ledgerId: input.cgstLedgerId,
          debit: 0,
          credit: b.cgst,
        });
      }
      if (b.sgst > 0) {
        lines.push({
          ledgerId: input.sgstLedgerId,
          debit: 0,
          credit: b.sgst,
        });
      }
    }
  } else {
    // Dr Purchase (taxable)
    lines.push({
      ledgerId: input.incomeExpenseLedgerId,
      debit: b.taxableValue,
      credit: 0,
    });
    if (b.isInterstate) {
      if (b.igst > 0) {
        lines.push({
          ledgerId: input.igstLedgerId,
          debit: b.igst,
          credit: 0,
        });
      }
    } else {
      if (b.cgst > 0) {
        lines.push({
          ledgerId: input.cgstLedgerId,
          debit: b.cgst,
          credit: 0,
        });
      }
      if (b.sgst > 0) {
        lines.push({
          ledgerId: input.sgstLedgerId,
          debit: b.sgst,
          credit: 0,
        });
      }
    }
    // Cr Party
    lines.push({
      ledgerId: input.partyLedgerId,
      debit: 0,
      credit: b.invoiceTotal,
    });
  }

  return lines.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0);
}
