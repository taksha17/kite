import { save } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import type { CompanyRecord } from "./client";

export async function getAppDataDir(): Promise<string> {
  return invoke<string>("app_data_dir");
}

/** Prompt for a destination path and copy the company SQLite file there. */
export async function backupCompany(company: CompanyRecord): Promise<string | null> {
  const appData = await getAppDataDir();
  const source = `${appData}/${company.db_file}`;
  const destination = await save({
    title: `Backup ${company.name}`,
    defaultPath: `${company.slug}-backup.kite.db`,
    filters: [{ name: "Kite company database", extensions: ["db"] }],
  });
  if (!destination) return null;

  const sourceOk = await exists(source);
  if (!sourceOk) {
    throw new Error(`Company database not found at ${source}`);
  }
  await copyFile(source, destination);
  return destination;
}

export async function ensureAppDataReady(): Promise<void> {
  const appData = await getAppDataDir();
  if (!(await exists(appData))) {
    await mkdir(appData, { recursive: true });
  }
}

/**
 * Browser-local backup: exports the sql.js database from IndexedDB and
 * triggers a browser download (no Tauri fs, no server involved).
 */
export async function browserDownloadBackup(
  company: CompanyRecord,
): Promise<string> {
  const { flushBrowserInstances, readBrowserDbBytes } = await import("./browser");
  await flushBrowserInstances();
  const bytes = await readBrowserDbBytes(company.db_file);
  if (!bytes) {
    throw new Error(`No local data found for “${company.name}” on this device.`);
  }
  const filename = `${company.slug}-backup.kite.db`;
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}
