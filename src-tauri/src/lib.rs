mod einvoice;
mod ewaybill;

use base64::Engine;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use tauri::Manager;

#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendInvoiceEmailArgs {
    host: String,
    port: u16,
    username: String,
    password: String,
    from_email: String,
    from_name: String,
    to_email: String,
    subject: String,
    body: String,
    pdf_base64: String,
    pdf_filename: String,
    use_starttls: bool,
}

#[tauri::command]
fn send_invoice_email(args: SendInvoiceEmailArgs) -> Result<(), String> {
    use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let pdf_bytes = base64::engine::general_purpose::STANDARD
        .decode(args.pdf_base64.as_bytes())
        .map_err(|e| format!("Invalid PDF data: {e}"))?;

    let from = format!("{} <{}>", args.from_name, args.from_email)
        .parse()
        .map_err(|e: lettre::address::AddressError| e.to_string())?;
    let to = args
        .to_email
        .parse()
        .map_err(|e: lettre::address::AddressError| e.to_string())?;

    let email = Message::builder()
        .from(from)
        .to(to)
        .subject(args.subject)
        .multipart(
            MultiPart::mixed()
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_PLAIN)
                        .body(args.body),
                )
                .singlepart(
                    Attachment::new(args.pdf_filename).body(
                        pdf_bytes,
                        ContentType::parse("application/pdf")
                            .map_err(|e| e.to_string())?,
                    ),
                ),
        )
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(args.username, args.password);

    let mailer = if args.use_starttls {
        SmtpTransport::starttls_relay(&args.host)
            .map_err(|e| e.to_string())?
            .port(args.port)
            .credentials(creds)
            .build()
    } else {
        SmtpTransport::relay(&args.host)
            .map_err(|e| e.to_string())?
            .port(args.port)
            .credentials(creds)
            .build()
    };

    mailer
        .send(&email)
        .map_err(|e| format!("SMTP send failed: {e}"))?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestArgs {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    basic_user: Option<String>,
    basic_pass: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponsePayload {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

#[tauri::command]
fn http_request(args: HttpRequestArgs) -> Result<HttpResponsePayload, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let method = args.method.to_uppercase();
    let mut builder = match method.as_str() {
        "GET" => client.get(&args.url),
        "POST" => client.post(&args.url),
        "PUT" => client.put(&args.url),
        "DELETE" => client.delete(&args.url),
        other => return Err(format!("Unsupported HTTP method: {other}")),
    };

    for (k, v) in &args.headers {
        builder = builder.header(k, v);
    }

    if let (Some(user), Some(pass)) = (&args.basic_user, &args.basic_pass) {
        builder = builder.basic_auth(user, Some(pass));
    }

    if let Some(body) = &args.body {
        builder = builder.body(body.clone());
    }

    let response = builder.send().map_err(|e| format!("HTTP request failed: {e}"))?;
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in response.headers().iter() {
        if let Ok(val) = v.to_str() {
            headers.insert(k.to_string(), val.to_string());
        }
    }
    let body = response.text().map_err(|e| e.to_string())?;

    Ok(HttpResponsePayload {
        status,
        body,
        headers,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            app_data_dir,
            send_invoice_email,
            http_request,
            ewaybill::nic_eway_auth,
            ewaybill::nic_eway_generate,
            einvoice::nic_einv_auth,
            einvoice::nic_einv_generate,
            einvoice::nic_einv_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
