import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { getAppDataDir } from "../lib/db/backup";
import {
  isBrowserMode,
  isRemoteMode,
  isTauriRuntime,
} from "../lib/server/remote";

/**
 * Plain-language where books live + how Backup works (trust track).
 */
export function DataBackupHelp() {
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getAppDataDir()
      .then(setDataDir)
      .catch((e) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  async function openFolder() {
    if (!dataDir) return;
    setError(null);
    try {
      await openPath(dataDir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1rem" }}>
      <h2>Data &amp; backup</h2>
      <p className="muted small">
        Solo is free for one desk — your books are files on this machine. Use{" "}
        <strong>Backup</strong> on each company (above) regularly.{" "}
        <a
          href="https://github.com/taksha17/kite/blob/main/docs/backup-restore.md"
          target="_blank"
          rel="noreferrer"
        >
          Backup &amp; restore guide
        </a>
        {" · "}
        <a
          href="https://github.com/taksha17/kite/blob/main/docs/whats-free.md"
          target="_blank"
          rel="noreferrer"
        >
          What&apos;s free / what&apos;s not
        </a>
      </p>

      {isTauriRuntime() && (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="muted small">
            <strong>This PC&apos;s data folder</strong>
          </p>
          <p className="mono small" style={{ wordBreak: "break-all" }}>
            {dataDir || "…"}
          </p>
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            Contains <code>kite-registry.db</code> and{" "}
            <code>kite-company-*.db</code>. Quit Kite before replacing files to
            restore.
          </p>
          <div className="cta-row" style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="ghost btn"
              disabled={!dataDir}
              onClick={() => void openFolder()}
            >
              Open data folder
            </button>
          </div>
        </div>
      )}

      {isBrowserMode() && (
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          Browser mode stores books in this device&apos;s browser storage.
          Use <strong>Backup</strong> to download a file, or Google Drive backup
          below when enabled.
        </p>
      )}

      {isRemoteMode() && (
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          Enterprise: books live on the <strong>parent PC</strong> data
          directory — not on this browser. Ask the admin to back up that folder.
          See the deployment guide.
        </p>
      )}

      {error && (
        <p className="error" role="alert" style={{ marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
    </section>
  );
}
