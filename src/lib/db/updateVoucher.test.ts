import { beforeEach, describe, expect, it } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import { openBrowserDb } from "./browser";
import { COMPANY_SCHEMA_STATEMENTS } from "./schema";
import { setActiveCompanyDb } from "./active";
import {
  getVoucherById,
  getVoucherLines,
  insertVoucher,
  updateVoucher,
} from "./client";
import { getVoucherStockMovements } from "./inventory";

let itemId = 0;
let godownId = 0;
let cashLedgerId = 0;
let salesLedgerId = 0;
let purchaseLedgerId = 0;

beforeEach(async () => {
  const db = await openBrowserDb(
    `test-update-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  for (const sql of COMPANY_SCHEMA_STATEMENTS) await db.execute(sql);
  setActiveCompanyDb(db as unknown as Database, "test-co");

  await db.execute(
    "INSERT INTO account_group (name, nature, normal_balance) VALUES ('Current Assets','asset','debit'),('Sales Accounts','income','credit'),('Purchase Accounts','expense','debit')",
  );
  cashLedgerId = Number(
    (
      await db.execute(
        "INSERT INTO ledger (name, group_id, is_cash_bank) VALUES ('Cash', 1, 1)",
      )
    ).lastInsertId,
  );
  salesLedgerId = Number(
    (await db.execute("INSERT INTO ledger (name, group_id) VALUES ('Sales', 2)"))
      .lastInsertId,
  );
  purchaseLedgerId = Number(
    (
      await db.execute(
        "INSERT INTO ledger (name, group_id) VALUES ('Purchase', 3)",
      )
    ).lastInsertId,
  );
  await db.execute(
    "INSERT INTO voucher_type (code, name) VALUES ('sales','Sales'),('purchase','Purchase')",
  );
  const unitId = Number(
    (await db.execute("INSERT INTO unit (name, symbol) VALUES ('Nos','NOS')"))
      .lastInsertId,
  );
  godownId = Number(
    (await db.execute("INSERT INTO godown (name, is_default) VALUES ('Main', 1)"))
      .lastInsertId,
  );
  itemId = Number(
    (
      await db.execute(
        "INSERT INTO stock_item (name, unit_id, hsn_sac) VALUES ('Widget', $1, '8471')",
        [unitId],
      )
    ).lastInsertId,
  );

  // Seed 10 units of stock via a purchase voucher.
  await insertVoucher({
    voucherType: "purchase",
    date: "2026-08-01",
    totalAmount: 800,
    lines: [
      { ledgerId: purchaseLedgerId, debit: 800, credit: 0 },
      { ledgerId: cashLedgerId, debit: 0, credit: 800 },
    ],
    stockItems: [{ itemId, godownId, qty: 10, rate: 80 }],
  });
});

async function postSales(qty: number, number = ""): Promise<number> {
  return insertVoucher({
    voucherType: "sales",
    date: "2026-08-02",
    number,
    totalAmount: qty * 100,
    lines: [
      { ledgerId: cashLedgerId, debit: qty * 100, credit: 0 },
      { ledgerId: salesLedgerId, debit: 0, credit: qty * 100 },
    ],
    stockItems: [{ itemId, godownId, qty, rate: 100 }],
  });
}

describe("updateVoucher", () => {
  it("replaces header, lines, and stock movements", async () => {
    const id = await postSales(4, "S-1");
    await updateVoucher(id, {
      voucherType: "sales",
      date: "2026-08-03",
      number: "S-1A",
      narration: "corrected",
      totalAmount: 600,
      lines: [
        { ledgerId: cashLedgerId, debit: 600, credit: 0 },
        { ledgerId: salesLedgerId, debit: 0, credit: 600 },
      ],
      stockItems: [{ itemId, godownId, qty: 6, rate: 100 }],
    });

    const v = await getVoucherById(id);
    expect(v?.number).toBe("S-1A");
    expect(v?.date).toBe("2026-08-03");
    expect(v?.total_amount).toBe(600);
    expect(v?.narration).toBe("corrected");

    const lines = await getVoucherLines(id);
    expect(lines).toHaveLength(2);
    expect(lines[0].debit).toBe(600);

    const moves = await getVoucherStockMovements(id);
    expect(moves).toHaveLength(1);
    expect(moves[0].qty_out).toBe(6);
  });

  it("counts the voucher's own old stock as available when editing", async () => {
    const id = await postSales(6);
    // 10 in stock, 6 out via this voucher → 4 on hand; editing to 10 must pass
    await updateVoucher(id, {
      voucherType: "sales",
      date: "2026-08-02",
      totalAmount: 1000,
      lines: [
        { ledgerId: cashLedgerId, debit: 1000, credit: 0 },
        { ledgerId: salesLedgerId, debit: 0, credit: 1000 },
      ],
      stockItems: [{ itemId, godownId, qty: 10, rate: 100 }],
    });
    const moves = await getVoucherStockMovements(id);
    expect(moves[0].qty_out).toBe(10);
  });

  it("still blocks edits that exceed restored stock", async () => {
    const id = await postSales(6);
    await expect(
      updateVoucher(id, {
        voucherType: "sales",
        date: "2026-08-02",
        totalAmount: 1200,
        lines: [
          { ledgerId: cashLedgerId, debit: 1200, credit: 0 },
          { ledgerId: salesLedgerId, debit: 0, credit: 1200 },
        ],
        stockItems: [{ itemId, godownId, qty: 12, rate: 100 }],
      }),
    ).rejects.toThrow(/Insufficient stock/);
    // failed edit leaves the old movements untouched
    const moves = await getVoucherStockMovements(id);
    expect(moves[0].qty_out).toBe(6);
  });

  it("locks editing while an IRN is active and unlocks after cancellation", async () => {
    const id = await postSales(2);
    const db = (await import("./active")).getActiveCompanyDb();
    await db.execute(
      "UPDATE voucher SET irn = $1, irn_status = 'ACT' WHERE id = $2",
      ["a".repeat(64), id],
    );
    await expect(
      updateVoucher(id, {
        voucherType: "sales",
        date: "2026-08-02",
        totalAmount: 200,
        lines: [
          { ledgerId: cashLedgerId, debit: 200, credit: 0 },
          { ledgerId: salesLedgerId, debit: 0, credit: 200 },
        ],
      }),
    ).rejects.toThrow(/IRN/);

    await db.execute("UPDATE voucher SET irn_status = 'CNL' WHERE id = $1", [
      id,
    ]);
    await updateVoucher(id, {
      voucherType: "sales",
      date: "2026-08-02",
      number: "FIXED",
      totalAmount: 300,
      lines: [
        { ledgerId: cashLedgerId, debit: 300, credit: 0 },
        { ledgerId: salesLedgerId, debit: 0, credit: 300 },
      ],
    });
    expect((await getVoucherById(id))?.number).toBe("FIXED");
  });

  it("rejects changing the voucher type", async () => {
    const id = await postSales(1);
    await expect(
      updateVoucher(id, {
        voucherType: "purchase",
        date: "2026-08-02",
        totalAmount: 100,
        lines: [
          { ledgerId: purchaseLedgerId, debit: 100, credit: 0 },
          { ledgerId: cashLedgerId, debit: 0, credit: 100 },
        ],
      }),
    ).rejects.toThrow(/type/);
  });
});
