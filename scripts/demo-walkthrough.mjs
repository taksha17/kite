/**
 * Records an end-to-end video walkthrough of Kite (web/Team build).
 *
 * - Starts kite-server with a fresh demo data dir
 * - Drives the real UI in Brave (headless) via playwright-core
 * - Playwright records a .webm of the whole session
 * - On-screen captions + element highlights narrate each step
 *
 * Usage: node scripts/demo-walkthrough.mjs
 * Output: demo/kite-walkthrough.webm (+ thumbnails, downloads)
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAVE = "/opt/brave.com/brave/brave";
const SERVER_BIN = process.env.KITE_SERVER_BIN || "/tmp/kite-srv-target/release/kite-server";
const PORT = 18100;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = "/tmp/kite-demo-data";
const PROFILE_DIR = "/tmp/kite-demo-profile";
const OUT_DIR = path.join(ROOT, "demo");
const VIDEO_RAW = "/tmp/kite-demo-video-raw";

const VW = 1600;
const VH = 900;
const PAUSE = 1400;
const TYPE_DELAY = 45;

for (const dir of [DATA_DIR, PROFILE_DIR, VIDEO_RAW]) {
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(path.join(OUT_DIR, "downloads"), { recursive: true });

// ---------- helpers ----------

async function caption(page, text, holdMs = PAUSE) {
  await page.evaluate((t) => {
    let bar = document.getElementById("kite-demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "kite-demo-caption";
      Object.assign(bar.style, {
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "28px",
        maxWidth: "80%",
        padding: "12px 22px",
        background: "rgba(17, 24, 39, 0.92)",
        color: "#f9fafb",
        fontSize: "17px",
        fontFamily: "Figtree, system-ui, sans-serif",
        fontWeight: "600",
        borderRadius: "12px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        zIndex: "2147483647",
        textAlign: "center",
        pointerEvents: "none",
        transition: "opacity 200ms ease",
      });
      document.body.appendChild(bar);
    }
    bar.textContent = t;
    bar.style.opacity = "1";
  }, text);
  await page.waitForTimeout(holdMs);
}

async function clearCaption(page) {
  await page.evaluate(() => {
    const bar = document.getElementById("kite-demo-caption");
    if (bar) bar.style.opacity = "0";
  });
}

async function highlight(locator, ms = 900) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.evaluate((node) => {
    node.dataset.kiteDemoOldOutline = node.style.outline;
    node.dataset.kiteDemoOldShadow = node.style.boxShadow;
    node.style.outline = "3px solid #f59e0b";
    node.style.outlineOffset = "2px";
    node.style.boxShadow = "0 0 0 6px rgba(245, 158, 11, 0.25)";
    node.style.borderRadius = "6px";
  });
  await el.page().waitForTimeout(ms);
  await el.evaluate((node) => {
    node.style.outline = node.dataset.kiteDemoOldOutline || "";
    node.style.boxShadow = node.dataset.kiteDemoOldShadow || "";
  });
}

async function clickEl(locator, { hold = 650 } = {}) {
  const el = locator.first();
  await highlight(el);
  await el.click();
  await el.page().waitForTimeout(hold);
}

async function fillEl(locator, text, { type = true } = {}) {
  const el = locator.first();
  await highlight(el, 500);
  await el.click();
  if (type) {
    await el.pressSequentially(text, { delay: TYPE_DELAY });
  } else {
    await el.fill(text);
  }
  await el.page().waitForTimeout(500);
}

/** Select an <option> by visible text substring (options here have no stable values). */
async function selectByText(selectLocator, text) {
  const sel = selectLocator.first();
  await highlight(sel, 500);
  const value = await sel.evaluate((node, wanted) => {
    const opt = [...node.options].find((o) =>
      o.textContent.toLowerCase().includes(String(wanted).toLowerCase()),
    );
    if (!opt) throw new Error(`option containing "${wanted}" not found`);
    return opt.value;
  }, text);
  await sel.selectOption(value);
  await sel.page().waitForTimeout(500);
}

