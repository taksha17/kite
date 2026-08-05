import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readFile, remove } from "@tauri-apps/plugin-fs";
import { getAppDataDir } from "../db/backup";
import { getActiveCompanyDb } from "../db/active";
import { amountInWordsInr } from "./amountInWords";
import type {
  InvoiceCompany,
  InvoiceLine,
  SalesInvoiceData,
  SmtpSettings,
} from "./types";

async function metaMap(): Promise<Record<string, string>> {
  const db = getActiveCompanyDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM meta",
  );
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

async function upsertMeta(key: string, value: string): Promise<void> {
  const db = getActiveCompanyDb();
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadLogoDataUrl(relPath: string): Promise<string> {
  if (!relPath) return "";
  const appData = await getAppDataDir();
  const path = `${appData}/${relPath}`;
  if (!(await exists(path))) return "";
  const bytes = await readFile(path);
  const ext = relPath.split(".").pop()?.toLowerCase() || "png";
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export async function getCompanyProfile(): Promise<InvoiceCompany> {
  const m = await metaMap();
  const logoRel = m.logo_path || "";
  return {
    name: m.company_name || "Company",
    gstin: m.gstin || "",
    stateCode: m.state_code || "",
    address: m.address || "",
    phone: m.phone || "",
    email: m.email || "",
    website: m.website || "",
    pan: m.pan || "",
    cin: m.cin || "",
    businessTagline: m.business_tagline || "",
    bankName: m.bank_name || "",
    bankBranch: m.bank_branch || "",
    bankAccount: m.bank_account || "",
    bankIfsc: m.bank_ifsc || "",
    upiId: m.upi_id || "",
    invoiceTerms: m.invoice_terms || "",
    logoDataUrl: await loadLogoDataUrl(logoRel),
  };
}

export async function saveCompanyProfile(input: {
  address: string;
  phone: string;
  email: string;
  website: string;
  pan: string;
  cin: string;
  businessTagline: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankIfsc: string;
  upiId: string;
  invoiceTerms: string;
}): Promise<void> {
  for (const [key, value] of Object.entries({
    address: input.address.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    website: input.website.trim(),
    pan: input.pan.trim().toUpperCase(),
    cin: input.cin.trim().toUpperCase(),
    business_tagline: input.businessTagline.trim(),
    bank_name: input.bankName.trim(),
    bank_branch: input.bankBranch.trim(),
    bank_account: input.bankAccount.trim(),
    bank_ifsc: input.bankIfsc.trim().toUpperCase(),
    upi_id: input.upiId.trim(),
    invoice_terms: input.invoiceTerms.trim(),
  })) {
    await upsertMeta(key, value);
  }
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const m = await metaMap();
  return {
    host: m.smtp_host || "",
    port: Number(m.smtp_port || 587) || 587,
    username: m.smtp_username || "",
    password: m.smtp_password || "",
    fromEmail: m.smtp_from_email || m.email || "",
    fromName: m.smtp_from_name || m.company_name || "",
    useStarttls: (m.smtp_starttls || "1") !== "0",
  };
}

export async function saveSmtpSettings(input: SmtpSettings): Promise<void> {
  await upsertMeta("smtp_host", input.host.trim());
  await upsertMeta("smtp_port", String(input.port || 587));
  await upsertMeta("smtp_username", input.username.trim());
  await upsertMeta("smtp_password", input.password);
  await upsertMeta("smtp_from_email", input.fromEmail.trim());
  await upsertMeta("smtp_from_name", input.fromName.trim());
  await upsertMeta("smtp_starttls", input.useStarttls ? "1" : "0");
}

/** Pick an image and store it under app data; returns relative logo path. */
export async function pickAndSaveCompanyLogo(
  companySlug: string,
): Promise<string> {
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
    ],
  });
  if (!selected || Array.isArray(selected)) {
    throw new Error("No logo selected.");
  }

  const appData = await getAppDataDir();
  const dir = `${appData}/logos`;
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }

  const ext = selected.split(".").pop()?.toLowerCase() || "png";
  const safeExt = ["png", "jpg", "jpeg", "webp"].includes(ext) ? ext : "png";
  const rel = `logos/${companySlug}.${safeExt}`;
  const dest = `${appData}/${rel}`;
  await copyFile(selected, dest);
  await upsertMeta("logo_path", rel);
  return rel;
}

