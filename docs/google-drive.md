# Phone-only mode: PWA + Google Drive backup

Kite can run **entirely on a phone** — no PC, no server. The accounting
engine (SQLite compiled to WebAssembly) runs inside the browser, data lives
in the phone's local storage, and snapshots back up to a hidden folder in
the owner's own Google Drive.

This is the fourth way to run Kite:

| Mode | Where data lives | Who it's for |
| --- | --- | --- |
| Desktop (Tauri) | Local SQLite files | Owner with a PC/laptop |
| Kite Enterprise | Self-hosted server (parent PC) | Office sharing one set of books |
| Kite Enterprise + Tailscale | Same, reachable anywhere | Private access on the go |
| **Phone-only (this doc)** | **Phone browser + Google Drive** | **Owner whose phone is the billing device** |

## How it works

- The web app detects there is no kite-server on its origin and switches to
  **browser-local mode** automatically.
- Companies are stored in the browser (IndexedDB) as real SQLite databases
  via [sql.js](https://sql.js.org/) — the same schema, seeds, and reports as
  the desktop app.
- **Sign in with Google** on the Companies page. Snapshots upload to the
  hidden `appDataFolder` in the user's Drive (invisible in their file list,
  safe from accidental edits; tiny — usually a few MB of their free 15 GB).
- Drive keeps **previous revisions ~30 days**, so every upload is also a
  version history.
- **New phone?** Open the app, sign in with Google, tap **Restore** — the
  latest snapshot downloads and the company reappears.
- Auto-backup runs 60 seconds after edits settle; manual **Back up** any
  time.

## The one-device rule

Drive syncs files, not database transactions. If two devices edit the same
company at the same time, one side's changes would be lost — so Kite treats
the Drive snapshot as belonging to whichever device wrote it last:

- Editing continues on one device at a time.
- If a backup was written by a *different* device and is newer than this
  device's last backup, Kite refuses to overwrite it silently and asks:
  **overwrite** (this device wins) or **restore** (Drive copy wins).
- Offices that need simultaneous multi-user should use Kite Enterprise instead.

## Enabling Google sign-in (deployment)

The Drive panel appears only when a Google OAuth client ID was baked into
the build.

1. Google Cloud Console → create a project → **APIs & Services → OAuth
   consent screen**: External, app name "Kite", your contact email. Add the
   scope `https://www.googleapis.com/auth/drive.appdata` (plus the default
   openid/email/profile).
2. **Credentials → Create OAuth client ID → Web application**. Authorized
   JavaScript origins: your app origin (e.g. `https://your-app.vercel.app`)
   and `http://localhost:1420` for dev.
3. Build/deploy with the client ID:

   ```bash
   VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com npm run build
   ```

   On Vercel: Project → Settings → Environment Variables →
   `VITE_GOOGLE_CLIENT_ID`, then redeploy.

4. While the consent screen is in **Testing** mode, up to 100 Google
   accounts can sign in — plenty for a beta. For general availability,
   submit Google's OAuth verification (the Drive scope is a restricted
   scope and may need a security review at scale).

## Security notes

- Access tokens live only in memory (~1 hour); nothing is stored server-side
  because there is no server.
- The app can only see its own hidden folder — it cannot read the user's
  Drive files.
- Snapshots are plain SQLite files; anyone with the Google account has the
  data, which is the point (the owner owns their books). Company logins
  inside Kite still apply per device.
