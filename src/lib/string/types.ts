/** String — named BYOK agent (voice + tools, review-before-write). */

export type StringToolName =
  | "ask_books"
  | "draft_voucher"
  | "propose_setup"
  | "draft_reminder"
  | "help"
  | "chat";

export interface StringToolCall {
  tool: StringToolName;
  /** Free-form args from the model (validated per tool). */
  args: Record<string, unknown>;
  /** Short spoken/chat acknowledgement. */
  reply: string;
}

export type StringActionKind =
  | "none"
  | "open_ask"
  | "open_draft"
  | "open_setup"
  | "open_follow_up"
  | "open_companies_ai";

export interface StringAction {
  kind: StringActionKind;
  label: string;
  href: string;
}

export interface StringTurnResult {
  reply: string;
  tool: StringToolName;
  /** Extra detail (SQL title, reminder body, etc.). */
  detail?: string;
  action?: StringAction;
  /** Ask-books table rows (capped). */
  rows?: Record<string, unknown>[];
}

export interface StringMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  detail?: string;
  action?: StringAction;
  rows?: Record<string, unknown>[];
  at: number;
}