export async function clearCompanyLogo(): Promise<void> {
  const m = await metaMap();
  const rel = m.logo_path || "";
  if (rel) {
    const appData = await getAppDataDir();
    const path = `${appData}/${rel}`;
    if (await exists(path)) {
      try {
        await remove(path);
      } catch {
        // ignore missing/unlink failures
      }
    }
  }
  await upsertMeta("logo_path", "");
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function fetchSalesInvoice(
  voucherId: number,
): Promise<SalesInvoiceData> {
  const db = getActiveCompanyDb();
  const vouchers = await db.select<
    {
      id: number;
      date: string;
      number: string | null;
      narration: string | null;
      voucher_type: string;
      place_of_supply: string | null;
      is_interstate: number;
      gst_rate: number | null;
      taxable_value: number | null;
      cgst_amount: number;
      sgst_amount: number;
      igst_amount: number;
      total_amount: number;
      party_ledger_id: number | null;
      payment_mode: string | null;
      reverse_charge: number | null;
      buyer_order_no: string | null;
      supplier_ref: string | null;
      vehicle_no: string | null;
      delivery_date: string | null;
      transport: string | null;
      terms_of_delivery: string | null;
      ship_to_name: string | null;
      ship_to_address: string | null;
      ship_to_state: string | null;
      ship_to_gstin: string | null;
      freight_amount: number | null;
      round_off: number | null;
      ewb_no: string | null;
      ewb_date: string | null;
      ewb_valid_upto: string | null;
      trans_distance: string | null;
    }[]
  >("SELECT * FROM voucher WHERE id = $1", [voucherId]);

  const v = vouchers[0];
  if (!v) throw new Error("Voucher not found.");
  if (v.voucher_type !== "sales") {
    throw new Error("PDF invoices are available for Sales vouchers only.");
  }

  let party = {
    name: "Customer",
    gstin: "",
    stateCode: "",
    email: "",
    address: "",
  };
  if (v.party_ledger_id) {
    const parties = await db.select<
      {
        name: string;
        gstin: string | null;
        state_code: string | null;
        email: string | null;
        address: string | null;
      }[]
    >(
      "SELECT name, gstin, state_code, email, address FROM ledger WHERE id = $1",
      [v.party_ledger_id],
    );
    if (parties[0]) {
      party = {
        name: parties[0].name,
        gstin: parties[0].gstin || "",
        stateCode: parties[0].state_code || "",
        email: parties[0].email || "",
        address: parties[0].address || "",
      };
    }
  }

  const movements = await db.select<
    {
      qty_out: number;
      rate: number;
      amount: number;
      item_name: string;
      hsn_sac: string | null;
      gst_rate: number | null;
      unit_symbol: string | null;
      batch_no: string | null;
      serial_no: string | null;
      line_description: string | null;
    }[]
  >(
    `SELECT m.qty_out, m.rate, m.amount, i.name as item_name, i.hsn_sac,
            i.gst_rate, u.symbol as unit_symbol,
            m.batch_no, m.serial_no, m.line_description
     FROM stock_movement m
     JOIN stock_item i ON i.id = m.item_id
     LEFT JOIN unit u ON u.id = i.unit_id
     WHERE m.voucher_id = $1
     ORDER BY m.id`,
    [voucherId],
  );

  const company = await getCompanyProfile();
  const voucherGstRate = Number(v.gst_rate || 0);
  const taxable = Number(v.taxable_value || v.total_amount || 0);
  const cgst = Number(v.cgst_amount || 0);
  const sgst = Number(v.sgst_amount || 0);
  const igst = Number(v.igst_amount || 0);
  const booksTotal = Number(v.total_amount || 0);
  const freight = Number(v.freight_amount || 0);
  const roundOff = Number(v.round_off || 0);
  const printedTotal = round2(booksTotal + freight + roundOff);

  const lines: InvoiceLine[] =
    movements.length > 0
      ? movements.map((m) => {
          const lineTaxable = Number(m.amount) || 0;
          const lineRate =
            Number(m.gst_rate) || voucherGstRate || 0;
          const gstAmount = round2((lineTaxable * lineRate) / 100);
          return {
            description: m.item_name,
            lineDescription: m.line_description || "",
            batchNo: m.batch_no || "",
            serialNo: m.serial_no || "",
            hsnSac: m.hsn_sac || "",
            qty: Number(m.qty_out) || null,
            unit: m.unit_symbol || "",
            rate: Number(m.rate) || null,
            taxable: lineTaxable,
            gstRate: lineRate,
            gstAmount,
            lineTotal: round2(lineTaxable + gstAmount),
          };
        })
      : [
          {
            description: v.narration || "Sales",
            lineDescription: "",
            batchNo: "",
            serialNo: "",
            hsnSac: "",
            qty: null,
            unit: "",
            rate: null,
            taxable,
            gstRate: voucherGstRate,
            gstAmount: round2(cgst + sgst + igst),
            lineTotal: booksTotal,
          },
        ];

  return {
    voucherId: v.id,
    date: v.date,
    number: v.number || `S-${v.id}`,
    narration: v.narration || "",
    placeOfSupply: v.place_of_supply || company.stateCode || "",
    isInterstate: Boolean(v.is_interstate),
    gstRate: voucherGstRate,
    taxableValue: taxable,
    cgst,
    sgst,
    igst,
    booksTotal,
    freight,
    roundOff,
    total: printedTotal,
    amountInWords: amountInWordsInr(printedTotal),
    paymentMode: v.payment_mode || "",
    reverseCharge: Boolean(v.reverse_charge),
    buyerOrderNo: v.buyer_order_no || "",
    supplierRef: v.supplier_ref || "",
    vehicleNo: v.vehicle_no || "",
    deliveryDate: v.delivery_date || "",
    transport: v.transport || "",
    termsOfDelivery: v.terms_of_delivery || "",
    ewbNo: v.ewb_no || "",
    ewbDate: v.ewb_date || "",
    ewbValidUpto: v.ewb_valid_upto || "",
    transDistance: v.trans_distance || "",
    company,
    party,
    shipTo: {
      name: v.ship_to_name || "",
      address: v.ship_to_address || "",
      stateCode: v.ship_to_state || "",
      gstin: v.ship_to_gstin || "",
    },
    lines,
  };
}
