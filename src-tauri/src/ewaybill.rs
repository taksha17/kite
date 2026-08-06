//! NIC e-Way Bill API v1.03 — RSA/AES helpers + Auth + GENEWAYBILL.

use base64::Engine;
use rand::RngCore;
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NicAuthArgs {
    pub base_url: String,
    pub gstin: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub public_key_pem: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NicAuthResult {
    pub auth_token: String,
    /// Base64 of decrypted 32-byte SEK (for reuse if needed)
    pub sek_b64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NicGenerateArgs {
    pub base_url: String,
    pub gstin: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub public_key_pem: String,
    /// GENEWAYBILL request object (plain JSON)
    pub payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NicGenerateResult {
    pub eway_bill_no: String,
    pub eway_bill_date: String,
    pub valid_upto: String,
    pub alert: String,
    pub raw: String,
}

pub(crate) fn b64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub(crate) fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(s.trim().as_bytes())
        .map_err(|e| format!("Base64 decode failed: {e}"))
}

pub(crate) fn normalize_pem(pem: &str) -> String {
    let trimmed = pem.trim();
    if trimmed.contains("BEGIN") {
        return trimmed.to_string();
    }
    // bare base64 body → wrap as PUBLIC KEY
    format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
        trimmed
    )
}

pub(crate) fn load_public_key(pem: &str) -> Result<RsaPublicKey, String> {
    let pem = normalize_pem(pem);
    RsaPublicKey::from_public_key_pem(&pem)
        .or_else(|_| {
            // Try PKCS#1 RSA PUBLIC KEY
            use rsa::pkcs1::DecodeRsaPublicKey;
            RsaPublicKey::from_pkcs1_pem(&pem)
        })
        .map_err(|e| {
            format!(
                "Invalid NIC public key PEM (use the e-Way Bill RSA public key from the sandbox/portal): {e}"
            )
        })
}

/// RSA/ECB/PKCS1Padding encrypt → Base64 (NIC e-way bill style).
pub(crate) fn rsa_encrypt_b64(public: &RsaPublicKey, plain: &[u8]) -> Result<String, String> {
    let mut rng = rand::thread_rng();
    let enc = public
        .encrypt(&mut rng, Pkcs1v15Encrypt, plain)
        .map_err(|e| format!("RSA encrypt failed: {e}"))?;
    Ok(b64_encode(&enc))
}

/// AES-256-ECB PKCS7 encrypt → Base64.
pub(crate) fn aes_ecb_encrypt_b64(key: &[u8], plain: &[u8]) -> Result<String, String> {
    use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
    use aes::Aes256;

    if key.len() != 32 {
        return Err(format!(
            "AES key must be 32 bytes (got {})",
            key.len()
        ));
    }

    // ecb via cipher crate: Encryptor
    type Aes256EcbEnc = ecb::Encryptor<Aes256>;
    let cipher = Aes256EcbEnc::new_from_slice(key)
        .map_err(|e| format!("AES init failed: {e}"))?;

    let ct = cipher
        .encrypt_padded_vec_mut::<Pkcs7>(plain);
    Ok(b64_encode(&ct))
}

/// AES-256-ECB PKCS7 decrypt from Base64.
pub(crate) fn aes_ecb_decrypt_b64(key: &[u8], cipher_b64: &str) -> Result<Vec<u8>, String> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyInit};
    use aes::Aes256;

    if key.len() != 32 {
        return Err(format!(
            "AES key must be 32 bytes (got {})",
            key.len()
        ));
    }

    let ct = b64_decode(cipher_b64)?;
    type Aes256EcbDec = ecb::Decryptor<Aes256>;
    let cipher = Aes256EcbDec::new_from_slice(key)
        .map_err(|e| format!("AES init failed: {e}"))?;

    cipher
        .decrypt_padded_vec_mut::<Pkcs7>(&ct)
        .map_err(|e| format!("AES decrypt failed (check app_key/SEK): {e}"))
}

