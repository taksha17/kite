use rand::RngCore;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::error::ApiError;
use crate::schema;

pub struct AppState {
    pub data_dir: PathBuf,
    pub jwt_secret: Vec<u8>,
    pub registry: SqlitePool,
    company_pools: Mutex<HashMap<String, SqlitePool>>,
}

fn pool_options() -> SqlitePoolOptions {
    SqlitePoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(15))
}

fn sqlite_options(path: &Path, create: bool) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(create)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(10))
}

pub async fn open_registry(data_dir: &Path) -> Result<SqlitePool, sqlx::Error> {
    let path = data_dir.join("kite-registry.db");
    let pool = pool_options()
        .connect_with(sqlite_options(&path, true))
        .await?;
    for sql in schema::REGISTRY_SCHEMA_STATEMENTS {
        sqlx::query(sql).execute(&pool).await?;
    }
    Ok(pool)
}

pub fn load_or_create_jwt_secret(data_dir: &Path) -> Result<Vec<u8>, String> {
    let path = data_dir.join("jwt_secret.hex");
    if let Ok(contents) = std::fs::read_to_string(&path) {
        if let Ok(secret) = hex::decode(contents.trim()) {
            if secret.len() >= 32 {
                return Ok(secret);
            }
        }
    }
    let mut secret = vec![0u8; 48];
    rand::thread_rng().fill_bytes(&mut secret);
    std::fs::write(&path, hex::encode(&secret))
        .map_err(|e| format!("Could not persist JWT secret: {e}"))?;
    Ok(secret)
}

impl AppState {
    pub fn new(data_dir: PathBuf, registry: SqlitePool, jwt_secret: Vec<u8>) -> Arc<Self> {
        Arc::new(AppState {
            data_dir,
            jwt_secret,
            registry,
            company_pools: Mutex::new(HashMap::new()),
        })
    }

    /// Open (or reuse) the pool for a company, running schema + migrations once.
    pub async fn company_pool(&self, company_id: &str) -> Result<SqlitePool, ApiError> {
        {
            let pools = self.company_pools.lock().await;
            if let Some(pool) = pools.get(company_id) {
                return Ok(pool.clone());
            }
        }

        let row: Option<(String,)> = sqlx::query_as("SELECT db_file FROM companies WHERE id = $1")
            .bind(company_id)
            .fetch_optional(&self.registry)
            .await?;
        let Some((db_file,)) = row else {
            return Err(ApiError::not_found("Company not found on this server."));
        };

        let path = self.data_dir.join(&db_file);
        if !path.exists() {
            return Err(ApiError::not_found(format!(
                "Company data file {db_file} is missing from the server data directory."
            )));
        }

        let pool = pool_options()
            .connect_with(sqlite_options(&path, false))
            .await?;
        schema::ensure_company_schema(&pool).await?;

        let mut pools = self.company_pools.lock().await;
        pools.insert(company_id.to_string(), pool.clone());
        Ok(pool)
    }

    /// Create a fresh company database file and return its pool.
    pub async fn create_company_pool(&self, db_file: &str) -> Result<SqlitePool, ApiError> {
        let path = self.data_dir.join(db_file);
        let pool = pool_options()
            .connect_with(sqlite_options(&path, true))
            .await?;
        schema::ensure_company_schema(&pool).await?;
        Ok(pool)
    }
}
