export type IrpEnvironment = "sandbox" | "production";

export interface IrpCredentials {
  environment: IrpEnvironment;
  /** Optional override; empty = preset for environment */
  baseUrl: string;
  gstin: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  /** E-invoice portal RSA public key PEM (from sandbox/portal docs) */
  publicKeyPem: string;
}

export interface IrnGenerateResult {
  irn: string;
  ackNo: string;
  ackDt: string;
  signedQrCode: string;
  status: string;
  ewbNo: string;
  ewbDt: string;
  ewbValidTill: string;
  raw: string;
}

export interface IrnCancelResult {
  irn: string;
  cancelDate: string;
  raw: string;
}

/** Sch v1.03 request object sent to POST /eicore/v1.03/Invoice. */
export interface IrpInvoiceRequest {
  Version: string;
  TranDtls: {
    TaxSch: string;
    SupTyp: string;
    RegRev: "Y" | "N";
    IgstOnIntra: "Y" | "N";
  };
  DocDtls: { Typ: "INV"; No: string; Dt: string };
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm: string;
    Addr1: string;
    Addr2: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    Pos: string;
    Addr1: string;
    Addr2: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  ItemList: {
    SlNo: string;
    PrdDesc?: string;
    IsServc: "Y" | "N";
    HsnCd: string;
    Qty?: number;
    Unit?: string;
    UnitPrice: number;
    TotAmt: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt: number;
    CgstAmt: number;
    SgstAmt: number;
    TotItemVal: number;
  }[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    OthChrg: number;
    RndOffAmt: number;
    TotInvVal: number;
  };
}
