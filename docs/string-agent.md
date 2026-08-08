# String — BYOK agent

**String** is Kite’s named agent for companies that have an AI API key under
**Companies → AI quick entry**.

## What it does

- **Chat or Dictate** (push-to-talk Web Speech when available)
- Picks a tool and runs it:
  - **Ask books** — read-only answers from your SQLite (same guardrails as Ask)
  - **Draft voucher** — opens the voucher editor with a draft (`Accept` to post)
  - **Propose setup** — opens AI onboarding (you **Apply** ledgers/items/GST)
  - **Draft reminder** — payment reminder text (you copy / send)
  - **Help / chat** — capabilities and greetings

## What it never does

- Auto-post vouchers
- Silently create masters or change GST
- Send email / WhatsApp / NIC e-way / e-invoice
- Free-form SQL writes

## Use it

1. Open a company and set AI key.
2. Sidebar **String** (or Cmd/Ctrl-K → “String agent”).
3. Type or tap **Dictate** → **Send**.
4. Use the action button (Open draft / Open setup / …) and review.

## Related

- [AI-first setup](./ai-first.md)
- [What’s free](./whats-free.md)
