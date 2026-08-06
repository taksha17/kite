//! AI quick entry: forwards fully-built prompts to the company's configured
//! LLM provider. The API key never leaves the server — the browser only sends
//! {system, user[, imageDataUrl]} and receives the model's reply text.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;

const MAX_PROMPT_CHARS: usize = 16_000;
const MAX_IMAGE_CHARS: usize = 2_500_000; // ~1.8MB binary as data URL
const TIMEOUT_SECS: u64 = 60;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: String,
    pub api_key: String,
    #[serde(default)]
    pub model: String,
}

pub fn default_model(provider: &str) -> Result<&'static str, ApiError> {
    match provider {
        "openai" => Ok("gpt-4o-mini"),
        "anthropic" => Ok("claude-haiku-4-5-20251001"),
        "gemini" => Ok("gemini-2.0-flash"),
        "openrouter" => Ok("openrouter/free"),
        other => Err(ApiError::bad_request(format!(
            "Unknown AI provider “{other}” — pick OpenRouter, OpenAI, Anthropic, or Gemini in company settings."
        ))),
    }
}

pub fn validate_prompts(system: &str, user: &str, image: Option<&str>) -> Result<(), ApiError> {
    if system.trim().is_empty() || user.trim().is_empty() {
        return Err(ApiError::bad_request("Empty prompt."));
    }
    if system.len() > MAX_PROMPT_CHARS || user.len() > MAX_PROMPT_CHARS {
        return Err(ApiError::bad_request("Prompt too long."));
    }
    if let Some(img) = image {
        if img.len() > MAX_IMAGE_CHARS {
            return Err(ApiError::bad_request(
                "Bill photo is too large after compression — try cropping to the bill.",
            ));
        }
        if !img.starts_with("data:image/") {
            return Err(ApiError::bad_request("Invalid bill image payload."));
        }
    }
    Ok(())
}

fn split_data_url(data_url: &str) -> Result<(String, String), ApiError> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| ApiError::bad_request("Invalid bill image payload."))?;
    let (meta, b64) = rest
        .split_once(";base64,")
        .ok_or_else(|| ApiError::bad_request("Invalid bill image payload."))?;
    Ok((meta.to_string(), b64.to_string()))
}

/// Calls the provider's chat endpoint and returns the reply text.
pub async fn call_provider(
    settings: &AiSettings,
    system: &str,
    user: &str,
    image_data_url: Option<&str>,
) -> Result<String, ApiError> {
    let model = if settings.model.trim().is_empty() {
        default_model(&settings.provider)?.to_string()
    } else {
        settings.model.trim().to_string()
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| ApiError::internal(format!("Could not build HTTP client: {e}")))?;

    let image = match image_data_url {
        Some(url) => Some(split_data_url(url)?),
        None => None,
    };

    async fn send_once(
        client: &reqwest::Client,
        settings: &AiSettings,
        model: &str,
        system: &str,
        user: &str,
        image: &Option<(String, String)>,
    ) -> Result<reqwest::Response, ApiError> {
        let response = match settings.provider.as_str() {
            "openai" | "openrouter" => {
                let user_content = if let Some((mime, b64)) = image {
                    json!([
                        { "type": "text", "text": user },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:{mime};base64,{b64}")
                            }
                        }
                    ])
                } else {
                    json!(user)
                };
                let mut req = client
                    .post(if settings.provider == "openrouter" {
                        "https://openrouter.ai/api/v1/chat/completions"
                    } else {
                        "https://api.openai.com/v1/chat/completions"
                    })
                    .bearer_auth(settings.api_key.trim());
                if settings.provider == "openrouter" {
                    req = req
                        .header("HTTP-Referer", "https://github.com/taksha17/kite")
                        .header("X-Title", "Kite Books");
                }
                req.json(&json!({
                    "model": model,
                    "temperature": 0,
                    "response_format": { "type": "json_object" },
                    "messages": [
                        { "role": "system", "content": system },
                        { "role": "user", "content": user_content },
                    ],
                }))
                .send()
                .await
            }
            "anthropic" => {
                let user_content = if let Some((mime, b64)) = image {
                    json!([
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": b64
                            }
                        },
                        { "type": "text", "text": user }
                    ])
                } else {
                    json!(user)
                };
                client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", settings.api_key.trim())
                    .header("anthropic-version", "2023-06-01")
                    .json(&json!({
                        "model": model,
                        "max_tokens": 2048,
                        "temperature": 0,
                        "system": system,
                        "messages": [ { "role": "user", "content": user_content } ],
                    }))
                    .send()
                    .await
            }
            "gemini" => {
                let mut parts = vec![json!({ "text": user })];
                if let Some((mime, b64)) = image {
                    parts.push(json!({
                        "inline_data": { "mime_type": mime, "data": b64 }
                    }));
                }
                client
                    .post(format!(
                        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                    ))
                    .header("x-goog-api-key", settings.api_key.trim())
                    .json(&json!({
                        "systemInstruction": { "parts": [ { "text": system } ] },
                        "contents": [ { "role": "user", "parts": parts } ],
                        "generationConfig": { "temperature": 0, "responseMimeType": "application/json" },
                    }))
                    .send()
                    .await
            }
            other => {
                return Err(ApiError::bad_request(format!(
                    "Unknown AI provider “{other}”."
                )))
            }
        }
        .map_err(|e| {
            ApiError::internal(format!(
                "Could not reach the AI provider. Check the server's internet connection: {e}"
            ))
        })?;
        Ok(response)
    }

    let mut response = send_once(&client, settings, &model, system, user, &image).await?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        response = send_once(&client, settings, &model, system, user, &image).await?;
    }

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("AI provider replied with non-JSON: {e}")))?;

    if !status.is_success() {
        let detail = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("no detail");
        return Err(match status.as_u16() {
            401 | 403 => ApiError::bad_request(format!(
                "The AI provider rejected the API key ({detail}). Update it under Companies → AI quick entry."
            )),
            429 => ApiError::internal(
                "The AI provider rate-limited the request — wait a minute and retry. On OpenRouter's free tier this is the 20/min or 50/day cap (a one-time $10 top-up raises it to 1000/day).",
            ),
            s => ApiError::internal(format!("AI provider error (HTTP {s}): {detail}")),
        });
    }

    let text = match settings.provider.as_str() {
        "openai" | "openrouter" => body
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        "anthropic" => body.pointer("/content/0/text").and_then(Value::as_str),
        "gemini" => body
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(Value::as_str),
        _ => None,
    };

    text.map(str::to_string).ok_or_else(|| {
        ApiError::internal("AI provider reply had an unexpected shape — no text found.")
    })
}
