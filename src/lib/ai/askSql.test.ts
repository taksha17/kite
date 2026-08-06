import { describe, expect, it } from "vitest";
import {
  assertSafeSelect,
  extractTableRefs,
} from "./askSql";
import { looksLikeBooksQuestion, parseAskPlan, summarizeAskRows } from "./askBooks";

describe("assertSafeSelect", () => {
  it("accepts a simple SELECT and adds LIMIT", () => {
    const sql = assertSafeSelect(
      "SELECT name, opening_debit FROM ledger ORDER BY name",
    );
    expect(sql).toMatch(/LIMIT 200/i);
    expect(extractTableRefs(sql)).toEqual(["ledger"]);
  });

  it("allows WITH … SELECT and clamps LIMIT", () => {
    const sql = assertSafeSelect(`
      WITH x AS (SELECT id FROM voucher)
      SELECT id FROM x
      LIMIT 999
    `);
    expect(sql).toMatch(/LIMIT 200/i);
  });

  it("rejects writes and multi-statements", () => {
    expect(() =>
      assertSafeSelect("DELETE FROM ledger WHERE id=1"),
    ).toThrow(/read-only/i);
    expect(() =>
      assertSafeSelect("SELECT 1 FROM ledger; DROP TABLE ledger"),
    ).toThrow(/one SQL/i);
    expect(() =>
      assertSafeSelect("INSERT INTO ledger (name) VALUES ('x')"),
    ).toThrow(/read-only|SELECT/i);
  });

  it("rejects unknown tables and PRAGMA", () => {
    expect(() =>
      assertSafeSelect("SELECT * FROM sqlite_master"),
    ).toThrow(/not available/i);
    expect(() => assertSafeSelect("PRAGMA table_info(ledger)")).toThrow(
      /read-only|SELECT/i,
    );
  });

  it("strips trailing comments that try to hide writes", () => {
    expect(() =>
      assertSafeSelect("SELECT id FROM ledger -- ; DELETE FROM ledger"),
    ).not.toThrow();
    expect(() =>
      assertSafeSelect("SELECT id FROM ledger /* DELETE FROM ledger */"),
    ).not.toThrow();
  });
});

describe("parseAskPlan", () => {
  it("parses JSON and validates SQL", () => {
    const plan = parseAskPlan(
      'Sure: {"sql":"SELECT SUM(total_amount) AS sales FROM voucher WHERE voucher_type=\'sales\'","title":"Sales total"}',
    );
    expect(plan.title).toBe("Sales total");
    expect(plan.sql).toMatch(/SELECT SUM/i);
    expect(plan.sql).toMatch(/LIMIT/i);
  });
});

describe("summarizeAskRows", () => {
  it("formats a single money cell", () => {
    expect(summarizeAskRows([{ total_amount: 1500.5 }], "Sales")).toBe(
      "Sales: ₹1,500.50.",
    );
  });

  it("handles empty results", () => {
    expect(summarizeAskRows([], "Owed")).toBe("Owed: no matching rows.");
  });
});

describe("looksLikeBooksQuestion", () => {
  it("detects questions vs voucher sentences", () => {
    expect(looksLikeBooksQuestion("How much does Agarwal owe me?")).toBe(true);
    expect(looksLikeBooksQuestion("what is my GST this month")).toBe(true);
    expect(looksLikeBooksQuestion("Sold 2 mice to Agarwal @799")).toBe(false);
  });
});
