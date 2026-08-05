export type NormalBalance = "debit" | "credit";

export type VoucherTypeCode =
  | "payment"
  | "receipt"
  | "contra"
  | "journal"
  | "sales"
  | "purchase"
  | "stock_journal";

export interface AccountGroupSeed {
  name: string;
  nature: "assets" | "liabilities" | "income" | "expenses" | "equity";
  normal_balance: NormalBalance;
  parent?: string;
  is_primary?: boolean;
}

export interface LedgerSeed {
  name: string;
  group: string;
  is_cash_bank?: boolean;
  is_party?: boolean;
}

export interface DraftLine {
  ledgerId: number;
  debit: number;
  credit: number;
  narration?: string;
}

export interface DraftVoucher {
  voucherType: VoucherTypeCode;
  date: string; // ISO YYYY-MM-DD
  number?: string;
  narration?: string;
  lines: DraftLine[];
}

export interface PostingResult {
  ok: true;
  totalDebit: number;
  totalCredit: number;
}

export interface PostingError {
  ok: false;
  error: string;
}

export type ValidateResult = PostingResult | PostingError;

export interface TrialBalanceRow {
  ledgerId: number;
  ledgerName: string;
  groupName: string;
  debit: number;
  credit: number;
}

export interface StatementLine {
  name: string;
  amount: number;
}
