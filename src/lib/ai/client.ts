import { getActiveCompanyId } from "../db/active";
import { aiConfigured, getAiSettings } from "../db/ai";
import { isTauriRuntime, remoteAiChat } from "../server/remote";
import { buildBillCapturePrompt } from "./billPrompt";
import { soloProviderChat } from "./provider";
import { buildDraftPrompt } from "./prompt";
import { parseVoucherDraft, type ParsedDraft } from "./parse";
import type { AiSettings, DraftContext } from "./types";

/** Overall budget for one text AI chat. */
export const AI_CHAT_TIMEOUT_MS = 45_000;
/** Vision / bill capture needs more headroom. */
export const AI_VISION_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s — the free AI model is overloaded. Wait a moment and try again.`,
        ),
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface AiChatOptions {
  imageDataUrl?: string;
  timeoutMs?: number;
  timeoutSecs?: number;
}

/**
 * One chat call, routed by build: Solo talks to the provider directly via
 * Rust; Team sends prompts to kite-server, which holds the API key.
 */
export async function aiChat(
  settings: AiSettings,
  system: string,
  user: string,
  options: AiChatOptions = {},
): Promise<string> {
  const timeoutMs =
    options.timeoutMs ??
    (options.imageDataUrl ? AI_VISION_TIMEOUT_MS : AI_CHAT_TIMEOUT_MS);
  const timeoutSecs =
    options.timeoutSecs ?? Math.ceil(timeoutMs / 1000) - 5;

  const call = isTauriRuntime()
    ? soloProviderChat(settings, system, user, {
        imageDataUrl: options.imageDataUrl,
        timeoutSecs: Math.max(20, timeoutSecs),
      })
    : (async () => {
        const companyId = getActiveCompanyId();
        if (!companyId) throw new Error("No company is open.");
        return remoteAiChat(companyId, {
          system,
          user,
          imageDataUrl: options.imageDataUrl,
        });
      })();
  return withTimeout(call, timeoutMs, "AI request");
}

/** Quick settings check — a one-token round trip. */
export async function testAiConnection(settings: AiSettings): Promise<void> {
  await aiChat(settings, "Reply with the word OK.", "ping");
}

/**
 * Turns one natural-language sentence into a validated voucher draft.
 * The model only extracts; parsing re-checks every id against the books.
 */
export async function draftVoucher(
  sentence: string,
  ctx: DraftContext,
): Promise<ParsedDraft> {
  const settings = await getAiSettings();
  if (!aiConfigured(settings)) {
    throw new Error(
      "AI quick entry is not set up — add an API key under Companies → AI quick entry.",
    );
  }
  const { system, user } = buildDraftPrompt(ctx, sentence);
  const raw = await aiChat(settings, system, user);
  return parseVoucherDraft(raw, ctx);
}

/**
 * Photo of a purchase bill → validated purchase voucher draft.
 * Reuses the same tolerant parser as text drafting.
 */
export async function draftVoucherFromBill(
  imageDataUrl: string,
  ctx: DraftContext,
): Promise<ParsedDraft> {
  const settings = await getAiSettings();
  if (!aiConfigured(settings)) {
    throw new Error(
      "AI quick entry is not set up — add an API key under Companies → AI quick entry.",
    );
  }
  if (settings.provider === "anthropic" && !settings.model.trim()) {
    // default haiku supports vision; nothing to do
  }
  const { system, user } = buildBillCapturePrompt(ctx);
  const raw = await aiChat(settings, system, user, {
    imageDataUrl,
    timeoutMs: AI_VISION_TIMEOUT_MS,
  });
  const parsed = parseVoucherDraft(raw, ctx);
  // Bill capture is purchase by definition.
  if (!parsed.draft.voucherType) parsed.draft.voucherType = "purchase";
  return parsed;
}
