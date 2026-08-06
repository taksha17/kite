import type Database from "@tauri-apps/plugin-sql";
import { lineAmount, stockValue } from "../inventory/calc";
import { getActiveCompanyDb } from "./active";

export interface UnitRow {
  id: number;
  name: string;
  symbol: string;
}

export interface GodownRow {
  id: number;
  name: string;
  is_default: number;
}

export interface StockItemRow {
  id: number;
  name: string;
  unit_id: number;
  unit_name?: string;
  unit_symbol?: string;
  hsn_sac: string | null;
  sku: string | null;
  gst_rate: number;
  purchase_rate: number;
  sales_rate: number;
  opening_qty: number;
  notes: string | null;
}

export interface StockMovementInput {
  itemId: number;
  godownId: number;
  qty: number;
  rate: number;
  direction: "in" | "out";
  movementType: "purchase" | "sales" | "opening" | "journal";
  narration?: string;
  batchNo?: string;
  serialNo?: string;
  lineDescription?: string;
}

export interface StockSummaryRow {
  item_id: number;
  item_name: string;
  unit_symbol: string;
  godown_id: number;
  godown_name: string;
  qty: number;
  purchase_rate: number;
  value: number;
}

const INVENTORY_TABLES = `
CREATE TABLE IF NOT EXISTS unit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS godown (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit_id INTEGER NOT NULL REFERENCES unit(id),
  hsn_sac TEXT,
  sku TEXT,
  gst_rate REAL NOT NULL DEFAULT 18,
  purchase_rate REAL NOT NULL DEFAULT 0,
  sales_rate REAL NOT NULL DEFAULT 0,
  opening_qty REAL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS stock_movement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER REFERENCES voucher(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES stock_item(id),
  godown_id INTEGER NOT NULL REFERENCES godown(id),
  qty_in REAL NOT NULL DEFAULT 0,
  qty_out REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  movement_type TEXT NOT NULL,
  narration TEXT,
  batch_no TEXT,
  serial_no TEXT,
  line_description TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_movement_item ON stock_movement(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_voucher ON stock_movement(voucher_id);
`;

export async function ensureInventorySchema(db: Database): Promise<void> {
  for (const sql of INVENTORY_TABLES.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql);
  }

  await db.execute(
    `INSERT OR IGNORE INTO voucher_type (code, name) VALUES ('stock_journal', 'Stock Journal')`,
  );

  const units = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM unit");
  if ((units[0]?.c || 0) === 0) {
    await db.execute(
      `INSERT INTO unit (name, symbol) VALUES ('Numbers', 'Nos'), ('Kilogram', 'Kg'), ('Litre', 'Ltr')`,
    );
  }

  const godowns = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM godown");
  if ((godowns[0]?.c || 0) === 0) {
    await db.execute(
      `INSERT INTO godown (name, is_default) VALUES ('Main Godown', 1)`,
    );
  }
}

export async function listUnits(): Promise<UnitRow[]> {
  const db = getActiveCompanyDb();
  return db.select<UnitRow[]>("SELECT * FROM unit ORDER BY name");
}

export async function listGodowns(): Promise<GodownRow[]> {
  const db = getActiveCompanyDb();
  return db.select<GodownRow[]>("SELECT * FROM godown ORDER BY name");
}

export async function listStockItems(): Promise<StockItemRow[]> {
  const db = getActiveCompanyDb();
  return db.select<StockItemRow[]>(
    `SELECT i.*, u.name as unit_name, u.symbol as unit_symbol
     FROM stock_item i
     JOIN unit u ON u.id = i.unit_id
     ORDER BY i.name`,
  );
}

export async function createUnit(name: string, symbol: string): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(`INSERT INTO unit (name, symbol) VALUES ($1, $2)`, [
    name.trim(),
    symbol.trim(),
  ]);
}

export async function createGodown(name: string): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(`INSERT INTO godown (name, is_default) VALUES ($1, 0)`, [
    name.trim(),
  ]);
}

