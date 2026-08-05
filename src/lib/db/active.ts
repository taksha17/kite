import type Database from "@tauri-apps/plugin-sql";

let companyDb: Database | null = null;
let activeCompanyId: string | null = null;

export function setActiveCompanyDb(db: Database | null, companyId: string | null) {
  companyDb = db;
  activeCompanyId = companyId;
}

export function getActiveCompanyDb(): Database {
  if (!companyDb) {
    throw new Error("No company is open.");
  }
  return companyDb;
}

export function getActiveCompanyId(): string | null {
  return activeCompanyId;
}

export function peekActiveCompanyDb(): Database | null {
  return companyDb;
}
