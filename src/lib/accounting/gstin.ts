import { INDIA_STATES } from "./gst";

/** Canonical GSTIN: uppercase, no spaces. */
export function normalizeGstin(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Structural check for a 15-char GSTIN (state + PAN + entity + Z + check).
 * Does not verify the checksum digit — enough to catch OCR/AI garbage.
 */
export function isValidGstin(raw: string): boolean {
  const g = normalizeGstin(raw);
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g);
}

/** First two digits of a GSTIN → Indian state code, if known. */
export function stateCodeFromGstin(raw: string): string | null {
  const g = normalizeGstin(raw);
  if (g.length < 2) return null;
  const code = g.slice(0, 2);
  return INDIA_STATES.some((s) => s.code === code) ? code : null;
}

/**
 * Empty → undefined. Non-empty must be a valid GSTIN or throws.
 * Use on party create / inline form save.
 */
export function assertGstinOrEmpty(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  const g = normalizeGstin(raw);
  if (!isValidGstin(g)) {
    throw new Error(
      `GSTIN “${raw.trim()}” is not valid — use 15 characters like 29AAAAA0000A1Z5.`,
    );
  }
  return g;
}
