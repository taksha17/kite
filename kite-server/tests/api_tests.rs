//! End-to-end API tests: company creation, login, authenticated SQL
//! execute/query, per-company data isolation, and auth guards.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(t) = token {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    let request = match body {
        Some(b) => builder
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&b).unwrap()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

async fn create_company(app: &axum::Router, name: &str, owner: &str) -> Value {
    let (status, body) = call(
        app,
        "POST",
        "/companies",
        None,
        Some(json!({
            "name": name,
            "ownerUsername": owner,
            "ownerPassword": "owner@123",
            "gstEnabled": true,
            "stateCode": "29",
            "gstin": "29AABCM1234F1Z5"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create company failed: {body}");
    body
}

async fn login(app: &axum::Router, company_id: &str, password: &str) -> (StatusCode, Value) {
    login_as(app, company_id, "owner", password).await
}

async fn login_as(
    app: &axum::Router,
    company_id: &str,
    username: &str,
    password: &str,
) -> (StatusCode, Value) {
    call(
        app,
        "POST",
        &format!("/companies/{company_id}/login"),
        None,
        Some(json!({ "username": username, "password": password })),
    )
    .await
}

#[tokio::test]
async fn full_company_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    let state = kite_server::build_state(dir.path()).await.unwrap();
    let app = kite_server::api_router().with_state(state);

    // health
    let (status, body) = call(&app, "GET", "/health", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // create company
    let created = create_company(&app, "Madhur Traders", "owner").await;
    let company_id = created["company"]["id"].as_str().unwrap().to_string();
    assert_eq!(created["company"]["name"], "Madhur Traders");
    assert_eq!(created["owner"]["role"], "owner");

    // appears in the list
    let (status, body) = call(&app, "GET", "/companies", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let companies = body["companies"].as_array().unwrap();
    assert!(companies.iter().any(|c| c["id"] == company_id));

    // info reports one user (the owner)
    let (status, body) = call(&app, "GET", &format!("/companies/{company_id}"), None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["userCount"], 1);

    // wrong password is rejected with the same 401 as a missing user
    let (status, _) = login(&app, &company_id, "not-the-password").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // correct password issues a token
    let (status, body) = login(&app, &company_id, "owner@123").await;
    assert_eq!(status, StatusCode::OK, "login failed: {body}");
    let token = body["token"].as_str().unwrap().to_string();
    assert_eq!(body["user"]["role"], "owner");

    // unauthenticated SQL is rejected
    let (status, _) = call(
        &app,
        "POST",
        "/company/execute",
        None,
        Some(
            json!({ "sql": "INSERT INTO meta (key, value) VALUES ($1, $2)", "params": ["k", "v"] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // authenticated execute returns rowsAffected + lastInsertId
    let (status, body) = call(
        &app,
        "POST",
        "/company/execute",
        Some(&token),
        Some(json!({ "sql": "INSERT INTO meta (key, value) VALUES ($1, $2)", "params": ["smoke", "hello"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "execute failed: {body}");
    assert_eq!(body["rowsAffected"], 1);
    assert!(body["lastInsertId"].as_i64().unwrap() > 0);

    // and the row is queryable back
    let (status, body) = call(
        &app,
        "POST",
        "/company/query",
        Some(&token),
        Some(json!({ "sql": "SELECT value FROM meta WHERE key = $1", "params": ["smoke"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["rows"][0]["value"], "hello");
}

#[tokio::test]
async fn companies_are_isolated() {
    let dir = tempfile::tempdir().unwrap();
    let state = kite_server::build_state(dir.path()).await.unwrap();
    let app = kite_server::api_router().with_state(state);

    let a = create_company(&app, "Alpha Traders", "owner").await;
    let a_id = a["company"]["id"].as_str().unwrap().to_string();
    let b = create_company(&app, "Beta & Co", "owner").await;
    let b_id = b["company"]["id"].as_str().unwrap().to_string();

    let (_, body) = login(&app, &a_id, "owner@123").await;
    let token_a = body["token"].as_str().unwrap().to_string();
    let (_, body) = login(&app, &b_id, "owner@123").await;
    let token_b = body["token"].as_str().unwrap().to_string();

    // A writes into its own books
    let (status, _) = call(
        &app,
        "POST",
        "/company/execute",
        Some(&token_a),
        Some(json!({ "sql": "INSERT INTO meta (key, value) VALUES ($1, $2)", "params": ["secret", "only-a"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // B sees nothing of A's data
    let (status, body) = call(
        &app,
        "POST",
        "/company/query",
        Some(&token_b),
        Some(json!({ "sql": "SELECT value FROM meta WHERE key = $1", "params": ["secret"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["rows"].as_array().unwrap().len(), 0);

    // A's token cannot touch B's company-scoped endpoints either
    let (status, _) = call(
        &app,
        "POST",
        &format!("/companies/{b_id}/gst"),
        Some(&token_a),
        Some(json!({ "gstEnabled": false, "stateCode": "", "gstin": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn backup_is_owner_only() {
    let dir = tempfile::tempdir().unwrap();
    let state = kite_server::build_state(dir.path()).await.unwrap();
    let app = kite_server::api_router().with_state(state);

    let created = create_company(&app, "Backup Co", "owner").await;
    let company_id = created["company"]["id"].as_str().unwrap().to_string();
    let (_, body) = login(&app, &company_id, "owner@123").await;
    let owner_token = body["token"].as_str().unwrap().to_string();

    // a data-entry teammate
    let hash = kite_server::auth::hash_password("welcome@123");
    let (status, _) = call(
        &app,
        "POST",
        "/company/execute",
        Some(&owner_token),
        Some(json!({
            "sql": "INSERT INTO app_user (username, display_name, role, password_hash) VALUES ($1, $2, $3, $4)",
            "params": ["priya", "Priya Sharma", "data_entry", hash]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // anonymous: 401
    let req = Request::builder()
        .method("GET")
        .uri(format!("/companies/{company_id}/backup"))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // data-entry: 403
    let (_, body) = login_as(&app, &company_id, "priya", "welcome@123").await;
    let staff_token = body["token"].as_str().unwrap().to_string();
    let req = Request::builder()
        .method("GET")
        .uri(format!("/companies/{company_id}/backup"))
        .header("authorization", format!("Bearer {staff_token}"))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // owner: a real SQLite file
    let req = Request::builder()
        .method("GET")
        .uri(format!("/companies/{company_id}/backup"))
        .header("authorization", format!("Bearer {owner_token}"))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert!(bytes.len() > 100, "backup too small: {} bytes", bytes.len());
    assert_eq!(&bytes[..16], b"SQLite format 3\0");
}

#[tokio::test]
async fn ai_chat_is_guarded() {
    let dir = tempfile::tempdir().unwrap();
    let state = kite_server::build_state(dir.path()).await.unwrap();
    let app = kite_server::api_router().with_state(state);

    // anonymous: 401
    let (status, _) = call(
        &app,
        "POST",
        "/company/ai/chat",
        None,
        Some(json!({ "system": "s", "user": "u" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let created = create_company(&app, "AI Co", "owner").await;
    let company_id = created["company"]["id"].as_str().unwrap().to_string();
    let (_, body) = login(&app, &company_id, "owner@123").await;
    let token = body["token"].as_str().unwrap().to_string();

    // authenticated but AI not configured: 400 with setup guidance
    // (no provider key on the server, so this never touches the network)
    let (status, body) = call(
        &app,
        "POST",
        "/company/ai/chat",
        Some(&token),
        Some(json!({ "system": "s", "user": "u" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("not set up"));

    // empty prompt rejected before any settings lookup
    let (status, _) = call(
        &app,
        "POST",
        "/company/ai/chat",
        Some(&token),
        Some(json!({ "system": " ", "user": "u" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_company_validates_input() {
    let dir = tempfile::tempdir().unwrap();
    let state = kite_server::build_state(dir.path()).await.unwrap();
    let app = kite_server::api_router().with_state(state);

    // short owner password rejected
    let (status, _) = call(
        &app,
        "POST",
        "/companies",
        None,
        Some(json!({ "name": "Bad Co", "ownerUsername": "owner", "ownerPassword": "123" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // empty name rejected
    let (status, _) = call(
        &app,
        "POST",
        "/companies",
        None,
        Some(json!({ "name": "  ", "ownerUsername": "owner", "ownerPassword": "owner@123" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
