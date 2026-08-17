---
description: Kite accounting app — India-first open-source books (Tauri 2 + React + Rust)
mode: primary
steps: 50
permission:
  bash: allow
  edit:
    "src/**": allow
    "src-tauri/**": allow
    "kite-server/**": allow
    "scripts/**": allow
    "docs/**": allow
    "*": ask
  read: allow
  glob: allow
  grep: allow
  task: allow
  todowrite: allow
---
# Kite Accounting App Agent

You are Kilo, working on the **Kite** codebase — an MIT-licensed, India-first open-source accounting app for small businesses.

## Architecture

- **Frontend**: React 19 + TypeScript + Vite 7, react-router-dom v7
- **Desktop shell**: Tauri 2 (Rust) for Windows, macOS, Linux
- **Enterprise server**: Kite Enterprise — separate Rust (Axum) server for multi-user browser/PWA mode
- **Database**: SQLite via `@tauri-apps/plugin-sql` (desktop) or `sql.js` (browser PWA)
- **Runtime modes**: `tauri` (desktop local SQLite), `remote` (browser + kite-server), `browser` (serverless PWA + IndexedDB)

## Key Directories

| Path | Purpose |
|---|---|
| `src/` | React frontend (pages, components, lib, state, styles) |
| `src-tauri/` | Tauri Rust backend (lib.rs, einvoice.rs, ewaybill.rs) |
| `kite-server/` | Kite Enterprise Axum server |
| `scripts/` | Dev/build/server scripts |
| `docs/` | Getting started, migration, AI, deployment guides |
| `demo/` | Demo videos and mock data |

## Frontend Structure

- `src/App.tsx` — Route definitions (18 pages)
- `src/state/AppContext.tsx` — Global state: companies, auth, permissions
- `src/components/Layout.tsx` — Shell with sidebar navigation
- `src/components/CommandPalette.tsx` — Cmd+K universal command palette
- `src/pages/` — 18 page components
- `src/lib/` — 15 domain modules:
  - `accounting/` — engine, GST, reports, period close, anomalies, seed data
  - `ai/` — prompts, parsing, bill capture, speech, provider routing
  - `ar/` — accounts receivable, open invoices, follow-up
  - `auth/` — permissions, crypto, auth flows
  - `bankimport/` — CSV/Excel parsing, AI matching, rules
  - `dataimport/` — Excel/CSV master import, mapping, templates
  - `db/` — client, schema, types, users, inventory, backup, AI settings, e-invoice/e-way credentials
  - `einvoice/` — IRP payload building, client
  - `ewaybill/` — payload building, client
  - `gdrive/` — Google Drive auth, backup, autosync
  - `integrations/` — Shopify, WooCommerce sync
  - `inventory/` — stock calculations
  - `invoice/` — PDF, QR, email, amount-in-words, data fetching
  - `server/` — remote mode HTTP client (routes to kite-server or direct)
  - `tally/` — Tally Prime XML client

## Rust Backend (`src-tauri/src/lib.rs`)

Tauri commands:
- `app_data_dir` — OS app data path
- `send_invoice_email` — SMTP via `lettre`
- `http_request` — Async HTTP proxy (for AI providers, long-running calls)
- `nic_eway_auth` / `nic_eway_generate` — NIC e-way bill API
- `nic_einv_auth` / `nic_einv_generate` / `nic_einv_cancel` — NIC e-invoice API

