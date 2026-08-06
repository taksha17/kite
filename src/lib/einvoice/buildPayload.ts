import type { SalesInvoiceData } from "../invoice/types";
import {
  extractPincode,
  mapQtyUnit,
  parseStateCode,
  splitAddress,
  toNicDate,
} from "../ewaybill/buildPayload";
import type { IrpInvoiceRequest } from "./types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function requirePin(value: number | null, who: string): number {
  if (!value) {
    throw new Error(
      `${who} PIN code (6 digits) is required for e-invoice. Add it to the address/master.`,
    );
  }
  return value;
}

function hsnCode(hsn: string, lineDesc: string): string {
  const digits = (hsn || "").replace(/\D/g, "");
  if (digits.length < 4) {
    throw new Error(
      `Line "${lineDesc}" needs a 4+ digit HSN/SAC before generating an e-invoice.`,
    );
  }
  return digits.slice(0, 8);
}

/** DocDtls.No must match ^[1-9a-zA-Z][0-9a-zA-Z\/-]{1,15}$ */
function sanitizeDocNo(raw: string, voucherId: number): string {
  const cleaned = (raw || "")
    .replace(/[^0-9a-zA-Z\/-]/g, "")
    .replace(/^[0\/-]+/, "")
    .slice(0, 16);
  if (cleaned.length >= 2) return cleaned;
  return `S-${voucherId}`.slice(0, 16);
}

function stateCode2(code: string, gstin: string, who: string): string {
  const n = parseStateCode(code, gstin);
  if (n < 1 || n > 99) {
    throw new Error(`${who} state code "${code}" is invalid.`);
  }
  return String(n).padStart(2, "0");
}

export function buildIrpInvoicePayload(inv: SalesInvoiceData): IrpInvoiceRequest {
  const sellerGstin = (inv.company.gstin || "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(sellerGstin)) {
    throw new Error(
      "Company GSTIN (15 chars) is required for e-invoice. Set it under Companies.",
    );
  }

  const buyerGstin = (inv.party.gstin || "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(buyerGstin)) {
    throw new Error(
      "e-Invoice applies to B2B supplies — the party needs a valid 15-character GSTIN on its ledger.",
    );
  }

  if (inv.lines.length === 0) {
    throw new Error("Invoice has no line items for e-invoice.");
  }

  const sellerAddr = splitAddress(inv.company.address);
  const sellerPin = requirePin(
    extractPincode(inv.company.address),
    "Company",
  );
  const sellerStcd = stateCode2(inv.company.stateCode, sellerGstin, "Company");

  const buyerAddr = splitAddress(inv.party.address);
  const buyerPin = requirePin(
    extractPincode(inv.party.pin) ?? extractPincode(inv.party.address),
    "Party",
  );
  const buyerStcd = stateCode2(inv.party.stateCode, buyerGstin, "Party");
  const buyerLoc = (inv.party.city || buyerAddr.place || "Place").slice(0, 50);

  const pos = stateCode2(
    inv.placeOfSupply || inv.party.stateCode,
    buyerGstin,
    "Place of supply",
  );

  const interstate = inv.isInterstate || sellerStcd !== pos;

  const itemList = inv.lines.map((line, i) => {
    const hsn = hsnCode(line.hsnSac, line.description);
    const qty = Number(line.qty) > 0 ? Number(line.qty) : 1;
    const unitPrice =
      Number(line.rate) > 0 ? Number(line.rate) : round2(line.taxable / qty);
    const totAmt = round2(unitPrice * qty);
    const assAmt = round2(line.taxable);
    const gstRt = Number(line.gstRate) || Number(inv.gstRate) || 0;
    const lineGst = round2(line.gstAmount);
    const igstAmt = interstate ? lineGst : 0;
    const half = interstate ? 0 : round2(lineGst / 2);
    const sgstAmt = half;
    const cgstAmt = interstate ? 0 : round2(lineGst - half);
    return {
      SlNo: String(i + 1),
      PrdDesc: (line.description || "Item").slice(0, 300),
      IsServc: "N" as const,
      HsnCd: hsn,
      Qty: qty,
      Unit: mapQtyUnit(line.unit),
      UnitPrice: unitPrice,
      TotAmt: totAmt,
      ...(totAmt > assAmt ? { Discount: round2(totAmt - assAmt) } : {}),
      AssAmt: assAmt,
      GstRt: gstRt,
      IgstAmt: igstAmt,
      CgstAmt: cgstAmt,
      SgstAmt: sgstAmt,
      TotItemVal: round2(assAmt + igstAmt + cgstAmt + sgstAmt),
    };
  });

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: inv.reverseCharge ? "Y" : "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: "INV",
      No: sanitizeDocNo(inv.number, inv.voucherId),
      Dt: toNicDate(inv.date),
    },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: inv.company.name.slice(0, 100),
      TrdNm: inv.company.name.slice(0, 100),
      Addr1: sellerAddr.line1,
      Addr2: sellerAddr.line2,
      Loc: sellerAddr.place.slice(0, 50),
      Pin: sellerPin,
      Stcd: sellerStcd,
    },
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: inv.party.name.slice(0, 100),
      Pos: pos,
      Addr1: buyerAddr.line1,
      Addr2: buyerAddr.line2,
      Loc: buyerLoc,
      Pin: buyerPin,
      Stcd: buyerStcd,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: round2(inv.taxableValue),
      CgstVal: round2(inv.cgst),
      SgstVal: round2(inv.sgst),
      IgstVal: round2(inv.igst),
      OthChrg: round2(inv.freight),
      RndOffAmt: round2(inv.roundOff),
      TotInvVal: round2(inv.total),
    },
  };
}
