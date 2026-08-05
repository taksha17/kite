import { describe, expect, it } from "vitest";
import {
  lineAmount,
  stockValue,
  sumItemAmounts,
  validateStockLines,
} from "./calc";

describe("inventory calc", () => {
  it("computes line amounts", () => {
    expect(lineAmount(2.5, 40)).toBe(100);
  });

  it("sums item lines", () => {
    expect(
      sumItemAmounts([
        { itemId: 1, godownId: 1, qty: 2, rate: 10 },
        { itemId: 2, godownId: 1, qty: 3, rate: 5 },
      ]),
    ).toBe(35);
  });

  it("validates empty lines", () => {
    expect(validateStockLines([])).toMatch(/at least one/i);
  });

  it("values stock at fixed purchase rate", () => {
    expect(stockValue(12, 25)).toBe(300);
  });
});
