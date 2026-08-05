import type { GstInvoiceRow } from "../db/client";
import { roundMoney } from "./engine";

export interface Gstr1Summary {
  invoices: GstInvoiceRow[];
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  invoiceTotal: number;
  b2bCount: number;
  b2cCount: number;
}

export interface Gstr3bSummary {
  outwardTaxable: number;
  outwardCgst: number;
  outwardSgst: number;
  outwardIgst: number;
  inwardTaxable: number;
  itcCgst: number;
  itcSgst: number;
  itcIgst: number;
  netCgst: number;
  netSgst: number;
  netIgst: number;
}

export function summarizeGstr1(rows: GstInvoiceRow[]): Gstr1Summary {
  const sales = rows.filter((r) => r.voucher_type === "sales");
  let taxableValue = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let invoiceTotal = 0;
  let b2bCount = 0;
  let b2cCount = 0;

  for (const r of sales) {
    taxableValue += r.taxable_value || 0;
    cgst += r.cgst_amount || 0;
    sgst += r.sgst_amount || 0;
    igst += r.igst_amount || 0;
    invoiceTotal += r.total_amount || 0;
    if (r.party_gstin) b2bCount += 1;
    else b2cCount += 1;
  }

  return {
    invoices: sales,
    taxableValue: roundMoney(taxableValue),
    cgst: roundMoney(cgst),
    sgst: roundMoney(sgst),
    igst: roundMoney(igst),
    invoiceTotal: roundMoney(invoiceTotal),
    b2bCount,
    b2cCount,
  };
}

export function summarizeGstr3b(rows: GstInvoiceRow[]): Gstr3bSummary {
  let outwardTaxable = 0;
  let outwardCgst = 0;
  let outwardSgst = 0;
  let outwardIgst = 0;
  let inwardTaxable = 0;
  let itcCgst = 0;
  let itcSgst = 0;
  let itcIgst = 0;

  for (const r of rows) {
    if (r.voucher_type === "sales") {
      outwardTaxable += r.taxable_value || 0;
      outwardCgst += r.cgst_amount || 0;
      outwardSgst += r.sgst_amount || 0;
      outwardIgst += r.igst_amount || 0;
    } else if (r.voucher_type === "purchase") {
      inwardTaxable += r.taxable_value || 0;
      itcCgst += r.cgst_amount || 0;
      itcSgst += r.sgst_amount || 0;
      itcIgst += r.igst_amount || 0;
    }
  }

  return {
    outwardTaxable: roundMoney(outwardTaxable),
    outwardCgst: roundMoney(outwardCgst),
    outwardSgst: roundMoney(outwardSgst),
    outwardIgst: roundMoney(outwardIgst),
    inwardTaxable: roundMoney(inwardTaxable),
    itcCgst: roundMoney(itcCgst),
    itcSgst: roundMoney(itcSgst),
    itcIgst: roundMoney(itcIgst),
    netCgst: roundMoney(outwardCgst - itcCgst),
    netSgst: roundMoney(outwardSgst - itcSgst),
    netIgst: roundMoney(outwardIgst - itcIgst),
  };
}
