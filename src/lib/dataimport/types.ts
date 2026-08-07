/** Types for masters / opening-balance migration import. */

export type ImportKind = "ledgers" | "parties" | "stock";

export type SheetRows = unknown[][];

/** Column indices into the sheet (-1 = unused). */
export interface MastersColumnMap {
  headerRow: number; // first data row index (rows after header)
  name: number;
  group: number | null;
  kind: number | null; // debtor/creditor for parties
  opening: number | null; // signed opening (Dr +, Cr -) or single amount
  openingDebit: number | null;
  openingCredit: number | null;
  gstin: number | null;
  state: number | null;
  email: number | null;
  phone: number | null;
  address: number | null;
  city: number | null;
  pin: number | null;
  isCashBank: number | null;
  unit: number | null;
  hsn: number | null;
  sku: number | null;
  gstRate: number | null;
  purchaseRate: number | null;
  salesRate: number | null;
  openingQty: number | null;
}

export interface PreparedLedgerRow {
  name: string;
  groupName: string;
  groupId: number | null;
  openingDebit: number;
  openingCredit: number;
  isParty: boolean;
  isCashBank: boolean;
  gstin: string;
  stateCode: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  pin: string;
  status: "ready" | "skip" | "error";
  reason?: string;
  rawIndex: number;
}

export interface PreparedStockRow {
  name: string;
  unitLabel: string;
  hsn: string;
  sku: string;
  gstRate: number;
  purchaseRate: number;
  salesRate: number;
  openingQty: number;
  status: "ready" | "skip" | "error";
  reason?: string;
  rawIndex: number;
}

export interface ImportSummary {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
}
