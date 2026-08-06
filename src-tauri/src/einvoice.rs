//! IRP e-Invoice API (Sch v1.03 / auth v1.04) — authenticate, GEN IRN, cancel IRN.
//! Reuses the NIC RSA/AES helpers from `ewaybill.rs`; header names differ
//! (client_id / client_secret / Gstin / user_name / AuthToken).

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::ewaybill::{
    aes_ecb_decrypt_b64, aes_ecb_encrypt_b64, http_post_json, load_public_key, rsa_encrypt_b64,
    trim_base,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrpAuthArgs {
    pub base_url: String,
    pub gstin: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub public_key_pem: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrpGenerateArgs {
    pub base_url: String,
    pub gstin: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub public_key_pem: String,
    /// Sch v1.03 invoice object (plain JSON, built by the frontend)
    pub payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrpCancelArgs {
    pub base_url: String,
    pub gstin: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub public_key_pem: String,
    pub irn: String,
    /// CnlRsn: 1 Duplicate, 2 Data entry mistake, 3 Order cancelled, 4 Others
    pub reason: String,
    pub remark: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrnResult {
    pub irn: String,
    pub ack_no: String,
    pub ack_dt: String,
    pub signed_qr_code: String,
    pub status: String,
    pub ewb_no: String,
    pub ewb_dt: String,
    pub ewb_valid_till: String,
    pub raw: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrnCancelResult {
    pub irn: String,
    pub cancel_date: String,
    pub raw: String,
}

fn irp_headers(args: &IrpAuthArgs) -> HashMap<String, String> {
    let mut h = HashMap::new();
    h.insert("client_id".into(), args.client_id.clone());
    h.insert("client-secret".into(), args.client_secret.clone());
    h.insert("client_secret".into(), args.client_secret.clone());
    h.insert("Gstin".into(), args.gstin.clone());
    h
}

/// NIC JSON bodies report status as "Status" (string) or "status" (string/number).
fn status_flag(parsed: &Value) -> String {
    for key in ["Status", "status"] {
        if let Some(v) = parsed.get(key) {
            if let Some(s) = v.as_str() {
                return s.to_string();
            }
            if let Some(n) = v.as_i64() {
                return n.to_string();
            }
        }
    }
    String::new()
}

fn error_text(parsed: &Value, fallback: &str) -> String {
    parsed
        .get("ErrorDetails")
        .filter(|v| !v.is_null())
        .map(|e| e.to_string())
        .or_else(|| parsed.get("error").map(|e| e.to_string()))
        .or_else(|| parsed.get("ErrorMessage").map(|e| e.to_string()))
        .unwrap_or_else(|| fallback.chars().take(500).collect())
}

/// Authenticate against {base}/eivital/v1.04/auth; returns (AuthToken, SEK bytes).
fn irp_authenticate(args: &IrpAuthArgs) -> Result<(String, Vec<u8>), String> {
    if args.username.trim().is_empty()
        || args.password.is_empty()
        || args.client_id.trim().is_empty()
        || args.client_secret.trim().is_empty()
        || args.gstin.trim().is_empty()
        || args.public_key_pem.trim().is_empty()
    {
        return Err(
            "IRP credentials incomplete. Set GSTIN, username, password, client-id, client-secret, and the e-invoice portal public key under Companies.".into(),
        );
    }

    let public = load_public_key(&args.public_key_pem)?;

    let mut app_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut app_key);

    let enc_password = rsa_encrypt_b64(&public, args.password.as_bytes())?;
    let enc_app_key = rsa_encrypt_b64(&public, &app_key)?;

    let body = serde_json::json!({
        "UserName": args.username.trim(),
        "Password": enc_password,
        "AppKey": enc_app_key,
        "ForceRefreshAccessToken": false,
    });

    let url = format!("{}/eivital/v1.04/auth", trim_base(&args.base_url));
    let headers = irp_headers(args);
    let (status, text) = http_post_json(&url, &headers, &body.to_string())?;

    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status_flag(&parsed) != "1" {
        return Err(format!(
            "IRP Auth failed (HTTP {status}): {}",
            error_text(&parsed, &text)
        ));
    }

    let data = parsed
        .get("Data")
        .cloned()
        .or_else(|| parsed.get("data").cloned())
        .ok_or_else(|| format!("IRP Auth response missing Data: {text}"))?;

    let auth_token = data
        .get("AuthToken")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("IRP Auth response missing AuthToken: {text}"))?
        .to_string();

    let sek_enc = data
        .get("Sek")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("IRP Auth response missing Sek: {text}"))?;

    let sek = aes_ecb_decrypt_b64(&app_key, sek_enc)?;
    if sek.len() != 32 {
        return Err(format!(
            "Decrypted SEK length is {} (expected 32). Check public key / environment.",
            sek.len()
        ));
    }

    Ok((auth_token, sek))
}

/// POST an AES-encrypted payload to an eicore endpoint; returns decrypted JSON body.
fn irp_post_encrypted(
    args: &IrpAuthArgs,
    auth_token: &str,
    sek: &[u8],
    path: &str,
    plain: &Value,
) -> Result<Value, String> {
    let plain_bytes =
        serde_json::to_vec(plain).map_err(|e| format!("Invalid IRP payload: {e}"))?;
    let enc_data = aes_ecb_encrypt_b64(sek, &plain_bytes)?;

    let body = serde_json::json!({ "Data": enc_data });
    let url = format!("{}{}", trim_base(&args.base_url), path);

    let mut headers = irp_headers(args);
    headers.insert("user_name".into(), args.username.trim().to_string());
    headers.insert("AuthToken".into(), auth_token.to_string());

    let (status, text) = http_post_json(&url, &headers, &body.to_string())?;
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    if status_flag(&parsed) != "1" {
        return Err(format!(
            "IRP request failed (HTTP {status}): {}",
            error_text(&parsed, &text)
        ));
    }

    let data_enc = parsed
        .get("Data")
        .or_else(|| parsed.get("data"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("IRP success but no Data: {text}"))?;

    let decrypted = aes_ecb_decrypt_b64(sek, data_enc)?;
    let decrypted_str = String::from_utf8_lossy(&decrypted).to_string();
    serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Could not parse decrypted IRP data: {e}\n{decrypted_str}"))
}

fn as_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

#[tauri::command]
pub fn nic_einv_auth(args: IrpAuthArgs) -> Result<(), String> {
    irp_authenticate(&args)?;
    Ok(())
}

#[tauri::command]
pub fn nic_einv_generate(args: IrpGenerateArgs) -> Result<IrnResult, String> {
    let auth_args = IrpAuthArgs {
        base_url: args.base_url.clone(),
        gstin: args.gstin.clone(),
        username: args.username.clone(),
        password: args.password.clone(),
        client_id: args.client_id.clone(),
        client_secret: args.client_secret.clone(),
        public_key_pem: args.public_key_pem.clone(),
    };
    let (auth_token, sek) = irp_authenticate(&auth_args)?;

    let result = irp_post_encrypted(
        &auth_args,
        &auth_token,
        &sek,
        "/eicore/v1.03/Invoice",
        &args.payload,
    )?;

    let irn = as_text(result.get("Irn"));
    if irn.is_empty() {
        return Err(format!("Missing Irn in IRP response: {result}"));
    }

    Ok(IrnResult {
        irn,
        ack_no: as_text(result.get("AckNo")),
        ack_dt: as_text(result.get("AckDt")),
        signed_qr_code: as_text(result.get("SignedQRCode")),
        status: as_text(result.get("Status")),
        ewb_no: as_text(result.get("EwbNo")),
        ewb_dt: as_text(result.get("EwbDt")),
        ewb_valid_till: as_text(result.get("EwbValidTill")),
        raw: result.to_string(),
    })
}

#[tauri::command]
pub fn nic_einv_cancel(args: IrpCancelArgs) -> Result<IrnCancelResult, String> {
    if args.irn.trim().len() != 64 {
        return Err("IRN must be the 64-character hash returned at generation.".into());
    }
    let auth_args = IrpAuthArgs {
        base_url: args.base_url.clone(),
        gstin: args.gstin.clone(),
        username: args.username.clone(),
        password: args.password.clone(),
        client_id: args.client_id.clone(),
        client_secret: args.client_secret.clone(),
        public_key_pem: args.public_key_pem.clone(),
    };
    let (auth_token, sek) = irp_authenticate(&auth_args)?;

    let reason = match args.reason.trim() {
        "1" | "2" | "3" | "4" => args.reason.trim().to_string(),
        _ => "2".to_string(),
    };
    let body = serde_json::json!({
        "Irn": args.irn.trim(),
        "CnlRsn": reason,
        "CnlRem": args.remark.trim().chars().take(100).collect::<String>(),
    });

    let result = irp_post_encrypted(
        &auth_args,
        &auth_token,
        &sek,
        "/eicore/v1.03/Invoice/Cancel",
        &body,
    )?;

    Ok(IrnCancelResult {
        irn: as_text(result.get("Irn")),
        cancel_date: as_text(result.get("CancelDate")),
        raw: result.to_string(),
    })
}