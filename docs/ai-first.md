# AI-first Kite — try it in ~2 minutes

Kite is **AI-first accounting**: the prompt *is* the voucher screen. The model
can only **draft**. You always review and press Accept. Nothing auto-posts.

## What you get

| Capability | What happens |
| --- | --- |
| **Quick entry** | Type or dictate English / Hinglish → voucher form pre-filled |
| **Bill capture** | Photo / image of a purchase bill → draft purchase (vision models) |
| **Cmd/Ctrl-K** | Draft a voucher or jump anywhere from the palette |
| **Ask my books** | Question → read-only SQL on your company DB → answer + table |
| **String agent** | Named BYOK agent + Dictate; ask / draft / setup / reminders — you Accept — [string-agent.md](./string-agent.md) |
| **Insights / follow-up** | Home cards, open AR, reminder drafts, period close, anomalies |

## 1. Get a free OpenRouter key (no card)

1. Create an account at [openrouter.ai](https://openrouter.ai/).
2. Create an API key.
3. In Kite: **Companies → AI quick entry**
   - Provider: **OpenRouter — free models**
   - Model: leave blank (defaults to `openrouter/free`) or pick a free model
   - Paste the API key → **Save** → optional **Test**

OpenRouter’s free roster rotates; if one model is busy, try another free id from
the suggestions list, or keep `openrouter/free` (auto-router).

Other providers (OpenAI, Anthropic, Gemini) work the same way — bring your own key.

## 2. Draft your first voucher

1. Open **Vouchers → New** (or press **Cmd/Ctrl-K** and type a sentence).
2. Example: `Sold 2 Wireless Mouse to Agarwal Electronics at 799 on UPI`
3. Review party, qty, rate, GST / HSN.
4. Press **Accept voucher** only when it looks right.

Hinglish works too, e.g. `Agarwal ko 2 mouse becha 799 mein UPI se`.

## 3. Ask your books

Open **Ask my books** (or Cmd-K → Ask) and try:

- `How much does Agarwal owe me?`
- `GST collected this month`
- `Which items are low on stock?`

Answers use **read-only** queries on your SQLite company file. Still verify before
you act on the numbers.

## Guardrails (read once)

- **Draft-only** — AI never posts vouchers or sends customer messages for you.
- **Your key, your provider** — prompts and relevant book context leave the
  machine when AI is on. Turn AI **Off** under Companies if that is not OK.
- **Not a CA** — always check GST rates, place of supply, and HSN before filing.
- **Free models** can rate-limit or hallucinate — review every draft.

Full list: [README — Caveats, guardrails & security](../README.md#caveats-guardrails--security).

## Solo vs Enterprise

| | Where the key lives | Who talks to the provider |
| --- | --- | --- |
| **Solo** | Company settings on that PC | Desktop app |
| **Enterprise** | Company settings on the parent server | `kite-server` (key stays server-side) |

Staff browsers on Enterprise never need the API key in the client.

## Next

- Product demos: [landing page](https://kite-v2-ten.vercel.app/#demo)
- Office setup: [deployment.md](./deployment.md)
- Phone-only (no AI server): [google-drive.md](./google-drive.md)