Dependencies: `tauri` 2, `tauri-plugin-sql` (sqlite), `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `lettre`, `reqwest`, `rsa`, `aes`, `ecb`, `base64`

## Kite Enterprise Server (`kite-server/`)

Axum server with routes:
- `GET/POST /api/companies` — list/create
- `GET /api/companies/{id}` — info
- `POST /api/companies/{id}/login` — JWT auth
- `POST /api/companies/{id}/gst` — GST settings
- `GET /api/companies/{id}/backup` — download SQLite
- `POST /api/company/query` — read-only SQL
- `POST /api/company/execute` — write SQL
- `POST /api/company/ai/chat` — AI proxy (holds API keys server-side)

## Database Schema

**Registry** (`kite-registry.db`):
- `companies` (id, name, slug, fy_start, currency, state_code, gstin, gst_enabled, db_file, created_at)

**Company DB** (`kite-company-*.db`):
- `meta` — key/value settings
- `account_group` — chart of accounts hierarchy
- `ledger` — accounts and parties (with GSTIN, state, contact, notes)
- `voucher_type` — sales, purchase, payment, receipt, contra, journal, stock_journal
- `voucher` — 28+ columns including GST, e-way bill, e-invoice (IRN) fields, freight, round-off, external provenance
- `voucher_line` — double-entry lines
- `unit`, `godown`, `stock_item`, `stock_movement` — inventory
- `app_user`, `audit_log` — authentication and audit trail
- `integration_sync_log` — external integration tracking

Schema migrations handled via `COMPANY_COLUMN_MIGRATIONS` / `REGISTRY_COLUMN_MIGRATIONS` for backward compatibility.

## Core Features

1. **Companies** — create/open/switch, GST settings, backup (local file, Google Drive, remote download)
2. **Ledgers** — chart of accounts, sundry debtors/creditors with GSTIN/state/contact
3. **Vouchers** — full double-entry (sales, purchase, payment, receipt, contra, journal, stock journal) with GST breakdown, stock movements, and external provenance
4. **GST** — CGST/SGST/IGST calculation, GSTR-1 and GSTR-3B reports, Excel export
5. **Inventory** — stock items, godowns, stock movements, opening balances, low-stock alerts
6. **E-Invoice (IRN)** — NIC IRP API integration via Rust (RSA/AES encryption), generate/cancel IRN, signed QR on PDF
7. **E-Way Bill** — NIC e-way bill API via Rust, generate bills with distance/vehicle/transport
8. **Bank Import** — CSV/Excel bank statement import, AI-assisted matching to invoices
9. **Data Import** — Excel/CSV master data import (ledgers, parties, stock, opening balances)
10. **Tally Migration** — live HTTP pull from Tally Prime (port 9000)
11. **AI Quick Entry** — natural language sentence -> voucher draft, bill photo -> purchase voucher draft (OpenAI, Anthropic, Gemini, OpenRouter)
12. **Ask My Books** — natural language Q&A over books data (safe SELECT-only SQL generation with allowlisted tables)
13. **Follow-up** — receivables aging, payment reminders
14. **Period Close** — month-end checklist
15. **Anomalies** — duplicate/unusual voucher detection
16. **Reports** — trial balance, P&L, balance sheet, day book, ledger statement, stock summary
17. **Integrations** — Shopify, WooCommerce sync
18. **Invoice** — PDF download, print, email with SMTP, QR code, amount in words
19. **Users & Permissions** — Owner / Accountant / Data Entry roles with granular permissions
20. **PWA** — offline-capable with service worker in browser mode

## Permissions

`manage_users`, `manage_company`, `manage_ledgers`, `manage_inventory`, `create_voucher`, `view_reports`, `view_audit`

Role matrix:
- `owner` — all permissions
- `accountant` — manage_company, manage_ledgers, manage_inventory, create_voucher, view_reports, view_audit
- `data_entry` — create_voucher, view_reports

## Coding Conventions

- TypeScript strict mode, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- React functional components with hooks
- All DB access goes through `src/lib/db/client.ts` which transparently routes based on runtime mode
- `getActiveCompanyDb()` returns the current company's Database instance
- Use `useApp()` hook for global state
- Rust commands that call external APIs are `async` to avoid freezing the UI
- Tests use Vitest (`*.test.ts` files alongside source)
- CSS uses plain CSS classes with patterns like `.btn`, `.panel`, `.table`, `.nav-link`, `.stat`, `.muted`

## Runtime Mode Detection

- `isTauriRuntime()` — desktop app (has `__TAURI_INTERNALS__` in window)
- `isRemoteMode()` — browser + kite-server (probes `/api/companies` for JSON)
- `isBrowserMode()` — serverless PWA (sql.js + IndexedDB, localStorage override)

All DB modules transparently route through `src/lib/server/remote.ts` in remote/browser modes. `RemoteCompanyDb` implements the same `{execute, select, close, path}` surface as the Tauri SQLite `Database`.

## Build & Scripts

- Dev: `npm run kite:dev` or `npm run tauri dev`
- Build: `npm run kite:build` (nice/ionice, capped Node heap at 3072MB, 4 cargo jobs)
- Test: `npm run test` (Vitest)
- Server: `npm run kite:server` (kite-server)
- Lint/typecheck: not explicitly configured, but `tsc` runs as part of `npm run build`
- Installers: `npm run kite:build` produces deb, rpm, msi, nsis, dmg, app

## Key Notes

- e-invoice RSA/AES is only available in Tauri runtime (desktop app) — browser mode shows a notice
- AI API keys stored per-company in `meta` table (local) or server-side (remote mode)
- `voucher` table has 28+ columns including e-way bill and e-invoice fields
- Schema uses `COMPANY_COLUMN_MIGRATIONS` for backward compatibility with older company DBs
- `src/lib/ai/askSql.ts` enforces read-only SELECT with allowlisted tables and max 200 rows
- Google Drive backup is browser-mode only with 60s debounced autosync
- Tauri stores SQLite files in OS app data directory (Linux: `~/.local/share/org.kitebooks.kite/`)
