import { closingNetDr } from "../accounting/homeInsights";
import type { LedgerBalanceInput } from "../accounting/reports";
import { askBooks } from "../ai/askBooks";
import { aiChat } from "../ai/client";
import { buildFollowUpTargets, draftPaymentReminder } from "../ar/followUp";
import { aiConfigured, getAiSettings } from "../db/ai";
import { fetchLedgerBalances, listLedgers } from "../db/client";
import {
  buildStringRouterPrompt,
  fallbackToolCall,
  parseStringToolCall,
} from "./router";
import type { StringToolCall, StringTurnResult } from "./types";

function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

async function routeUserMessage(userText: string): Promise<StringToolCall> {
  const settings = await getAiSettings();
  if (!aiConfigured(settings)) {
    throw new Error(
      "String needs an AI key — add one under Companies → AI quick entry.",
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const { system } = buildStringRouterPrompt(today);
  try {
    const raw = await aiChat(
      settings,
      system,
      JSON.stringify({ message: userText.trim(), today }),
    );
    return parseStringToolCall(raw);
  } catch {
    return fallbackToolCall(userText);
  }
}

async function runTool(
  call: StringToolCall,
  userText: string,
  companyName: string,
): Promise<StringTurnResult> {
  switch (call.tool) {
    case "ask_books": {
      const question = argString(call.args, "question") || userText;
      const today = new Date().toISOString().slice(0, 10);
      const res = await askBooks(question, today);
      return {
        reply: call.reply,
        tool: "ask_books",
        detail: `${res.title}\n\n${res.summary}`,
        rows: res.rows.slice(0, 12),
        action: {
          kind: "open_ask",
          label: "Open in Ask",
          href: `/ask?q=${encodeURIComponent(question)}`,
        },
      };
    }
    case "draft_voucher": {
      const sentence = argString(call.args, "sentence") || userText;
      return {
        reply: call.reply,
        tool: "draft_voucher",
        detail:
          "Nothing is posted yet. Review the draft, then Accept on the voucher screen.",
        action: {
          kind: "open_draft",
          label: "Open voucher draft",
          href: `/vouchers/new?ai=${encodeURIComponent(sentence)}&go=1`,
        },
      };
    }
    case "propose_setup": {
      const description = argString(call.args, "description") || userText;
      return {
        reply: call.reply,
        tool: "propose_setup",
        detail:
          "Setup proposes ledgers / stock / GST. You Apply — String never creates masters silently.",
        action: {
          kind: "open_setup",
          label: "Open setup with AI",
          href: `/?setup=1&desc=${encodeURIComponent(description.slice(0, 500))}`,
        },
      };
    }
    case "draft_reminder": {
      const partyName = argString(call.args, "partyName") || userText;
      const today = new Date().toISOString().slice(0, 10);
      const [balances, ledgers] = await Promise.all([
        fetchLedgerBalances(),
        listLedgers(),
      ]);
      const mapped: LedgerBalanceInput[] = balances.map((b) => ({
        ledgerId: b.ledger_id,
        ledgerName: b.ledger_name,
        groupName: b.group_name,
        nature: b.nature as LedgerBalanceInput["nature"],
        openingDebit: b.opening_debit,
        openingCredit: b.opening_credit,
        periodDebit: b.period_debit,
        periodCredit: b.period_credit,
      }));
      const targets = buildFollowUpTargets(mapped, ledgers, new Map(), today);
      const key = partyName.toLowerCase();
      let hit =
        targets.find((p) => p.name.toLowerCase() === key) ||
        targets.find((p) => p.name.toLowerCase().includes(key)) ||
        null;

      if (!hit) {
        const partyLedgers = ledgers.filter((l) => l.is_party);
        const p =
          partyLedgers.find((x) => x.name.toLowerCase() === key) ||
          partyLedgers.find((x) => x.name.toLowerCase().includes(key));
        if (p) {
          const bal = mapped.find((b) => b.ledgerId === p.id);
          const amount = bal ? Math.max(0, closingNetDr(bal)) : 0;
          hit = {
            ledgerId: p.id,
            name: p.name,
            amount,
            email: p.email ?? null,
            phone: p.phone ?? null,
            oldestOpenDate: null,
            daysOverdue: null,
            oldestOpenNumber: null,
          };
        }
      }

      if (!hit) {
        return {
          reply: `I couldn't find a party matching “${partyName}”.`,
          tool: "draft_reminder",
          detail: "Open Follow-up to pick from open receivables.",
          action: {
            kind: "open_follow_up",
            label: "Open Follow-up",
            href: "/follow-up",
          },
        };
      }
      const draft = draftPaymentReminder({
        partyName: hit.name,
        amount: hit.amount,
        companyName,
        daysOverdue: hit.daysOverdue,
        oldestOpenNumber: hit.oldestOpenNumber,
      });
      return {
        reply: call.reply,
        tool: "draft_reminder",
        detail: `${draft.subject}\n\n${draft.body}\n\n— WhatsApp —\n${draft.whatsappText}`,
        action: {
          kind: "open_follow_up",
          label: "Open Follow-up",
          href: "/follow-up",
        },
      };
    }
    case "help":
      return {
        reply: call.reply,
        tool: "help",
        detail: [
          "• Ask about balances, sales, GST, stock",
          "• Dictate or type a sale/purchase → voucher draft (you Accept)",
          "• “Set up my shop…” → AI setup proposals (you Apply)",
          "• “Remind Agarwal” → payment reminder text (you send)",
          "• Push-to-talk Dictate when your browser supports it",
          "",
          "String never auto-posts vouchers or changes settings without you.",
        ].join("\n"),
      };
    case "chat":
    default:
      return {
        reply:
          call.reply ||
          "I'm String. Ask a books question, dictate a voucher, or say “set up my business”.",
        tool: "chat",
      };
  }
}

/** One user → String turn (route + execute). */
export async function runStringTurn(
  userText: string,
  companyName: string,
): Promise<StringTurnResult> {
  const text = userText.trim();
  if (!text) throw new Error("Say or type something for String.");
  const call = await routeUserMessage(text);
  return runTool(call, text, companyName);
}
