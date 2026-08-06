export interface CompanyRecord {
  id: string;
  name: string;
  slug: string;
  fy_start: string;
  currency: string;
  state_code: string | null;
  gstin: string | null;
  gst_enabled: number;
  db_file: string;
  created_at: string;
}

export interface AccountGroupRow {
  id: number;
  name: string;
  parent_id: number | null;
  nature: string;
  normal_balance: string;
  is_primary: number;
}

export interface LedgerRow {
  id: number;
  name: string;
  group_id: number;
  group_name?: string;
  opening_debit: number;
  opening_credit: number;
  is_cash_bank: number;
  is_party: number;
  gstin: string | null;
  state_code: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  pin: string | null;
  phone: string | null;
  notes: string | null;
}

export interface VoucherRow {
  id: number;
  voucher_type: string;
  date: string;
  number: string | null;
  narration: string | null;
  total_amount: number;
  party_ledger_id: number | null;
  place_of_supply: string | null;
  is_interstate: number;
  hsn_sac: string | null;
  gst_rate: number | null;
  taxable_value: number | null;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  payment_mode: string | null;
  reverse_charge: number;
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
  freight_amount: number;
  round_off: number;
  external_source: string | null;
  external_id: string | null;
  ewb_no: string | null;
  ewb_date: string | null;
  ewb_valid_upto: string | null;
  trans_distance: string | null;
  irn: string | null;
  irn_ack_no: string | null;
  irn_ack_date: string | null;
  irn_signed_qr: string | null;
  irn_status: string | null;
  irn_cancel_date: string | null;
  created_at: string;
  party_name?: string;
}

export interface VoucherLineRow {
  id: number;
  voucher_id: number;
  ledger_id: number;
  ledger_name?: string;
  debit: number;
  credit: number;
  line_narration: string | null;
}

export interface GstInvoiceRow {
  id: number;
  date: string;
  number: string | null;
  voucher_type: string;
  party_name: string | null;
  party_gstin: string | null;
  place_of_supply: string | null;
  is_interstate: number;
  hsn_sac: string | null;
  gst_rate: number | null;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
}
