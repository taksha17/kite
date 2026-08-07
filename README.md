# Kite

[![CI](https://github.com/taksha17/kite/actions/workflows/ci.yml/badge.svg)](https://github.com/taksha17/kite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Forks](https://img.shields.io/github/forks/taksha17/kite?style=social)](https://github.com/taksha17/kite/fork)

**Books that stay light.** · **Version 2.0 — AI-first**

Kite is an **AI-first**, MIT-licensed accounting app for Indian small and mid-size
businesses: describe a sale (English or Hinglish) or snap a purchase bill — Kite
**drafts** the voucher; **you** approve. Nothing auto-posts. Books stay in files
you own (Solo desktop or self-hosted Enterprise).

- **AI-first** — prompt-as-entry, bill capture, Ask my books, insights & follow-up drafts — [docs/ai-first.md](./docs/ai-first.md)
- **Platform independent** — Windows, macOS, and Linux from one Tauri codebase
- **Lightweight** — local SQLite companies; no forced Kite cloud
- **India-first** — INR, Apr–Mar FY, GST / e-way / e-invoice
- **Forkable** — clone from Git, invent your own product on top

**Landing page (AI-first story + downloads + demos):**
[kite-v2-ten.vercel.app](https://kite-4jy6.vercel.app/)

**Try AI in ~2 minutes:** [docs/ai-first.md](./docs/ai-first.md) (free OpenRouter key, no card)

This is an **original** product. It is not affiliated with Tally or any
proprietary accounting suite.

## Which product do I need?

| Product | Who it's for | How you use it |
| --- | --- | --- |
| **Kite Solo** | One person / one desk | Desktop installers (Windows / macOS / Linux). Books stay in local SQLite files. |
| **Kite Enterprise** (Server Edition) | Office with shared books (1 parent PC + staff) | Parent runs `kite-server`; everyone else opens a **browser** to that PC on the LAN. Parent and child OS can differ. |
| **Phone-only** | Owner whose phone is the billing device | Browser PWA + optional Google Drive snapshots — [docs/google-drive.md](./docs/google-drive.md) |

Do **not** put Solo’s company `.db` files on a Windows/NAS shared drive and open them from multiple PCs. That can corrupt SQLite. For shared books, use **Enterprise** (HTTP to the parent), not a file share.

## Demo videos

| Tour | Watch / download |
| --- | --- |
| **Desktop (PC)** — company → sale → GST invoice → reports → roles | [kite-desktop-walkthrough.webm](https://github.com/taksha17/kite/releases/latest/download/kite-desktop-walkthrough.webm) |
| **Mobile screen** — same flow on a phone-sized viewport | [kite-mobile-walkthrough.webm](https://github.com/taksha17/kite/releases/latest/download/kite-mobile-walkthrough.webm) |

Also embedded on the [landing page](https://kite-v2-ten.vercel.app/#demo). Regenerate locally:

```bash
npm run build
# kite-server release binary available (see scripts/demo-walkthrough.mjs)
npm run kite:demo          # desktop
npm run kite:demo:mobile   # mobile
# or: npm run kite:demo:all
```

## Screenshots

| Voucher entry | GST tax invoice | Reports & GSTR-1 |
| --- | --- | --- |
| ![Voucher entry](docs/images/screenshot-voucher.png) | ![GST tax invoice](docs/images/screenshot-invoice.png) | ![Reports](docs/images/screenshot-reports.png) |

## Download

Grab the latest build from
[**Releases**](https://github.com/taksha17/kite/releases/latest):

### Solo (desktop)

| Platform | Installer |
| --- | --- |
| Windows 10/11 (64-bit) | [kite-windows-x64-setup.exe](https://github.com/taksha17/kite/releases/latest/download/kite-windows-x64-setup.exe) |
| macOS (Apple Silicon) | [kite-macos-arm64.dmg](https://github.com/taksha17/kite/releases/latest/download/kite-macos-arm64.dmg) |
| macOS (Intel) | [kite-macos-x64.dmg](https://github.com/taksha17/kite/releases/latest/download/kite-macos-x64.dmg) |
| Linux (Ubuntu/Debian) | [kite-linux-x64.deb](https://github.com/taksha17/kite/releases/latest/download/kite-linux-x64.deb) |

### Enterprise (parent / office PC)

| Parent OS | Package |
| --- | --- |
| Windows (64-bit) | [kite-enterprise-windows-x64.zip](https://github.com/taksha17/kite/releases/latest/download/kite-enterprise-windows-x64.zip) |
| Linux (x64) | [kite-enterprise-linux-x64.tar.gz](https://github.com/taksha17/kite/releases/latest/download/kite-enterprise-linux-x64.tar.gz) |

Staff phones / tablets: open the Enterprise URL in the browser → “Add to Home Screen” (PWA). Setup guide: [docs/deployment.md](./docs/deployment.md).

Builds are **unsigned** for now (see caveats below).

## Features

### AI-first (v2.0)

- **Quick entry:** describe a sale in English or Hinglish — or snap a purchase bill — AI drafts the voucher; **you** Accept ([docs/ai-first.md](./docs/ai-first.md))
- **Cmd/Ctrl-K:** draft or jump from anywhere
- **Ask my books:** natural-language → read-only SQL on your company DB
- **Home insights, open AR (FIFO), follow-up drafts, period close, anomaly watch**
- **BYOK:** OpenRouter free models (no card), plus OpenAI / Anthropic / Gemini — draft-only, never auto-post

### Books & India GST

- Create and open companies (one SQLite file per company)
- Default Indian chart of groups + common ledgers
- Ledgers and parties (state + GSTIN)
- Vouchers: Payment, Receipt, Contra, Journal, Sales, Purchase
- **GST:** company GST on/off, intra vs inter-state CGST/SGST/IGST, HSN/SAC, GSTR-1 & GSTR-3B style summaries, **Excel (.xlsx) export**
- **Inventory:** units, godowns, stock items, sales/purchase stock lines, stock journal, stock summary
- **Multi-user:** per-company logins, Owner / Accountant / Data Entry roles, voucher audit log
- **Kite Enterprise:** parent PC server + browser clients on the LAN — [docs/deployment.md](./docs/deployment.md)
- **Phone-only mode:** sql.js in the browser + optional Google Drive backups — [docs/google-drive.md](./docs/google-drive.md)
- **PDF invoices:** preview + download for Sales; email via your own SMTP
- **e-Way bills:** NIC generation from the invoice (sandbox/production)
- **e-Invoicing (IRN):** IRN + signed QR on PDF; cancel-IRN; free direct NIC API (no GSP fees)
- **Bank statement import:** CSV/Excel (HDFC/SBI/ICICI/Axis/Kotak layouts), learned rules, open-invoice matching, AI ledger suggestions
- **Data import (migrate):** Excel/CSV ledgers, parties, and stock with opening balances — Tally-friendly column detect + templates — [docs/data-import.md](./docs/data-import.md)
- **Open AR (FIFO):** receipts clear oldest unpaid sales first
- Reports: Day Book, Ledger, Trial Balance, Profit & Loss, Balance Sheet
- Balanced double-entry before save; posted vouchers editable until IRN/e-way locks them

## Caveats, guardrails & security

Read this before putting real company data on a shared network.

### Installers & trust

- **Unsigned binaries.** Windows SmartScreen / macOS Gatekeeper will warn. Use **More info → Run anyway** (Windows) or **right-click → Open** (macOS). Prefer downloading only from [official Releases](https://github.com/taksha17/kite/releases).
- **No auto-update channel.** You choose when to install a newer release.

### Data ownership & backups

- **You own the files.** Solo: company DBs under the OS app-data folder. Enterprise: everything under the parent’s `--data-dir` (`kite-registry.db`, `jwt_secret.hex`, `kite-company-*.db`).
- **Back up deliberately.** Copy the data directory or use Companies → Backup (owner). Losing the only copy loses the books.
- **Never put the live data directory on a multi-writer network share** for Solo. Concurrent SQLite over SMB/NFS is unsafe. Use Enterprise for shared access.

### Kite Enterprise (LAN / server)

- **Parent holds the only writers.** Children are browsers talking HTTP(S) to the parent — not file sharing.
- **HTTP on a trusted LAN is convenient but not encrypted.** Session JWTs travel in clear text. For untrusted networks or the public internet, put **HTTPS** in front (Caddy/nginx) — see [docs/deployment.md](./docs/deployment.md).
- **Open the firewall only as needed** (default port `8080`). Prefer binding carefully if the parent is exposed beyond the office LAN.
- **JWT secret** is auto-generated in the data dir (`jwt_secret.hex`). Back it up with the data; treat it like a credential.
- **Passwords** are stored as PBKDF2 hashes (not plaintext). Use strong owner/user passwords in production — demo passwords in walkthrough videos are not for real books.
- **Roles are a guardrail, not a security boundary against a malicious local admin.** An Owner (or anyone with the DB files) can read everything.

### AI (optional)

- **Off until you configure a provider/key.** Kite does not require AI to keep books.
- **Draft-only:** the model proposes vouchers / answers; **you** must review and accept. Nothing auto-posts from the LLM.
- **Ask my books** runs **read-only** SQL generated by the model; still review results before acting.
- **Bring your own key.** When AI is on, prompts and relevant book context are sent to **your chosen provider** (OpenRouter / OpenAI / Anthropic / Gemini). That leaves your machine. Do not enable AI if that is unacceptable for your data policy.
- **Keys:** stored in company settings (Solo: local; Enterprise: server-side). Protect backups of the company DB.
- **Free-tier models** can rate-limit, hallucinate, or change quality — always verify GST amounts, parties, and HSN before posting.

### Government & third-party integrations

- **e-Way / e-Invoice:** credentials live in the company database. Use **sandbox** until you are sure. Wrong environment or keys can fail against NIC or create real IRNs.
- **SMTP email:** credentials you enter are used to send invoice mail; they sit in settings/DB with the rest of the company data.
- **Google Drive (phone-only):** last-writer-wins snapshots — **not** simultaneous multi-user. Drive access is to the owner’s own account; configure OAuth client IDs carefully ([docs/google-drive.md](./docs/google-drive.md)).

### Application guardrails

- **Double-entry must balance** before a voucher saves.
- **IRN / e-way** can lock invoice edits while active.
- **Receivables follow-up** drafts WhatsApp/email text — **you** send; Kite does not spam customers by itself.
- **No phone-home telemetry** from the core app. Network use is what you enable (AI providers, NIC, SMTP, Drive, Enterprise HTTP).

### What Kite is not

- Not a substitute for a CA’s advice on GST filings.
- Not a hosted SaaS with Kite-operated cloud (unless **you** host Enterprise).
- Not affiliated with Tally or proprietary “Tally-compatible” suites.

## Quick start (developers)

### Prerequisites

- Node.js 20+
- Rust (via [rustup](https://rustup.rs/))
- Tauri [OS prerequisites](https://v2.tauri.app/start/prerequisites/)

### Develop

```bash
git clone https://github.com/taksha17/kite.git
cd kite
npm install
npm run kite:dev      # preferred (uses scripts/env.sh)
```

### Tests

```bash
npm test                          # frontend unit tests (vitest)
npm run kite:server:test          # server API + auth tests (cargo)
```

### Kite Enterprise from source

```bash
npm run build
cd kite-server && cargo build --release
./target/release/kite-server serve --data-dir ./kite-data --web-dir ../dist --host 0.0.0.0 --port 8080
```

Prebuilt archives and office LAN setup: [docs/deployment.md](./docs/deployment.md).

### Production Solo builds

```bash
npm run kite:build
```

Artifacts land under `.cache/cargo-target/release/` (and `bundle/`).

## Project layout

```
src/                   React UI + TypeScript accounting engine
src/lib/accounting/    Pure posting / report math (unit tested)
src/lib/db/            SQLite schema + company I/O (local and remote)
src/lib/server/        Kite Enterprise client (HTTP data layer)
src/lib/gdrive/        Phone-only mode: Google sign-in + Drive snapshots
src/lib/ai/            AI quick entry (prompt, strict parse, providers)
src/lib/ewaybill/      NIC e-way bill client
src/lib/einvoice/      IRP e-invoice client (IRN + signed QR)
src-tauri/             Tauri Solo shell (Rust)
kite-server/           Kite Enterprise server (Rust, axum + sqlx)
scripts/               Dev / build / server / demo walkthroughs
site/                  Marketing landing (Vercel)
docs/                  Getting started, AI-first, deployment, Drive
demo/                  Generated walkthrough videos
site/                  Marketing landing (Vercel) — AI-first story
```

## Roadmap

1. **Done** — core books, GST invoices & Excel reports, inventory, roles & audit
2. **Done** — PDF invoices + email, e-way bills, Kite Enterprise server + PWA
3. **Done** — AI quick entry (BYOK, draft-only) on Solo and Enterprise
4. **Done** — phone-only PWA with Google Drive backup
5. **Done** — e-invoicing (IRN + signed QR) via free direct IRP API
6. **Done** — AI-first phases A–D (entry, documents, ask/insights, follow-up / close / anomalies)
7. **Done** — Enterprise Server Edition packages (Linux + Windows)
8. **Done** — AI-first public positioning (landing, docs/ai-first.md)
9. **Done** — Data import for masters / openings (Excel/CSV, Tally-friendly)

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Like Kite? **Star the repo.** Building your own thing on top?
[**Fork it**](https://github.com/taksha17/kite/fork) — that's what the MIT license is for.

## License

[MIT](./LICENSE)

## Data & privacy (short)

Your company databases live on **your** machine (or your Enterprise parent). You own
the files. Back them up. Optional AI and government APIs only run when you
configure them — see **Caveats, guardrails & security** above.
