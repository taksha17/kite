import { httpRequest } from "../integrations/http";
import { splitDataUrl } from "./image";
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

export interface ChatOptions {
  /** data:image/...;base64,... for vision / bill capture */
  imageDataUrl?: string;
  /** Per-attempt HTTP timeout (seconds). Default 40; use ~55 for vision. */
  timeoutSecs?: number;
}

export async function soloProviderChat(
  settings: AiSettings,
  system: string,
  user: string,
  options: ChatOptions = {},
): Promise<string> {
  const provider = settings.provider as AiProvider;
  const model = modelFor(settings);
  const key = settings.apiKey.trim();
  const timeoutSecs = options.timeoutSecs ?? 40;
  const image = options.imageDataUrl
    ? splitDataUrl(options.imageDataUrl)
    : null;

  let url: string;
  let headers: Record<string, string>;
  let payload: unknown;

  if (provider === "openai" || provider === "openrouter") {
    url =
      provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${key}` };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/taksha17/kite";
      headers["X-Title"] = "Kite Books";
    }
    const userContent = image
      ? [
          { type: "text", text: user },
          {
            type: "image_url",
            image_url: {
              url: `data:${image.mime};base64,${image.base64}`,
            },
          },
        ]
      : user;
    payload = {
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    const userContent = image
      ? [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mime,
              data: image.base64,
            },
          },
          { type: "text", text: user },
        ]
      : user;
    payload = {
      model,
      max_tokens: 2048,
      temperature: 0,
      system,
      messages: [{ role: "user", content: userContent }],
    };
  } else if (provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers = { "x-goog-api-key": key };
    const parts: unknown[] = [{ text: user }];
    if (image) {
      parts.push({
        inline_data: { mime_type: image.mime, data: image.base64 },
      });
    }
    payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    };
  } else {
    throw new Error("Unknown AI provider.");
  }

  const requestOnce = () =>
    httpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      timeoutSecs,
    });

  let res = await requestOnce();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await requestOnce();
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
