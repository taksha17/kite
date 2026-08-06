import { httpRequest } from "../integrations/http";
import { AI_DEFAULT_MODELS, type AiProvider, type AiSettings } from "./types";

/**
 * Direct-to-provider calls for the Solo desktop build, via the Rust
 * `http_request` command (CORS-free, key stays in the app process).
 * The Team build never touches this — kite-server holds the key instead.
 */

function modelFor(settings: AiSettings): string {
  if (!settings.provider) throw new Error("Pick an AI provider first.");
  return settings.model.trim() || AI_DEFAULT_MODELS[settings.provider];
}

export async function soloProviderChat(
  settings: AiSettings,
  system: string,
  user: string,
): Promise<string> {
  const provider = settings.provider as AiProvider;
  const model = modelFor(settings);
  const key = settings.apiKey.trim();
  let url: string;
  let headers: Record<string, string>;
  let payload: unknown;

  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${key}` };
    payload = {
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    payload = {
      model,
      max_tokens: 1024,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    };
  } else if (provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers = { "x-goog-api-key": key };
    payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    };
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://github.com/taksha17/kite",
      "X-Title": "Kite Books",
    };
    payload = {
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
  } else {
    throw new Error("Unknown AI provider.");
  }

  // Free tiers (esp. OpenRouter) throttle often — one automatic retry
  // smooths a transient 429 without any user action.
  let res = await httpRequest({
    method: "POST",
    url,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 4000));
    res = await httpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
  }

  let body: unknown = null;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = null;
  }

  if (res.status < 200 || res.status >= 300) {
    const detail =
      (body as { error?: { message?: string } } | null)?.error?.message ||
      `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`The AI provider rejected the API key (${detail}).`);
    }
    if (res.status === 429) {
      throw new Error(
        provider === "openrouter"
          ? "OpenRouter's free limit is hit — wait a minute and retry. Free accounts get 20 requests/min and 50/day (a one-time $10 top-up raises it to 1000/day)."
          : "The AI provider rate-limited the request — wait a moment and retry.",
      );
    }
    throw new Error(`AI provider error: ${detail}`);
  }

  const text =
    provider === "openai" || provider === "openrouter"
      ? (body as { choices?: { message?: { content?: string } }[] } | null)
          ?.choices?.[0]?.message?.content
      : provider === "anthropic"
        ? (body as { content?: { text?: string }[] } | null)?.content?.[0]?.text
        : (body as
            | { candidates?: { content?: { parts?: { text?: string }[] } }[] }
            | null)?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("AI provider reply had an unexpected shape — no text found.");
  }
  return text;
}
