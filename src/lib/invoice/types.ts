export interface InvoiceCompany {
  name: string;
  gstin: string;
  stateCode: string;
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
  /** data URL for logo preview/PDF when available */
  logoDataUrl: string;
}

export interface InvoiceParty {
  name: string;
  gstin: string;
  stateCode: string;
  email: string;
  address: string;
}

export interface InvoiceShipTo {
  name: string;
  address: string;
  stateCode: string;
  gstin: string;
}

export interface InvoiceLine {
  description: string;
  /** Extra notes under the item name on the invoice */
  lineDescription: string;
  batchNo: string;
  serialNo: string;
  hsnSac: string;
  qty: number | null;
  unit: string;
  rate: number | null;
  taxable: number;
  gstRate: number;
  gstAmount: number;
  lineTotal: number;
}

export interface SalesInvoiceData {
  voucherId: number;
  date: string;
  number: string;
  narration: string;
  placeOfSupply: string;
  isInterstate: boolean;
  gstRate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Posted GST voucher total (taxable + tax) */
  booksTotal: number;
  freight: number;
  roundOff: number;
  /** Printed grand total = booksTotal + freight + roundOff */
  total: number;
  amountInWords: string;
  paymentMode: string;
  reverseCharge: boolean;
  buyerOrderNo: string;
  supplierRef: string;
  vehicleNo: string;
  deliveryDate: string;
  transport: string;
  termsOfDelivery: string;
  ewbNo: string;
  ewbDate: string;
  ewbValidUpto: string;
  transDistance: string;
  company: InvoiceCompany;
  party: InvoiceParty;
  shipTo: InvoiceShipTo;
  lines: InvoiceLine[];
}

export interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  useStarttls: boolean;
}

export interface InvoiceExtrasInput {
  paymentMode?: string;
  reverseCharge?: boolean;
  buyerOrderNo?: string;
  supplierRef?: string;
  vehicleNo?: string;
  deliveryDate?: string;
  transport?: string;
  termsOfDelivery?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToState?: string;
  shipToGstin?: string;
  freightAmount?: number;
  roundOff?: number;
}
