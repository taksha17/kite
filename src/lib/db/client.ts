import Database from "@tauri-apps/plugin-sql";
import { indianFyStartFor } from "../accounting/engine";
import type { GstBreakdown } from "../accounting/gst";
import { DEFAULT_GROUPS, DEFAULT_LEDGERS, VOUCHER_TYPES } from "../accounting/seed";
import {
  getActiveCompanyDb,
  getActiveCompanyId,
  peekActiveCompanyDb,
  setActiveCompanyDb,
} from "./active";
import { ensureInventorySchema, insertStockMovements, assertSufficientStock, listStockItems } from "./inventory";
import { ensureAuthSchema, writeAudit } from "./users";
import { getCurrentUser } from "./session";
import {
  COMPANY_COLUMN_MIGRATIONS,
  COMPANY_SCHEMA_STATEMENTS,
  REGISTRY_COLUMN_MIGRATIONS,
  REGISTRY_SCHEMA_STATEMENTS,
} from "./schema";
import { ensureIntegrationSchema } from "./integrations";
import {
  clearServerToken,
  isBrowserMode,
  isRemoteMode,
  RemoteCompanyDb,
  remoteCreateCompany,
  remoteListCompanies,
  remoteUpdateGst,
} from "../server/remote";
import { openBrowserDb } from "./browser";

export type {
  CompanyRecord,
  AccountGroupRow,
  LedgerRow,
  VoucherRow,
  VoucherLineRow,
  GstInvoiceRow,
} from "./types";
import type {
  CompanyRecord,
  AccountGroupRow,
  LedgerRow,
  VoucherRow,
  VoucherLineRow,
  GstInvoiceRow,
} from "./types";
export { getActiveCompanyDb, getActiveCompanyId } from "./active";

const REGISTRY_PATH = "sqlite:kite-registry.db";

let registry: Database | null = null;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "company"
  );
}

