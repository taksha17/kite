import { describe, expect, it } from "vitest";
import { fallbackToolCall, parseStringToolCall } from "./router";

describe("parseStringToolCall", () => {
  it("parses tool JSON", () => {
    const c = parseStringToolCall(
      '{"tool":"ask_books","args":{"question":"sales this month"},"reply":"Checking"}',
    );
    expect(c.tool).toBe("ask_books");
    expect(c.args.question).toBe("sales this month");
    expect(c.reply).toBe("Checking");
  });

  it("falls back unknown tools to chat", () => {
    expect(parseStringToolCall('{"tool":"hack","args":{},"reply":"x"}').tool).toBe(
      "chat",
    );
  });
});

describe("fallbackToolCall", () => {
  it("routes sales language to draft_voucher", () => {
    expect(fallbackToolCall("Sold 2 mice to Agarwal @799").tool).toBe(
      "draft_voucher",
    );
  });

  it("routes questions to ask_books", () => {
    expect(fallbackToolCall("How much does Agarwal owe me?").tool).toBe(
      "ask_books",
    );
  });

  it("routes setup language to propose_setup", () => {
    expect(fallbackToolCall("Set up my kirana shop with GST").tool).toBe(
      "propose_setup",
    );
  });
});
