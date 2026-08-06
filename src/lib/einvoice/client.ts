import { invoke } from "@tauri-apps/api/core";
import {
  getIrpCredentials,
  markVoucherIrnCancelled,
  resolveIrpBaseUrl,
  saveVoucherIrn,
} from "../db/einvoice";
import type { SalesInvoiceData } from "../invoice/types";
import { buildIrpInvoicePayload } from "./buildPayload";
import type { IrnCancelResult, IrnGenerateResult } from "./types";

async function credArgs() {
  const creds = await getIrpCredentials();
  return {
    baseUrl: resolveIrpBaseUrl(creds),
    gstin: creds.gstin.trim().toUpperCase(),
    username: creds.username.trim(),
    password: creds.password,
    clientId: creds.clientId.trim(),
    clientSecret: creds.clientSecret.trim(),
    publicKeyPem: creds.publicKeyPem.trim(),
  };
}

export async function testIrpAuth(): Promise<void> {
  await invoke("nic_einv_auth", await credArgs());
}

export async function generateIrnForInvoice(
  inv: SalesInvoiceData,
): Promise<IrnGenerateResult & { saved: true }> {
  if (inv.irn && inv.irnStatus !== "CNL") {
    throw new Error(
      `This invoice already has an active IRN. Cancel it first if regeneration is truly needed.`,
    );
  }
  const args = await credArgs();
  if (!args.gstin) {
    args.gstin = (inv.company.gstin || "").trim().toUpperCase();
  }
  const payload = buildIrpInvoicePayload(inv);

  const result = await invoke<IrnGenerateResult>("nic_einv_generate", {
    ...args,
    payload,
  });

  await saveVoucherIrn({
    voucherId: inv.voucherId,
    irn: result.irn,
    ackNo: result.ackNo,
    ackDt: result.ackDt,
    signedQr: result.signedQrCode,
    status: result.status || "ACT",
  });

  return { ...result, saved: true };
}

export async function cancelIrnForInvoice(
  inv: SalesInvoiceData,
  reason: string,
  remark: string,
): Promise<IrnCancelResult & { saved: true }> {
  if (!inv.irn || inv.irnStatus === "CNL") {
    throw new Error("No active IRN on this invoice to cancel.");
  }
  const args = await credArgs();
  const result = await invoke<IrnCancelResult>("nic_einv_cancel", {
    ...args,
    irn: inv.irn,
    reason,
    remark,
  });
  await markVoucherIrnCancelled(inv.voucherId, result.cancelDate);
  return { ...result, saved: true };
}
