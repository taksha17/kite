//! Port of `src/lib/db/schema.ts` (plus auth/inventory/integration DDL).
//! Keep both sides in sync when the schema evolves.

pub const COMPANY_SCHEMA_STATEMENTS: &[&str] = &[
    "PRAGMA foreign_keys = ON",
    r#"CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)"#,
    r#"CREATE TABLE IF NOT EXISTS account_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES account_group(id),
  nature TEXT NOT NULL,
  normal_balance TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0
)"#,
    r#"CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  group_id INTEGER NOT NULL REFERENCES account_group(id),
  opening_debit REAL NOT NULL DEFAULT 0,
  opening_credit REAL NOT NULL DEFAULT 0,
  is_cash_bank INTEGER NOT NULL DEFAULT 0,
  is_party INTEGER NOT NULL DEFAULT 0,
  gstin TEXT,
  state_code TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  pin TEXT,
  phone TEXT,
  notes TEXT
)"#,
    r#"CREATE TABLE IF NOT EXISTS voucher_type (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
)"#,
    r#"CREATE TABLE IF NOT EXISTS voucher (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_type TEXT NOT NULL REFERENCES voucher_type(code),
  date TEXT NOT NULL,
  number TEXT,
  narration TEXT,
  total_amount REAL NOT NULL,
  party_ledger_id INTEGER REFERENCES ledger(id),
  place_of_supply TEXT,
  is_interstate INTEGER NOT NULL DEFAULT 0,
  hsn_sac TEXT,
  gst_rate REAL,
  taxable_value REAL,
  cgst_amount REAL NOT NULL DEFAULT 0,
  sgst_amount REAL NOT NULL DEFAULT 0,
  igst_amount REAL NOT NULL DEFAULT 0,
  payment_mode TEXT,
  reverse_charge INTEGER NOT NULL DEFAULT 0,
  buyer_order_no TEXT,
  supplier_ref TEXT,
  vehicle_no TEXT,
  delivery_date TEXT,
  transport TEXT,
  terms_of_delivery TEXT,
  ship_to_name TEXT,
  ship_to_address TEXT,
  ship_to_state TEXT,
  ship_to_gstin TEXT,
  freight_amount REAL NOT NULL DEFAULT 0,
  round_off REAL NOT NULL DEFAULT 0,
  external_source TEXT,
  external_id TEXT,
  ewb_no TEXT,
  ewb_date TEXT,
  ewb_valid_upto TEXT,
  trans_distance TEXT,
  irn TEXT,
  irn_ack_no TEXT,
  irn_ack_date TEXT,
  irn_signed_qr TEXT,
  irn_status TEXT,
  irn_cancel_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)"#,
    r#"CREATE TABLE IF NOT EXISTS voucher_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES voucher(id) ON DELETE CASCADE,
  ledger_id INTEGER NOT NULL REFERENCES ledger(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  line_narration TEXT
)"#,
    "CREATE INDEX IF NOT EXISTS idx_voucher_date ON voucher(date)",
    "CREATE INDEX IF NOT EXISTS idx_voucher_line_ledger ON voucher_line(ledger_id)",
    "CREATE INDEX IF NOT EXISTS idx_voucher_line_voucher ON voucher_line(voucher_id)",
    "CREATE INDEX IF NOT EXISTS idx_voucher_gst ON voucher(voucher_type, date)",
    r#"CREATE TABLE IF NOT EXISTS unit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL
)"#,
    r#"CREATE TABLE IF NOT EXISTS godown (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0
)"#,
    r#"CREATE TABLE IF NOT EXISTS stock_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit_id INTEGER NOT NULL REFERENCES unit(id),
  hsn_sac TEXT,
  sku TEXT,
  gst_rate REAL NOT NULL DEFAULT 18,
  purchase_rate REAL NOT NULL DEFAULT 0,
  sales_rate REAL NOT NULL DEFAULT 0,
  opening_qty REAL NOT NULL DEFAULT 0,
  notes TEXT
)"#,
    r#"CREATE TABLE IF NOT EXISTS stock_movement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER REFERENCES voucher(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES stock_item(id),
  godown_id INTEGER NOT NULL REFERENCES godown(id),
  qty_in REAL NOT NULL DEFAULT 0,
  qty_out REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  movement_type TEXT NOT NULL,
  narration TEXT,
  batch_no TEXT,
  serial_no TEXT,
  line_description TEXT
)"#,
    "CREATE INDEX IF NOT EXISTS idx_stock_movement_item ON stock_movement(item_id)",
    "CREATE INDEX IF NOT EXISTS idx_stock_movement_voucher ON stock_movement(voucher_id)",
];

