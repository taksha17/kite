import * as XLSX from "xlsx";
import type { ImportKind } from "./types";

const TEMPLATES: Record<ImportKind, { sheet: string; rows: string[][] }> = {
  ledgers: {
    sheet: "Ledgers",
    rows: [
      ["Ledger Name", "Under", "Opening Balance", "GSTIN", "State", "Cash/Bank"],
      ["HDFC Current", "Bank Accounts", "250000", "", "", "Yes"],
      ["Office Rent", "Indirect Expenses", "0", "", "", ""],
      ["Furniture", "Fixed Assets", "80000", "", "", ""],
    ],
  },
  parties: {
    sheet: "Parties",
    rows: [
      ["Party Name", "Kind", "Opening Balance", "GSTIN", "State", "Email", "Phone"],
      ["Agarwal Electronics", "Debtor", "15000", "29BBCDE4321G1Z3", "Karnataka", "billing@agarwal.example", "9876543210"],
      ["ABC Suppliers", "Creditor", "-22000", "29AABCT1332L1ZV", "29", "", ""],
    ],
  },
  stock: {
    sheet: "Stock",
    rows: [
      ["Item Name", "Unit", "HSN", "GST %", "Purchase Rate", "Sales Rate", "Opening Qty", "SKU"],
      ["Wireless Mouse", "Nos", "8471", "18", "450", "799", "40", "WM-100"],
      ["USB-C Hub", "Nos", "8471", "18", "900", "1499", "12", "HUB-01"],
    ],
  },
};

/** Download a starter Excel template for the given import kind. */
export function downloadImportTemplate(kind: ImportKind): void {
  const spec = TEMPLATES[kind];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(spec.rows);
  XLSX.utils.book_append_sheet(wb, ws, spec.sheet);
  XLSX.writeFile(wb, `kite-import-${kind}.xlsx`);
}
