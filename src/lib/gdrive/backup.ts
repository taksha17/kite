/**
 * Google Drive snapshot backup for browser-local companies.
 *
 * Layout in the user's hidden appDataFolder:
 *   kite-manifest.json        — registry of companies + sync metadata
 *   kite-company-<id>.db      — one SQLite snapshot per company
 *
 * Drive keeps previous file revisions for ~30 days, so every upload is
 * also a version history. Conflict rule: a snapshot last written by a
 * *different* device and newer than this device's last backup is never
 * overwritten silently — the UI must choose restore-vs-overwrite.
 */
import type { CompanyRecord } from "../db/client";
import { closeCompany, getActiveCompanyId, getRegistry } from "../db/client";
import {
  flushBrowserInstances,
  readBrowserDbBytes,
  restoreBrowserDb,
} from "../db/browser";
import { getAccessToken } from "./auth";
import {
  driveCreateFile,
  driveDownloadFile,
  driveFindFile,
  driveUpdateFile,
} from "./drive";

const MANIFEST_NAME = "kite-manifest.json";
const DEVICE_ID_KEY = "kite.deviceId";
const LAST_BACKUP_PREFIX = "kite.drive.lastBackup.";

export interface DriveManifestEntry {
  companyId: string;
  name: string;
  record: CompanyRecord;
  fileId: string;
  updatedAt: string;
  deviceId: string;
  deviceName: string;
  sizeBytes: number;
}

interface DriveManifest {
  version: 1;
  companies: DriveManifestEntry[];
}

export class DriveConflictError extends Error {
  constructor(public readonly entry: DriveManifestEntry) {
    super(
      `A newer backup of “${entry.name}” exists from ${entry.deviceName} (${entry.updatedAt}).`,
    );
    this.name = "DriveConflictError";
  }
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceName(): string {
  return localStorage.getItem("kite.deviceName") || "This device";
}

function getLastBackupAt(companyId: string): string | null {
  return localStorage.getItem(LAST_BACKUP_PREFIX + companyId);
}

/** When this device last uploaded a snapshot of the company (UI display). */
export function getDriveLastBackupAt(companyId: string): string | null {
  return getLastBackupAt(companyId);
}

function setLastBackupAt(companyId: string, iso: string): void {
  localStorage.setItem(LAST_BACKUP_PREFIX + companyId, iso);
}

export type BackupAction = "upload" | "conflict";

/** Pure conflict rule — unit tested. */
export function decideBackupAction(
  remote: DriveManifestEntry | null,
  local: { deviceId: string; lastBackupAt: string | null },
): BackupAction {
  if (!remote) return "upload";
  if (remote.deviceId === local.deviceId) return "upload";
  if (
    local.lastBackupAt &&
    new Date(remote.updatedAt) <= new Date(local.lastBackupAt)
  ) {
    return "upload";
  }
  return "conflict";
}

async function readManifest(token: string): Promise<{
  manifest: DriveManifest;
  fileId: string | null;
}> {
  const file = await driveFindFile(token, MANIFEST_NAME);
  if (!file) return { manifest: { version: 1, companies: [] }, fileId: null };
  try {
    const bytes = await driveDownloadFile(token, file.id);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as DriveManifest;
    if (!Array.isArray(parsed.companies)) throw new Error("bad manifest");
    return { manifest: parsed, fileId: file.id };
  } catch {
    // A corrupt manifest must not strand the user — start fresh.
    return { manifest: { version: 1, companies: [] }, fileId: file.id };
  }
}

async function writeManifest(
  token: string,
  manifest: DriveManifest,
  fileId: string | null,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 1));
  if (fileId) {
    await driveUpdateFile(token, fileId, bytes, "application/json");
  } else {
    await driveCreateFile(token, MANIFEST_NAME, bytes, "application/json");
  }
}

/**
 * Uploads a snapshot of the company to Drive. Throws DriveConflictError
 * when another device owns a newer remote snapshot (pass force=true after
 * the user confirms overwrite).
 */
export async function backupCompanyToDrive(
  company: CompanyRecord,
  options: { force?: boolean } = {},
): Promise<{ updatedAt: string }> {
  const token = await getAccessToken();
  await flushBrowserInstances();
  const bytes = await readBrowserDbBytes(company.db_file);
  if (!bytes) throw new Error(`No local data found for “${company.name}”.`);

  const { manifest, fileId: manifestFileId } = await readManifest(token);
  const remote = manifest.companies.find((c) => c.companyId === company.id) ?? null;

  const action = decideBackupAction(remote, {
    deviceId: getDeviceId(),
    lastBackupAt: getLastBackupAt(company.id),
  });
  if (action === "conflict" && !options.force && remote) {
    throw new DriveConflictError(remote);
  }

  const fileName = `kite-company-${company.id}.db`;
  const existing = await driveFindFile(token, fileName);
  let fileId: string;
  if (existing) {
    await driveUpdateFile(token, existing.id, bytes);
    fileId = existing.id;
  } else {
    fileId = await driveCreateFile(token, fileName, bytes);
  }

  const updatedAt = new Date().toISOString();
  const entry: DriveManifestEntry = {
    companyId: company.id,
    name: company.name,
    record: company,
    fileId,
    updatedAt,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    sizeBytes: bytes.byteLength,
  };
  manifest.companies = [
    entry,
    ...manifest.companies.filter((c) => c.companyId !== company.id),
  ];
  await writeManifest(token, manifest, manifestFileId);
  setLastBackupAt(company.id, updatedAt);
  return { updatedAt };
}

/** Companies that have snapshots in this Drive account. */
export async function listDriveCompanies(): Promise<DriveManifestEntry[]> {
  const token = await getAccessToken();
  const { manifest } = await readManifest(token);
  return manifest.companies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Downloads a snapshot into the local store and registers the company
 * locally if needed. Closes the company first if it is currently open.
 */
export async function restoreCompanyFromDrive(
  entry: DriveManifestEntry,
): Promise<CompanyRecord> {
  if (getActiveCompanyId() === entry.companyId) {
    await closeCompany();
  }
  const token = await getAccessToken();
  const bytes = await driveDownloadFile(token, entry.fileId);
  await restoreBrowserDb(entry.record.db_file, bytes);

  const registry = await getRegistry();
  const rows = await registry.select<{ id: string }[]>(
    "SELECT id FROM companies WHERE id = $1",
    [entry.companyId],
  );
  if (!rows.length) {
    const r = entry.record;
    await registry.execute(
      `INSERT INTO companies (id, name, slug, fy_start, currency, state_code, gstin, gst_enabled, db_file)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        r.id,
        r.name,
        r.slug,
        r.fy_start,
        r.currency || "INR",
        r.state_code || null,
        r.gstin || null,
        r.gst_enabled ? 1 : 0,
        r.db_file,
      ],
    );
  }
  setLastBackupAt(entry.companyId, entry.updatedAt);
  return entry.record;
}