pub const AUTH_SCHEMA_STATEMENTS: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)"#,
    r#"CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES app_user(id),
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT
)"#,
    "CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)",
];

pub const INTEGRATION_SCHEMA_STATEMENTS: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS integration_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)"#,
    "CREATE INDEX IF NOT EXISTS idx_integration_sync_log ON integration_sync_log(source, created_at)",
];

pub const REGISTRY_SCHEMA_STATEMENTS: &[&str] = &[r#"CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  fy_start TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  state_code TEXT,
  gstin TEXT,
  gst_enabled INTEGER NOT NULL DEFAULT 0,
  db_file TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)"#];

pub struct ColumnMigration {
    pub table: &'static str,
    pub column: &'static str,
    pub ddl: &'static str,
}

/// Port of COMPANY_COLUMN_MIGRATIONS — for company DBs copied from older
/// Kite Solo installs onto the server.
pub const COMPANY_COLUMN_MIGRATIONS: &[ColumnMigration] = &[
    ColumnMigration {
        table: "ledger",
        column: "state_code",
        ddl: "ALTER TABLE ledger ADD COLUMN state_code TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "party_ledger_id",
        ddl: "ALTER TABLE voucher ADD COLUMN party_ledger_id INTEGER REFERENCES ledger(id)",
    },
    ColumnMigration {
        table: "voucher",
        column: "place_of_supply",
        ddl: "ALTER TABLE voucher ADD COLUMN place_of_supply TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "is_interstate",
        ddl: "ALTER TABLE voucher ADD COLUMN is_interstate INTEGER NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "voucher",
        column: "hsn_sac",
        ddl: "ALTER TABLE voucher ADD COLUMN hsn_sac TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "gst_rate",
        ddl: "ALTER TABLE voucher ADD COLUMN gst_rate REAL",
    },
    ColumnMigration {
        table: "voucher",
        column: "taxable_value",
        ddl: "ALTER TABLE voucher ADD COLUMN taxable_value REAL",
    },
    ColumnMigration {
        table: "voucher",
        column: "cgst_amount",
        ddl: "ALTER TABLE voucher ADD COLUMN cgst_amount REAL NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "voucher",
        column: "sgst_amount",
        ddl: "ALTER TABLE voucher ADD COLUMN sgst_amount REAL NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "voucher",
        column: "igst_amount",
        ddl: "ALTER TABLE voucher ADD COLUMN igst_amount REAL NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "ledger",
        column: "email",
        ddl: "ALTER TABLE ledger ADD COLUMN email TEXT",
    },
    ColumnMigration {
        table: "ledger",
        column: "address",
        ddl: "ALTER TABLE ledger ADD COLUMN address TEXT",
    },
    ColumnMigration {
        table: "ledger",
        column: "city",
        ddl: "ALTER TABLE ledger ADD COLUMN city TEXT",
    },
    ColumnMigration {
        table: "ledger",
        column: "pin",
        ddl: "ALTER TABLE ledger ADD COLUMN pin TEXT",
    },
    ColumnMigration {
        table: "ledger",
        column: "phone",
        ddl: "ALTER TABLE ledger ADD COLUMN phone TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "payment_mode",
        ddl: "ALTER TABLE voucher ADD COLUMN payment_mode TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "reverse_charge",
        ddl: "ALTER TABLE voucher ADD COLUMN reverse_charge INTEGER NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "voucher",
        column: "buyer_order_no",
        ddl: "ALTER TABLE voucher ADD COLUMN buyer_order_no TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "supplier_ref",
        ddl: "ALTER TABLE voucher ADD COLUMN supplier_ref TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "vehicle_no",
        ddl: "ALTER TABLE voucher ADD COLUMN vehicle_no TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "delivery_date",
        ddl: "ALTER TABLE voucher ADD COLUMN delivery_date TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "transport",
        ddl: "ALTER TABLE voucher ADD COLUMN transport TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "terms_of_delivery",
        ddl: "ALTER TABLE voucher ADD COLUMN terms_of_delivery TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ship_to_name",
        ddl: "ALTER TABLE voucher ADD COLUMN ship_to_name TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ship_to_address",
        ddl: "ALTER TABLE voucher ADD COLUMN ship_to_address TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ship_to_state",
        ddl: "ALTER TABLE voucher ADD COLUMN ship_to_state TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ship_to_gstin",
        ddl: "ALTER TABLE voucher ADD COLUMN ship_to_gstin TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "freight_amount",
        ddl: "ALTER TABLE voucher ADD COLUMN freight_amount REAL NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "voucher",
        column: "round_off",
        ddl: "ALTER TABLE voucher ADD COLUMN round_off REAL NOT NULL DEFAULT 0",
    },
    ColumnMigration {
        table: "voucher",
        column: "external_source",
        ddl: "ALTER TABLE voucher ADD COLUMN external_source TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "external_id",
        ddl: "ALTER TABLE voucher ADD COLUMN external_id TEXT",
    },
    ColumnMigration {
        table: "stock_item",
        column: "sku",
        ddl: "ALTER TABLE stock_item ADD COLUMN sku TEXT",
    },
    ColumnMigration {
        table: "stock_movement",
        column: "batch_no",
        ddl: "ALTER TABLE stock_movement ADD COLUMN batch_no TEXT",
    },
    ColumnMigration {
        table: "stock_movement",
        column: "serial_no",
        ddl: "ALTER TABLE stock_movement ADD COLUMN serial_no TEXT",
    },
    ColumnMigration {
        table: "stock_movement",
        column: "line_description",
        ddl: "ALTER TABLE stock_movement ADD COLUMN line_description TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ewb_no",
        ddl: "ALTER TABLE voucher ADD COLUMN ewb_no TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ewb_date",
        ddl: "ALTER TABLE voucher ADD COLUMN ewb_date TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "ewb_valid_upto",
        ddl: "ALTER TABLE voucher ADD COLUMN ewb_valid_upto TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "trans_distance",
        ddl: "ALTER TABLE voucher ADD COLUMN trans_distance TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "irn",
        ddl: "ALTER TABLE voucher ADD COLUMN irn TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "irn_ack_no",
        ddl: "ALTER TABLE voucher ADD COLUMN irn_ack_no TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "irn_ack_date",
        ddl: "ALTER TABLE voucher ADD COLUMN irn_ack_date TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "irn_signed_qr",
        ddl: "ALTER TABLE voucher ADD COLUMN irn_signed_qr TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "irn_status",
        ddl: "ALTER TABLE voucher ADD COLUMN irn_status TEXT",
    },
    ColumnMigration {
        table: "voucher",
        column: "irn_cancel_date",
        ddl: "ALTER TABLE voucher ADD COLUMN irn_cancel_date TEXT",
    },
];

/// Apply full schema + idempotent column migrations to a company database.
pub async fn ensure_company_schema(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    for sql in COMPANY_SCHEMA_STATEMENTS
        .iter()
        .chain(AUTH_SCHEMA_STATEMENTS.iter())
        .chain(INTEGRATION_SCHEMA_STATEMENTS.iter())
    {
        sqlx::query(sql).execute(pool).await?;
    }
    for m in COMPANY_COLUMN_MIGRATIONS {
        let pragma = format!("PRAGMA table_info({})", m.table);
        let rows = sqlx::query(&pragma).fetch_all(pool).await?;
        use sqlx::Row;
        let exists = rows.iter().any(|r| r.get::<String, _>("name") == m.column);
        if !exists {
            sqlx::query(m.ddl).execute(pool).await?;
        }
    }
    Ok(())
}
