import { httpRequest } from "../integrations/http";
import { isTauriRuntime } from "../server/remote";
import type {
  TallyCompanyInfo,
  TallyConnection,
  TallyLedger,
  TallyStockItem,
} from "./types";
import {
  companyAltProbeXml,
  companyProbeXml,
  ledgersExportXml,
  parseCompanyName,
  parseLedgersXml,
  parseStockXml,
  stockExportXml,
  tallyErrorFromXml,
} from "./xml";

function normalizeBaseUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, "");
  if (!u) u = "http://127.0.0.1:9000";
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

async function postXml(baseUrl: string, xml: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error(
      "Tally live migrate needs Kite Solo (desktop) on the same PC as TallyPrime — the browser build cannot reach localhost:9000 reliably.",
    );
  }

  const res = await httpRequest({
    method: "POST",
    url: baseUrl,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
    body: xml,
    timeoutSecs: 90,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Tally HTTP ${res.status}: ${(res.body || "").slice(0, 240) || "no body"}`,
    );
  }

  const err = tallyErrorFromXml(res.body);
  if (err) throw new Error(`Tally error: ${err}`);
  return res.body;
}

export function defaultTallyUrl(): string {
  return "http://127.0.0.1:9000";
}

/**
 * Ping Tally HTTP server and try to read the loaded company name.
 */
export async function probeTally(
  url: string = defaultTallyUrl(),
): Promise<TallyCompanyInfo & { baseUrl: string }> {
  const baseUrl = normalizeBaseUrl(url);
  let body: string;
  try {
    body = await postXml(baseUrl, companyProbeXml());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timed out|failed|ECONNREFUSED|Connection refused/i.test(msg)) {
      throw new Error(
        `Cannot reach Tally at ${baseUrl}. Open TallyPrime, load a company, and enable the HTTP server (Help → Settings → Connectivity → port 9000).`,
      );
    }
    throw e;
  }

  let name = parseCompanyName(body);
  if (!name) {
    try {
      const alt = await postXml(baseUrl, companyAltProbeXml());
      name = parseCompanyName(alt) || name;
    } catch {
      // ignore — connection already works
    }
  }

  return {
    baseUrl,
    name: name || "(company loaded — name not in probe response)",
    rawHint: body.slice(0, 120),
  };
}

export async function pullLedgers(
  conn: TallyConnection,
): Promise<TallyLedger[]> {
  const body = await postXml(normalizeBaseUrl(conn.baseUrl), ledgersExportXml());
  const list = parseLedgersXml(body);
  if (!list.length) {
    throw new Error(
      "Connected, but no LEDGER nodes in the response. Confirm a company is open and try again.",
    );
  }
  return list;
}

export async function pullStockItems(
  conn: TallyConnection,
): Promise<TallyStockItem[]> {
  const body = await postXml(normalizeBaseUrl(conn.baseUrl), stockExportXml());
  const list = parseStockXml(body);
  if (!list.length) {
    throw new Error(
      "Connected, but no STOCKITEM nodes. Inventory may be empty, or Tally returned a different collection id — try Excel export as fallback.",
    );
  }
  return list;
}
