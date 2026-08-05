/** Shared ecommerce → Kite order model (platform adapters normalize into this). */

export type IntegrationSource = "shopify" | "woocommerce";

export interface NormalizedAddress {
  name: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  provinceCode: string;
  zip: string;
  countryCode: string;
  phone: string;
}

export interface NormalizedLine {
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  taxableAmount: number;
  taxAmount: number;
  /** percent, e.g. 18 */
  taxRate: number | null;
}

export interface NormalizedOrder {
  source: IntegrationSource;
  externalId: string;
  orderNumber: string;
  createdAt: string;
  currency: string;
  financialStatus: string;
  paymentMode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  billing: NormalizedAddress | null;
  shipping: NormalizedAddress | null;
  lines: NormalizedLine[];
  shippingAmount: number;
  totalTax: number;
  totalPrice: number;
  note: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface ImportOrdersResult {
  created: number;
  skipped: number;
  failed: number;
  messages: string[];
}
