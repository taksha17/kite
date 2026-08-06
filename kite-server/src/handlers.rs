use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use std::sync::Arc;

use crate::auth::{issue_token, verify_password, AuthUser};
use crate::company::{create_company, get_company, list_companies, CreateCompanyInput};
use crate::error::ApiError;
use crate::state::AppState;

pub async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "kite-server" }))
}

pub async fn companies_list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let companies = list_companies(&state).await?;
    Ok(Json(json!({ "companies": companies })))
}

pub async fn companies_create(
    State(state): State<Arc<AppState>>,
    Json(input): Json<CreateCompanyInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (company, owner) = create_company(&state, &input).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "company": company, "owner": owner })),
    ))
}

pub async fn company_info(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let company = get_company(&state, &id).await?;
    let pool = state.company_pool(&id).await?;
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM app_user")
        .fetch_one(&pool)
        .await?;
    Ok(Json(json!({ "company": company, "userCount": count.0 })))
}

#[derive(Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

pub async fn company_login(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(input): Json<LoginInput>,
) -> Result<Json<Value>, ApiError> {
    let pool = state.company_pool(&id).await?;
    let row = sqlx::query(
        "SELECT id, username, display_name, role, is_active, created_at, password_hash \
         FROM app_user WHERE username = $1 COLLATE NOCASE LIMIT 1",
    )
    .bind(input.username.trim())
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| ApiError::unauthorized("Invalid username or password."))?;

    let is_active: i64 = row.get("is_active");
    if is_active == 0 {
        return Err(ApiError::forbidden("This user has been deactivated."));
    }
    let password_hash: String = row.get("password_hash");
    if !verify_password(&input.password, &password_hash) {
        return Err(ApiError::unauthorized("Invalid username or password."));
    }

    let user_id: i64 = row.get("id");
    let username: String = row.get("username");
    let role: String = row.get("role");
    let token = issue_token(&state.jwt_secret, user_id, &id, &username, &role)?;

    Ok(Json(json!({
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "display_name": row.get::<String, _>("display_name"),
            "role": role,
            "is_active": is_active,
            "created_at": row.get::<String, _>("created_at"),
        }
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GstSettingsInput {
    pub gst_enabled: bool,
    pub state_code: String,
    pub gstin: String,
}

pub async fn company_update_gst(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<GstSettingsInput>,
) -> Result<Json<Value>, ApiError> {
    if auth.company_id != id {
        return Err(ApiError::forbidden("Token does not match this company."));
    }
    if auth.role != "owner" && auth.role != "accountant" {
        return Err(ApiError::forbidden(
            "You do not have permission to change GST settings.",
        ));
    }
    sqlx::query("UPDATE companies SET gst_enabled = $1, state_code = $2, gstin = $3 WHERE id = $4")
        .bind(input.gst_enabled as i64)
        .bind(if input.state_code.trim().is_empty() {
            None
        } else {
            Some(input.state_code.trim())
        })
        .bind(if input.gstin.trim().is_empty() {
            None
        } else {
            Some(input.gstin.trim())
        })
        .bind(&id)
        .execute(&state.registry)
        .await?;
    let company = get_company(&state, &id).await?;
    Ok(Json(json!({ "company": company })))
}

/// Owner-only full backup: checkpoints the WAL, then streams the company's
/// SQLite file. The file is the whole company — restore is a file swap.
pub async fn company_backup(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    if auth.company_id != id {
        return Err(ApiError::forbidden("Token does not match this company."));
    }
    if auth.role != "owner" {
        return Err(ApiError::forbidden(
            "Only the owner can download company backups.",
        ));
    }
    let company = get_company(&state, &id).await?;
    let pool = state.company_pool(&id).await?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&pool)
        .await?;
    let path = state.data_dir.join(&company.db_file);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| ApiError::internal(format!("Could not read company file: {e}")))?;
    let filename = format!(
        "kite-{}-backup-{}.db",
        company.slug,
        time::OffsetDateTime::now_utc().date()
    );
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.sqlite3".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        bytes,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatInput {
    pub system: String,
    pub user: String,
    /// Optional data:image/...;base64,... for bill capture / vision.
    #[serde(default)]
    pub image_data_url: Option<String>,
}

/// Forwards prompts to the company's LLM provider. Authenticated teammates
/// never see the API key — it stays server-side in the company's meta.
pub async fn company_ai_chat(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(input): Json<AiChatInput>,
) -> Result<Json<Value>, ApiError> {
    crate::ai::validate_prompts(&input.system, &input.user, input.image_data_url.as_deref())?;
    let pool = state.company_pool(&auth.company_id).await?;
    let row = sqlx::query("SELECT value FROM meta WHERE key = 'ai_settings'")
        .fetch_optional(&pool)
        .await?;
    let settings = row
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|v| serde_json::from_str::<crate::ai::AiSettings>(&v).ok())
        .filter(|s| !s.provider.is_empty() && !s.api_key.trim().is_empty())
        .ok_or_else(|| {
            ApiError::bad_request(
                "AI quick entry is not set up — the owner can add an API key under Companies → AI quick entry.",
            )
        })?;
    let content = crate::ai::call_provider(
        &settings,
        &input.system,
        &input.user,
        input.image_data_url.as_deref(),
    )
    .await?;
    Ok(Json(json!({ "content": content })))
}

