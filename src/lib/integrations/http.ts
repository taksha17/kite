import { invoke } from "@tauri-apps/api/core";

export interface HttpRequestInput {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Basic auth username (WooCommerce key) */
  basicUser?: string;
  /** Basic auth password (WooCommerce secret) */
  basicPass?: string;
  /** Per-request timeout in seconds (Rust clamps 5–90). Default 30. */
  timeoutSecs?: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** CORS-free HTTP via Rust (async reqwest — does not freeze the window). */
export async function httpRequest(
  input: HttpRequestInput,
): Promise<HttpResponse> {
  return invoke<HttpResponse>("http_request", {
    args: {
      method: input.method,
      url: input.url,
      headers: input.headers || {},
      body: input.body ?? null,
      basicUser: input.basicUser ?? null,
      basicPass: input.basicPass ?? null,
      timeoutSecs: input.timeoutSecs ?? null,
    },
  });
}

export async function httpJson<T>(input: HttpRequestInput): Promise<T> {
  const res = await httpRequest(input);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `HTTP ${res.status}: ${res.body.slice(0, 280) || "request failed"}`,
    );
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error("Response was not valid JSON.");
  }
}
