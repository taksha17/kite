import type Database from "@tauri-apps/plugin-sql";
import { hashPassword, verifyPassword } from "../auth/crypto";
import type { UserRole } from "../auth/permissions";
import { getActiveCompanyDb, getActiveCompanyId } from "./active";
import { isRemoteMode, remoteGetCompanyInfo, remoteLogin } from "../server/remote";

export interface AppUser {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: number;
  created_at: string;
}

export interface AuditRow {
  id: number;
  created_at: string;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  detail: string | null;
}

const AUTH_SQL = `
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES app_user(id),
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;

export async function ensureAuthSchema(db: Database): Promise<void> {
  for (const sql of AUTH_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await db.execute(sql);
  }
}

export async function countUsers(): Promise<number> {
  if (isRemoteMode()) {
    // Pre-login gate: the server answers this without a session token.
    const companyId = getActiveCompanyId();
    if (!companyId) return 0;
    const info = await remoteGetCompanyInfo(companyId);
    return Number(info.userCount) || 0;
  }
  const db = getActiveCompanyDb();
  const rows = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) as c FROM app_user",
  );
  return Number(rows[0]?.c || 0);
}

export async function listUsers(): Promise<AppUser[]> {
  const db = getActiveCompanyDb();
  return db.select<AppUser[]>(
    `SELECT id, username, display_name, role, is_active, created_at
     FROM app_user ORDER BY id`,
  );
}

export async function setupOwner(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<AppUser> {
  if (isRemoteMode()) {
    // The server created the owner atomically with the company — sign in.
    const companyId = getActiveCompanyId();
    if (!companyId) throw new Error("No company is open.");
    const { user } = await remoteLogin(companyId, input.username, input.password);
    return user;
  }
  const db = getActiveCompanyDb();
  const existing = await countUsers();
  if (existing > 0) throw new Error("Owner already set up for this company.");
  if (input.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  const password_hash = await hashPassword(input.password);
  await db.execute(
    `INSERT INTO app_user (username, display_name, role, password_hash)
     VALUES ($1, $2, 'owner', $3)`,
    [input.username.trim(), input.displayName.trim() || input.username.trim(), password_hash],
  );
  const rows = await db.select<AppUser[]>(
    `SELECT id, username, display_name, role, is_active, created_at
     FROM app_user WHERE username = $1 COLLATE NOCASE`,
    [input.username.trim()],
  );
  return rows[0];
}

export async function createUser(input: {
  username: string;
  displayName: string;
  role: UserRole;
  password: string;
}): Promise<void> {
  if (input.role === "owner") {
    throw new Error("Use a dedicated transfer flow to add another owner.");
  }
  if (input.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  const db = getActiveCompanyDb();
  const password_hash = await hashPassword(input.password);
  await db.execute(
    `INSERT INTO app_user (username, display_name, role, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [
      input.username.trim(),
      input.displayName.trim() || input.username.trim(),
      input.role,
      password_hash,
    ],
  );
}

export async function setUserActive(userId: number, active: boolean): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(`UPDATE app_user SET is_active = $1 WHERE id = $2`, [
    active ? 1 : 0,
    userId,
  ]);
}

export async function authenticate(
  username: string,
  password: string,
): Promise<AppUser> {
  if (isRemoteMode()) {
    const companyId = getActiveCompanyId();
    if (!companyId) throw new Error("No company is open.");
    const { user } = await remoteLogin(companyId, username, password);
    return user;
  }
  const db = getActiveCompanyDb();
  const rows = await db.select<
    (AppUser & { password_hash: string })[]
  >(
    `SELECT id, username, display_name, role, is_active, created_at, password_hash
     FROM app_user WHERE username = $1 COLLATE NOCASE LIMIT 1`,
    [username.trim()],
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw new Error("Invalid username or password.");
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error("Invalid username or password.");
  const { password_hash: _, ...safe } = user;
  return safe;
}

export async function writeAudit(input: {
  user: AppUser | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  detail?: string;
}): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.user?.id ?? null,
      input.user?.username || "system",
      input.action,
      input.entityType,
      input.entityId != null ? String(input.entityId) : null,
      input.detail || null,
    ],
  );
}

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  const db = getActiveCompanyDb();
  return db.select<AuditRow[]>(
    `SELECT id, created_at, username, action, entity_type, entity_id, detail
     FROM audit_log ORDER BY id DESC LIMIT $1`,
    [limit],
  );
}
