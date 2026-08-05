//! Password hashing (PBKDF2-SHA256, compatible with `src/lib/auth/crypto.ts`)
//! and JWT session tokens.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::ApiError;
use crate::state::AppState;

const PBKDF2_ITERATIONS: u32 = 120_000;
const TOKEN_TTL_SECS: u64 = 12 * 60 * 60;

/// Returns `iterations$saltHex$hashHex` — same format as the desktop app.
pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut out);
    format!(
        "{}${}${}",
        PBKDF2_ITERATIONS,
        hex::encode(salt),
        hex::encode(out)
    )
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    let mut parts = encoded.split('$');
    let (Some(iter_str), Some(salt_hex), Some(hash_hex)) =
        (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let Ok(iterations) = iter_str.parse::<u32>() else {
        return false;
    };
    if iterations < 10_000 {
        return false;
    }
    let Ok(salt) = hex::decode(salt_hex) else {
        return false;
    };
    let Ok(expected) = hex::decode(hash_hex) else {
        return false;
    };
    if expected.len() != 32 {
        return false;
    }
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut out);
    // constant-time compare
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= out[i] ^ expected[i];
    }
    diff == 0
}

#[derive(Serialize, Deserialize)]
pub struct Claims {
    pub sub: i64,
    pub company_id: String,
    pub username: String,
    pub role: String,
    pub exp: u64,
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn issue_token(
    secret: &[u8],
    user_id: i64,
    company_id: &str,
    username: &str,
    role: &str,
) -> Result<String, ApiError> {
    let claims = Claims {
        sub: user_id,
        company_id: company_id.to_string(),
        username: username.to_string(),
        role: role.to_string(),
        exp: now_secs() + TOKEN_TTL_SECS,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|e| ApiError::internal(format!("Could not issue token: {e}")))
}

/// Authenticated user extracted from `Authorization: Bearer <jwt>`.
pub struct AuthUser {
    pub user_id: i64,
    pub company_id: String,
    pub username: String,
    pub role: String,
}

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| ApiError::unauthorized("Sign in first."))?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::unauthorized("Malformed authorization header."))?;
        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(&state.jwt_secret),
            &Validation::default(),
        )
        .map_err(|_| ApiError::unauthorized("Session expired — sign in again."))?;
        let claims = data.claims;
        Ok(AuthUser {
            user_id: claims.sub,
            company_id: claims.company_id,
            username: claims.username,
            role: claims.role,
        })
    }
}
