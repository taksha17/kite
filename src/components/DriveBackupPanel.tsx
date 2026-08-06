import { useCallback, useEffect, useState } from "react";
import type { CompanyRecord } from "../lib/db/client";
import { isBrowserMode } from "../lib/server/remote";
import {
  getGoogleProfile,
  googleAuthAvailable,
  GoogleInteractionRequired,
  signInWithGoogle,
  signOutGoogle,
  type GoogleProfile,
} from "../lib/gdrive/auth";
import {
  backupCompanyToDrive,
  DriveConflictError,
  getDriveLastBackupAt,
  listDriveCompanies,
  restoreCompanyFromDrive,
  type DriveManifestEntry,
} from "../lib/gdrive/backup";
import { resumeDriveAutosync } from "../lib/gdrive/autosync";
import { useApp } from "../state/AppContext";

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Google Drive backup for the serverless PWA (browser-local mode only).
 * Sign in with Google → per-company "Back up" → restore on a new device.
 */
export function DriveBackupPanel() {
  const { companies, refreshCompanies } = useApp();
  const [profile, setProfile] = useState<GoogleProfile | null>(() =>
    getGoogleProfile(),
  );
  const [remote, setRemote] = useState<DriveManifestEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const loadRemote = useCallback(async () => {
    if (!getGoogleProfile()) return;
    try {
      setRemote(await listDriveCompanies());
    } catch (err) {
      if (err instanceof GoogleInteractionRequired) {
        setProfile(null);
      }
      setRemote(null);
    }
  }, []);

  useEffect(() => {
    void loadRemote();
  }, [loadRemote, profile]);

  if (!isBrowserMode()) return null;

  if (!googleAuthAvailable()) {
    return (
      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2>Google Drive backup</h2>
        <p className="muted small">
          This build has no Google client ID configured, so Drive backup is
          off. Set <code>VITE_GOOGLE_CLIENT_ID</code> when building to enable
          it — see docs/google-drive.md.
        </p>
      </section>
    );
  }

  async function onSignIn() {
    setBusy(true);
    setError(null);
    try {
      setProfile(await signInWithGoogle());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onBackup(c: CompanyRecord, force = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { updatedAt } = await backupCompanyToDrive(c, { force });
      resumeDriveAutosync();
      setNotice(`Backed up “${c.name}” to Google Drive at ${fmtTime(updatedAt)}.`);
      setTick((t) => t + 1);
      await loadRemote();
    } catch (err) {
      if (err instanceof DriveConflictError) {
        const e = err.entry;
        const overwrite = window.confirm(
          `Google Drive already has a newer backup of “${e.name}” from ${e.deviceName} ` +
            `(${fmtTime(e.updatedAt)}).\n\n` +
            `OK = overwrite the Drive copy with this device's data.\n` +
            `Cancel = keep the Drive copy (use Restore below to fetch it).`,
        );
        if (overwrite) {
          setBusy(false);
          return onBackup(c, true);
        }
      } else if (err instanceof GoogleInteractionRequired) {
        setProfile(null);
        setError("Please sign in with Google again.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(entry: DriveManifestEntry) {
    const local = companies.find((c) => c.id === entry.companyId);
    const message = local
      ? `Replace the local copy of “${entry.name}” on this device with the Drive snapshot from ${fmtTime(entry.updatedAt)}?`
      : `Restore “${entry.name}” (snapshot from ${fmtTime(entry.updatedAt)}, ${fmtSize(entry.sizeBytes)}) onto this device?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await restoreCompanyFromDrive(entry);
      resumeDriveAutosync();
      await refreshCompanies();
      setNotice(
        `Restored “${entry.name}” from Google Drive. Open it from Your companies.`,
      );
    } catch (err) {
      if (err instanceof GoogleInteractionRequired) {
        setProfile(null);
        setError("Please sign in with Google again.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1rem" }}>
      <h2>Google Drive backup</h2>
      <p className="muted small">
        Snapshots go to a hidden app folder in your Drive — always backed up,
        and a new phone can restore everything after you sign in. One device
        should edit a company at a time.
      </p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {profile ? (
        <div className="cta-row" style={{ alignItems: "center" }}>
          {profile.picture && (
            <img
              src={profile.picture}
              alt=""
              style={{ width: 28, height: 28, borderRadius: "50%" }}
            />
          )}
          <span className="small">
            {profile.name} · {profile.email}
          </span>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => {
              signOutGoogle();
              setProfile(null);
              setRemote(null);
            }}
          >
            Sign out
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void onSignIn()}
        >
          {busy ? "Opening Google…" : "Sign in with Google"}
        </button>
      )}

      {profile && companies.length > 0 && (
        <>
          <h3 style={{ margin: "0.75rem 0 0.25rem", fontSize: "1rem" }}>
            Back up this device&apos;s companies
          </h3>
          <ul className="list">
            {companies.map((c) => (
              <li key={c.id} className="list-row">
                <div>
                  <strong>{c.name}</strong>
                  <p className="muted small">
                    Last backup from this device: {fmtTime(getDriveLastBackupAt(c.id))}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void onBackup(c)}
                >
                  Back up
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {profile && remote && remote.length > 0 && (
        <>
          <h3 style={{ margin: "0.75rem 0 0.25rem", fontSize: "1rem" }}>
            Restore from Drive
          </h3>
          <ul className="list">
            {remote.map((entry) => (
              <li key={entry.companyId} className="list-row">
                <div>
                  <strong>{entry.name}</strong>
                  <p className="muted small">
                    {fmtTime(entry.updatedAt)} · {entry.deviceName} ·{" "}
                    {fmtSize(entry.sizeBytes)}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void onRestore(entry)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {profile && remote && remote.length === 0 && (
        <p className="muted small">No backups in this Drive account yet.</p>
      )}
    </section>
  );
}
