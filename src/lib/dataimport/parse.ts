import * as XLSX from "xlsx";
import { INDIA_STATES } from "../accounting/gst";
import { normalizeGstin, isValidGstin, stateCodeFromGstin } from "../accounting/gstin";
import type { ImportKind, MastersColumnMap, SheetRows } from "./types";

export function cellText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function headerKey(v: unknown): string {
  return cellText(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Read first sheet of CSV/TSV/XLS/XLSX into a string grid. */
export async function readImportFile(file: File): Promise<SheetRows> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as SheetRows;
}

export function parseAmount(value: unknown): number | null {
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
  if (/\b(dr|debit|dr\.)$/i.test(s)) {
    sign = 1;
    s = s.replace(/\b(dr|debit|dr\.)$/i, "");
  } else if (/\b(cr|credit|cr\.)$/i.test(s)) {
    sign = -1;
    s = s.replace(/\b(cr|credit|cr\.)$/i, "");
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

/** Split a signed opening into debit/credit. Positive → debit, negative → credit. */
export function openingToDrCr(signed: number): { debit: number; credit: number } {
  if (signed > 0) return { debit: signed, credit: 0 };
  if (signed < 0) return { debit: 0, credit: Math.abs(signed) };
  return { debit: 0, credit: 0 };
}

export function parseStateCode(value: unknown): string {
  const raw = cellText(value);
  if (!raw) return "";
  if (/^\d{2}$/.test(raw)) {
    return INDIA_STATES.some((s) => s.code === raw) ? raw : "";
  }
  // "29 — Karnataka" or "Karnataka"
  const m = /^(\d{2})\b/.exec(raw);
  if (m && INDIA_STATES.some((s) => s.code === m[1])) return m[1];
  const lower = raw.toLowerCase();
  const hit = INDIA_STATES.find(
    (s) => s.name.toLowerCase() === lower || lower.includes(s.name.toLowerCase()),
  );
  return hit?.code ?? "";
}

export function parseGstin(value: unknown): string {
  const n = normalizeGstin(cellText(value));
  return isValidGstin(n) ? n : cellText(value).toUpperCase().replace(/\s+/g, "");
}

type FieldKey = keyof Omit<MastersColumnMap, "headerRow">;

const FIELD_HINTS: { key: FieldKey; match: RegExp; kinds: ImportKind[] }[] = [
  { key: "name", match: /^(name|ledger name|ledger|party name|party|item name|stock item|item)$/, kinds: ["ledgers", "parties", "stock"] },
  { key: "group", match: /^(group|under|parent|ledger group|account group|belongs to)$/, kinds: ["ledgers", "parties"] },
  { key: "kind", match: /^(kind|type|party type|debtor|creditor|sundry)$/, kinds: ["parties"] },
  { key: "openingDebit", match: /opening debit|op debit|^debit\b|dr balance/, kinds: ["ledgers", "parties"] },
  { key: "openingCredit", match: /opening credit|op credit|^credit\b|cr balance/, kinds: ["ledgers", "parties"] },
  { key: "opening", match: /^(opening|opening balance|op bal|op balance|closing balance)$/, kinds: ["ledgers", "parties"] },
  { key: "gstin", match: /gstin|gst no|gst number|tin/, kinds: ["ledgers", "parties"] },
  { key: "state", match: /^(state|state code|place of supply|pos)$/, kinds: ["ledgers", "parties"] },
  { key: "email", match: /^e.?mail/, kinds: ["ledgers", "parties"] },
  { key: "phone", match: /phone|mobile|contact/, kinds: ["ledgers", "parties"] },
  { key: "address", match: /^address/, kinds: ["ledgers", "parties"] },
  { key: "city", match: /^city/, kinds: ["ledgers", "parties"] },
  { key: "pin", match: /^(pin|pincode|postal)$/, kinds: ["ledgers", "parties"] },
  { key: "isCashBank", match: /cash.?bank|is bank|bank account/, kinds: ["ledgers"] },
  { key: "unit", match: /^(unit|uom|symbol)$/, kinds: ["stock"] },
  { key: "hsn", match: /hsn|sac|hsn sac/, kinds: ["stock"] },
  { key: "sku", match: /^(sku|part no|part number|item code)$/, kinds: ["stock"] },
  { key: "gstRate", match: /gst %|gst rate|tax rate|gst%/ , kinds: ["stock"] },
  { key: "purchaseRate", match: /purchase rate|cost rate|buy rate/, kinds: ["stock"] },
  { key: "salesRate", match: /sales rate|selling rate|mrp|sale rate/, kinds: ["stock"] },
  { key: "openingQty", match: /opening qty|op qty|opening quantity|qty|quantity/, kinds: ["stock"] },
];

function emptyMap(headerRow: number): MastersColumnMap {
  return {
    headerRow,
    name: -1,
    group: null,
    kind: null,
    opening: null,
    openingDebit: null,
    openingCredit: null,
    gstin: null,
    state: null,
    email: null,
    phone: null,
    address: null,
    city: null,
    pin: null,
    isCashBank: null,
    unit: null,
    hsn: null,
    sku: null,
    gstRate: null,
    purchaseRate: null,
    salesRate: null,
    openingQty: null,
  };
}

/** Guess sheet kind from headers. */
export function guessSheetKind(rows: SheetRows): ImportKind {
  const limit = Math.min(rows.length, 8);
  let stock = 0;
  let party = 0;
  let ledger = 0;
  for (let r = 0; r < limit; r++) {
    const keys = (rows[r] || []).map(headerKey).join(" | ");
    if (/hsn|sku|opening qty|unit|uom|stock item/.test(keys)) stock += 2;
    if (/debtor|creditor|party|gstin|sundry/.test(keys)) party += 2;
    if (/ledger|under|opening balance|group/.test(keys)) ledger += 1;
  }
  if (stock >= party && stock >= ledger && stock > 0) return "stock";
  if (party >= ledger && party > 0) return "parties";
  return "ledgers";
}

/** Locate header row and column map for a known kind. */
export function guessColumnMap(rows: SheetRows, kind: ImportKind): MastersColumnMap | null {
  const limit = Math.min(rows.length, 12);
  let best: MastersColumnMap | null = null;
  let bestHits = 0;

  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map(headerKey);
    const mapping = emptyMap(r + 1);
    let hits = 0;
    cells.forEach((key, idx) => {
      if (!key) return;
      for (const hint of FIELD_HINTS) {
        if (!hint.kinds.includes(kind)) continue;
        if (hint.match.test(key)) {
          const cur = mapping[hint.key];
          if (cur == null || cur === -1) {
            (mapping as unknown as Record<string, number | null>)[hint.key] = idx;
            hits++;
          }
          break;
        }
      }
    });
    if (mapping.name >= 0 && hits > bestHits) {
      best = mapping;
      bestHits = hits;
    }
  }
  return best && best.name >= 0 ? best : null;
}

export function columnLabel(rows: SheetRows, headerRow: number, idx: number): string {
  const letters = String.fromCharCode(65 + (idx % 26));
  if (headerRow > 0) {
    const header = rows[headerRow - 1]?.[idx];
    if (header != null && String(header).trim()) {
      return `${letters} — ${String(header).trim().slice(0, 32)}`;
    }
  }
  return `Column ${letters}`;
}

export function maxColumns(rows: SheetRows): number {
  let m = 0;
  for (const row of rows.slice(0, 20)) m = Math.max(m, (row || []).length);
  return m;
}

export function truthyFlag(value: unknown): boolean {
  const s = cellText(value).toLowerCase();
  return s === "1" || s === "y" || s === "yes" || s === "true" || s === "bank" || s === "cash";
}

export function partyKindFromValue(value: unknown): "debtor" | "creditor" {
  const s = cellText(value).toLowerCase();
  if (/creditor|payable|supplier|vendor/.test(s)) return "creditor";
  return "debtor";
}

export function stateFromGstinOrCell(gstin: string, stateCell: unknown): string {
  const fromGstin = gstin && isValidGstin(normalizeGstin(gstin))
    ? stateCodeFromGstin(normalizeGstin(gstin))
    : null;
  return fromGstin || parseStateCode(stateCell);
}