/** Edits a stock item's master fields (movements and opening qty stay). */
export async function updateStockItem(
  itemId: number,
  input: {
    name: string;
    unitId: number;
    hsnSac?: string;
    sku?: string;
    gstRate?: number;
    purchaseRate?: number;
    salesRate?: number;
  },
): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `UPDATE stock_item
     SET name = $1, unit_id = $2, hsn_sac = $3, sku = $4,
         gst_rate = $5, purchase_rate = $6, sales_rate = $7
     WHERE id = $8`,
    [
      input.name.trim(),
      input.unitId,
      input.hsnSac?.trim() || null,
      input.sku?.trim() || null,
      input.gstRate ?? 18,
      input.purchaseRate || 0,
      input.salesRate || 0,
      itemId,
    ],
  );
}

export async function createStockItem(input: {
  name: string;
  unitId: number;
  hsnSac?: string;
  sku?: string;
  gstRate?: number;
  purchaseRate?: number;
  salesRate?: number;
  openingQty?: number;
  openingGodownId?: number;
}): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO stock_item (name, unit_id, hsn_sac, sku, gst_rate, purchase_rate, sales_rate, opening_qty)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.name.trim(),
      input.unitId,
      input.hsnSac || null,
      input.sku?.trim() || null,
      input.gstRate ?? 18,
      input.purchaseRate || 0,
      input.salesRate || 0,
      input.openingQty || 0,
    ],
  );

  const opening = Number(input.openingQty) || 0;
  if (opening > 0) {
    const items = await db.select<{ id: number; purchase_rate: number }[]>(
      "SELECT id, purchase_rate FROM stock_item WHERE name = $1",
      [input.name.trim()],
    );
    const item = items[0];
    let godownId = input.openingGodownId;
    if (!godownId) {
      const g = await db.select<{ id: number }[]>(
        "SELECT id FROM godown ORDER BY is_default DESC, id LIMIT 1",
      );
      godownId = g[0]?.id;
    }
    if (item && godownId) {
      const rate = item.purchase_rate || input.purchaseRate || 0;
      await db.execute(
        `INSERT INTO stock_movement (
          voucher_id, date, item_id, godown_id, qty_in, qty_out, rate, amount, movement_type, narration
        ) VALUES (NULL, date('now'), $1, $2, $3, 0, $4, $5, 'opening', 'Opening stock')`,
        [item.id, godownId, opening, rate, lineAmount(opening, rate)],
      );
    }
  }
}

export async function getItemQty(
  itemId: number,
  godownId?: number,
): Promise<number> {
  const db = getActiveCompanyDb();
  const rows = godownId
    ? await db.select<{ qty: number }[]>(
        `SELECT COALESCE(SUM(qty_in - qty_out), 0) as qty
         FROM stock_movement WHERE item_id = $1 AND godown_id = $2`,
        [itemId, godownId],
      )
    : await db.select<{ qty: number }[]>(
        `SELECT COALESCE(SUM(qty_in - qty_out), 0) as qty
         FROM stock_movement WHERE item_id = $1`,
        [itemId],
      );
  return Number(rows[0]?.qty || 0);
}

export async function assertSufficientStock(
  lines: { itemId: number; godownId: number; qty: number }[],
  itemNames: Map<number, string>,
  restoredOuts?: Map<string, number>,
): Promise<void> {
  for (const line of lines) {
    const onHand = await getItemQty(line.itemId, line.godownId);
    const restored =
      restoredOuts?.get(`${line.itemId}:${line.godownId}`) || 0;
    if (line.qty > onHand + restored + 1e-9) {
      const name = itemNames.get(line.itemId) || `#${line.itemId}`;
      throw new Error(
        `Insufficient stock for ${name}: need ${line.qty}, have ${onHand + restored}.`,
      );
    }
  }
}

/** Stock movement rows belonging to one voucher, for the editor's edit mode. */
export async function getVoucherStockMovements(voucherId: number): Promise<
  {
    item_id: number;
    godown_id: number;
    qty_in: number;
    qty_out: number;
    rate: number;
    batch_no: string | null;
    serial_no: string | null;
    line_description: string | null;
  }[]
