//! Company creation shared by the HTTP API and the CLI.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::{Month, OffsetDateTime};

use crate::error::ApiError;
use crate::seed::{create_owner, seed_company, CompanyMetaSeed};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyRecord {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub fy_start: String,
    pub currency: String,
    pub state_code: Option<String>,
    pub gstin: Option<String>,
    pub gst_enabled: i64,
    pub db_file: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserRecord {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub is_active: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompanyInput {
    pub name: String,
    pub fy_start: Option<String>,
    pub state_code: Option<String>,
    pub gstin: Option<String>,
    pub gst_enabled: Option<bool>,
    pub owner_username: String,
    pub owner_password: String,
    pub owner_display_name: Option<String>,
}

fn slugify(name: &str) -> String {
    let lowered = name.to_lowercase();
    let mut slug = String::with_capacity(lowered.len());
    let mut last_dash = false;
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    let clipped: String = trimmed.chars().take(48).collect();
    if clipped.is_empty() {
        "company".to_string()
    } else {
        clipped
    }
}

fn uid() -> String {
    let mut bytes = [0u8; 6];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Indian FY start (1 April) for "today" — matches `indianFyStartFor()`.
pub fn indian_fy_start_for_today() -> String {
    let now = OffsetDateTime::now_utc();
    let year = now.year();
    let fy_year = if now.month() as u8 >= Month::April as u8 {
        year
    } else {
        year - 1
    };
    format!("{fy_year:04}-04-01")
}

fn map_company_row(row: &sqlx::sqlite::SqliteRow) -> CompanyRecord {
    CompanyRecord {
        id: row.get("id"),
        name: row.get("name"),
        slug: row.get("slug"),
        fy_start: row.get("fy_start"),
        currency: row.get("currency"),
        state_code: row.get("state_code"),
        gstin: row.get("gstin"),
        gst_enabled: row.get("gst_enabled"),
        db_file: row.get("db_file"),
        created_at: row.get("created_at"),
    }
}

pub async fn list_companies(state: &AppState) -> Result<Vec<CompanyRecord>, ApiError> {
    let rows = sqlx::query("SELECT * FROM companies ORDER BY created_at DESC")
        .fetch_all(&state.registry)
        .await?;
    Ok(rows.iter().map(map_company_row).collect())
}

pub async fn get_company(state: &AppState, id: &str) -> Result<CompanyRecord, ApiError> {
    let row = sqlx::query("SELECT * FROM companies WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.registry)
        .await?;
    row.as_ref()
        .map(map_company_row)
        .ok_or_else(|| ApiError::not_found("Company not found on this server."))
}

pub async fn create_company(
    state: &AppState,
    input: &CreateCompanyInput,
) -> Result<(CompanyRecord, UserRecord), ApiError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("Company name is required."));
    }
    if input.owner_username.trim().is_empty() {
        return Err(ApiError::bad_request("Owner username is required."));
    }
    if input.owner_password.len() < 6 {
        return Err(ApiError::bad_request(
            "Owner password must be at least 6 characters.",
        ));
    }

    let id = uid();
    let slug = format!("{}-{}", slugify(name), &id[..6]);
    let db_file = format!("kite-company-{slug}.db");
    let fy_start = input
        .fy_start
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(indian_fy_start_for_today);
    let gstin = input.gstin.clone().unwrap_or_default();
    let state_code = input.state_code.clone().unwrap_or_default();
    let gst_enabled = input.gst_enabled == Some(true) || !gstin.trim().is_empty();

    // Registry row first; roll back if company init fails.
    sqlx::query(
        "INSERT INTO companies (id, name, slug, fy_start, currency, state_code, gstin, gst_enabled, db_file) \
         VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8)",
    )
    .bind(&id)
    .bind(name)
    .bind(&slug)
    .bind(&fy_start)
    .bind(if state_code.trim().is_empty() { None } else { Some(state_code.trim()) })
    .bind(if gstin.trim().is_empty() { None } else { Some(gstin.trim()) })
    .bind(gst_enabled as i64)
    .bind(&db_file)
    .execute(&state.registry)
    .await?;

    let result = async {
        let pool = state.create_company_pool(&db_file).await?;
        seed_company(
            &pool,
            &CompanyMetaSeed {
                name,
                fy_start: &fy_start,
                gstin: gstin.trim(),
                state_code: state_code.trim(),
                gst_enabled,
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("Could not seed company: {e}")))?;
        let owner_id = create_owner(
            &pool,
            input.owner_username.trim(),
            input.owner_display_name.as_deref().unwrap_or(""),
            &input.owner_password,
        )
        .await
        .map_err(ApiError::bad_request)?;
        let user_row = sqlx::query(
            "SELECT id, username, display_name, role, is_active, created_at FROM app_user WHERE id = $1",
        )
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
        Ok::<UserRecord, ApiError>(UserRecord {
            id: user_row.get("id"),
            username: user_row.get("username"),
            display_name: user_row.get("display_name"),
            role: user_row.get("role"),
            is_active: user_row.get("is_active"),
            created_at: user_row.get("created_at"),
        })
    }
    .await;

    let owner = match result {
        Ok(owner) => owner,
        Err(e) => {
            let _ = sqlx::query("DELETE FROM companies WHERE id = $1")
                .bind(&id)
                .execute(&state.registry)
                .await;
            let _ = std::fs::remove_file(state.data_dir.join(&db_file));
            return Err(e);
        }
    };

    let company = get_company(state, &id).await?;
    Ok((company, owner))
}