pub(crate) fn trim_base(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

pub(crate) fn http_post_json(
    url: &str,
    headers: &HashMap<String, String>,
    body: &str,
) -> Result<(u16, String), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client
        .post(url)
        .header("Content-Type", "application/json");
    for (k, v) in headers {
        builder = builder.header(k, v);
    }

    let response = builder
        .body(body.to_string())
        .send()
        .map_err(|e| format!("HTTP request failed: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().map_err(|e| e.to_string())?;
    Ok((status, text))
}

fn auth_headers(args: &NicAuthArgs) -> HashMap<String, String> {
    let mut h = HashMap::new();
    h.insert("client-id".into(), args.client_id.clone());
    h.insert("client-secret".into(), args.client_secret.clone());
    h.insert("gstin".into(), args.gstin.clone());
    h
}

/// Authenticate; returns authtoken + decrypted SEK bytes.
fn authenticate(args: &NicAuthArgs) -> Result<(String, Vec<u8>), String> {
    if args.username.trim().is_empty()
        || args.password.is_empty()
        || args.client_id.trim().is_empty()
        || args.client_secret.trim().is_empty()
        || args.gstin.trim().is_empty()
        || args.public_key_pem.trim().is_empty()
    {
        return Err(
            "NIC credentials incomplete. Set GSTIN, username, password, client-id, client-secret, and public key under Companies.".into(),
        );
    }

    let public = load_public_key(&args.public_key_pem)?;

    // 32 random bytes — NIC treats app_key as AES-256 key material
    let mut app_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut app_key);

    let enc_password = rsa_encrypt_b64(&public, args.password.as_bytes())?;
    let enc_app_key = rsa_encrypt_b64(&public, &app_key)?;

    let body = serde_json::json!({
        "action": "ACCESSTOKEN",
        "username": args.username.trim(),
        "password": enc_password,
        "app_key": enc_app_key,
    });

    let url = format!("{}/Auth", trim_base(&args.base_url));
    let headers = auth_headers(args);
    let (status, text) = http_post_json(&url, &headers, &body.to_string())?;

    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let status_flag = parsed
        .get("status")
        .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string())))
        .unwrap_or_default();

    if status_flag != "1" {
        let err = parsed
            .get("error")
            .map(|e| e.to_string())
            .or_else(|| parsed.get("errorCodes").map(|e| e.to_string()))
            .unwrap_or_else(|| text.chars().take(400).collect());
        return Err(format!(
            "NIC Auth failed (HTTP {status}): {err}"
        ));
    }

    let auth_token = parsed
        .get("authtoken")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("NIC Auth response missing authtoken: {text}"))?
        .to_string();

    let sek_enc = parsed
        .get("sek")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("NIC Auth response missing sek: {text}"))?;

    let sek = aes_ecb_decrypt_b64(&app_key, sek_enc)?;
    if sek.len() != 32 {
        return Err(format!(
            "Decrypted SEK length is {} (expected 32). Check public key / sandbox environment.",
            sek.len()
        ));
    }

    Ok((auth_token, sek))
}

#[tauri::command]
pub fn nic_eway_auth(args: NicAuthArgs) -> Result<NicAuthResult, String> {
    let (token, sek) = authenticate(&args)?;
    Ok(NicAuthResult {
        auth_token: token,
        sek_b64: b64_encode(&sek),
    })
}

#[tauri::command]
pub fn nic_eway_generate(args: NicGenerateArgs) -> Result<NicGenerateResult, String> {
    let auth_args = NicAuthArgs {
        base_url: args.base_url.clone(),
        gstin: args.gstin.clone(),
        username: args.username.clone(),
        password: args.password.clone(),
        client_id: args.client_id.clone(),
        client_secret: args.client_secret.clone(),
        public_key_pem: args.public_key_pem.clone(),
    };
    let (auth_token, sek) = authenticate(&auth_args)?;

    let plain = serde_json::to_vec(&args.payload)
        .map_err(|e| format!("Invalid GENEWAYBILL payload: {e}"))?;
    let enc_data = aes_ecb_encrypt_b64(&sek, &plain)?;

    let body = serde_json::json!({
        "action": "GENEWAYBILL",
        "data": enc_data,
    });

    let url = format!("{}/ewayapi", trim_base(&args.base_url));
    let mut headers = auth_headers(&auth_args);
    headers.insert("authtoken".into(), auth_token);

    let (status, text) = http_post_json(&url, &headers, &body.to_string())?;
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let status_flag = parsed
        .get("status")
        .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string())))
        .unwrap_or_default();

    if status_flag != "1" {
        let err = parsed
            .get("error")
            .map(|e| e.to_string())
            .or_else(|| {
                parsed
                    .pointer("/error/errorCodes")
                    .map(|e| format!("errorCodes {e}"))
            })
            .unwrap_or_else(|| text.chars().take(500).collect());
        return Err(format!(
            "GENEWAYBILL failed (HTTP {status}): {err}"
        ));
    }

    let data_enc = parsed
        .get("data")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("GENEWAYBILL success but no data: {text}"))?;

    let decrypted = aes_ecb_decrypt_b64(&sek, data_enc)?;
    let decrypted_str = String::from_utf8_lossy(&decrypted).to_string();
    // Response may itself be base64(JSON) in some NIC builds — try both
    let result_json: Value = serde_json::from_slice(&decrypted).or_else(|_| {
        let inner = b64_decode(&decrypted_str)?;
        serde_json::from_slice(&inner).map_err(|e| e.to_string())
    }).map_err(|e| format!("Could not parse decrypted GENEWAYBILL data: {e}\n{decrypted_str}"))?;

    let eway_bill_no = result_json
        .get("ewayBillNo")
        .map(|v| match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => v.to_string(),
        })
        .filter(|s| !s.is_empty() && s != "null")
        .ok_or_else(|| format!("Missing ewayBillNo in response: {decrypted_str}"))?;

    let eway_bill_date = result_json
        .get("ewayBillDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let valid_upto = result_json
        .get("validUpto")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let alert = result_json
        .get("alert")
        .and_then(|v| v.as_str())
        .or_else(|| parsed.get("alert").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    Ok(NicGenerateResult {
        eway_bill_no,
        eway_bill_date,
        valid_upto,
        alert,
        raw: decrypted_str,
    })
}
