import { roundMoney } from "../accounting/engine";

export interface StockItemLineDraft {
  itemId: number;
  godownId: number;
  qty: number;
  rate: number;
}

export function lineAmount(qty: number, rate: number): number {
  return roundMoney((Number(qty) || 0) * (Number(rate) || 0));
}

export function sumItemAmounts(lines: StockItemLineDraft[]): number {
  return roundMoney(
    lines.reduce((s, l) => s + lineAmount(l.qty, l.rate), 0),
  );
}

export function validateStockLines(
  lines: StockItemLineDraft[],
  opts?: { requirePositiveQty?: boolean },
): string | null {
  const usable = lines.filter((l) => l.itemId && l.godownId);
  if (!usable.length) return "Add at least one stock item line.";
  for (const l of usable) {
    if ((l.qty || 0) <= 0 && opts?.requirePositiveQty !== false) {
      return "Quantity must be greater than zero.";
    }
    if ((l.rate || 0) < 0) return "Rate cannot be negative.";
  }
  return null;
}

export function stockValue(qty: number, purchaseRate: number): number {
  return roundMoney((Number(qty) || 0) * (Number(purchaseRate) || 0));
}
