import { getActiveCompanyDb } from "./active";

export type NicEnvironment = "sandbox" | "production";

export interface NicEwayCredentials {
  environment: NicEnvironment;
  /** Optional override; empty = preset for environment */
  baseUrl: string;
  gstin: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  /** NIC e-way bill RSA public key PEM (from sandbox/portal docs) */
  publicKeyPem: string;
}

const META_KEY = "nic_eway_credentials";

export const NIC_PRESET_URLS: Record<NicEnvironment, string> = {
  sandbox: "https://ewb1api.gstsandbox.nic.in/ewaybillapi/v1.03",
  production: "https://ewaybillapi.nic.in/ewaybillapi/v1.03",
};

export function emptyNicCredentials(): NicEwayCredentials {
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

export function resolveNicBaseUrl(creds: NicEwayCredentials): string {
  const custom = creds.baseUrl.trim().replace(/\/$/, "");
  if (custom) return custom;
  return NIC_PRESET_URLS[creds.environment];
}

async function upsertMeta(key: string, value: string): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getNicCredentials(): Promise<NicEwayCredentials> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [META_KEY],
  );
  if (!rows[0]?.value) return emptyNicCredentials();
  try {
    return { ...emptyNicCredentials(), ...JSON.parse(rows[0].value) };
  } catch {
    return emptyNicCredentials();
  }
}

export async function saveNicCredentials(
  creds: NicEwayCredentials,
): Promise<void> {
  await upsertMeta(META_KEY, JSON.stringify(creds));
}

export async function saveVoucherEwayBill(input: {
  voucherId: number;
  ewbNo: string;
  ewbDate: string;
  ewbValidUpto: string;
  vehicleNo?: string;
  transDistance?: string;
}): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `UPDATE voucher SET
      ewb_no = $1,
      ewb_date = $2,
      ewb_valid_upto = $3,
      vehicle_no = COALESCE(NULLIF($4, ''), vehicle_no),
      trans_distance = COALESCE(NULLIF($5, ''), trans_distance)
     WHERE id = $6`,
    [
      input.ewbNo,
      input.ewbDate,
      input.ewbValidUpto,
      input.vehicleNo?.trim() || "",
      input.transDistance?.trim() || "",
      input.voucherId,
    ],
  );
}
