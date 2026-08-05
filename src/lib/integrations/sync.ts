import {
  getShopifyConnection,
  getWooConnection,
  saveShopifyConnection,
  saveWooConnection,
  writeSyncLog,
  type ShopifyConnection,
  type WooConnection,
} from "../db/integrations";
import {
  fetchShopifyOrdersRaw,
  normalizeShopifyOrders,
  testShopifyConnection,
} from "./shopify/client";
import {
  fetchWooOrdersRaw,
  normalizeWooOrders,
  testWooConnection,
} from "./woo/client";
import { importNormalizedOrders } from "./mapOrder";
import type { ConnectionTestResult, ImportOrdersResult } from "./types";

export async function testShopify(
  conn?: ShopifyConnection,
): Promise<ConnectionTestResult> {
  const c = conn || (await getShopifyConnection());
  const result = await testShopifyConnection(c);
  await writeSyncLog({
    source: "shopify",
    status: result.ok ? "ok" : "error",
    message: `Test connection: ${result.message}`,
  });
  return result;
}

export async function testWoo(
  conn?: WooConnection,
): Promise<ConnectionTestResult> {
  const c = conn || (await getWooConnection());
  const result = await testWooConnection(c);
  await writeSyncLog({
    source: "woocommerce",
    status: result.ok ? "ok" : "error",
    message: `Test connection: ${result.message}`,
  });
  return result;
}

export async function importShopifyOrders(): Promise<ImportOrdersResult> {
  const conn = await getShopifyConnection();
  if (!conn.enabled || !conn.shopDomain || !conn.accessToken) {
    return {
      created: 0,
      skipped: 0,
      failed: 0,
      messages: ["Save and enable Shopify credentials first."],
    };
  }

  try {
    const raw = await fetchShopifyOrdersRaw(
      conn,
      conn.lastSyncedAt || undefined,
    );
    if (raw.status < 200 || raw.status >= 300) {
      const msg = `Shopify orders HTTP ${raw.status}`;
      await writeSyncLog({ source: "shopify", status: "error", message: msg });
      return { created: 0, skipped: 0, failed: 1, messages: [msg] };
    }

    const orders = normalizeShopifyOrders(raw.body);
    const result = await importNormalizedOrders(orders);
    result.messages.unshift(
      `Fetched Shopify response (${raw.body.length} bytes); normalized ${orders.length} order(s).`,
    );

    const next: ShopifyConnection = {
      ...conn,
      lastSyncedAt: new Date().toISOString(),
    };
    await saveShopifyConnection(next);
    await writeSyncLog({
      source: "shopify",
      status: "info",
      message: `Import scaffold: ${orders.length} normalized, ${result.created} created.`,
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeSyncLog({ source: "shopify", status: "error", message: msg });
    return { created: 0, skipped: 0, failed: 1, messages: [msg] };
  }
}

export async function importWooOrders(): Promise<ImportOrdersResult> {
  const conn = await getWooConnection();
  if (!conn.enabled || !conn.storeUrl || !conn.consumerKey) {
    return {
      created: 0,
      skipped: 0,
      failed: 0,
      messages: ["Save and enable WooCommerce credentials first."],
    };
  }

  try {
    const raw = await fetchWooOrdersRaw(conn, conn.lastSyncedAt || undefined);
    if (raw.status < 200 || raw.status >= 300) {
      const msg = `WooCommerce orders HTTP ${raw.status}`;
      await writeSyncLog({
        source: "woocommerce",
        status: "error",
        message: msg,
      });
      return { created: 0, skipped: 0, failed: 1, messages: [msg] };
    }

    const orders = normalizeWooOrders(raw.body);
    const result = await importNormalizedOrders(orders);
    result.messages.unshift(
      `Fetched Woo response (${raw.body.length} bytes); normalized ${orders.length} order(s).`,
    );

    await saveWooConnection({
      ...conn,
      lastSyncedAt: new Date().toISOString(),
    });
    await writeSyncLog({
      source: "woocommerce",
      status: "info",
      message: `Import scaffold: ${orders.length} normalized, ${result.created} created.`,
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeSyncLog({
      source: "woocommerce",
      status: "error",
      message: msg,
    });
    return { created: 0, skipped: 0, failed: 1, messages: [msg] };
  }
}
