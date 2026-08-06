import { describe, expect, it } from "vitest";
import type { SalesInvoiceData } from "../invoice/types";
import { buildIrpInvoicePayload } from "./buildPayload";

function baseInvoice(): SalesInvoiceData {
  return {
    voucherId: 42,
    date: "2026-08-01",
    number: "INV-26/001",
    narration: "",
    placeOfSupply: "29",
    isInterstate: false,
    gstRate: 18,
    taxableValue: 2000,
    cgst: 180,
    sgst: 180,
    igst: 0,
    booksTotal: 2360,
    freight: 40,
    roundOff: 0,
    total: 2400,
    amountInWords: "",
    paymentMode: "UPI",
    reverseCharge: false,
    buyerOrderNo: "",
    supplierRef: "",
    vehicleNo: "",
    deliveryDate: "",
    transport: "",
    termsOfDelivery: "",
    ewbNo: "",
    ewbDate: "",
    ewbValidUpto: "",
    transDistance: "",
    irn: "",
    irnAckNo: "",
    irnAckDate: "",
    irnSignedQr: "",
    irnStatus: "",
    irnCancelDate: "",
    company: {
      name: "Kite Traders",
      gstin: "29AAAAA0000A1Z5",
      stateCode: "29",
      address: "12 MG Road\nBengaluru 560001",
      phone: "",
      email: "",
      website: "",
      pan: "",
      cin: "",
      businessTagline: "",
      bankName: "",
      bankBranch: "",
      bankAccount: "",
      bankIfsc: "",
      upiId: "",
      invoiceTerms: "",
      logoDataUrl: "",
    },
    party: {
      name: "Agarwal Enterprises",
      gstin: "29BBBBA1111B1Z3",
      stateCode: "29",
      email: "",
      address: "5 Residency Road",
      city: "Bengaluru",
      pin: "560025",
    },
    shipTo: { name: "", address: "", stateCode: "", gstin: "" },
    lines: [
      {
        description: "Wireless Mouse",
        lineDescription: "",
        batchNo: "",
        serialNo: "",
        hsnSac: "8471",
        qty: 4,
        unit: "Nos",
        rate: 500,
        taxable: 2000,
        gstRate: 18,
        gstAmount: 360,
        lineTotal: 2360,
      },
    ],
  };
}

describe("buildIrpInvoicePayload", () => {
  it("builds a valid intra-state B2B payload", () => {
    const p = buildIrpInvoicePayload(baseInvoice());
    expect(p.Version).toBe("1.1");
    expect(p.TranDtls).toEqual({
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: "N",
      IgstOnIntra: "N",
    });
    expect(p.DocDtls).toEqual({ Typ: "INV", No: "INV-26/001", Dt: "01/08/2026" });
    expect(p.SellerDtls.Gstin).toBe("29AAAAA0000A1Z5");
    expect(p.SellerDtls.Pin).toBe(560001);
    expect(p.SellerDtls.Stcd).toBe("29");
    expect(p.BuyerDtls.Gstin).toBe("29BBBBA1111B1Z3");
    expect(p.BuyerDtls.Pos).toBe("29");
    expect(p.BuyerDtls.Pin).toBe(560025);
    expect(p.BuyerDtls.Loc).toBe("Bengaluru");
    expect(p.ItemList).toHaveLength(1);
    const item = p.ItemList[0];
    expect(item.SlNo).toBe("1");
    expect(item.HsnCd).toBe("8471");
    expect(item.Qty).toBe(4);
    expect(item.Unit).toBe("NOS");
    expect(item.UnitPrice).toBe(500);
    expect(item.TotAmt).toBe(2000);
    expect(item.AssAmt).toBe(2000);
    expect(item.GstRt).toBe(18);
    expect(item.IgstAmt).toBe(0);
    expect(item.CgstAmt).toBe(180);
    expect(item.SgstAmt).toBe(180);
    expect(item.TotItemVal).toBe(2360);
    expect(p.ValDtls).toEqual({
      AssVal: 2000,
      CgstVal: 180,
      SgstVal: 180,
      IgstVal: 0,
      OthChrg: 40,
      RndOffAmt: 0,
      TotInvVal: 2400,
    });
  });

  it("splits IGST for inter-state supplies", () => {
    const inv = baseInvoice();
    inv.isInterstate = true;
    inv.placeOfSupply = "27";
    inv.party.stateCode = "27";
    inv.party.gstin = "27BBBBA1111B1Z3";
    inv.cgst = 0;
    inv.sgst = 0;
    inv.igst = 360;
    const p = buildIrpInvoicePayload(inv);
    expect(p.ItemList[0].IgstAmt).toBe(360);
    expect(p.ItemList[0].CgstAmt).toBe(0);
    expect(p.ValDtls.IgstVal).toBe(360);
  });

  it("rejects missing party GSTIN with a clear message", () => {
    const inv = baseInvoice();
    inv.party.gstin = "";
    expect(() => buildIrpInvoicePayload(inv)).toThrow(/B2B/);
  });

  it("rejects missing company GSTIN", () => {
    const inv = baseInvoice();
    inv.company.gstin = "";
    expect(() => buildIrpInvoicePayload(inv)).toThrow(/Company GSTIN/);
  });

  it("rejects lines without HSN", () => {
    const inv = baseInvoice();
    inv.lines[0].hsnSac = "";
    expect(() => buildIrpInvoicePayload(inv)).toThrow(/HSN/);
  });

  it("rejects missing party PIN", () => {
    const inv = baseInvoice();
    inv.party.pin = "";
    inv.party.address = "5 Residency Road";
    expect(() => buildIrpInvoicePayload(inv)).toThrow(/PIN/);
  });

  it("falls back to PIN found inside the party address", () => {
    const inv = baseInvoice();
    inv.party.pin = "";
    inv.party.address = "5 Residency Road, Bengaluru - 560025";
    const p = buildIrpInvoicePayload(inv);
    expect(p.BuyerDtls.Pin).toBe(560025);
  });

  it("sanitizes invalid invoice numbers into the NIC pattern", () => {
    const inv = baseInvoice();
    inv.number = "INV #26 (001)!";
    const p = buildIrpInvoicePayload(inv);
    expect(p.DocDtls.No).toMatch(/^[1-9a-zA-Z][0-9a-zA-Z/-]{1,15}$/);
  });
});
