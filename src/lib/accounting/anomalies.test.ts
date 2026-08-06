import { describe, expect, it } from "vitest";
import {
  collectAnomalies,
  findDuplicateNumbers,
  findUnusualAmounts,
  findWeekendEntries,
} from "./anomalies";
import type { VoucherRow } from "../db/types";

function v(
  partial: Partial<VoucherRow> & {
    id: number;
    voucher_type: string;
    date: string;
    total_amount: number;
  },
): VoucherRow {
  return {
    number: null,
    narration: null,
    party_ledger_id: null,
    place_of_supply: null,
    is_interstate: 0,
    hsn_sac: null,
    gst_rate: null,
    taxable_value: null,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    payment_mode: null,
    reverse_charge: 0,
    buyer_order_no: null,
    supplier_ref: null,
    vehicle_no: null,
    delivery_date: null,
    transport: null,
    terms_of_delivery: null,
    ship_to_name: null,
    ship_to_address: null,
    ship_to_state: null,
    ship_to_gstin: null,
    freight_amount: 0,
    round_off: 0,
    external_source: null,
    external_id: null,
    ewb_no: null,
    ewb_date: null,
    ewb_valid_upto: null,
    trans_distance: null,
    irn: null,
    irn_ack_no: null,
    irn_ack_date: null,
    ...partial,
  } as VoucherRow;
}

describe("findDuplicateNumbers", () => {
  it("flags same type + number", () => {
    const a = findDuplicateNumbers([
      v({ id: 1, voucher_type: "sales", date: "2026-08-01", total_amount: 100, number: "INV-1" }),
      v({ id: 2, voucher_type: "sales", date: "2026-08-02", total_amount: 200, number: "INV-1" }),
      v({ id: 3, voucher_type: "purchase", date: "2026-08-02", total_amount: 50, number: "INV-1" }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].title).toMatch(/INV-1/);
  });
});

describe("findUnusualAmounts", () => {
  it("needs enough samples and flags outliers", () => {
    const rows = [100, 110, 90, 105, 95, 5000].map((amt, i) =>
      v({
        id: i + 1,
        voucher_type: "sales",
        date: "2026-08-01",
        total_amount: amt,
      }),
    );
    const a = findUnusualAmounts(rows, ["sales"], 5);
    expect(a.some((x) => x.id === "amt-6")).toBe(true);
  });
});

describe("findWeekendEntries", () => {
  it("flags Saturday dates", () => {
    // 2026-08-01 is Saturday
    const a = findWeekendEntries([
      v({ id: 1, voucher_type: "payment", date: "2026-08-01", total_amount: 50 }),
      v({ id: 2, voucher_type: "payment", date: "2026-08-03", total_amount: 50 }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("weekend-1");
  });
});

describe("collectAnomalies", () => {
  it("caps combined list", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      v({
        id: i + 1,
        voucher_type: "journal",
        date: "2026-08-01",
        total_amount: 10,
        number: `J-${i}`,
      }),
    );
    expect(collectAnomalies(rows).length).toBeLessThanOrEqual(50);
  });
});
