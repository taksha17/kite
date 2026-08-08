# Backup & restore

Your books are **files you own**. Kite does not keep a cloud copy unless **you**
turn on Google Drive (phone/PWA) or host **Enterprise** yourself.

## Solo (desktop) — where files live

| OS | Folder |
|----|--------|
| Linux | `~/.local/share/org.kitebooks.kite/` |
| macOS | `~/Library/Application Support/org.kitebooks.kite/` |
| Windows | `%APPDATA%\org.kitebooks.kite\` |

Typical files:

| File | Purpose |
|------|---------|
| `kite-registry.db` | List of companies on this PC |
| `kite-company-….db` | One company’s ledgers, vouchers, stock |

In the app: **Companies** → **Data & backup** shows the live path (Solo) and a
**Open data folder** button.

### Backup (recommended weekly)

1. Open **Companies**.
2. Click **Backup** next to a company.
3. Save the `.db` somewhere safe (external drive, cloud sync folder you trust).

That copies **one** company file. For a full PC move, also copy
`kite-registry.db` (or recreate companies and restore each `.db` carefully).

### Restore on the same PC

1. **Quit Kite completely.**
2. Replace the matching `kite-company-….db` in the app-data folder with your
   backup (same filename), **or** keep the backup name and only restore after
   you know which registry row points at which file.
3. Start Kite and open the company.

Safer habit: keep dated copies (`acme-2026-08-07.db`) and only overwrite when
you are sure.

### Move to a new PC

1. Install Kite Solo on the new machine; create a throwaway company once if
   needed so the app-data folder exists.
2. Quit Kite.
3. Copy `kite-registry.db` and all `kite-company-*.db` from the old app-data
   folder into the new one (merge carefully — don’t mix two registries blindly).
4. Open Kite; your company list should appear.

If anything looks wrong, restore from an older backup before posting new
vouchers.

## Enterprise (parent PC)

Everything lives under the parent’s `--data-dir` (see
[deployment.md](./deployment.md)): registry, JWT secret, and company DBs.

- **Backup:** stop or quiesce the server, copy the whole data directory.
- **Restore:** stop the server, restore the directory, start again.
- Staff browsers do **not** hold the books — only the parent does.

Do **not** put Solo `.db` files on a shared SMB/NAS and open them from two PCs.
That can corrupt SQLite. Shared access = Enterprise.

## Phone / browser (PWA) mode

- Data is in the browser (IndexedDB), not a visible `.db` on disk.
- Use **Backup** on Companies for a downloadable file, and/or **Google Drive
  backup** when configured — [google-drive.md](./google-drive.md).

## What Backup does *not* do

- It is not continuous cloud sync (except optional Drive autosync in PWA).
- It does not replace a CA’s year-end archive process.
- Restoring an old file **overwrites** later vouchers on that company — treat
  restores as deliberate.

## Related

- [What’s free / what’s not](./whats-free.md)
- [Getting started](./getting-started.md)
- [Enterprise deploy](./deployment.md)
