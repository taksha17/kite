# What’s free / what’s not

Plain language for owners and CAs. Kite is **MIT open source** — that matters
for developers. For day-to-day use, think in terms of **editions** and
**limits**.

## Kite Solo — free for one desk

| | |
|--|--|
| **Cost** | Free to download and use. No annual license just to keep the books open. |
| **Who** | One person / one PC. |
| **Data** | Company files on **your** machine. You back them up. |
| **Includes** | Ledgers, vouchers, GST reports, inventory, bank import, Excel/Tally migrate, optional AI (your key), e-way / e-invoice via NIC when you configure it. |

### Solo limitations (honest)

- **Not multi-user on a shared file.** Two people must not open the same `.db`
  over a network share. For a team, use **Enterprise**.
- **No Kite phone support desk.** Docs + GitHub issues; you (or an IT/CA
  helper) handle install and backup.
- **Installers are unsigned** — Windows/macOS may warn; download only from
  [GitHub Releases](https://github.com/taksha17/kite/releases).
- **AI is optional and BYOK** — you bring an OpenRouter / OpenAI / etc. key.
  Draft-only; nothing posts without you.
- **Migration** needs Tally open (HTTP) or Excel export — we don’t read raw
  `.900` folders.
- **You own backup risk** — use **Companies → Backup** regularly.
  Guide: [backup-restore.md](./backup-restore.md).

## Kite Enterprise — free software, you run the parent PC

| | |
|--|--|
| **Cost** | Same MIT license; no Kite subscription. You provide the parent PC / server. |
| **Who** | Office: one parent runs `kite-server`; staff use browsers on the LAN. |
| **Data** | All books on the **parent** under `--data-dir`. |

### Enterprise limitations

- You operate the server (updates, backups, LAN/HTTPS).
- Default LAN HTTP is convenient, not a hardened public SaaS.
- Roles help; they are not a substitute for physical access control to the DB.

Setup: [deployment.md](./deployment.md).

## Quick chooser

| Situation | Use |
|-----------|-----|
| Only I enter books on one PC | **Solo** |
| Owner + staff need the same books | **Enterprise** |
| Phone-only / try in browser | PWA / browser mode (+ optional Drive backup) |
| “Is there a free forever cloud by Kite?” | **No** — we don’t host your books |

## One sentence you can send on WhatsApp

**Kite Solo is free for one business on your own computer. Your data stays on
your PC — you back it up. Team access needs Enterprise on a parent PC. AI and
e-invoice need your own keys/credentials when you turn them on.**

## Related

- [Backup & restore](./backup-restore.md)
- [AI-first setup](./ai-first.md)
- [Caveats in README](../README.md#caveats-guardrails--security)
