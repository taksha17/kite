import type { StatementLine, TrialBalanceRow } from "./types";

export interface LedgerBalanceInput {
  ledgerId: number;
  ledgerName: string;
  groupName: string;
  nature: "assets" | "liabilities" | "income" | "expenses" | "equity";
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
}

export function computeTrialBalance(rows: LedgerBalanceInput[]): TrialBalanceRow[] {
  return rows
    .map((r) => {
      const debit = r.openingDebit + r.periodDebit;
      const credit = r.openingCredit + r.periodCredit;
      const net = debit - credit;
      return {
        ledgerId: r.ledgerId,
        ledgerName: r.ledgerName,
        groupName: r.groupName,
        debit: net > 0 ? Math.round(net * 100) / 100 : 0,
        credit: net < 0 ? Math.round(-net * 100) / 100 : 0,
      };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.ledgerName.localeCompare(b.ledgerName));
}

export function computeProfitAndLoss(rows: LedgerBalanceInput[]): {
  income: StatementLine[];
  expenses: StatementLine[];
  netProfit: number;
} {
  const income: StatementLine[] = [];
  const expenses: StatementLine[] = [];
  let incomeTotal = 0;
  let expenseTotal = 0;

  for (const r of rows) {
    const net = r.openingCredit + r.periodCredit - (r.openingDebit + r.periodDebit);
    if (r.nature === "income") {
      const amount = Math.round(net * 100) / 100;
      if (amount !== 0) {
        income.push({ name: r.ledgerName, amount });
        incomeTotal += amount;
      }
    } else if (r.nature === "expenses") {
      const amount = Math.round(-net * 100) / 100;
      if (amount !== 0) {
        expenses.push({ name: r.ledgerName, amount });
        expenseTotal += amount;
      }
    }
  }

  return {
    income,
    expenses,
    netProfit: Math.round((incomeTotal - expenseTotal) * 100) / 100,
  };
}

export function computeBalanceSheet(
  rows: LedgerBalanceInput[],
  netProfit: number,
): {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
} {
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];

  for (const r of rows) {
    const debit = r.openingDebit + r.periodDebit;
    const credit = r.openingCredit + r.periodCredit;
    const netDr = Math.round((debit - credit) * 100) / 100;
    if (r.nature === "assets" && netDr !== 0) {
      assets.push({ name: r.ledgerName, amount: netDr });
    } else if (r.nature === "liabilities" && netDr !== 0) {
      liabilities.push({ name: r.ledgerName, amount: -netDr });
    } else if (r.nature === "equity" && netDr !== 0) {
      equity.push({ name: r.ledgerName, amount: -netDr });
    }
  }

  if (netProfit !== 0) {
    equity.push({ name: "Profit & Loss (current)", amount: netProfit });
  }

  return { assets, liabilities, equity };
}
