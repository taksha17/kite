# Contributing to Kite

Thanks for helping build open-source books for Indian SMBs (and the world).

## Quick start

```bash
git clone <your-fork-url>
cd kite   # or this repo root
npm install
npm run tauri dev
```

You need [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/), and Tauri
[system prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

## Tests

```bash
npm test
```

Accounting math lives in `src/lib/accounting/` — prefer covering new posting
rules with unit tests.

## Pull requests

1. Fork and branch from `main`
2. Keep changes focused (one feature or fix per PR)
3. Run `npm test` and `npm run build`
4. Describe *why* the change helps users or contributors

## Project principles

- **MIT** — keep contributions compatible with the license
- **Lightweight** — prefer local SQLite and small UI surface area
- **India-first defaults** — FY Apr–Mar, INR, GST-ready fields
- **Original product** — do not copy proprietary software assets or branding

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
