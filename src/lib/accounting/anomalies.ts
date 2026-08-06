import type { VoucherRow } from "../db/types";

export type AnomalySeverity = "info" | "warn";

export interface Anomaly {
  id: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  href: string;
}

/** Duplicate bill/voucher numbers within the same voucher type. */
export function findDuplicateNumbers(vouchers: VoucherRow[]): Anomaly[] {
  const keyCount = new Map<string, VoucherRow[]>();
  for (const v of vouchers) {
    const num = (v.number || "").trim().toLowerCase();
    if (!num) continue;
    const key = `${v.voucher_type}|${num}`;
    const list = keyCount.get(key) || [];
    list.push(v);
    keyCount.set(key, list);
  }
  const out: Anomaly[] = [];
  for (const [, list] of keyCount) {
    if (list.length < 2) continue;
    const sample = list[0];
    out.push({
      id: `dup-${sample.voucher_type}-${sample.number}`,
      severity: "warn",
      title: `Duplicate ${sample.voucher_type} number “${sample.number}”`,
      detail: `${list.length} vouchers share this number (ids ${list.map((v) => v.id).join(", ")}).`,
      href: "/vouchers",
    });
  }
  return out;
}

/**
 * Amounts far above the typical sale/purchase for this books sample.
 * Uses median × multiplier; needs at least 5 vouchers of that type.
 */
export function findUnusualAmounts(
  vouchers: VoucherRow[],
  types: string[] = ["sales", "purchase", "payment", "receipt"],
  multiplier = 5,
): Anomaly[] {
  const out: Anomaly[] = [];
  for (const type of types) {
    const amounts = vouchers
      .filter((v) => v.voucher_type === type && (v.total_amount || 0) > 0)
      .map((v) => Number(v.total_amount) || 0)
      .sort((a, b) => a - b);
    if (amounts.length < 5) continue;
    const mid = amounts[Math.floor(amounts.length / 2)];
    if (mid < 1) continue;
    const threshold = mid * multiplier;
    for (const v of vouchers) {
      if (v.voucher_type !== type) continue;
      const amt = Number(v.total_amount) || 0;
      if (amt >= threshold) {
        out.push({
          id: `amt-${v.id}`,
          severity: "info",
          title: `Unusual ${type} amount ₹${amt.toLocaleString("en-IN")}`,
          detail: `Median ${type} is about ₹${Math.round(mid).toLocaleString("en-IN")} — this is ${multiplier}×+ larger (voucher #${v.id}${v.number ? ` · ${v.number}` : ""}).`,
          href: `/vouchers/${v.id}/edit`,
        });
      }
    }
  }
  return out;
}

/** Weekend-dated vouchers (Sat/Sun) — often worth a glance. */
export function findWeekendEntries(vouchers: VoucherRow[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const v of vouchers) {
    const d = new Date(`${v.date}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getDay();
    if (day !== 0 && day !== 6) continue;
    out.push({
      id: `weekend-${v.id}`,
      severity: "info",
      title: `Weekend ${v.voucher_type} on ${v.date}`,
      detail: `Posted on a ${day === 0 ? "Sunday" : "Saturday"}${v.number ? ` · ${v.number}` : ""} · ₹${Number(v.total_amount || 0).toLocaleString("en-IN")}.`,
      href: `/vouchers/${v.id}/edit`,
    });
  }
  return out;
}

export function collectAnomalies(vouchers: VoucherRow[]): Anomaly[] {
  return [
    ...findDuplicateNumbers(vouchers),
    ...findUnusualAmounts(vouchers),
    ...findWeekendEntries(vouchers),
  ].slice(0, 50);
}
