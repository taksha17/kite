# Getting started with Kite

## Clone and run

```bash
git clone https://github.com/taksha17/kite.git
cd kite
npm install
npm run kite:dev      # or: npm run tauri dev
```

## First company

1. Open **Companies**
2. Enter a business name (GSTIN optional)
3. Click **Create & open**
4. Add a party under **Ledgers**, then post a **Sales** or **Payment** voucher
5. On **Companies**, use **Backup** to save the SQLite file anywhere you like

## Migrate from Tally / Excel

**Live (recommended when Tally is on the same PC):** open TallyPrime + Kite Solo →
[Migrate from Tally](./tally-migrate.md) (HTTP port 9000).

**Files:** use **Data import** for Excel/CSV masters (including Tally exports) —
[data-import.md](./data-import.md).

## AI-first (optional, ~2 minutes)

Turn on AI under **Companies → AI quick entry** with a free OpenRouter key, then
draft vouchers by sentence or bill photo. Step-by-step:
[docs/ai-first.md](./ai-first.md).

## Low-disk Ubuntu tip

If `/` is nearly full, always:

```bash
source scripts/env.sh
npm run kite:dev
# or
npm run kite:build
```

That keeps Cargo/npm/tmp under `.cache/` on the project drive.

Tauri stores SQLite files in the OS app data directory:

- Linux: `~/.local/share/org.kitebooks.kite/`
- macOS: `~/Library/Application Support/org.kitebooks.kite/`
- Windows: `%APPDATA%\\org.kitebooks.kite\\`

Files:

- `kite-registry.db` — list of companies
- `kite-company-*.db` — each company’s books

Copy those files to back up or move a company.

## Build installers

```bash
npm run kite:build    # or: npm run tauri build
```

With the volume-aware script, bundles land under
`.cache/cargo-target/release/bundle/` (otherwise `src-tauri/target/release/bundle/`).
Don't commit installers — attach them to a GitHub Release instead.
