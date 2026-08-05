import { invoke } from "@tauri-apps/api/core";
import {
  getNicCredentials,
  resolveNicBaseUrl,
  saveVoucherEwayBill,
} from "../db/ewaybill";
import type { SalesInvoiceData } from "../invoice/types";
import { buildGenEwayBillPayload } from "./buildPayload";
import type { GenerateEwayOptions, NicGenerateResult } from "./types";

export async function testNicAuth(): Promise<void> {
  const creds = await getNicCredentials();
  await invoke("nic_eway_auth", {
    baseUrl: resolveNicBaseUrl(creds),
    gstin: (creds.gstin || "").trim().toUpperCase(),
    username: creds.username.trim(),
    password: creds.password,
    clientId: creds.clientId.trim(),
    clientSecret: creds.clientSecret.trim(),
    publicKeyPem: creds.publicKeyPem.trim(),
  });
}

export async function generateEwayBillForInvoice(
  inv: SalesInvoiceData,
  opts: GenerateEwayOptions,
): Promise<NicGenerateResult & { saved: true }> {
  if (inv.ewbNo) {
    throw new Error(
      `This invoice already has e-way bill ${inv.ewbNo}. Cancel on the NIC portal before regenerating.`,
    );
  }

  const creds = await getNicCredentials();
  const payload = buildGenEwayBillPayload(inv, opts);

  const result = await invoke<{
    ewayBillNo: string;
    ewayBillDate: string;
    validUpto: string;
    alert: string;
    raw: string;
  }>("nic_eway_generate", {
    baseUrl: resolveNicBaseUrl(creds),
    gstin: (creds.gstin || inv.company.gstin || "").trim().toUpperCase(),
    username: creds.username.trim(),
    password: creds.password,
    clientId: creds.clientId.trim(),
    clientSecret: creds.clientSecret.trim(),
    publicKeyPem: creds.publicKeyPem.trim(),
    payload,
  });

  await saveVoucherEwayBill({
    voucherId: inv.voucherId,
    ewbNo: result.ewayBillNo,
    ewbDate: result.ewayBillDate,
    ewbValidUpto: result.validUpto,
    vehicleNo: opts.vehicleNo || inv.vehicleNo,
    transDistance: opts.distanceKm,
  });

  return {
    ewayBillNo: result.ewayBillNo,
    ewayBillDate: result.ewayBillDate,
    validUpto: result.validUpto,
    alert: result.alert || "",
    raw: result.raw,
    saved: true,
  };
}
