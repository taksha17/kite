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
