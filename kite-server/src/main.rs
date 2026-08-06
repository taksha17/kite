use axum::Router;
use clap::{Parser, Subcommand};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use kite_server::company::{create_company, CreateCompanyInput};
use kite_server::{api_router, build_state};

#[derive(Parser)]
#[command(
    name = "kite-server",
    about = "Kite Enterprise — multi-user server for Kite books"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the HTTP server (API + web app).
    Serve {
        /// Directory holding company SQLite files and the server registry.
        #[arg(long, default_value = "./kite-data")]
        data_dir: PathBuf,
        /// Directory with the built web app (vite dist).
        #[arg(long, default_value = "./dist")]
        web_dir: PathBuf,
        #[arg(long, default_value = "0.0.0.0")]
        host: String,
        #[arg(long, default_value_t = 8080)]
        port: u16,
    },
    /// Create a company on this server without the UI.
    CreateCompany {
        #[arg(long, default_value = "./kite-data")]
        data_dir: PathBuf,
        #[arg(long)]
        name: String,
        #[arg(long)]
        owner: String,
        #[arg(long)]
        password: String,
        #[arg(long, default_value = "")]
        display_name: String,
        #[arg(long, default_value = "")]
        fy_start: String,
        #[arg(long, default_value = "")]
        state_code: String,
        #[arg(long, default_value = "")]
        gstin: String,
    },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kite_server=info,tower_http=info".into()),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Command::Serve {
            data_dir,
            web_dir,
            host,
            port,
        } => {
            let state = match build_state(&data_dir).await {
                Ok(state) => state,
                Err(e) => {
                    eprintln!("Startup failed: {e}");
                    std::process::exit(1);
                }
            };

            let index = web_dir.join("index.html");
            if !index.exists() {
                tracing::warn!(
                    "Web directory {} has no index.html — only the API will be served.",
                    web_dir.display()
                );
            }
            // .fallback() keeps the fallback's own 200 status (SPA serving);
            // not_found_service would force 404 even when index.html is served.
            let static_service = ServeDir::new(&web_dir).fallback(ServeFile::new(index));

            let app = Router::new()
                .nest("/api", api_router())
                .fallback_service(static_service)
                .layer(TraceLayer::new_for_http())
                .layer(CorsLayer::permissive())
                .with_state(state);

            let addr: SocketAddr = match format!("{host}:{port}").parse() {
                Ok(addr) => addr,
                Err(e) => {
                    eprintln!("Invalid listen address {host}:{port} — {e}");
                    std::process::exit(1);
                }
            };
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => listener,
                Err(e) => {
                    eprintln!("Could not bind {addr}: {e}");
                    std::process::exit(1);
                }
            };
            tracing::info!("kite-server listening on http://{addr}");
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("Server error: {e}");
                std::process::exit(1);
            }
        }
        Command::CreateCompany {
            data_dir,
            name,
            owner,
            password,
            display_name,
            fy_start,
            state_code,
            gstin,
        } => {
            let state = match build_state(&data_dir).await {
                Ok(state) => state,
                Err(e) => {
                    eprintln!("Startup failed: {e}");
                    std::process::exit(1);
                }
            };
            let input = CreateCompanyInput {
                name,
                fy_start: if fy_start.trim().is_empty() {
                    None
                } else {
                    Some(fy_start)
                },
                state_code: if state_code.trim().is_empty() {
                    None
                } else {
                    Some(state_code)
                },
                gstin: if gstin.trim().is_empty() {
                    None
                } else {
                    Some(gstin)
                },
                gst_enabled: None,
                owner_username: owner,
                owner_password: password,
                owner_display_name: if display_name.trim().is_empty() {
                    None
                } else {
                    Some(display_name)
                },
            };
            match create_company(&state, &input).await {
                Ok((company, owner)) => {
                    println!(
                        "Company \"{}\" created (id {}), owner \"{}\" ready.",
                        company.name, company.id, owner.username
                    );
                }
                Err(e) => {
                    eprintln!("Could not create company: {e:?}");
                    std::process::exit(1);
                }
            }
        }
    }
}
