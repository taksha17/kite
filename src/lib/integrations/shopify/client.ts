import type { ShopifyConnection } from "../../db/integrations";
import { httpJson, httpRequest } from "../http";
import type { ConnectionTestResult, NormalizedOrder } from "../types";

function shopHost(domain: string): string {
  let d = domain.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!d.includes(".")) d = `${d}.myshopify.com`;
  return d;
}

function apiBase(conn: ShopifyConnection): string {
  return `https://${shopHost(conn.shopDomain)}/admin/api/${conn.apiVersion || "2024-10"}`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    "X-Shopify-Access-Token": token.trim(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function testShopifyConnection(
  conn: ShopifyConnection,
): Promise<ConnectionTestResult> {
  if (!conn.shopDomain.trim() || !conn.accessToken.trim()) {
    return { ok: false, message: "Enter shop domain and Admin API access token." };
  }
  try {
    const data = await httpJson<{ shop?: { name?: string; domain?: string } }>({
      method: "GET",
      url: `${apiBase(conn)}/shop.json`,
      headers: authHeaders(conn.accessToken),
    });
    const name = data.shop?.name || data.shop?.domain || "shop";
    return { ok: true, message: `Connected to ${name}.` };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Fetch paid orders updated since `updatedAtMin` (ISO). Empty import body for scaffold — normalize later. */
export async function fetchShopifyOrdersRaw(
  conn: ShopifyConnection,
  updatedAtMin?: string,
): Promise<{ status: number; body: string }> {
  const params = new URLSearchParams({
    status: "any",
    limit: "50",
  });
  if (conn.importPaidOnly) params.set("financial_status", "paid");
  if (updatedAtMin) params.set("updated_at_min", updatedAtMin);

  const res = await httpRequest({
    method: "GET",
    url: `${apiBase(conn)}/orders.json?${params}`,
    headers: authHeaders(conn.accessToken),
  });
  return { status: res.status, body: res.body };
}

/** Placeholder until Shopify normalize is implemented. */
export function normalizeShopifyOrders(_rawBody: string): NormalizedOrder[] {
  return [];
}
