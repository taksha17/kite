//! Unit tests for password hashing (incl. parity with the desktop/web
//! frontend `src/lib/auth/crypto.ts`) and JWT tokens.

use jsonwebtoken::{decode, DecodingKey, Validation};
use kite_server::auth::{hash_password, issue_token, verify_password, Claims};

#[test]
fn hash_and_verify_roundtrip() {
    let encoded = hash_password("correct horse battery staple");
    assert!(verify_password("correct horse battery staple", &encoded));
    assert!(!verify_password("wrong password", &encoded));
}

#[test]
fn rejects_malformed_hashes() {
    assert!(!verify_password("pw", "not-a-hash"));
    assert!(!verify_password("pw", "abc$def$ghi"));
    // iteration floor (matches the frontend's 10_000 minimum)
    assert!(!verify_password(
        "pw",
        "100$0a1b2c3d4e5f60718293a4b5c6d7e8f9$8256f63b6afc306b72859eface03eafa41312508d6739477609d7329228e822b"
    ));
    // bad hex
    assert!(!verify_password("pw", "120000$zzzz$abcd"));
    // wrong hash length
    assert!(!verify_password(
        "pw",
        "120000$0a1b2c3d4e5f60718293a4b5c6d7e8f9$abcd"
    ));
}

/// Generated with WebCrypto (same code path as `hashPassword` in crypto.ts):
/// password "kite-parity-check", salt below, 120_000 iterations, SHA-256, 32 bytes.
const FRONTEND_ENCODED: &str = "120000$0a1b2c3d4e5f60718293a4b5c6d7e8f9$8256f63b6afc306b72859eface03eafa41312508d6739477609d7329228e822b";

#[test]
fn verifies_frontend_generated_hash() {
    // A hash produced by the browser/desktop app must verify on the server —
    // this is what lets the same user log in from Solo and Team builds.
    assert!(verify_password("kite-parity-check", FRONTEND_ENCODED));
    assert!(!verify_password("kite-parity-chek", FRONTEND_ENCODED));
}

#[test]
fn jwt_roundtrip_and_wrong_secret() {
    let secret = b"test-secret-that-is-long-enough-32b";
    let token = issue_token(secret, 7, "company-1", "owner", "owner").expect("issue");

    let data = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret),
        &Validation::default(),
    )
    .expect("decode with same secret");
    assert_eq!(data.claims.sub, 7);
    assert_eq!(data.claims.company_id, "company-1");
    assert_eq!(data.claims.username, "owner");
    assert_eq!(data.claims.role, "owner");

    let wrong = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(b"another-secret-also-long-enough!!"),
        &Validation::default(),
    );
    assert!(wrong.is_err());
}
