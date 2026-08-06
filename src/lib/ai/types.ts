export type AiProvider = "openai" | "anthropic" | "gemini" | "openrouter";

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
  // openrouter/free is an auto-router across all no-cost models — the most
  // resilient default since the free roster rotates.
  openrouter: "openrouter/free",
};

/** Suggested models per provider, shown as autofill hints in settings. */
export const AI_MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
  gemini: ["gemini-2.0-flash", "gemini-2.5-flash"],
  openrouter: [
    "openrouter/free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free",
    "google/gemini-2.0-flash-exp:free",
    "google/gemma-3-27b-it:free",
    "qwen/qwen3-coder:free",
  ],
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
