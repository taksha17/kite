# Kite Enterprise (Server Edition)

Shared books for an office: **one parent PC** runs this server; **child PCs**
open a browser. Parent and child OS can differ (Windows parent + Ubuntu
browsers, or the reverse).

## Do not share the data folder

Keep `kite-data/` on the **parent PC’s local disk**. Do not put it on a
Windows/NAS file share and open Solo against it from every machine — SQLite
over network shares risks corruption. Children use the **HTTP URL**, not a
mapped drive.

## Quick start

### Windows

1. Unzip this archive on the parent PC.
2. Double-click `start.bat` (or run `kite-server.exe serve …` from a terminal).
3. On the parent: open http://localhost:8080 → create a company.
4. On child PCs: open `http://PARENT-IP:8080` (same Wi‑Fi/LAN). Allow port
   8080 in Windows Firewall if needed.

### Linux

```bash
tar -xzf kite-enterprise-linux-x64.tar.gz
cd kite-enterprise
mkdir -p kite-data
./kite-server serve --data-dir ./kite-data --web-dir ./dist --host 0.0.0.0 --port 8080
```

Optional systemd unit: copy `systemd/kite-server.service` to
`/etc/systemd/system/`, adjust paths, then `systemctl enable --now kite-server`.

## Data layout

```
kite-data/
  kite-registry.db
  jwt_secret.hex
  kite-company-*.db
```

Back up that directory (or use Companies → Backup as owner). Full production
notes (HTTPS, cron): https://github.com/taksha17/kite/blob/main/docs/deployment.md
