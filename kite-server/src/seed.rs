//! Port of the company seed in `src/lib/db/client.ts` + `src/lib/accounting/seed.ts`.
//! Keep both sides in sync.

use sqlx::SqlitePool;

use crate::auth::hash_password;

struct GroupSeed {
    name: &'static str,
    nature: &'static str,
    normal_balance: &'static str,
    is_primary: bool,
    parent: Option<&'static str>,
}

const DEFAULT_GROUPS: &[GroupSeed] = &[
    GroupSeed {
        name: "Assets",
        nature: "assets",
        normal_balance: "debit",
        is_primary: true,
        parent: None,
    },
    GroupSeed {
        name: "Liabilities",
        nature: "liabilities",
        normal_balance: "credit",
        is_primary: true,
        parent: None,
    },
    GroupSeed {
        name: "Equity",
        nature: "equity",
        normal_balance: "credit",
        is_primary: true,
        parent: None,
    },
    GroupSeed {
        name: "Income",
        nature: "income",
        normal_balance: "credit",
        is_primary: true,
        parent: None,
    },
    GroupSeed {
        name: "Expenses",
        nature: "expenses",
        normal_balance: "debit",
        is_primary: true,
        parent: None,
    },
    GroupSeed {
        name: "Current Assets",
        nature: "assets",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Assets"),
    },
    GroupSeed {
        name: "Fixed Assets",
        nature: "assets",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Assets"),
    },
    GroupSeed {
        name: "Cash-in-Hand",
        nature: "assets",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Current Assets"),
    },
    GroupSeed {
        name: "Bank Accounts",
        nature: "assets",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Current Assets"),
    },
    GroupSeed {
        name: "Sundry Debtors",
        nature: "assets",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Current Assets"),
    },
    GroupSeed {
        name: "Stock-in-Hand",
        nature: "assets",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Current Assets"),
    },
    GroupSeed {
        name: "Duties & Taxes",
        nature: "liabilities",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Liabilities"),
    },
    GroupSeed {
        name: "Current Liabilities",
        nature: "liabilities",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Liabilities"),
    },
    GroupSeed {
        name: "Sundry Creditors",
        nature: "liabilities",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Current Liabilities"),
    },
    GroupSeed {
        name: "Loans (Liability)",
        nature: "liabilities",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Liabilities"),
    },
    GroupSeed {
        name: "Capital Account",
        nature: "equity",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Equity"),
    },
    GroupSeed {
        name: "Direct Incomes",
        nature: "income",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Income"),
    },
    GroupSeed {
        name: "Indirect Incomes",
        nature: "income",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Income"),
    },
    GroupSeed {
        name: "Sales Accounts",
        nature: "income",
        normal_balance: "credit",
        is_primary: false,
        parent: Some("Direct Incomes"),
    },
    GroupSeed {
        name: "Direct Expenses",
        nature: "expenses",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Expenses"),
    },
    GroupSeed {
        name: "Indirect Expenses",
        nature: "expenses",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Expenses"),
    },
    GroupSeed {
        name: "Purchase Accounts",
        nature: "expenses",
        normal_balance: "debit",
        is_primary: false,
        parent: Some("Direct Expenses"),
    },
];

struct LedgerSeed {
    name: &'static str,
    group: &'static str,
    is_cash_bank: bool,
}

const DEFAULT_LEDGERS: &[LedgerSeed] = &[
    LedgerSeed {
        name: "Cash",
        group: "Cash-in-Hand",
        is_cash_bank: true,
    },
    LedgerSeed {
        name: "Bank Account",
        group: "Bank Accounts",
        is_cash_bank: true,
    },
    LedgerSeed {
        name: "Capital",
        group: "Capital Account",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "Sales",
        group: "Sales Accounts",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "Purchase",
        group: "Purchase Accounts",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "Rent",
        group: "Indirect Expenses",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "Salary",
        group: "Indirect Expenses",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "Electricity",
        group: "Indirect Expenses",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "CGST",
        group: "Duties & Taxes",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "SGST",
        group: "Duties & Taxes",
        is_cash_bank: false,
    },
    LedgerSeed {
        name: "IGST",
        group: "Duties & Taxes",
        is_cash_bank: false,
    },
];

