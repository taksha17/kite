export type AiProvider = "openai" | "anthropic" | "gemini";

export interface AiSettings {
  provider: AiProvider | "";
  apiKey: string;
  /** Empty = provider default model. */
  model: string;
}

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.0-flash",
};

export interface DraftStockLine {
  itemId: number | null;
  qty: number | null;
  rate: number | null;
  description: string | null;
}

/** What the model is allowed to propose — the editor always has final say. */
export interface VoucherDraft {
  voucherType:
    | "sales"
    | "purchase"
    | "payment"
    | "receipt"
    | "contra"
    | "journal"
    | null;
  /** YYYY-MM-DD. */
  date: string | null;
  number: string | null;
  partyId: number | null;
  /** 2-digit GST state code. */
  placeOfSupply: string | null;
  hsn: string | null;
  gstRate: number | null;
  /** Taxable value when the draft has no stock lines. */
  taxable: number | null;
  stockLines: DraftStockLine[];
  paymentMode: string | null;
  narration: string | null;
}

export interface DraftContextParty {
  id: number;
  name: string;
  gstin: string | null;
}

export interface DraftContextItem {
  id: number;
  name: string;
  salesRate: number;
  purchaseRate: number;
  gstRate: number;
  hsn: string | null;
}

/** Real books data the model must map the sentence onto. */
export interface DraftContext {
  today: string;
  companyStateCode: string;
  gstEnabled: boolean;
  parties: DraftContextParty[];
  items: DraftContextItem[];
}
