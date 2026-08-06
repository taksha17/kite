# Deploying Kite Enterprise (Server Edition)

Kite Enterprise is the multi-user build for an office: **one parent PC** runs
`kite-server` (API + web UI); **child PCs** open a browser. Parent and child
operating systems can differ (Windows Server + Ubuntu browsers, or the reverse).

Do **not** put the data directory on a shared network drive and open Solo on
every PC against those files — SQLite over SMB/NFS risks corruption. Share
access via the **server URL on the LAN**, not via file sharing.

Data layout (always on the parent’s **local** disk):

```
<data-dir>/
  kite-registry.db        # company index
  jwt_secret.hex          # session signing key (auto-generated)
  kite-company-*.db       # one SQLite file per company
```

Back up that directory and you have backed up everything.

## 1. Download (recommended)

Grab the latest Enterprise package from
[Releases](https://github.com/taksha17/kite/releases/latest):

| Parent OS | Package |
| --- | --- |
| Windows (64-bit) | [kite-enterprise-windows-x64.zip](https://github.com/taksha17/kite/releases/latest/download/kite-enterprise-windows-x64.zip) |
| Linux (x64) | [kite-enterprise-linux-x64.tar.gz](https://github.com/taksha17/kite/releases/latest/download/kite-enterprise-linux-x64.tar.gz) |

### Windows parent

1. Unzip on the office PC.
2. Run `start.bat`.
3. On the parent: open http://localhost:8080 → create a company and users.
4. On child PCs (any OS): open `http://PARENT-LAN-IP:8080`. Allow port 8080 in
   Windows Firewall if other machines cannot connect.

### Linux parent

```bash
tar -xzf kite-enterprise-linux-x64.tar.gz
cd kite-enterprise
mkdir -p kite-data
./kite-server serve --data-dir ./kite-data --web-dir ./dist --host 0.0.0.0 --port 8080
```

Children open `http://PARENT-LAN-IP:8080` in any modern browser.

## 2. Build from source (optional)

```bash
# web app
npm ci
npm run build              # outputs dist/

# server
cd kite-server
cargo build --release      # target/release/kite-server
```

Package locally:

```bash
bash scripts/package-enterprise.sh --os linux --bin kite-server/target/release/kite-server
```

## 3. Run (manual)

```bash
kite-server serve \
  --data-dir /var/lib/kite \
  --web-dir  /opt/kite/dist \
  --host 0.0.0.0 \
  --port 8080
```

Create the first company from the UI or headless:

```bash
kite-server create-company \
  --data-dir /var/lib/kite \
  --name "Madhur Traders" --owner admin --password 'change-me-now' \
  --state-code 29 --gstin 29AABCM1234F1Z5
```

## 4. systemd

Use the unit shipped in the Linux archive (`systemd/kite-server.service`), or:

`/etc/systemd/system/kite-server.service`:

```ini
[Unit]
Description=Kite Enterprise server
After=network.target

[Service]
Type=simple
User=kite
ExecStart=/opt/kite/kite-server serve --data-dir /var/lib/kite --web-dir /opt/kite/dist --host 0.0.0.0 --port 8080
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

## 5. HTTPS (required when exposing beyond a trusted LAN)

On a plain office LAN, HTTP is often enough for a first setup. For the public
internet or untrusted networks, serve over HTTPS: browsers only offer PWA
install on secure origins, and login tokens should not cross the network in
clear text. Caddy is the shortest path:

```
books.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx works too — a plain `proxy_pass http://127.0.0.1:8080;` block with
your certificate of choice. No special WebSocket config needed; the API is
plain request/response.

## 6. Backups

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

## 7. Updating

1. Download the new Enterprise archive (or rebuild), replace the binary and `dist/`.
2. Restart the server (`systemctl restart kite-server` or stop/start `start.bat`).
3. Company databases migrate themselves on first open (the server applies the
   same DDL the desktop app does), so no separate migration step is needed.
