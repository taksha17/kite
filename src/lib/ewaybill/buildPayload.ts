import type { SalesInvoiceData } from "../invoice/types";
import type { GenerateEwayOptions, NicGenEwayBillRequest } from "./types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function toNicDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(iso.trim())) return iso.trim();
  throw new Error(`Invoice date must be YYYY-MM-DD (got "${iso}").`);
}

export function parseStateCode(code: string, gstin?: string): number {
  const fromGstin = (gstin || "").trim().slice(0, 2);
  const raw = (code || fromGstin || "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 99) {
    throw new Error(
      `Invalid state code "${code || ""}". Set company/party GST state codes.`,
    );
  }
  return n;
}

/** First 6-digit Indian PIN in text, or null. */
export function extractPincode(text: string): number | null {
  const m = /\b(\d{6})\b/.exec(text || "");
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 100000 && n <= 999999 ? n : null;
}

function splitAddress(addr: string): { line1: string; line2: string; place: string } {
  const lines = (addr || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line1 = (lines[0] || "Address").slice(0, 120);
  const line2 = (lines[1] || "").slice(0, 120);
  const place = (lines[lines.length - 1] || lines[0] || "Place")
    .replace(/\b\d{6}\b/g, "")
    .replace(/,\s*$/, "")
    .trim()
    .slice(0, 50);
  return { line1, line2, place: place || "Place" };
}

const UNIT_MAP: Record<string, string> = {
  nos: "NOS",
  no: "NOS",
  pcs: "NOS",
  pc: "NOS",
  unit: "NOS",
  kg: "KGS",
  kgs: "KGS",
  g: "GMS",
  gm: "GMS",
  gms: "GMS",
  ltr: "LTR",
  lt: "LTR",
  l: "LTR",
  mtr: "MTR",
  m: "MTR",
  box: "BOX",
  bag: "BAG",
  set: "SET",
  doz: "DOZ",
  ton: "TON",
  qtl: "QTL",
};

function mapQtyUnit(symbol: string): string {
  const key = (symbol || "").trim().toLowerCase();
  if (!key) return "NOS";
  const upper = key.toUpperCase();
  if (UNIT_MAP[key]) return UNIT_MAP[key];
  // NIC units are usually 3-letter codes
  return upper.slice(0, 3) || "NOS";
}

function hsnNumber(hsn: string): number {
  const digits = (hsn || "").replace(/\D/g, "");
  if (!digits) {
    throw new Error(
      "Each stock line needs an HSN/SAC code before generating an e-way bill.",
    );
  }
  const n = Number(digits.slice(0, 8));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid HSN/SAC "${hsn}".`);
  }
  return n;
}

export function buildGenEwayBillPayload(
  inv: SalesInvoiceData,
  opts: GenerateEwayOptions,
): NicGenEwayBillRequest {
  const fromGstin = (inv.company.gstin || "").trim().toUpperCase();
  if (fromGstin.length !== 15) {
    throw new Error("Company GSTIN (15 chars) is required for e-way bill.");
  }

  const shipGstin = (inv.shipTo.gstin || inv.party.gstin || "").trim().toUpperCase();
  const toGstin = shipGstin.length === 15 ? shipGstin : "URP";

  const fromState = parseStateCode(inv.company.stateCode, fromGstin);
  const toStateRaw = inv.shipTo.stateCode || inv.placeOfSupply || inv.party.stateCode;
  const toState = parseStateCode(toStateRaw, shipGstin || undefined);

  const billAddr = splitAddress(inv.company.address);
  const shipName = inv.shipTo.name || inv.party.name;
  const shipAddrText = inv.shipTo.address || inv.party.address;
  const shipAddr = splitAddress(shipAddrText);

  const shipDiffers =
    Boolean(inv.shipTo.name && inv.shipTo.name !== inv.party.name) ||
    Boolean(inv.shipTo.address && inv.shipTo.address !== inv.party.address) ||
    Boolean(inv.shipTo.gstin && inv.shipTo.gstin !== inv.party.gstin);

  // 1 Regular; 2 Bill To – Ship To
  const transactionType = shipDiffers ? 2 : 1;

  const distance = String(opts.distanceKm || "").trim();
  if (!distance || Number(distance) < 0) {
    throw new Error("Enter transport distance in km.");
  }

  if (!opts.fromPincode || !opts.toPincode) {
    throw new Error("From and To PIN codes (6 digits) are required.");
  }

  const vehicleNo = (opts.vehicleNo || inv.vehicleNo || "").trim().toUpperCase();
  const interstate = inv.isInterstate || fromState !== toState;

  if (inv.lines.length === 0) {
    throw new Error("Invoice has no line items for e-way bill.");
  }

  const itemList = inv.lines.map((line) => {
    const rate = Number(line.gstRate) || Number(inv.gstRate) || 0;
    const half = round2(rate / 2);
    return {
      productName: (line.description || "Item").slice(0, 100),
      productDesc: (line.lineDescription || line.description || "Item").slice(
        0,
        100,
      ),
      hsnCode: hsnNumber(line.hsnSac),
      quantity: Number(line.qty) > 0 ? Number(line.qty) : 1,
      qtyUnit: mapQtyUnit(line.unit),
      cgstRate: interstate ? 0 : half,
      sgstRate: interstate ? 0 : half,
      igstRate: interstate ? rate : 0,
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount: round2(line.taxable),
    };
  });

  const docNo = (inv.number || `S-${inv.voucherId}`).slice(0, 16);

  return {
    supplyType: "O",
    subSupplyType: "1",
    subSupplyDesc: "",
    docType: "INV",
    docNo,
    docDate: toNicDate(inv.date),
    fromGstin,
    fromTrdName: inv.company.name.slice(0, 100),
    fromAddr1: billAddr.line1,
    fromAddr2: billAddr.line2,
    fromPlace: (opts.fromPlace || billAddr.place).slice(0, 50),
    fromPincode: opts.fromPincode,
    actFromStateCode: fromState,
    fromStateCode: fromState,
    toGstin,
    toTrdName: (shipName || inv.party.name).slice(0, 100),
    toAddr1: shipAddr.line1,
    toAddr2: shipAddr.line2,
    toPlace: (opts.toPlace || shipAddr.place).slice(0, 50),
    toPincode: opts.toPincode,
    actToStateCode: toState,
    toStateCode: toState,
    transactionType,
    otherValue: round2(inv.freight + inv.roundOff),
    totalValue: round2(inv.taxableValue),
    cgstValue: round2(inv.cgst),
    sgstValue: round2(inv.sgst),
    igstValue: round2(inv.igst),
    cessValue: 0,
    cessNonAdvolValue: 0,
    totInvValue: round2(inv.total),
    transporterId: (opts.transporterId || "").trim().toUpperCase(),
    transporterName: (opts.transporterName || inv.transport || "").slice(0, 100),
    transDocNo: "",
    transMode: opts.transMode || "1",
    transDistance: distance,
    transDocDate: "",
    vehicleNo,
    vehicleType: opts.vehicleType || "R",
    itemList,
  };
}