> {
  const db = getActiveCompanyDb();
  return db.select(
    `SELECT item_id, godown_id, qty_in, qty_out, rate, batch_no, serial_no, line_description
     FROM stock_movement WHERE voucher_id = $1 ORDER BY id`,
    [voucherId],
  );
}

export async function insertStockMovements(input: {
  voucherId: number | null;
  date: string;
  lines: StockMovementInput[];
}): Promise<void> {
  const db = getActiveCompanyDb();
  for (const line of input.lines) {
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    const rate = Number(line.rate) || 0;
    const amount = lineAmount(qty, rate);
    await db.execute(
      `INSERT INTO stock_movement (
        voucher_id, date, item_id, godown_id, qty_in, qty_out, rate, amount, movement_type, narration,
        batch_no, serial_no, line_description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.voucherId,
        input.date,
        line.itemId,
        line.godownId,
        line.direction === "in" ? qty : 0,
        line.direction === "out" ? qty : 0,
        rate,
        amount,
        line.movementType,
        line.narration || null,
        line.batchNo?.trim() || null,
        line.serialNo?.trim() || null,
        line.lineDescription?.trim() || null,
      ],
    );
  }
}

export async function fetchStockSummary(): Promise<StockSummaryRow[]> {
  const db = getActiveCompanyDb();
  const rows = await db.select<
    {
      item_id: number;
      item_name: string;
      unit_symbol: string;
      godown_id: number;
      godown_name: string;
      qty: number;
      purchase_rate: number;
    }[]
  >(
    `SELECT
      i.id as item_id,
      i.name as item_name,
      u.symbol as unit_symbol,
      g.id as godown_id,
      g.name as godown_name,
      COALESCE(SUM(m.qty_in - m.qty_out), 0) as qty,
      i.purchase_rate as purchase_rate
     FROM stock_item i
     JOIN unit u ON u.id = i.unit_id
     CROSS JOIN godown g
     LEFT JOIN stock_movement m
       ON m.item_id = i.id AND m.godown_id = g.id
     GROUP BY i.id, g.id
     HAVING ABS(COALESCE(SUM(m.qty_in - m.qty_out), 0)) > 0.00001
        OR i.opening_qty > 0
     ORDER BY i.name, g.name`,
  );

  return rows
    .map((r) => ({
      ...r,
      qty: Number(r.qty) || 0,
      value: stockValue(Number(r.qty) || 0, Number(r.purchase_rate) || 0),
    }))
    .filter((r) => Math.abs(r.qty) > 1e-9);
}

export async function postStockJournal(input: {
  date: string;
  number?: string;
  narration?: string;
  lines: {
    itemId: number;
    godownId: number;
    qty: number;
    direction: "in" | "out";
    rate: number;
  }[];
}): Promise<number> {
  const db = getActiveCompanyDb();
  const usable = input.lines.filter((l) => l.itemId && l.godownId && l.qty > 0);
  if (!usable.length) throw new Error("Add at least one stock line.");

  const outs = usable.filter((l) => l.direction === "out");
  if (outs.length) {
    const items = await listStockItems();
    const names = new Map(items.map((i) => [i.id, i.name]));
    await assertSufficientStock(outs, names);
  }

  const total = usable.reduce((s, l) => s + lineAmount(l.qty, l.rate), 0);
  // Use the INSERT's own rowid — safe under concurrent multi-user posting.
  const inserted = await db.execute(
    `INSERT INTO voucher (voucher_type, date, number, narration, total_amount)
     VALUES ('stock_journal', $1, $2, $3, $4)`,
    [input.date, input.number || null, input.narration || null, total],
  );
  const voucherId = inserted.lastInsertId ?? 0;
  if (!voucherId) throw new Error("Could not save the stock journal. Please retry.");

  await insertStockMovements({
    voucherId,
    date: input.date,
    lines: usable.map((l) => ({
      itemId: l.itemId,
      godownId: l.godownId,
      qty: l.qty,
      rate: l.rate,
      direction: l.direction,
      movementType: "journal",
      narration: input.narration,
    })),
  });

  return voucherId;
}
