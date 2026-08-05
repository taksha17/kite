import type { WooConnection } from "../../db/integrations";
import { httpJson, httpRequest } from "../http";
import type { ConnectionTestResult, NormalizedOrder } from "../types";

function storeBase(url: string): string {
  let u = url.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export async function testWooConnection(
  conn: WooConnection,
): Promise<ConnectionTestResult> {
  if (
    !conn.storeUrl.trim() ||
    !conn.consumerKey.trim() ||
    !conn.consumerSecret.trim()
  ) {
    return {
      ok: false,
      message: "Enter store URL, consumer key, and consumer secret.",
    };
  }
  try {
    const data = await httpJson<unknown>({
      method: "GET",
      url: `${storeBase(conn.storeUrl)}/wp-json/wc/v3/system_status`,
      basicUser: conn.consumerKey,
      basicPass: conn.consumerSecret,
    });
    void data;
    return { ok: true, message: "Connected to WooCommerce REST API." };
  } catch (e) {
    // system_status may be restricted; fall back to orders?per_page=1
    try {
      const res = await httpRequest({
        method: "GET",
        url: `${storeBase(conn.storeUrl)}/wp-json/wc/v3/orders?per_page=1`,
        basicUser: conn.consumerKey,
        basicPass: conn.consumerSecret,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: "Connected to WooCommerce REST API." };
      }
      return {
        ok: false,
        message: `HTTP ${res.status}: ${res.body.slice(0, 200)}`,
      };
    } catch (e2) {
      return {
        ok: false,
        message: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }
}

export async function fetchWooOrdersRaw(
  conn: WooConnection,
  afterIso?: string,
): Promise<{ status: number; body: string }> {
  const params = new URLSearchParams({
    per_page: "50",
    orderby: "date",
    order: "desc",
  });
  if (conn.importPaidOnly) {
    params.set("status", "processing,completed");
  }
  if (afterIso) params.set("after", afterIso);

  const res = await httpRequest({
    method: "GET",
    url: `${storeBase(conn.storeUrl)}/wp-json/wc/v3/orders?${params}`,
    basicUser: conn.consumerKey,
    basicPass: conn.consumerSecret,
  });
  return { status: res.status, body: res.body };
}

export function normalizeWooOrders(_rawBody: string): NormalizedOrder[] {
  return [];
}
