import type { DraftVoucher, ValidateResult } from "./types";

const EPS = 0.005;

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sumLines(voucher: DraftVoucher): {
  totalDebit: number;
  totalCredit: number;
} {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of voucher.lines) {
    totalDebit += line.debit || 0;
    totalCredit += line.credit || 0;
  }
  return {
    totalDebit: roundMoney(totalDebit),
    totalCredit: roundMoney(totalCredit),
  };
}

/** Enforce double-entry invariants before persisting a voucher. */
export function validateVoucher(voucher: DraftVoucher): ValidateResult {
  if (!voucher.date || !/^\d{4}-\d{2}-\d{2}$/.test(voucher.date)) {
    return { ok: false, error: "A valid voucher date is required." };
  }
  if (!voucher.lines.length) {
    return { ok: false, error: "Add at least one debit and one credit line." };
  }

  for (const line of voucher.lines) {
    if (!line.ledgerId) {
      return { ok: false, error: "Every line needs a ledger." };
    }
    const d = line.debit || 0;
    const c = line.credit || 0;
    if (d < 0 || c < 0) {
      return { ok: false, error: "Amounts cannot be negative." };
    }
    if (d > 0 && c > 0) {
      return {
        ok: false,
        error: "A line cannot have both debit and credit amounts.",
      };
    }
    if (d === 0 && c === 0) {
      return { ok: false, error: "Each line needs a debit or credit amount." };
    }
  }

  const { totalDebit, totalCredit } = sumLines(voucher);
  if (Math.abs(totalDebit - totalCredit) > EPS) {
    return {
      ok: false,
      error: `Voucher is not balanced (Dr ${totalDebit.toFixed(2)} ≠ Cr ${totalCredit.toFixed(2)}).`,
    };
  }
  if (totalDebit === 0) {
    return { ok: false, error: "Voucher total cannot be zero." };
  }

  const hasDebit = voucher.lines.some((l) => (l.debit || 0) > 0);
  const hasCredit = voucher.lines.some((l) => (l.credit || 0) > 0);
  if (!hasDebit || !hasCredit) {
    return {
      ok: false,
      error: "Include at least one debit line and one credit line.",
    };
  }

  return { ok: true, totalDebit, totalCredit };
}

export function indianFyStartFor(date: Date = new Date()): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-04-01`;
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}