const VOUCHER_TYPES: &[(&str, &str)] = &[
    ("payment", "Payment"),
    ("receipt", "Receipt"),
    ("contra", "Contra"),
    ("journal", "Journal"),
    ("sales", "Sales"),
    ("purchase", "Purchase"),
    ("stock_journal", "Stock Journal"),
];

async fn upsert_meta(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO meta (key, value) VALUES ($1, $2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub struct CompanyMetaSeed<'a> {
    pub name: &'a str,
    pub fy_start: &'a str,
    pub gstin: &'a str,
    pub state_code: &'a str,
    pub gst_enabled: bool,
}

pub async fn seed_company(
    pool: &SqlitePool,
    meta: &CompanyMetaSeed<'_>,
) -> Result<(), sqlx::Error> {
    upsert_meta(pool, "company_name", meta.name).await?;
    upsert_meta(pool, "fy_start", meta.fy_start).await?;
    upsert_meta(pool, "currency", "INR").await?;
    upsert_meta(pool, "gstin", meta.gstin).await?;
    upsert_meta(pool, "state_code", meta.state_code).await?;
    upsert_meta(
        pool,
        "gst_enabled",
        if meta.gst_enabled { "1" } else { "0" },
    )
    .await?;

    for (code, name) in VOUCHER_TYPES {
        sqlx::query("INSERT INTO voucher_type (code, name) VALUES ($1, $2)")
            .bind(code)
            .bind(name)
            .execute(pool)
            .await?;
    }

    // Insert groups, resolving parents first (same guard loop as the TS seed).
    let mut pending: Vec<&GroupSeed> = DEFAULT_GROUPS.iter().collect();
    let mut guard = 0;
    while !pending.is_empty() && guard < 50 {
        guard += 1;
        let mut i = pending.len();
        while i > 0 {
            i -= 1;
            let g = pending[i];
            if let Some(parent) = g.parent {
                let exists: Option<(i64,)> =
                    sqlx::query_as("SELECT id FROM account_group WHERE name = $1")
                        .bind(parent)
                        .fetch_optional(pool)
                        .await?;
                if exists.is_none() {
                    continue;
                }
            }
            let parent_id: Option<i64> = match g.parent {
                Some(parent) => {
                    let row: (i64,) =
                        sqlx::query_as("SELECT id FROM account_group WHERE name = $1")
                            .bind(parent)
                            .fetch_one(pool)
                            .await?;
                    Some(row.0)
                }
                None => None,
            };
            sqlx::query(
                "INSERT INTO account_group (name, parent_id, nature, normal_balance, is_primary) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(g.name)
            .bind(parent_id)
            .bind(g.nature)
            .bind(g.normal_balance)
            .bind(g.is_primary as i64)
            .execute(pool)
            .await?;
            pending.remove(i);
        }
    }

    for ledger in DEFAULT_LEDGERS {
        let group: Option<(i64,)> = sqlx::query_as("SELECT id FROM account_group WHERE name = $1")
            .bind(ledger.group)
            .fetch_optional(pool)
            .await?;
        let Some((group_id,)) = group else { continue };
        sqlx::query(
            "INSERT INTO ledger (name, group_id, is_cash_bank, is_party) VALUES ($1, $2, $3, $4)",
        )
        .bind(ledger.name)
        .bind(group_id)
        .bind(ledger.is_cash_bank as i64)
        .bind(0)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Create the owner login for a freshly seeded company. Returns the user id.
pub async fn create_owner(
    pool: &SqlitePool,
    username: &str,
    display_name: &str,
    password: &str,
) -> Result<i64, String> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM app_user")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    if count.0 > 0 {
        return Err("Owner already set up for this company.".into());
    }
    if password.len() < 6 {
        return Err("Password must be at least 6 characters.".into());
    }
    let hash = hash_password(password);
    let display = if display_name.trim().is_empty() {
        username.trim()
    } else {
        display_name.trim()
    };
    let res = sqlx::query(
        "INSERT INTO app_user (username, display_name, role, password_hash) \
         VALUES ($1, $2, 'owner', $3)",
    )
    .bind(username.trim())
    .bind(display)
    .bind(hash)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(res.last_insert_rowid())
}
