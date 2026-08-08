import { extractJsonObject } from "../ai/parse";
import type { StringToolCall, StringToolName } from "./types";

const TOOLS = new Set<StringToolName>([
  "ask_books",
  "draft_voucher",
  "propose_setup",
  "draft_reminder",
  "help",
  "chat",
]);

export function buildStringRouterPrompt(today: string): {
  system: string;
  userPrefix: string;
} {
  const system = [
    "You are String, Kite's in-app agent for Indian GST books.",
    "The user has their own AI API key. You pick ONE tool and fill args.",
    "Reply with ONE raw JSON object only — no markdown, no code fences.",
    "Schema:",
    "{",
    '  "tool": "ask_books" | "draft_voucher" | "propose_setup" | "draft_reminder" | "help" | "chat",',
    '  "args": object,',
    '  "reply": string  // short friendly acknowledgement (1-2 sentences)',
    "}",
    "Tool rules:",
    '- ask_books — questions about balances, sales, GST, stock, who owes what. args: { "question": string }',
    '- draft_voucher — user wants to record a sale/purchase/payment/receipt. args: { "sentence": string } (keep their wording)',
    '- propose_setup — new company setup / customise ledgers & stock from a business description. args: { "description": string }',
    '- draft_reminder — payment reminder / follow-up for a party. args: { "partyName": string }',
    "- help — what String can do. args: {}",
    "- chat — greetings, thanks, or unclear ask. args: {}",
    "Never claim you posted a voucher or changed settings — the human must Accept/Apply in Kite.",
    "Understand English and Hinglish. Today is " + today + ".",
  ].join("\n");

  return { system, userPrefix: "" };
}

export function parseStringToolCall(raw: string): StringToolCall {
  const obj = extractJsonObject(raw);
  const toolRaw = typeof obj.tool === "string" ? obj.tool.trim() : "chat";
  const tool = (TOOLS.has(toolRaw as StringToolName)
    ? toolRaw
    : "chat") as StringToolName;
  const args =
    obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
      ? (obj.args as Record<string, unknown>)
      : {};
  const reply =
    typeof obj.reply === "string" && obj.reply.trim()
      ? obj.reply.trim()
      : defaultReply(tool);
  return { tool, args, reply };
}

function defaultReply(tool: StringToolName): string {
  switch (tool) {
    case "ask_books":
      return "Checking your books…";
    case "draft_voucher":
      return "I'll open a voucher draft for you to review.";
    case "propose_setup":
      return "Opening setup — you review before anything is created.";
    case "draft_reminder":
      return "Drafting a payment reminder…";
    case "help":
      return "Here's what I can help with.";
    default:
      return "How can I help with your books?";
  }
}

/** Heuristic fallback when the model returns non-JSON. */
export function fallbackToolCall(userText: string): StringToolCall {
  const t = userText.trim();
  const lower = t.toLowerCase();
  if (
    /^(hi|hello|hey|namaste|thanks|thank you|ok|okay)\b/.test(lower) ||
    t.length < 3
  ) {
    return { tool: "chat", args: {}, reply: "Hi — I'm String. Ask about your books, dictate a sale, or say “set up my shop”." };
  }
  if (
    /set up|setup|onboard|customise|customize|configure my|mera business|shop setup|company setup/.test(
      lower,
    )
  ) {
    return {
      tool: "propose_setup",
      args: { description: t },
      reply: "I'll open setup proposals — you Accept before anything is created.",
    };
  }
  if (
    /remind|follow[- ]?up|payment reminder|kitna pending|paise maang/.test(lower)
  ) {
    const partyName = t
      .replace(/.*\b(for|to|se)\b/i, "")
      .replace(/remind(er)?|follow[- ]?up|payment|pending|karo|do/gi, "")
      .trim() || t;
    return {
      tool: "draft_reminder",
      args: { partyName },
      reply: "Drafting a reminder — you send it yourself.",
    };
  }
  if (
    /sold|sale|purchase|bought|payment|paid|received|receipt|voucher|bill|invoice|becha|khareeda/.test(
      lower,
    )
  ) {
    return {
      tool: "draft_voucher",
      args: { sentence: t },
      reply: "Opening a voucher draft for your review.",
    };
  }
  if (
    /owe|balance|sales|gst|stock|kitna|how much|show|list|report|profit|debtor|creditor|\?/.test(
      lower,
    )
  ) {
    return {
      tool: "ask_books",
      args: { question: t },
      reply: "Looking that up in your books…",
    };
  }
  if (/help|what can you|kaise|capabilities/.test(lower)) {
    return { tool: "help", args: {}, reply: "Here's what I can do." };
  }
  return {
    tool: "ask_books",
    args: { question: t },
    reply: "I'll try your books first…",
  };
}
