/** Tables the ask-my-books LLM is allowed to touch. */
export const ASK_ALLOWED_TABLES = new Set([
  "voucher",
  "voucher_line",
  "voucher_type",
  "ledger",
  "account_group",
  "stock_item",
  "stock_movement",
  "unit",
  "godown",
]);

export const ASK_MAX_ROWS = 200;

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRIGGER|GRANT|REVOKE|EXEC(?:UTE)?|INTO)\b/i;

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/** Table names referenced after FROM / JOIN (aliases ignored). */
export function extractTableRefs(sql: string): string[] {
  const refs: string[] = [];
  const re = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    refs.push(m[1].toLowerCase());
  }
  return refs;
}

/** CTE names from a WITH clause (so FROM cte_alias is allowed). */
export function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  const withMatch = /\bWITH\b([\s\S]+?)\bSELECT\b/i.exec(sql);
  if (!withMatch) return names;
  const re = /\b([a-z_][a-z0-9_]*)\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withMatch[1])) !== null) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * Validate and normalize a model-proposed query.
 * Only single-statement SELECT (optional WITH) against allowlisted tables.
 */
export function assertSafeSelect(rawSql: string): string {
  if (!rawSql || typeof rawSql !== "string") {
    throw new Error("The AI did not return a SQL query.");
  }
  let sql = stripSqlComments(rawSql).trim().replace(/;+\s*$/g, "");
  if (!sql) throw new Error("The AI returned an empty SQL query.");
  if (sql.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }
  if (FORBIDDEN.test(sql)) {
    throw new Error("Only read-only SELECT queries are allowed on your books.");
  }
  if (!/^\s*(WITH\b[\s\S]+)?SELECT\b/i.test(sql)) {
    throw new Error("Query must be a SELECT (WITH … SELECT is fine).");
  }

  const ctes = extractCteNames(sql);
  const tables = extractTableRefs(sql);
  if (tables.length === 0) {
    throw new Error("Could not find any tables in the SQL — try rephrasing.");
  }
  for (const t of tables) {
    if (ASK_ALLOWED_TABLES.has(t) || ctes.has(t)) continue;
    throw new Error(
      `Table “${t}” is not available for Ask — stick to ledgers, vouchers, and stock.`,
    );
  }

  const lim = sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (!lim) {
    sql = `${sql}\nLIMIT ${ASK_MAX_ROWS}`;
  } else if (Number(lim[1]) > ASK_MAX_ROWS) {
    sql = sql.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${ASK_MAX_ROWS}`);
  }
  return sql;
}