#[derive(Deserialize)]
pub struct SqlRequest {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

fn bind_params<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    params: &'q [Value],
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    for value in params {
        query = match value {
            Value::Null => query.bind(None::<i64>),
            Value::Bool(b) => query.bind(*b as i64),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    query.bind(i)
                } else {
                    query.bind(n.as_f64().unwrap_or(0.0))
                }
            }
            Value::String(s) => query.bind(s.clone()),
            other => query.bind(other.to_string()),
        };
    }
    query
}

fn cell_to_json(row: &sqlx::sqlite::SqliteRow, index: usize) -> Value {
    let raw = match row.try_get_raw(index) {
        Ok(raw) => raw,
        Err(_) => return Value::Null,
    };
    let type_name = raw.type_info().name().to_uppercase();
    match type_name.as_str() {
        "INTEGER" | "INT" | "BIGINT" | "SMALLINT" | "TINYINT" | "BOOLEAN" => row
            .try_get::<Option<i64>, _>(index)
            .ok()
            .flatten()
            .map(Value::from)
            .unwrap_or(Value::Null),
        "REAL" | "FLOAT" | "DOUBLE" => row
            .try_get::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .map(Value::from)
            .unwrap_or(Value::Null),
        "TEXT" | "VARCHAR" | "CHAR" | "DATETIME" | "DATE" | "TIME" => row
            .try_get::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(Value::from)
            .unwrap_or(Value::Null),
        "BLOB" => row
            .try_get::<Option<Vec<u8>>, _>(index)
            .ok()
            .flatten()
            .map(hex::encode)
            .map(Value::from)
            .unwrap_or(Value::Null),
        "NULL" => Value::Null,
        _ => row
            .try_get::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(Value::from)
            .unwrap_or(Value::Null),
    }
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut obj = Map::new();
    for (i, column) in row.columns().iter().enumerate() {
        obj.insert(column.name().to_string(), cell_to_json(row, i));
    }
    Value::Object(obj)
}

pub async fn company_query(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<SqlRequest>,
) -> Result<Json<Value>, ApiError> {
    let pool = state.company_pool(&auth.company_id).await?;
    let query = bind_params(sqlx::query(&req.sql), &req.params);
    let rows = query.fetch_all(&pool).await?;
    let rows_json: Vec<Value> = rows.iter().map(row_to_json).collect();
    Ok(Json(json!({ "rows": rows_json })))
}

pub async fn company_execute(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<SqlRequest>,
) -> Result<Json<Value>, ApiError> {
    let pool = state.company_pool(&auth.company_id).await?;
    let query = bind_params(sqlx::query(&req.sql), &req.params);
    let result = query.execute(&pool).await?;
    Ok(Json(json!({
        "rowsAffected": result.rows_affected(),
        "lastInsertId": result.last_insert_rowid(),
    })))
}
