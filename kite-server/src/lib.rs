pub mod ai;
pub mod auth;
pub mod company;
pub mod error;
pub mod handlers;
pub mod schema;
pub mod seed;
pub mod state;

use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

use crate::state::{load_or_create_jwt_secret, open_registry, AppState};

pub async fn build_state(data_dir: &std::path::Path) -> Result<Arc<AppState>, String> {
    std::fs::create_dir_all(data_dir).map_err(|e| {
        format!(
            "Could not create data directory {}: {e}",
            data_dir.display()
        )
    })?;
    let registry = open_registry(data_dir)
        .await
        .map_err(|e| format!("Could not open server registry: {e}"))?;
    let jwt_secret = load_or_create_jwt_secret(data_dir)?;
    Ok(AppState::new(data_dir.to_path_buf(), registry, jwt_secret))
}

pub fn api_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(handlers::health))
        .route(
            "/companies",
            get(handlers::companies_list).post(handlers::companies_create),
        )
        .route("/companies/{id}", get(handlers::company_info))
        .route("/companies/{id}/login", post(handlers::company_login))
        .route("/companies/{id}/gst", post(handlers::company_update_gst))
        .route("/companies/{id}/backup", get(handlers::company_backup))
        .route("/company/query", post(handlers::company_query))
        .route("/company/execute", post(handlers::company_execute))
        .route("/company/ai/chat", post(handlers::company_ai_chat))
}
