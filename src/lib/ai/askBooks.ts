import { formatInr } from "../accounting/engine";
import { getActiveCompanyDb } from "../db/active";
import { aiConfigured, getAiSettings } from "../db/ai";
import { aiChat } from "./client";
import { extractJsonObject } from "./parse";
import { assertSafeSelect, ASK_MAX_ROWS } from "./askSql";

export interface AskPlan {
  sql: string;
  title: string;
}

export interface AskResult {
  question: string;
  title: string;
  sql: string;
  rows: Record<string, unknown>[];
  summary: string;
}

const SCHEMA_DOC = `
Tables (SQLite):
- ledger(id, name, group_id, opening_debit, opening_credit, is_cash_bank, is_party, gstin, state_code)
- account_group(id, name, parent_id, nature, normal_balance)  -- nature: asset|liability|income|expense|equity
- voucher(id, voucher_type, date, number, narration, total_amount, party_ledger_id,
    place_of_supply, is_interstate, hsn_sac, gst_rate, taxable_value, cgst_amount, sgst_amount, igst_amount, payment_mode)
  voucher_type values: sales, purchase, payment, receipt, contra, journal, stock_journal
- voucher_line(id, voucher_id, ledger_id, debit, credit, line_narration)
- voucher_type(code, name)
- stock_item(id, name, unit_id, hsn_sac, gst_rate, purchase_rate, sales_rate, opening_qty)
- stock_movement(id, voucher_id, date, item_id, godown_id, qty_in, qty_out, rate, amount, movement_type)
- unit(id, name, symbol)
- godown(id, name, is_default)

Useful patterns:
- Party balance: SUM(debit)-SUM(credit) + opening from voucher_line JOIN ledger WHERE is_party=1
- Sales this month: SELECT SUM(total_amount) FROM voucher WHERE voucher_type='sales' AND date >= …
- GST liability: SUM(cgst_amount+sgst_amount+igst_amount) FROM voucher WHERE date BETWEEN …
- Stock qty: SUM(qty_in-qty_out) FROM stock_movement GROUP BY item_id
`.trim();

export function buildAskPrompt(
  question: string,
  today: string,
): { system: string; user: string } {
  const system = [
    "You translate questions about an Indian double-entry books SQLite DB into ONE read-only SQL query.",
    "Reply with ONE raw JSON object only — no markdown, no explanation, no numbers.",
    'Schema: { "sql": string, "title": string }',
    "Rules:",
    "- sql MUST be a single SELECT (WITH … SELECT allowed).",
    "- Never INSERT/UPDATE/DELETE/DROP/PRAGMA or touch other tables.",
    `- Allowed tables only: ledger, account_group, voucher, voucher_line, voucher_type, stock_item, stock_movement, unit, godown.`,
    `- Always include LIMIT ${ASK_MAX_ROWS} or less.`,
    "- Use ISO dates YYYY-MM-DD. Today is " + today + ".",
    "- Join ledger for party/account names. Prefer clear column aliases.",
    "- title is a short English label for the result (no amounts).",
    "- Do NOT invent figures — only write SQL; the app will run it.",
    "",
    SCHEMA_DOC,
  ].join("\n");

  const user = JSON.stringify({ question: question.trim(), today });
  return { system, user };
}

export function parseAskPlan(raw: string): AskPlan {
  const obj = extractJsonObject(raw);
  const sql = typeof obj.sql === "string" ? obj.sql : "";
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim()
      : "Query result";
  return { sql: assertSafeSelect(sql), title };
}

const MONEY_COL =
  /amount|total|balance|debit|credit|taxable|cgst|sgst|igst|value|sales|purchase|rate|opening/i;

function cellNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Build a one-line answer from DB rows only — never trust the model for figures. */
export function summarizeAskRows(
  rows: Record<string, unknown>[],
  title: string,
): string {
  if (rows.length === 0) return `${title}: no matching rows.`;

  const keys = Object.keys(rows[0]);
  if (rows.length === 1 && keys.length === 1) {
    const n = cellNumber(rows[0][keys[0]]);
    if (n != null && MONEY_COL.test(keys[0])) {
      return `${title}: ${formatInr(n)}.`;
    }
    if (n != null) return `${title}: ${n}.`;
    return `${title}: ${String(rows[0][keys[0]] ?? "—")}.`;
  }

  if (rows.length === 1) {
    const moneyBits = keys
      .filter((k) => MONEY_COL.test(k))
      .map((k) => {
        const n = cellNumber(rows[0][k]);
        return n != null ? `${k} ${formatInr(n)}` : null;
      })
      .filter(Boolean);
    if (moneyBits.length) {
      return `${title}: ${moneyBits.join(" · ")}.`;
    }
  }

  const moneyKeys = keys.filter((k) => MONEY_COL.test(k));
  if (moneyKeys.length === 1) {
    const sum = rows.reduce((s, r) => s + (cellNumber(r[moneyKeys[0]]) || 0), 0);
    return `${title}: ${rows.length} row${rows.length === 1 ? "" : "s"} · total ${formatInr(sum)}.`;
  }

  return `${title}: ${rows.length} row${rows.length === 1 ? "" : "s"}.`;
}

export async function runAskQuery(
  sql: string,
): Promise<Record<string, unknown>[]> {
  const safe = assertSafeSelect(sql);
  const db = getActiveCompanyDb();
  const rows = await db.select<Record<string, unknown>[]>(safe);
  return Array.isArray(rows) ? rows.slice(0, ASK_MAX_ROWS) : [];
}

/**
 * Ask a question about the open company books.
 * Model proposes SQL; app validates + runs it; summary uses only DB numbers.
 */
export async function askBooks(
  question: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<AskResult> {
  const q = question.trim();
  if (!q) throw new Error("Ask a question about your books.");

  const settings = await getAiSettings();
  if (!aiConfigured(settings)) {
    throw new Error(
      "AI is not set up — add a free OpenRouter key under Companies → AI quick entry.",
    );
  }

  const { system, user } = buildAskPrompt(q, today);
  const raw = await aiChat(settings, system, user);
  const plan = parseAskPlan(raw);
  const rows = await runAskQuery(plan.sql);
  return {
    question: q,
    title: plan.title,
    sql: plan.sql,
    rows,
    summary: summarizeAskRows(rows, plan.title),
  };
}

/** Heuristic: treat Cmd-K input as a books question vs a voucher draft. */
export function looksLikeBooksQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.includes("?")) return true;
  if (
    /^(who|what|how|when|which|where|does|is|are|can|show|list|total|sum|count|balance)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return /\b(owe|owing|receivable|payable|balance|gst|gstr|stock on hand|how much|profit|sales this|purchases this)\b/.test(
    t,
  );
}