/** A section.panel that contains a heading with the given text. */
function panel(page, title) {
  return page.locator("section.panel", {
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

function log(step) {
  console.log(`[demo] ${step}`);
}

// ---------- server ----------

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("kite-server did not start");
}

const server = spawn(
  SERVER_BIN,
  [
    "serve",
    "--data-dir", DATA_DIR,
    "--web-dir", path.join(ROOT, "dist"),
    "--host", "127.0.0.1",
    "--port", String(PORT),
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

let context;
try {
  await waitForServer(`${BASE}/api/health`);
  log("server up");

  const browser = await chromium.launch({
    executablePath: BRAVE,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: VIDEO_RAW, size: { width: VW, height: VH } },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(15000);

  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  // ---------- walkthrough ----------

  log("open app");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await caption(page, "Kite — open-source books for Indian businesses. This is the Team build, served by kite-server.", 3200);

  // 1. Create company
  log("create company");
  await clickEl(page.getByRole("link", { name: "Create a company" }));
  await page.waitForURL("**/companies");
  await caption(page, "Companies page — create a company with GST and an Owner login.", 2600);
  const createForm = panel(page, "Create company");
  await fillEl(createForm.getByLabel("Company name"), "Madhur Traders");
  await fillEl(createForm.getByLabel(/GSTIN/), "29AABCM1234F1Z5");
  await fillEl(createForm.getByLabel("Owner password"), "owner@123");
  await caption(page, "The server creates the company database, seeds the default Indian chart of accounts, and signs us in.", 2800);
  await clickEl(createForm.getByRole("button", { name: /Create & open/ }), { hold: 500 });
  await page.waitForURL("**/", { timeout: 20000 });
  await page.waitForTimeout(1500);

  // 2. Home
  await caption(page, "Home — the dashboard. Balances and activity fill in as we post.", 2800);

  // 3. Add a customer (party)
  log("add party");
  await clickEl(page.getByRole("link", { name: "Ledgers" }));
  await caption(page, "Ledgers — accounts. First, a customer to bill.", 2400);
  await clickEl(page.getByRole("button", { name: "Add party" }));
  const partyForm = panel(page, "New party");
  await fillEl(partyForm.getByLabel("Name"), "Agarwal Electronics");
  await selectByText(partyForm.getByLabel("State"), "29 — Karnataka");
  await fillEl(partyForm.getByLabel(/GSTIN/), "29BBCDE4321G1Z3");
  await fillEl(partyForm.getByLabel(/Address/), "12, MG Road, Bengaluru 560001");
  await fillEl(partyForm.getByLabel(/Email/), "billing@agarwalelectronics.in");
  await clickEl(partyForm.getByRole("button", { name: "Save party" }));
  await caption(page, "Customer saved under Sundry Debtors — GSTIN drives invoice and GST reports.", 2800);

  // 4. Inventory: unit, godown, item
  log("inventory setup");
  await clickEl(page.getByRole("link", { name: "Inventory" }));
  await caption(page, "Inventory — set up a unit and godown, then an item.", 2400);

  await clickEl(page.getByRole("button", { name: "Units", exact: true }));
  const unitForm = panel(page, "Add unit");
  const unitInputs = unitForm.locator("input");
  await fillEl(unitInputs.nth(0), "Pieces");
  await fillEl(unitInputs.nth(1), "pcs");
  await clickEl(unitForm.getByRole("button", { name: /Save|Add/ }));

  await clickEl(page.getByRole("button", { name: "Godowns" }));
  const godownForm = panel(page, "Add godown");
  await fillEl(godownForm.locator("input").first(), "Main Godown");
  await clickEl(godownForm.getByRole("button", { name: /Save|Add/ }));

  await clickEl(page.getByRole("button", { name: "Items", exact: true }));
  const itemForm = panel(page, "Add item");
  await fillEl(itemForm.getByLabel("Name"), "Wireless Mouse");
  await fillEl(itemForm.getByLabel(/SKU/), "WM-100");
  await selectByText(itemForm.getByLabel("Unit"), "Pieces");
  await fillEl(itemForm.getByLabel("Purchase rate"), "450", { type: false });
  await fillEl(itemForm.getByLabel("Sales rate"), "799", { type: false });
  await fillEl(itemForm.getByLabel("Opening qty"), "40", { type: false });
  await selectByText(itemForm.getByLabel("GST %"), "18%");
  await fillEl(itemForm.getByLabel("HSN / SAC"), "8471");
  await clickEl(itemForm.getByRole("button", { name: "Save item" }));
  await caption(page, "Item ready — HSN and GST rate feed invoices and GSTR reports.", 2800);

  // 5. Sales voucher
  log("sales voucher");
  await clickEl(page.getByRole("link", { name: "Vouchers" }));
  await clickEl(page.getByRole("link", { name: "New voucher" }));
  await caption(page, "New voucher — a GST sales invoice.", 2200);

  const form = page.locator("form.panel");
  await selectByText(form.getByLabel("Type"), "Sales");
  await fillEl(form.getByLabel("Number"), "INV-0001", { type: false });
  await selectByText(form.getByLabel("Party"), "Agarwal Electronics");
  await selectByText(form.getByLabel("Place of supply"), "29 — Karnataka");
  await fillEl(form.getByLabel("HSN / SAC"), "8471", { type: false });
  await selectByText(form.getByLabel("GST rate"), "18%");

  await clickEl(form.getByRole("checkbox", { name: /Include stock items/ }));
  await caption(page, "Stock lines update inventory on save — and print on the invoice.", 2600);

  const lineRow = page.locator("table.voucher-lines tbody tr").first();
  await selectByText(lineRow.locator("select").nth(0), "Wireless Mouse");
  await selectByText(lineRow.locator("select").nth(1), "Main Godown");
  await fillEl(lineRow.locator("input[type=number]").nth(0), "2", { type: false });

  const detailRow = page.locator("table.voucher-lines tbody tr").nth(1);
  await fillEl(detailRow.getByLabel(/Description/), "With 1-year warranty");
  await fillEl(detailRow.getByLabel("Batch no."), "B-0804");
  await fillEl(detailRow.getByLabel("Serial no."), "WM-1001 / WM-1002");

  await clickEl(page.getByRole("button", { name: /Show invoice details/ }));
  await caption(page, "Invoice details — payment mode, Ship To, freight, buyer refs… all print on the invoice.", 2800);
  await fillEl(page.getByPlaceholder("UPI / Cash / NEFT"), "UPI", { type: false });
  await fillEl(form.getByLabel("Narration"), "Walkthrough demo sale", { type: false });
  await caption(page, "Tax split is automatic — intra-state, so CGST + SGST. Total ₹1,885.64.", 3000);
  await clickEl(form.getByRole("button", { name: /Accept voucher/ }), { hold: 400 });
  // Sales vouchers land straight on the invoice page after save.
  await page.waitForURL("**/vouchers/*/invoice**", { timeout: 20000 });
  await caption(page, "Posted — ledger entries, GST amounts and stock all updated in one go.", 2800);

  // 6. Invoice preview
  log("invoice preview");
  await page.waitForTimeout(1800);
  await caption(page, "The tax invoice — party GSTIN, HSN lines with batch/serial, tax breakup, totals.", 3400);
  await page.evaluate(() => window.scrollTo({ top: 320, behavior: "smooth" }));
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: "smooth" }));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT_DIR, "thumb-invoice.png") });
  await caption(page, "PDF download, printing, direct email to the party, and e-way bill generation live here too.", 3400);
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  // 7. Reports
  log("reports");
  await clickEl(page.getByRole("link", { name: "Reports" }));
  await page.waitForTimeout(1200);
  await caption(page, "Reports — the trial balance already reflects the sale.", 3000);
  await clickEl(page.getByRole("button", { name: "Profit & loss" }));
  await caption(page, "Profit & loss…", 2200);
  await clickEl(page.getByRole("button", { name: "Stock summary" }));
  await caption(page, "…and stock summary — the 2 mice moved out of Main Godown.", 3000);
  await clickEl(page.getByRole("button", { name: "GSTR-1", exact: true }));
  await page.waitForTimeout(1200);
  await caption(page, "GST returns build themselves — GSTR-1 picked up INV-0001 automatically.", 3200);
  const gstr1 = panel(page, "GSTR-1 (sales)");
  await highlight(gstr1, 1500);
  await clickEl(gstr1.getByRole("button", { name: /Download Excel/ }), { hold: 2500 });
  await caption(page, "One click exports a real .xlsx workbook for the accountant.", 2600);

  // 8. Users & roles
  log("users");
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await clickEl(page.getByRole("link", { name: "Users" }));
  await caption(page, "Multi-user is built in — add teammates with roles, and every action lands in the audit log.", 3200);
  const userForm = panel(page, "Add user");
  await fillEl(userForm.getByLabel("Username"), "priya");
  await fillEl(userForm.getByLabel("Display name"), "Priya Sharma");
  await selectByText(userForm.getByLabel("Role"), "Data Entry");
  await fillEl(userForm.getByLabel("Temporary password"), "welcome@123");
  await clickEl(userForm.getByRole("button", { name: "Create user" }));
  await page.waitForTimeout(1200);

  // 9. Re-login as the restricted user
  log("login as data entry");
  await clickEl(page.getByRole("button", { name: "Log out" }));
  await caption(page, "Signing in as Priya (Data Entry)…", 2200);
  await fillEl(page.getByLabel("Username"), "priya");
  await fillEl(page.getByLabel("Password"), "welcome@123");
  await clickEl(page.getByRole("button", { name: "Sign in" }), { hold: 1200 });
  await caption(page, "Role-based access: she can post vouchers and view reports — Users, Integrations and Inventory stay hidden.", 3600);

  // 10. End card
  await caption(page, "Kite — Solo for one desk, Team for the whole office. Open source, your data stays yours.", 4200);
  await clearCaption(page);

  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  const { copyFileSync } = await import("node:fs");
  const out = path.join(OUT_DIR, "kite-walkthrough.webm");
  copyFileSync(videoPath, out);
  log(`video saved: ${out}`);
} finally {
  if (context) await context.close().catch(() => {});
  server.kill();
}
