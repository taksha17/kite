import { describe, expect, it } from "vitest";
import { BrowserCompanyDb, convertParams, openBrowserDb } from "./browser";
import {
  COMPANY_SCHEMA_STATEMENTS,
  REGISTRY_SCHEMA_STATEMENTS,
} from "./schema";

// Node test env: no IndexedDB — the adapter must still work fully in
// memory (persistence degrades gracefully).

describe("convertParams", () => {
  it("rewrites $N placeholders to ? preserving order", () => {
    const { text, values } = convertParams(
      "INSERT INTO t (a, b, c) VALUES ($1, $2, $3)",
      [10, "x", null],
    );
    expect(text).toBe("INSERT INTO t (a, b, c) VALUES (?, ?, ?)");
    expect(values).toEqual([10, "x", null]);
  });

  it("expands repeated placeholders", () => {
    const { text, values } = convertParams(
      "SELECT * FROM t WHERE a = $1 OR b = $1",
      [42],
    );
    expect(text).toBe("SELECT * FROM t WHERE a = ? OR b = ?");
    expect(values).toEqual([42, 42]);
  });

  it("leaves placeholder-free SQL untouched", () => {
    const { text, values } = convertParams("SELECT 1", []);
    expect(text).toBe("SELECT 1");
    expect(values).toEqual([]);
  });
});

describe("BrowserCompanyDb", () => {
  it("runs the registry schema and round-trips a company row", async () => {
    const db = await openBrowserDb(`test-registry-${Date.now()}.db`);
    for (const sql of REGISTRY_SCHEMA_STATEMENTS) await db.execute(sql);

    const inserted = await db.execute(
      `INSERT INTO companies (id, name, slug, fy_start, currency, state_code, gstin, gst_enabled, db_file)
       VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8)`,
      ["id1", "Test Co", "test-co", "2026-04-01", "29", null, 1, "test.db"],
    );
    expect(inserted.rowsAffected).toBe(1);

    const rows = await db.select<{ name: string; gst_enabled: number }[]>(
      "SELECT name, gst_enabled FROM companies WHERE id = $1",
      ["id1"],
    );
    expect(rows).toEqual([{ name: "Test Co", gst_enabled: 1 }]);
    await db.close();
  });

  it("reports lastInsertId for inserts and 0 for updates", async () => {
    const db = await openBrowserDb(`test-ids-${Date.now()}.db`);
    for (const sql of COMPANY_SCHEMA_STATEMENTS) await db.execute(sql);

    const insert = await db.execute(
      "INSERT INTO voucher_type (code, name) VALUES ($1, $2)",
      ["test", "Test type"],
    );
    expect(insert.lastInsertId).toBeGreaterThan(0);

    const update = await db.execute(
      "UPDATE voucher_type SET name = $1 WHERE code = $2",
      ["Renamed", "test"],
    );
    expect(update.rowsAffected).toBe(1);
    expect(update.lastInsertId).toBe(0);
    await db.close();
  });

  it("exported bytes reopen with the same data (snapshot round-trip)", async () => {
    const key = `test-export-${Date.now()}.db`;
    const db = await openBrowserDb(key);
    await db.execute("CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT)");
    await db.execute("INSERT INTO note (body) VALUES ($1)", ["hello drive"]);
    const bytes = db.exportBytes();
    await db.close();

    // Simulate restore: fresh sql.js database from the exported bytes.
    const restored = await openBrowserDb(`test-export-other-${Date.now()}.db`);
    (restored as unknown as { db: { close(): void } }).db.close();
    const SQL = await (await import("sql.js")).default();
    const reopened = new BrowserCompanyDb(new SQL.Database(bytes), "restored");
    const rows = await reopened.select<{ body: string }[]>(
      "SELECT body FROM note",
    );
    expect(rows).toEqual([{ body: "hello drive" }]);
    await reopened.close();
  });
});
