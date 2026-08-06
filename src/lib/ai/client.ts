import { getActiveCompanyId } from "../db/active";
import { aiConfigured, getAiSettings } from "../db/ai";
import { isTauriRuntime, remoteAiChat } from "../server/remote";
import { soloProviderChat } from "./provider";
import { buildDraftPrompt } from "./prompt";
import { parseVoucherDraft, type ParsedDraft } from "./parse";
import type { AiSettings, DraftContext } from "./types";

/** Overall budget for one AI chat (covers network + one short 429 retry). */
export const AI_CHAT_TIMEOUT_MS = 45_000;

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

/**
 * One chat call, routed by build: Solo talks to the provider directly via
 * Rust; Team sends prompts to kite-server, which holds the API key.
 */
export async function aiChat(
  settings: AiSettings,
  system: string,
  user: string,
): Promise<string> {
  const call = isTauriRuntime()
    ? soloProviderChat(settings, system, user)
    : (async () => {
        const companyId = getActiveCompanyId();
        if (!companyId) throw new Error("No company is open.");
        return remoteAiChat(companyId, { system, user });
      })();
  return withTimeout(call, AI_CHAT_TIMEOUT_MS, "AI request");
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
