import * as XLSX from "xlsx";

/** Raw grid of cell values from the statement file. */
export type SheetRows = unknown[][];

export interface ColumnMapping {
  /** Row index where data starts (0 = no header row). */
  headerRow: number;
  date: number;
  narration: number;
  reference: number | null;
  /** Separate debit (money out) column index, if the bank uses one. */
  debit: number | null;
  /** Separate credit (money in) column index, if the bank uses one. */
  credit: number | null;
  /** Single signed amount column (negative = money out). */
  amount: number | null;
}

export interface ParsedTxn {
  date: string;
  narration: string;
  reference: string;
  withdrawal: number;
  deposit: number;
  rawIndex: number;
}

export interface ParseResult {
  txns: ParsedTxn[];
  skipped: { index: number; reason: string }[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function cellText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function headerKey(v: unknown): string {
  return cellText(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Excel date serial (1900 system) → ISO date. */
function excelSerialToIso(n: number): string | null {
  if (n < 20000 || n > 73000) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pad2(n: string): string {
  return n.padStart(2, "0");
}

function fullYear(y: string): string {
  return y.length === 2 ? `20${y}` : y;
}

function valid(y: number, m: number, d: number): boolean {
  return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * Parse the many date shapes Indian bank statements use.
 * Numeric ambiguous dates are read day-first (Indian convention).
 */
export function parseStatementDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number") return excelSerialToIso(value);

  const s = cellText(value);
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/.exec(s);
  if (m) {
    const [d, mo, y] = [+m[1], +m[2], +fullYear(m[3])];
    if (valid(y, mo, d)) return `${y}-${pad2(String(mo))}-${pad2(String(d))}`;
    // day-first failed — try month-first as a fallback for odd exports
    if (valid(y, d, mo)) return `${y}-${pad2(String(d))}-${pad2(String(mo))}`;
  }

  m = /^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})\b/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = +fullYear(m[3]);
    if (mo && valid(y, mo, +m[1])) {
      return `${y}-${pad2(String(mo))}-${pad2(m[1])}`;
    }
  }
  return null;
}

/**
 * Parse an amount cell: Indian/Intl commas, (negatives), Dr/Cr suffixes.
 * Returns a signed number (negative = money out) or null.
 */
export function parseStatementAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  let s = cellText(value);
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\b(dr|debit)$/i.test(s)) {
    sign = -1;
    s = s.replace(/\b(dr|debit)$/i, "");
  } else if (/\b(cr|credit)$/i.test(s)) {
    s = s.replace(/\b(cr|credit)$/i, "");
  }
  s = s.replace(/[₹$,\s]/g, "").replace(/^\+/, "");
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? sign * Math.round(n * 100) / 100 : null;
}

const HEADER_HINTS: { key: keyof Omit<ColumnMapping, "headerRow">; match: RegExp }[] = [
  { key: "date", match: /^(date|txn date|transaction date|trans date|value date|value dt|posting date|post date)\b/ },
  { key: "narration", match: /narration|description|particulars|transaction details|details|remarks|remitter|beneficiary/ },
  { key: "reference", match: /ref|utr|cheque|chq|transaction id|upi|instr|instrument/ },
  { key: "debit", match: /debit|withdrawal|withdrawl|dr amt|dr amount|^dr\b|paid out|money out/ },
  { key: "credit", match: /credit|deposit|cr amt|cr amount|^cr\b|paid in|money in/ },
  { key: "amount", match: /^(amount|txn amount|transaction amount)\b/ },
];

/**
 * Locate the header row and map columns by common Indian bank header names.
 * Scans the first 12 rows (statements often carry preamble lines).
 */
export function guessMapping(rows: SheetRows): ColumnMapping | null {
  const limit = Math.min(rows.length, 12);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map(headerKey);
    const mapping: ColumnMapping = {
      headerRow: r + 1,
      date: -1,
      narration: -1,
      reference: null,
      debit: null,
      credit: null,
      amount: null,
    };
    let hits = 0;
    cells.forEach((key, idx) => {
      if (!key) return;
      for (const hint of HEADER_HINTS) {
        if (hint.match.test(key)) {
          if (mapping[hint.key] == null || mapping[hint.key] === -1) {
            (mapping[hint.key] as number | null) = idx;
            hits++;
          }
          break;
        }
      }
    });
    if (mapping.date >= 0 && mapping.narration >= 0 && hits >= 3) {
      return mapping;
    }
  }
  return null;
}

const SKIP_NARRATION = /opening balance|closing balance|^total\b|statement total/i;

/** Turn raw rows into normalized transactions using the mapping. */
export function applyMapping(rows: SheetRows, mapping: ColumnMapping): ParseResult {
  const txns: ParsedTxn[] = [];
  const skipped: ParseResult["skipped"] = [];

  for (let i = mapping.headerRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = parseStatementDate(row[mapping.date]);
    const narration = cellText(row[mapping.narration]);
    if (!date && !narration) continue; // blank row
    if (!date) {
      skipped.push({ index: i, reason: "unreadable date" });
      continue;
    }
    if (SKIP_NARRATION.test(narration)) continue;

    let withdrawal = 0;
    let deposit = 0;
    if (mapping.amount != null) {
      const amt = parseStatementAmount(row[mapping.amount]);
      if (amt != null) {
        if (amt < 0) withdrawal = -amt;
        else deposit = amt;
      }
    } else {
      const d = mapping.debit != null ? parseStatementAmount(row[mapping.debit]) : null;
      const c = mapping.credit != null ? parseStatementAmount(row[mapping.credit]) : null;
      withdrawal = d != null ? Math.abs(d) : 0;
      deposit = c != null ? Math.abs(c) : 0;
    }

    if (!withdrawal && !deposit) {
      skipped.push({ index: i, reason: "no amount" });
      continue;
    }

    txns.push({
      date,
      narration: narration || "(no narration)",
      reference: mapping.reference != null ? cellText(row[mapping.reference]) : "",
      withdrawal,
      deposit,
      rawIndex: i,
    });
  }
  return { txns, skipped };
}

/** Read a statement file (CSV/TSV/XLS/XLSX) into a raw grid. */
export async function readStatementFile(file: File): Promise<SheetRows> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("No sheet found in that file.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) throw new Error("That file looks empty.");
  return rows;
}
