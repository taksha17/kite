/**
 * Remote (Kite Enterprise) data layer.
 *
 * In a browser / PWA there is no Tauri SQLite — instead, a RemoteCompanyDb
 * implements the same {execute, select, close, path} surface as the
 * tauri-plugin-sql Database and forwards statements to kite-server over HTTP.
 * Every module that talks to getActiveCompanyDb() works unchanged.
 */
import type { CompanyRecord } from "../db/types";
import type { AppUser } from "../db/users";

export interface QueryResult {
  rowsAffected: number;
  lastInsertId: number;
}

const TOKEN_PREFIX = "kite.serverToken.";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Where the app's data lives:
 * - tauri   — desktop app, local SQLite files
 * - remote  — browser/PWA talking to a kite-server on the same origin
 * - browser — serverless PWA, SQLite-in-WASM on this device (+ Drive backup)
 */
type RuntimeMode = "tauri" | "remote" | "browser";

let runtimeMode: RuntimeMode = isTauriRuntime() ? "tauri" : "remote";

/**
 * Detects remote vs browser mode by probing for the kite-server API.
 * Call once before rendering (main.tsx); browsers without a server on
 * the origin fall back to browser-local mode. A localStorage override
 * ("kite.runtimeMode" = "browser" | "remote") forces a mode for testing.
 */
export async function initRuntimeMode(): Promise<RuntimeMode> {
  if (isTauriRuntime()) {
    runtimeMode = "tauri";
    return runtimeMode;
  }
  try {
    const forced = localStorage.getItem("kite.runtimeMode");
    if (forced === "browser" || forced === "remote") {
      runtimeMode = forced;
      return runtimeMode;
    }
  } catch {
    // localStorage unavailable — probe normally
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${window.location.origin}/api/companies`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const contentType = response.headers.get("Content-Type") || "";
    // SPA fallbacks may answer 200 HTML for /api/* — only JSON counts.
    runtimeMode =
      response.ok && contentType.includes("application/json")
        ? "remote"
        : "browser";
  } catch {
    runtimeMode = "browser";
  }
  return runtimeMode;
}

/** True when the app runs in a browser/PWA against kite-server. */
export function isRemoteMode(): boolean {
  return !isTauriRuntime() && runtimeMode === "remote";
}

/** True when the app runs serverless in a browser (sql.js + IndexedDB). */
export function isBrowserMode(): boolean {
  return !isTauriRuntime() && runtimeMode === "browser";
}

function baseUrl(): string {
  return window.location.origin;
}

export function getServerToken(companyId: string): string | null {
  return localStorage.getItem(TOKEN_PREFIX + companyId);
}

export function setServerToken(companyId: string, token: string): void {
  localStorage.setItem(TOKEN_PREFIX + companyId, token);
}

export function clearServerToken(companyId: string): void {
  localStorage.removeItem(TOKEN_PREFIX + companyId);
}

async function apiFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
  } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: options.method || (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error(
      "Cannot reach the Kite server. Check your connection and try again.",
    );
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      (data as { error?: string } | null)?.error ||
      `Server error (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export async function remoteListCompanies(): Promise<CompanyRecord[]> {
  const data = await apiFetch("/api/companies");
  return data.companies as CompanyRecord[];
}

export async function remoteGetCompanyInfo(
  companyId: string,
): Promise<{ company: CompanyRecord; userCount: number }> {
  return apiFetch(`/api/companies/${encodeURIComponent(companyId)}`);
}

export async function remoteCreateCompany(input: {
  name: string;
  fyStart?: string;
  stateCode?: string;
  gstin?: string;
  gstEnabled?: boolean;
  ownerUsername: string;
  ownerPassword: string;
  ownerDisplayName?: string;
}): Promise<{ company: CompanyRecord; owner: AppUser }> {
  return apiFetch("/api/companies", { body: input });
}

export async function remoteLogin(
  companyId: string,
  username: string,
  password: string,
): Promise<{ token: string; user: AppUser }> {
  const data = await apiFetch(
    `/api/companies/${encodeURIComponent(companyId)}/login`,
    { body: { username, password } },
  );
  setServerToken(companyId, data.token);
  return data as { token: string; user: AppUser };
}

/**
 * Downloads the company's full SQLite file (owner-only server endpoint).
 * Triggers a browser save; returns the suggested filename.
 */
export async function remoteDownloadBackup(companyId: string): Promise<string> {
  const token = getServerToken(companyId);
  if (!token) throw new Error("Sign in to this company first.");
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl()}/api/companies/${encodeURIComponent(companyId)}/backup`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    throw new Error(
      "Cannot reach the Kite server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    let message = `Server error (HTTP ${response.status}).`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] || `kite-backup-${companyId}.db`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export async function remoteUpdateGst(
  companyId: string,
  input: { gstEnabled: boolean; stateCode: string; gstin: string },
): Promise<CompanyRecord> {
  const data = await apiFetch(
    `/api/companies/${encodeURIComponent(companyId)}/gst`,
    { body: input, token: getServerToken(companyId) },
  );
  return data.company as CompanyRecord;
}

/** Team-mode AI quick entry — the server holds the API key. */
export async function remoteAiChat(
  companyId: string,
  input: { system: string; user: string; imageDataUrl?: string },
): Promise<string> {
  const data = await apiFetch("/api/company/ai/chat", {
    body: input,
    token: getServerToken(companyId),
  });
  return data.content as string;
}

export class RemoteCompanyDb {
  readonly path: string;

  constructor(private readonly companyId: string) {
    this.path = `remote:${companyId}`;
  }

  private token(): string {
    const token = getServerToken(this.companyId);
    if (!token) {
      throw new Error("Sign in to this company first.");
    }
    return token;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    const data = await apiFetch("/api/company/execute", {
      body: { sql, params: params ?? [] },
      token: this.token(),
    });
    return {
      rowsAffected: Number(data.rowsAffected) || 0,
      lastInsertId: Number(data.lastInsertId) || 0,
    };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    const data = await apiFetch("/api/company/query", {
      body: { sql, params: params ?? [] },
      token: this.token(),
    });
    return data.rows as T;
  }

  async close(_path?: string): Promise<void> {
    // Server-side pools are shared; nothing to close per client.
  }
}
