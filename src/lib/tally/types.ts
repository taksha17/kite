/** Live TallyPrime HTTP/XML pull → Kite masters migration. */

export interface TallyConnection {
  /** e.g. http://127.0.0.1:9000 */
  baseUrl: string;
}

export interface TallyCompanyInfo {
  name: string;
  /** Raw snippet for debugging */
  rawHint?: string;
}

export interface TallyLedger {
  name: string;
  parent: string;
  /** Signed opening: Dr positive, Cr negative (Tally Dr/Cr parsed). */
  opening: number;
  gstin: string;
  state: string;
  email: string;
  phone: string;
  address: string;
  pin: string;
}

export interface TallyStockItem {
  name: string;
  unit: string;
  hsn: string;
  gstRate: number;
  openingQty: number;
  purchaseRate: number;
  salesRate: number;
}

export type TallyPullKind = "ledgers" | "stock";
