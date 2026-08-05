# Deploying Kite Team

Kite Team is the multi-user build: one `kite-server` process serves the API
**and** the web app (PWA). Users connect from a browser on Windows, macOS,
Linux — or install it on Android from Chrome ("Add to home screen").

Data layout: one directory holds everything —

```
<data-dir>/
  kite-registry.db        # company index
  jwt_secret.hex          # session signing key (auto-generated)
  kite-company-*.db       # one SQLite file per company
```

Back up that directory and you have backed up everything.

## 1. Build

```bash
# web app
npm ci
npm run build              # outputs dist/

# server (Linux x86_64)
cd kite-server
cargo build --release      # outputs target/release/kite-server
```

## 2. Run

```bash
kite-server serve \
  --data-dir /var/lib/kite \
  --web-dir  /opt/kite/dist \
  --host 127.0.0.1 \
  --port 8080
```

Create the first company from the UI (open the site → "Create a company") or
headless:

```bash
kite-server create-company \
  --data-dir /var/lib/kite \
  --name "Madhur Traders" --owner admin --password 'change-me-now' \
  --state-code 29 --gstin 29AABCM1234F1Z5
```

## 3. systemd

`/etc/systemd/system/kite-server.service`:

```ini
[Unit]
Description=Kite Team server
After=network.target

[Service]
Type=simple
User=kite
ExecStart=/opt/kite/kite-server serve --data-dir /var/lib/kite --web-dir /opt/kite/dist --host 127.0.0.1 --port 8080
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/kite

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now kite-server
```

## 4. HTTPS (required in practice)

Serve over HTTPS: browsers only offer PWA install on secure origins, and login
tokens shouldn't cross the network in clear text. Caddy is the shortest path:

```
books.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx works too — a plain `proxy_pass http://127.0.0.1:8080;` block with
your certificate of choice. No special WebSocket config needed; the API is
plain request/response.

## 5. Backups

Two independent mechanisms:

- **Owner self-service** — Companies → Backup downloads the company's whole
  SQLite file (owner role only). Restore = hand the file back to the server.
- **Server-side** — snapshot the data directory. SQLite needs a consistent
  checkpoint first; easiest is a quiet-hours job:

```bash
#!/bin/sh
# /etc/cron.daily/kite-backup
DEST=/backup/kite/$(date +%F)
mkdir -p "$DEST"
for db in /var/lib/kite/*.db; do
  sqlite3 "$db" ".backup '$DEST/$(basename "$db")'"
done
cp /var/lib/kite/jwt_secret.hex "$DEST"/
```

(`.backup` is online-safe — no need to stop the server.)

## 6. Updating

1. Build the new web app and server binary.
2. `systemctl restart kite-server`.
3. Company databases migrate themselves on first open (the server applies the
   same DDL the desktop app does), so no separate migration step is needed.
