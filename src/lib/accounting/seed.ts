import type { AccountGroupSeed, LedgerSeed } from "./types";

/** Default Indian SMB chart of groups (simplified). */
export const DEFAULT_GROUPS: AccountGroupSeed[] = [
  { name: "Assets", nature: "assets", normal_balance: "debit", is_primary: true },
  { name: "Liabilities", nature: "liabilities", normal_balance: "credit", is_primary: true },
  { name: "Equity", nature: "equity", normal_balance: "credit", is_primary: true },
  { name: "Income", nature: "income", normal_balance: "credit", is_primary: true },
  { name: "Expenses", nature: "expenses", normal_balance: "debit", is_primary: true },

  { name: "Current Assets", nature: "assets", normal_balance: "debit", parent: "Assets" },
  { name: "Fixed Assets", nature: "assets", normal_balance: "debit", parent: "Assets" },
  { name: "Cash-in-Hand", nature: "assets", normal_balance: "debit", parent: "Current Assets" },
  { name: "Bank Accounts", nature: "assets", normal_balance: "debit", parent: "Current Assets" },
  { name: "Sundry Debtors", nature: "assets", normal_balance: "debit", parent: "Current Assets" },
  { name: "Stock-in-Hand", nature: "assets", normal_balance: "debit", parent: "Current Assets" },
  { name: "Duties & Taxes", nature: "liabilities", normal_balance: "credit", parent: "Liabilities" },
  { name: "Current Liabilities", nature: "liabilities", normal_balance: "credit", parent: "Liabilities" },
  { name: "Sundry Creditors", nature: "liabilities", normal_balance: "credit", parent: "Current Liabilities" },
  { name: "Loans (Liability)", nature: "liabilities", normal_balance: "credit", parent: "Liabilities" },
  { name: "Capital Account", nature: "equity", normal_balance: "credit", parent: "Equity" },
  { name: "Direct Incomes", nature: "income", normal_balance: "credit", parent: "Income" },
  { name: "Indirect Incomes", nature: "income", normal_balance: "credit", parent: "Income" },
  { name: "Sales Accounts", nature: "income", normal_balance: "credit", parent: "Direct Incomes" },
  { name: "Direct Expenses", nature: "expenses", normal_balance: "debit", parent: "Expenses" },
  { name: "Indirect Expenses", nature: "expenses", normal_balance: "debit", parent: "Expenses" },
  { name: "Purchase Accounts", nature: "expenses", normal_balance: "debit", parent: "Direct Expenses" },
];

export const DEFAULT_LEDGERS: LedgerSeed[] = [
  { name: "Cash", group: "Cash-in-Hand", is_cash_bank: true },
  { name: "Bank Account", group: "Bank Accounts", is_cash_bank: true },
  { name: "Capital", group: "Capital Account" },
  { name: "Sales", group: "Sales Accounts" },
  { name: "Purchase", group: "Purchase Accounts" },
  { name: "Rent", group: "Indirect Expenses" },
  { name: "Salary", group: "Indirect Expenses" },
  { name: "Electricity", group: "Indirect Expenses" },
  { name: "CGST", group: "Duties & Taxes" },
  { name: "SGST", group: "Duties & Taxes" },
  { name: "IGST", group: "Duties & Taxes" },
];

export const VOUCHER_TYPES: { code: string; name: string }[] = [
  { code: "payment", name: "Payment" },
  { code: "receipt", name: "Receipt" },
  { code: "contra", name: "Contra" },
  { code: "journal", name: "Journal" },
  { code: "sales", name: "Sales" },
  { code: "purchase", name: "Purchase" },
  { code: "stock_journal", name: "Stock Journal" },
];