function uid(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function companyPath(dbFile: string): string {
  return `sqlite:${dbFile}`;
}

/** Opens a company database file on-device (Tauri SQLite or browser sql.js). */
async function openLocalCompanyDb(dbFile: string): Promise<Database> {
  if (isBrowserMode()) {
    return (await openBrowserDb(dbFile)) as unknown as Database;
  }
  return Database.load(companyPath(dbFile));
}

async function closePool(db: Database | null): Promise<void> {
  if (!db) return;
  try {
    await db.close(db.path);
  } catch {
    // ignore
  }
}

async function execAll(db: Database, statements: string[]) {
  for (const sql of statements) {
    await db.execute(sql);
  }
}

async function ensureColumns(
  db: Database,
  migrations: { table: string; column: string; ddl: string }[],
) {
  for (const m of migrations) {
    const cols = await db.select<{ name: string }[]>(
      `PRAGMA table_info(${m.table})`,
    );
    if (!cols.some((c) => c.name === m.column)) {
      await db.execute(m.ddl);
    }
  }
}

export async function getRegistry(): Promise<Database> {
  if (registry) {
    try {
      await registry.select<{ ok: number }[]>("SELECT 1 as ok");
      await ensureColumns(registry, REGISTRY_COLUMN_MIGRATIONS);
      return registry;
    } catch {
      registry = null;
    }
  }
  registry = isBrowserMode()
    ? ((await openBrowserDb("kite-registry.db")) as unknown as Database)
    : await Database.load(REGISTRY_PATH);
  await execAll(registry, REGISTRY_SCHEMA_STATEMENTS);
  await ensureColumns(registry, REGISTRY_COLUMN_MIGRATIONS);
  return registry;
}

export async function listCompanies(): Promise<CompanyRecord[]> {
  if (isRemoteMode()) {
    return remoteListCompanies();
  }
  const db = await getRegistry();
  return db.select<CompanyRecord[]>(
    "SELECT * FROM companies ORDER BY created_at DESC",
  );
}

export async function createCompany(input: {
  name: string;
  fyStart?: string;
  stateCode?: string;
  gstin?: string;
  gstEnabled?: boolean;
  /** Required in remote (server) mode; the server creates the owner atomically. */
  ownerUsername?: string;
  ownerPassword?: string;
  ownerDisplayName?: string;
}): Promise<CompanyRecord> {
  if (isRemoteMode()) {
    if (!input.ownerUsername || !input.ownerPassword) {
      throw new Error("Owner username and password are required.");
    }
    const { company } = await remoteCreateCompany({
      name: input.name,
      fyStart: input.fyStart,
      stateCode: input.stateCode,
      gstin: input.gstin,
      gstEnabled: input.gstEnabled,
      ownerUsername: input.ownerUsername,
      ownerPassword: input.ownerPassword,
      ownerDisplayName: input.ownerDisplayName,
    });
    // Mirror the local path, which leaves the new company active —
    // setupOwner/authenticate need an active company id.
    await openCompany(company);
    return company;
  }
  const db = await getRegistry();
  const id = uid();
  const baseSlug = slugify(input.name);
  const slug = `${baseSlug}-${id.slice(0, 6)}`;
  const dbFile = `kite-company-${slug}.db`;
  const fy_start = input.fyStart || indianFyStartFor();
  const gstEnabled =
    input.gstEnabled === true || Boolean(input.gstin?.trim()) ? 1 : 0;

  await db.execute(
    `INSERT INTO companies (id, name, slug, fy_start, currency, state_code, gstin, gst_enabled, db_file)
     VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8)`,
    [
      id,
      input.name.trim(),
      slug,
      fy_start,
      input.stateCode || null,
      input.gstin || null,
      gstEnabled,
      dbFile,
    ],
  );

  if (peekActiveCompanyDb()) {
    await closePool(peekActiveCompanyDb());
    setActiveCompanyDb(null, null);
  }

  const opened = await openLocalCompanyDb(dbFile);
  await execAll(opened, COMPANY_SCHEMA_STATEMENTS);
  await seedCompany(opened, {
    name: input.name.trim(),
    fy_start,
    gstin: input.gstin || "",
    state_code: input.stateCode || "",
    gst_enabled: String(gstEnabled),
  });
  await ensureInventorySchema(opened);
  await ensureAuthSchema(opened);
  await ensureIntegrationSchema(opened);
  setActiveCompanyDb(opened, id);

  const rows = await db.select<CompanyRecord[]>(
    "SELECT * FROM companies WHERE id = $1",
    [id],
  );
  return rows[0];
}

export async function updateCompanyGstSettings(input: {
  companyId: string;
  gstEnabled: boolean;
  stateCode: string;
  gstin: string;
}): Promise<CompanyRecord> {
  if (isRemoteMode()) {
    const updated = await remoteUpdateGst(input.companyId, {
      gstEnabled: input.gstEnabled,
      stateCode: input.stateCode,
      gstin: input.gstin,
    });
    const active = getActiveCompanyDb();
    await upsertMeta(active, "gst_enabled", input.gstEnabled ? "1" : "0");
    await upsertMeta(active, "state_code", input.stateCode || "");
    await upsertMeta(active, "gstin", input.gstin || "");
    return updated;
  }
  const db = await getRegistry();
  await db.execute(
    `UPDATE companies SET gst_enabled = $1, state_code = $2, gstin = $3 WHERE id = $4`,
    [
      input.gstEnabled ? 1 : 0,
      input.stateCode || null,
      input.gstin || null,
      input.companyId,
    ],
  );

  const active = getActiveCompanyDb();
  await upsertMeta(active, "gst_enabled", input.gstEnabled ? "1" : "0");
  await upsertMeta(active, "state_code", input.stateCode || "");
  await upsertMeta(active, "gstin", input.gstin || "");

  const rows = await db.select<CompanyRecord[]>(
    "SELECT * FROM companies WHERE id = $1",
    [input.companyId],
  );
  return rows[0];
}

async function upsertMeta(db: Database, key: string, value: string) {
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

async function seedCompany(
  db: Database,
  meta: {
    name: string;
    fy_start: string;
    gstin: string;
    state_code: string;
    gst_enabled: string;
  },
) {
  await db.execute("INSERT INTO meta (key, value) VALUES ($1, $2)", [
    "company_name",
    meta.name,
  ]);
  await db.execute("INSERT INTO meta (key, value) VALUES ($1, $2)", [
    "fy_start",
    meta.fy_start,
  ]);
  await db.execute("INSERT INTO meta (key, value) VALUES ($1, $2)", [
    "currency",
    "INR",
  ]);
  await db.execute("INSERT INTO meta (key, value) VALUES ($1, $2)", [
    "gstin",
    meta.gstin,
  ]);
  await db.execute("INSERT INTO meta (key, value) VALUES ($1, $2)", [
    "state_code",
    meta.state_code,
  ]);
  await db.execute("INSERT INTO meta (key, value) VALUES ($1, $2)", [
    "gst_enabled",
    meta.gst_enabled,
  ]);

  for (const vt of VOUCHER_TYPES) {
    await db.execute(
      "INSERT INTO voucher_type (code, name) VALUES ($1, $2)",
      [vt.code, vt.name],
    );
  }

  const groupIds = new Map<string, number>();
  const pending = [...DEFAULT_GROUPS];
  let guard = 0;
  while (pending.length && guard < 50) {
    guard += 1;
    for (let i = pending.length - 1; i >= 0; i--) {
      const g = pending[i];
      if (g.parent && !groupIds.has(g.parent)) continue;
      await db.execute(
        `INSERT INTO account_group (name, parent_id, nature, normal_balance, is_primary)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          g.name,
          g.parent ? groupIds.get(g.parent)! : null,
          g.nature,
          g.normal_balance,
          g.is_primary ? 1 : 0,
        ],
      );
      const rows = await db.select<{ id: number }[]>(
        "SELECT id FROM account_group WHERE name = $1",
        [g.name],
      );
      groupIds.set(g.name, rows[0].id);
      pending.splice(i, 1);
    }
  }

  for (const ledger of DEFAULT_LEDGERS) {
    const groupId = groupIds.get(ledger.group);
    if (!groupId) continue;
    await db.execute(
      `INSERT INTO ledger (name, group_id, is_cash_bank, is_party)
       VALUES ($1, $2, $3, $4)`,
      [ledger.name, groupId, ledger.is_cash_bank ? 1 : 0, ledger.is_party ? 1 : 0],
    );
  }
}

export async function openCompany(company: CompanyRecord): Promise<Database> {
  if (isRemoteMode()) {
    // Schema + migrations are ensured by kite-server when its pool opens.
    const remote = new RemoteCompanyDb(company.id);
    setActiveCompanyDb(remote as unknown as Database, company.id);
    return remote as unknown as Database;
  }
  const current = peekActiveCompanyDb();
  if (current && getActiveCompanyId() === company.id) {
    try {
      await current.select<{ ok: number }[]>("SELECT 1 as ok");
      await ensureColumns(current, COMPANY_COLUMN_MIGRATIONS);
      await ensureInventorySchema(current);
      await ensureAuthSchema(current);
      await ensureIntegrationSchema(current);
      return current;
    } catch {
      setActiveCompanyDb(null, null);
    }
  }

  if (current) {
    await closePool(current);
    setActiveCompanyDb(null, null);
  }

  const opened = await openLocalCompanyDb(company.db_file);
  await opened.execute("PRAGMA foreign_keys = ON");
  await ensureColumns(opened, COMPANY_COLUMN_MIGRATIONS);
  await ensureInventorySchema(opened);
  await ensureAuthSchema(opened);
  await ensureIntegrationSchema(opened);
  setActiveCompanyDb(opened, company.id);
  return opened;
}

export async function closeCompany(): Promise<void> {
  if (isRemoteMode()) {
    const activeId = getActiveCompanyId();
    if (activeId) clearServerToken(activeId);
    setActiveCompanyDb(null, null);
    return;
  }
  await closePool(peekActiveCompanyDb());
  setActiveCompanyDb(null, null);
}

export async function listGroups(): Promise<AccountGroupRow[]> {
  const db = getActiveCompanyDb();
  return db.select<AccountGroupRow[]>(
    "SELECT * FROM account_group ORDER BY name",
  );
}

export async function listLedgers(): Promise<LedgerRow[]> {
  const db = getActiveCompanyDb();
  return db.select<LedgerRow[]>(
    `SELECT l.*, g.name as group_name
     FROM ledger l
     JOIN account_group g ON g.id = l.group_id
     ORDER BY l.name`,
  );
}

export async function findLedgerByName(name: string): Promise<LedgerRow | null> {
  const db = getActiveCompanyDb();
  const rows = await db.select<LedgerRow[]>(
    "SELECT * FROM ledger WHERE name = $1 LIMIT 1",
    [name],
  );
  return rows[0] || null;
}

export async function createLedger(input: {
  name: string;
  groupId: number;
  openingDebit?: number;
  openingCredit?: number;
  isParty?: boolean;
  isCashBank?: boolean;
  gstin?: string;
  stateCode?: string;
  email?: string;
  address?: string;
  city?: string;
  pin?: string;
  phone?: string;
}): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO ledger (name, group_id, opening_debit, opening_credit, is_party, is_cash_bank, gstin, state_code, email, address, city, pin, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.name.trim(),
      input.groupId,
      input.openingDebit || 0,
      input.openingCredit || 0,
      input.isParty ? 1 : 0,
      input.isCashBank ? 1 : 0,
      input.gstin || null,
      input.stateCode || null,
      input.email?.trim() || null,
      input.address?.trim() || null,
      input.city?.trim() || null,
      input.pin?.trim() || null,
      input.phone?.trim() || null,
    ],
  );
}

export async function createParty(input: {
  name: string;
  kind: "debtor" | "creditor";
  gstin?: string;
  stateCode?: string;
  email?: string;
  address?: string;
  city?: string;
  pin?: string;
  phone?: string;
}): Promise<void> {
  const db = getActiveCompanyDb();
  const groupName =
    input.kind === "debtor" ? "Sundry Debtors" : "Sundry Creditors";
  const groups = await db.select<{ id: number }[]>(
    "SELECT id FROM account_group WHERE name = $1",
    [groupName],
  );
  if (!groups[0]) throw new Error(`Missing group ${groupName}`);
  await createLedger({
    name: input.name,
    groupId: groups[0].id,
    isParty: true,
    gstin: input.gstin,
    stateCode: input.stateCode,
    email: input.email,
    address: input.address,
    city: input.city,
    pin: input.pin,
    phone: input.phone,
  });
}

export async function updateLedgerEmail(
  ledgerId: number,
  email: string,
): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute("UPDATE ledger SET email = $1 WHERE id = $2", [
    email.trim() || null,
    ledgerId,
  ]);
}

/** Edits a ledger/party's master fields (group and opening balances stay). */
export async function updateLedger(
  ledgerId: number,
  input: {
    name: string;
    gstin?: string;
    stateCode?: string;
    email?: string;
    address?: string;
    city?: string;
    pin?: string;
    phone?: string;
  },
): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `UPDATE ledger SET name = $1, gstin = $2, state_code = $3, email = $4, address = $5,
       city = $6, pin = $7, phone = $8
     WHERE id = $9`,
    [
      input.name.trim(),
      input.gstin?.trim() || null,
      input.stateCode || null,
      input.email?.trim() || null,
      input.address?.trim() || null,
      input.city?.trim() || null,
      input.pin?.trim() || null,
      input.phone?.trim() || null,
      ledgerId,
    ],
  );
}

export async function insertVoucher(input: {
  voucherType: string;
  date: string;
  number?: string;
  narration?: string;
  totalAmount: number;
  lines: { ledgerId: number; debit: number; credit: number; narration?: string }[];
  gst?: {
    partyLedgerId: number;
    placeOfSupply: string;
    isInterstate: boolean;
    hsnSac?: string;
    gstRate: number;
    breakdown: GstBreakdown;
  };
  stockItems?: {
    itemId: number;
    godownId: number;
    qty: number;
    rate: number;
    batchNo?: string;
    serialNo?: string;
    lineDescription?: string;
  }[];
  invoiceExtras?: {
    paymentMode?: string;
    reverseCharge?: boolean;
    buyerOrderNo?: string;
    supplierRef?: string;
    vehicleNo?: string;
    deliveryDate?: string;
    transport?: string;
    termsOfDelivery?: string;
    shipToName?: string;
    shipToAddress?: string;
    shipToState?: string;
    shipToGstin?: string;
    freightAmount?: number;
    roundOff?: number;
  };
}): Promise<number> {
  const db = getActiveCompanyDb();
  const ex = input.invoiceExtras;

  if (input.stockItems?.length && input.voucherType === "sales") {
    const items = await listStockItems();
    const names = new Map(items.map((i) => [i.id, i.name]));
    await assertSufficientStock(
      input.stockItems.map((s) => ({
        itemId: s.itemId,
        godownId: s.godownId,
        qty: s.qty,
      })),
      names,
    );
  }

  // Use the INSERT's own rowid — under concurrent users a follow-up
  // "SELECT id ... DESC LIMIT 1" could return another user's voucher.
  const inserted = await db.execute(
    `INSERT INTO voucher (
      voucher_type, date, number, narration, total_amount,
      party_ledger_id, place_of_supply, is_interstate, hsn_sac, gst_rate,
      taxable_value, cgst_amount, sgst_amount, igst_amount,
      payment_mode, reverse_charge, buyer_order_no, supplier_ref, vehicle_no,
      delivery_date, transport, terms_of_delivery,
      ship_to_name, ship_to_address, ship_to_state, ship_to_gstin,
      freight_amount, round_off
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
    )`,
    [
      input.voucherType,
      input.date,
      input.number || null,
      input.narration || null,
      input.totalAmount,
      input.gst?.partyLedgerId ?? null,
      input.gst?.placeOfSupply ?? null,
      input.gst?.isInterstate ? 1 : 0,
      input.gst?.hsnSac ?? null,
      input.gst?.gstRate ?? null,
      input.gst?.breakdown.taxableValue ?? null,
      input.gst?.breakdown.cgst ?? 0,
      input.gst?.breakdown.sgst ?? 0,
      input.gst?.breakdown.igst ?? 0,
      ex?.paymentMode?.trim() || null,
      ex?.reverseCharge ? 1 : 0,
      ex?.buyerOrderNo?.trim() || null,
      ex?.supplierRef?.trim() || null,
      ex?.vehicleNo?.trim() || null,
      ex?.deliveryDate?.trim() || null,
      ex?.transport?.trim() || null,
      ex?.termsOfDelivery?.trim() || null,
      ex?.shipToName?.trim() || null,
      ex?.shipToAddress?.trim() || null,
      ex?.shipToState?.trim() || null,
      ex?.shipToGstin?.trim() || null,
      Number(ex?.freightAmount) || 0,
      Number(ex?.roundOff) || 0,
    ],
  );
  const voucherId = inserted.lastInsertId ?? 0;
  if (!voucherId) throw new Error("Could not save the voucher. Please retry.");
  for (const line of input.lines) {
    await db.execute(
      `INSERT INTO voucher_line (voucher_id, ledger_id, debit, credit, line_narration)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        voucherId,
        line.ledgerId,
        line.debit,
        line.credit,
        line.narration || null,
      ],
    );
  }

  if (input.stockItems?.length) {
    const direction = input.voucherType === "purchase" ? "in" : "out";
    const movementType =
      input.voucherType === "purchase" ? "purchase" : "sales";
    await insertStockMovements({
      voucherId,
      date: input.date,
      lines: input.stockItems.map((s) => ({
        itemId: s.itemId,
        godownId: s.godownId,
        qty: s.qty,
        rate: s.rate,
        direction,
        movementType,
        narration: input.narration,
        batchNo: s.batchNo,
        serialNo: s.serialNo,
        lineDescription: s.lineDescription,
      })),
    });
  }

  try {
    await writeAudit({
      user: getCurrentUser(),
      action: "create",
      entityType: "voucher",
      entityId: voucherId,
      detail: `${input.voucherType} · ${input.date} · ${input.totalAmount}`,
    });
  } catch {
    // audit should not block posting
  }

  return voucherId;
}

export async function listVouchers(limit = 200): Promise<VoucherRow[]> {
  const db = getActiveCompanyDb();
  return db.select<VoucherRow[]>(
    `SELECT v.*, p.name as party_name
     FROM voucher v
     LEFT JOIN ledger p ON p.id = v.party_ledger_id
     ORDER BY v.date DESC, v.id DESC
     LIMIT $1`,
    [limit],
  );
}

export async function getVoucherLines(
  voucherId: number,
): Promise<VoucherLineRow[]> {
  const db = getActiveCompanyDb();
  return db.select<VoucherLineRow[]>(
    `SELECT vl.*, l.name as ledger_name
     FROM voucher_line vl
     JOIN ledger l ON l.id = vl.ledger_id
     WHERE vl.voucher_id = $1
     ORDER BY vl.id`,
    [voucherId],
  );
}

export async function fetchLedgerBalances() {
  const db = getActiveCompanyDb();
  return db.select<
    {
      ledger_id: number;
      ledger_name: string;
      group_name: string;
      nature: string;
      opening_debit: number;
      opening_credit: number;
      period_debit: number;
      period_credit: number;
    }[]
  >(
    `SELECT
      l.id as ledger_id,
      l.name as ledger_name,
      g.name as group_name,
      g.nature as nature,
      l.opening_debit as opening_debit,
      l.opening_credit as opening_credit,
      COALESCE(SUM(vl.debit), 0) as period_debit,
      COALESCE(SUM(vl.credit), 0) as period_credit
     FROM ledger l
     JOIN account_group g ON g.id = l.group_id
     LEFT JOIN voucher_line vl ON vl.ledger_id = l.id
     GROUP BY l.id
     ORDER BY l.name`,
  );
}

export async function fetchDayBook(): Promise<
  (VoucherRow & { lines: VoucherLineRow[] })[]
> {
  const vouchers = await listVouchers(100);
  const result = [];
  for (const v of vouchers) {
    result.push({ ...v, lines: await getVoucherLines(v.id) });
  }
  return result;
}

export async function fetchLedgerStatement(ledgerId: number) {
  const db = getActiveCompanyDb();
  const ledger = await db.select<LedgerRow[]>(
    "SELECT * FROM ledger WHERE id = $1",
    [ledgerId],
  );
  const lines = await db.select<
    {
      date: string;
      voucher_id: number;
      voucher_type: string;
      number: string | null;
      narration: string | null;
      debit: number;
      credit: number;
    }[]
  >(
    `SELECT v.date, v.id as voucher_id, v.voucher_type, v.number, v.narration,
            vl.debit, vl.credit
     FROM voucher_line vl
     JOIN voucher v ON v.id = vl.voucher_id
     WHERE vl.ledger_id = $1
     ORDER BY v.date, v.id`,
    [ledgerId],
  );
  return { ledger: ledger[0], lines };
}

export async function fetchGstInvoices(
  type: "sales" | "purchase" | "all" = "all",
): Promise<GstInvoiceRow[]> {
  const db = getActiveCompanyDb();
  const typeFilter =
    type === "all"
      ? "v.voucher_type IN ('sales', 'purchase')"
      : "v.voucher_type = $1";
  const params = type === "all" ? [] : [type];
  return db.select<GstInvoiceRow[]>(
    `SELECT
      v.id, v.date, v.number, v.voucher_type,
      p.name as party_name, p.gstin as party_gstin,
      v.place_of_supply, v.is_interstate, v.hsn_sac, v.gst_rate,
      COALESCE(v.taxable_value, 0) as taxable_value,
      COALESCE(v.cgst_amount, 0) as cgst_amount,
      COALESCE(v.sgst_amount, 0) as sgst_amount,
      COALESCE(v.igst_amount, 0) as igst_amount,
      v.total_amount
     FROM voucher v
     LEFT JOIN ledger p ON p.id = v.party_ledger_id
     WHERE ${typeFilter}
       AND v.taxable_value IS NOT NULL
     ORDER BY v.date, v.id`,
    params,
  );
}

export function companyDbPathHint(company: CompanyRecord): string {
  return company.db_file;
}
