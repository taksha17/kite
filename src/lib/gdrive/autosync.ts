/**
 * Automatic Drive backup: after local writes settle (60s debounce),
 * snapshot the active company — best effort, never blocks the user.
 * Pauses itself on conflicts or sign-in issues until a manual backup
 * resolves them.
 */
import { listCompanies, getActiveCompanyId } from "../db/client";
import { onBrowserMutation } from "../db/browser";
import { isBrowserMode } from "../server/remote";
import { getGoogleProfile, GoogleInteractionRequired } from "./auth";
import { backupCompanyToDrive, DriveConflictError } from "./backup";

const DEBOUNCE_MS = 60_000;

let paused = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function syncActiveCompany(): Promise<void> {
  if (paused || !isBrowserMode() || !getGoogleProfile()) return;
  const companyId = getActiveCompanyId();
  if (!companyId) return;
  try {
    const companies = await listCompanies();
    const record = companies.find((c) => c.id === companyId);
    if (!record) return;
    await backupCompanyToDrive(record);
  } catch (err) {
    if (err instanceof DriveConflictError || err instanceof GoogleInteractionRequired) {
      paused = true;
    }
    // Network/online hiccups: try again after the next edit.
  }
}

/** Resumes autosync after a manual backup/restore resolved a conflict. */
export function resumeDriveAutosync(): void {
  paused = false;
}

export function startDriveAutosync(): () => void {
  if (!isBrowserMode()) return () => {};
  const unsubscribe = onBrowserMutation((storeKey) => {
    if (storeKey === "kite-registry.db") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncActiveCompany(), DEBOUNCE_MS);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
