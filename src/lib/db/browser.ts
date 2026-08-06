/**
 * Browser-local data layer (phone-only / serverless PWA mode).
 *
 * No Tauri, no kite-server: SQLite runs inside the browser via sql.js
 * (WASM) and each database file is persisted to IndexedDB as exported
 * bytes, debounced after writes. BrowserCompanyDb implements the same
 * {execute, select, close, path} surface as tauri-plugin-sql's Database,
 * so every module built on getActiveCompanyDb() works unchanged.
 */
import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase, SqlJsStatic, BindParams } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export interface QueryResult {
  rowsAffected: number;
  lastInsertId: number;
}

const IDB_NAME = "kite-browser";
const IDB_STORE = "files";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    // Node (tests): sql.js resolves the wasm from the package itself.
    const isNode =
      typeof process !== "undefined" && Boolean(process.versions?.node);
    sqlJsPromise = isNode
      ? initSqlJs()
      : initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlJsPromise;
}

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  if (!hasIdb()) return null;
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, data: Uint8Array): Promise<void> {
  if (!hasIdb()) return;
  const db = await idbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbDelete(key: string): Promise<void> {
  if (!hasIdb()) return;
  const db = await idbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * tauri-plugin-sql binds JS arrays to $1..$N named placeholders. sql.js
 * binds arrays positionally to "?". Rewrite each $N occurrence (in order,
 * duplicates expanded) to "?" and build the matching values array.
 */
export function convertParams(
  sql: string,
  params: unknown[],
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const text = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    values.push(params[Number(n) - 1] ?? null);
    return "?";
  });
  return { text, values };
}

type MutationListener = (storeKey: string) => void;

const mutationListeners = new Set<MutationListener>();
const openInstances = new Set<BrowserCompanyDb>();

export function onBrowserMutation(listener: MutationListener): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function flushAllInstances(): void {
  for (const instance of openInstances) {
    void instance.flush();
  }
}

/** Flushes every open browser database to IndexedDB (before reads/backups). */
export async function flushBrowserInstances(): Promise<void> {
  await Promise.all([...openInstances].map((instance) => instance.flush()));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllInstances();
  });
  window.addEventListener("pagehide", flushAllInstances);
}

export class BrowserCompanyDb {
  readonly path: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly db: SqlJsDatabase,
    private readonly storeKey: string,
  ) {
    this.path = `browser:${storeKey}`;
    openInstances.add(this);
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 750);
    for (const listener of mutationListeners) listener(this.storeKey);
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (this.closed) throw new Error("Database is closed.");
    const { text, values } = convertParams(sql, params ?? []);
    this.db.run(text, values as BindParams);
    const rowsAffected = this.db.getRowsModified();
    let lastInsertId = 0;
    if (/^\s*insert\b/i.test(text)) {
      const rows = this.db.exec("SELECT last_insert_rowid() AS id");
      lastInsertId = Number(rows[0]?.values[0]?.[0]) || 0;
    }
    this.markDirty();
    return { rowsAffected, lastInsertId };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    if (this.closed) throw new Error("Database is closed.");
    const { text, values } = convertParams(sql, params ?? []);
    const stmt = this.db.prepare(text);
    try {
      stmt.bind(values as BindParams);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows as T;
    } finally {
      stmt.free();
    }
  }

  exportBytes(): Uint8Array {
    return this.db.export();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty || this.closed) return;
    this.dirty = false;
    await idbPut(this.storeKey, this.db.export());
  }

  async close(_path?: string): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    openInstances.delete(this);
    this.db.close();
  }
}

/**
 * Opens (or creates) a browser-local database file backed by IndexedDB.
 * `storeKey` is the same file name used in local/remote modes
 * (e.g. "kite-registry.db", "kite-company-….db") so Drive snapshots map
 * 1:1 to local files.
 */
export async function openBrowserDb(storeKey: string): Promise<BrowserCompanyDb> {
  const SQL = await getSqlJs();
  const stored = await idbGet(storeKey);
  const db = stored ? new SQL.Database(stored) : new SQL.Database();
  return new BrowserCompanyDb(db, storeKey);
}

/** Restores bytes downloaded from Drive into a local store slot. */
export async function restoreBrowserDb(
  storeKey: string,
  bytes: Uint8Array,
): Promise<void> {
  await idbPut(storeKey, bytes);
}

/** Reads the raw persisted bytes of a store slot (for backup). */
export async function readBrowserDbBytes(
  storeKey: string,
): Promise<Uint8Array | null> {
  return idbGet(storeKey);
}
