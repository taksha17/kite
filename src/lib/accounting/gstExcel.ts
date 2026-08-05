import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import * as XLSX from "xlsx";
import type { GstInvoiceRow } from "../db/types";
import type { Gstr1Summary, Gstr3bSummary } from "./gstReports";

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function saveWorkbook(
  wb: XLSX.WorkBook,
  defaultName: string,
): Promise<string | null> {
  const path = await save({
    title: "Save Excel report",
    defaultPath: defaultName,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path) return null;
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await writeFile(path, new Uint8Array(bytes));
  return path;
}

function invoiceRow(r: GstInvoiceRow) {
  return {
    Date: r.date,
    "Invoice no": r.number || `V-${r.id}`,
    Type: r.voucher_type,
    Party: r.party_name || "",
    GSTIN: r.party_gstin || "",
    "Place of supply": r.place_of_supply || "",
    Interstate: r.is_interstate ? "Yes" : "No",
    "HSN/SAC": r.hsn_sac || "",
    "GST %": r.gst_rate ?? "",
    "Taxable value": money(r.taxable_value),
    CGST: money(r.cgst_amount),
    SGST: money(r.sgst_amount),
    IGST: money(r.igst_amount),
    "Invoice total": money(r.total_amount),
    Category: r.party_gstin ? "B2B" : "B2C",
  };
}

/** GSTR-1 style workbook: Summary + B2B + B2C + All invoices (books aid, not portal JSON). */
export async function exportGstr1Excel(
  summary: Gstr1Summary,
  companyName: string,
): Promise<string | null> {
  const wb = XLSX.utils.book_new();
  const stamp = new Date().toISOString().slice(0, 10);

  const summaryAoA = [
    ["Kite — GSTR-1 style sales report"],
    ["Company", companyName],
    ["Generated", stamp],
    [],
    ["Note", "Books worksheet for accounting / portal prep — not the official GST portal JSON upload."],
    [],
    ["Metric", "Value"],
    ["Taxable value", money(summary.taxableValue)],
    ["CGST", money(summary.cgst)],
    ["SGST", money(summary.sgst)],
    ["IGST", money(summary.igst)],
    ["Invoice total", money(summary.invoiceTotal)],
    ["B2B invoices", summary.b2bCount],
    ["B2C invoices", summary.b2cCount],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summaryAoA),
    "Summary",
  );

  const b2b = summary.invoices.filter((r) => r.party_gstin);
  const b2c = summary.invoices.filter((r) => !r.party_gstin);

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(b2b.map(invoiceRow)),
    "B2B",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(b2c.map(invoiceRow)),
    "B2C",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary.invoices.map(invoiceRow)),
    "All invoices",
  );

  const safe = companyName.replace(/[^\w.\-]+/g, "_").slice(0, 40) || "company";
  return saveWorkbook(wb, `GSTR1_${safe}_${stamp}.xlsx`);
}

/** GSTR-3B style workbook: outward / ITC / net payable tables. */
export async function exportGstr3bExcel(
  summary: Gstr3bSummary,
  companyName: string,
  detailRows: GstInvoiceRow[],
): Promise<string | null> {
  const wb = XLSX.utils.book_new();
  const stamp = new Date().toISOString().slice(0, 10);

  const summaryAoA = [
    ["Kite — GSTR-3B style summary"],
    ["Company", companyName],
    ["Generated", stamp],
    [],
    ["Note", "Approximate books summary for accounting. Confirm figures before portal filing."],
    [],
    ["3.1 Outward supplies", "Amount"],
    ["Taxable value", money(summary.outwardTaxable)],
    ["CGST", money(summary.outwardCgst)],
    ["SGST", money(summary.outwardSgst)],
    ["IGST", money(summary.outwardIgst)],
    [],
    ["4. Eligible ITC (from purchases)", "Amount"],
    ["Inward taxable", money(summary.inwardTaxable)],
    ["ITC CGST", money(summary.itcCgst)],
    ["ITC SGST", money(summary.itcSgst)],
    ["ITC IGST", money(summary.itcIgst)],
    [],
    ["Net payable (approx.)", "Amount"],
    ["CGST", money(summary.netCgst)],
    ["SGST", money(summary.netSgst)],
    ["IGST", money(summary.netIgst)],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summaryAoA),
    "3B Summary",
  );

  const sales = detailRows.filter((r) => r.voucher_type === "sales");
  const purchases = detailRows.filter((r) => r.voucher_type === "purchase");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sales.map(invoiceRow)),
    "Outward detail",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(purchases.map(invoiceRow)),
    "Inward detail",
  );

  const safe = companyName.replace(/[^\w.\-]+/g, "_").slice(0, 40) || "company";
  return saveWorkbook(wb, `GSTR3B_${safe}_${stamp}.xlsx`);
}
