import type Database from "@tauri-apps/plugin-sql";
import { getActiveCompanyDb } from "./active";
import { INTEGRATION_SCHEMA_STATEMENTS } from "./schema";

export type IntegrationSource = "shopify" | "woocommerce";

export interface ShopifyConnection {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  enabled: boolean;
  lastSyncedAt: string;
  defaultGstRate: number;
  importPaidOnly: boolean;
}

export interface WooConnection {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  enabled: boolean;
  lastSyncedAt: string;
  defaultGstRate: number;
  importPaidOnly: boolean;
}

export interface SyncLogRow {
  id: number;
  source: string;
  external_id: string | null;
  status: string;
  message: string | null;
  created_at: string;
}

const SHOPIFY_META = "integration_shopify";
const WOO_META = "integration_woocommerce";

export function emptyShopifyConnection(): ShopifyConnection {
  return {
    shopDomain: "",
    accessToken: "",
    apiVersion: "2024-10",
    enabled: false,
    lastSyncedAt: "",
    defaultGstRate: 18,
    importPaidOnly: true,
  };
}

export function emptyWooConnection(): WooConnection {
  return {
    storeUrl: "",
    consumerKey: "",
    consumerSecret: "",
    enabled: false,
    lastSyncedAt: "",
    defaultGstRate: 18,
    importPaidOnly: true,
  };
}

export async function ensureIntegrationSchema(db: Database): Promise<void> {
  for (const sql of INTEGRATION_SCHEMA_STATEMENTS) {
    await db.execute(sql);
  }
}

async function upsertMeta(key: string, value: string): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

async function readMeta(key: string): Promise<string> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [key],
  );
  return rows[0]?.value || "";
}

export async function getShopifyConnection(): Promise<ShopifyConnection> {
  const raw = await readMeta(SHOPIFY_META);
  if (!raw) return emptyShopifyConnection();
  try {
    return { ...emptyShopifyConnection(), ...JSON.parse(raw) };
  } catch {
    return emptyShopifyConnection();
  }
}

export async function saveShopifyConnection(
  conn: ShopifyConnection,
): Promise<void> {
  await upsertMeta(SHOPIFY_META, JSON.stringify(conn));
}

export async function getWooConnection(): Promise<WooConnection> {
  const raw = await readMeta(WOO_META);
  if (!raw) return emptyWooConnection();
  try {
    return { ...emptyWooConnection(), ...JSON.parse(raw) };
  } catch {
    return emptyWooConnection();
  }
}

export async function saveWooConnection(conn: WooConnection): Promise<void> {
  await upsertMeta(WOO_META, JSON.stringify(conn));
}

export async function writeSyncLog(input: {
  source: IntegrationSource;
  externalId?: string;
  status: "ok" | "skip" | "error" | "info";
  message: string;
}): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO integration_sync_log (source, external_id, status, message)
     VALUES ($1, $2, $3, $4)`,
    [input.source, input.externalId || null, input.status, input.message],
  );
}

export async function listSyncLog(limit = 40): Promise<SyncLogRow[]> {
  const db = getActiveCompanyDb();
  return db.select<SyncLogRow[]>(
    `SELECT * FROM integration_sync_log
     ORDER BY id DESC
     LIMIT $1`,
    [limit],
  );
}

export async function voucherExistsExternal(
  source: IntegrationSource,
  externalId: string,
): Promise<boolean> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM voucher
     WHERE external_source = $1 AND external_id = $2`,
    [source, externalId],
  );
  return (rows[0]?.c || 0) > 0;
}
