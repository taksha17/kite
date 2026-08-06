import { getActiveCompanyDb } from "./active";
import type { IrpCredentials, IrpEnvironment } from "../einvoice/types";

const META_KEY = "irp_einv_credentials";

export const IRP_PRESET_URLS: Record<IrpEnvironment, string> = {
  sandbox: "https://einv-apisandbox.nic.in",
  production: "https://einvoice1.gst.gov.in",
};

export function emptyIrpCredentials(): IrpCredentials {
  return {
    environment: "sandbox",
    baseUrl: "",
    gstin: "",
    username: "",
    password: "",
    clientId: "",
    clientSecret: "",
    publicKeyPem: "",
  };
}

export function resolveIrpBaseUrl(creds: IrpCredentials): string {
  const custom = creds.baseUrl.trim().replace(/\/$/, "");
  if (custom) return custom;
  return IRP_PRESET_URLS[creds.environment];
}

async function upsertMeta(key: string, value: string): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getIrpCredentials(): Promise<IrpCredentials> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [META_KEY],
  );
  if (!rows[0]?.value) return emptyIrpCredentials();
  try {
    return { ...emptyIrpCredentials(), ...JSON.parse(rows[0].value) };
  } catch {
    return emptyIrpCredentials();
  }
}

export async function saveIrpCredentials(
  creds: IrpCredentials,
): Promise<void> {
  await upsertMeta(META_KEY, JSON.stringify(creds));
}

export async function saveVoucherIrn(input: {
  voucherId: number;
  irn: string;
  ackNo: string;
  ackDt: string;
  signedQr: string;
  status: string;
}): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `UPDATE voucher SET
      irn = $1,
      irn_ack_no = $2,
      irn_ack_date = $3,
      irn_signed_qr = $4,
      irn_status = $5,
      irn_cancel_date = NULL
     WHERE id = $6`,
    [input.irn, input.ackNo, input.ackDt, input.signedQr, input.status, input.voucherId],
  );
}

export async function markVoucherIrnCancelled(
  voucherId: number,
  cancelDate: string,
): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `UPDATE voucher SET irn_status = 'CNL', irn_cancel_date = $1 WHERE id = $2`,
    [cancelDate, voucherId],
  );
}
