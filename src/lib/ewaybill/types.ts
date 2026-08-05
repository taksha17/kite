/** Payload shapes for NIC GENEWAYBILL (v1.03). */

export interface NicEwayItem {
  productName: string;
  productDesc: string;
  hsnCode: number;
  quantity: number;
  qtyUnit: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
  cessNonadvol: number;
  taxableAmount: number;
}

export interface NicGenEwayBillRequest {
  supplyType: "O" | "I";
  subSupplyType: string;
  subSupplyDesc: string;
  docType: string;
  docNo: string;
  docDate: string;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string;
  fromPlace: string;
  fromPincode: number;
  actFromStateCode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2: string;
  toPlace: string;
  toPincode: number;
  actToStateCode: number;
  toStateCode: number;
  transactionType: number;
  otherValue: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  cessNonAdvolValue: number;
  totInvValue: number;
  transporterId: string;
  transporterName: string;
  transDocNo: string;
  transMode: string;
  transDistance: string;
  transDocDate: string;
  vehicleNo: string;
  vehicleType: string;
  itemList: NicEwayItem[];
}

export interface NicGenerateResult {
  ewayBillNo: string;
  ewayBillDate: string;
  validUpto: string;
  alert: string;
  raw: string;
}

export interface GenerateEwayOptions {
  /** Distance in km (NIC string) */
  distanceKm: string;
  vehicleNo: string;
  /** 1 Road, 2 Rail, 3 Air, 4 Ship */
  transMode: string;
  vehicleType: "R" | "O";
  fromPincode: number;
  toPincode: number;
  transporterId?: string;
  transporterName?: string;
  fromPlace?: string;
  toPlace?: string;
}
