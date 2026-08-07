/**
 * Records end-to-end walkthrough videos of Kite (Enterprise web UI via kite-server).
 *
 * Usage:
 *   node scripts/demo-walkthrough.mjs --mode desktop
 *   node scripts/demo-walkthrough.mjs --mode mobile
 *   node scripts/demo-walkthrough.mjs --mode all
 *
 * Env:
 *   KITE_SERVER_BIN  path to kite-server (default /tmp/kite-srv-target/release/kite-server)
 *   KITE_DEMO_BROWSER  chrome|brave path override
 *
 * Output under demo/:
 *   kite-desktop-walkthrough.webm  (+ kite-walkthrough.webm alias)
 *   kite-mobile-walkthrough.webm
 *   posters + thumbnails when ffmpeg is available
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAVE = "/opt/brave.com/brave/brave";
const CHROME = "/opt/google/chrome/chrome";
const SERVER_BIN =
  process.env.KITE_SERVER_BIN || "/tmp/kite-srv-target/release/kite-server";
const PORT = Number(process.env.KITE_DEMO_PORT || 18100);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, "demo");

const args = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}
const modeArg = argValue("--mode", process.env.KITE_DEMO_MODE || "desktop");
const MODES =
  modeArg === "all" ? ["desktop", "mobile"] : [modeArg === "mobile" ? "mobile" : "desktop"];

const PAUSE = 1400;
const TYPE_DELAY = 40;

const PRESETS = {
  desktop: {
    label: "desktop",
    vw: 1600,
    vh: 900,
    out: "kite-desktop-walkthrough.webm",
    alias: "kite-walkthrough.webm",
    poster: "desktop-demo-poster.png",
    isMobile: false,
    captionSize: "17px",
    captionPad: "12px 22px",
  },
  mobile: {
    label: "mobile",
    vw: 390,
    vh: 844,
    out: "kite-mobile-walkthrough.webm",
    alias: null,
    poster: "mobile-demo-poster.png",
    isMobile: true,
    captionSize: "13px",
    captionPad: "10px 14px",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

function browserPath() {
  if (process.env.KITE_DEMO_BROWSER && existsSync(process.env.KITE_DEMO_BROWSER)) {
    return process.env.KITE_DEMO_BROWSER;
  }
  if (existsSync(BRAVE)) return BRAVE;
  if (existsSync(CHROME)) return CHROME;
  throw new Error("No Brave/Chrome found; set KITE_DEMO_BROWSER");
}

function log(step) {
  console.log(`[demo] ${step}`);
}

async function caption(page, text, holdMs = PAUSE, style = {}) {
  await page.evaluate(
    ({ t, fontSize, pad }) => {
      let bar = document.getElementById("kite-demo-caption");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "kite-demo-caption";
        Object.assign(bar.style, {
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: "18px",
          maxWidth: "92%",
          background: "rgba(17, 24, 39, 0.92)",
          color: "#f9fafb",
          fontFamily: "Figtree, system-ui, sans-serif",
          fontWeight: "600",
          borderRadius: "12px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
          zIndex: "2147483647",
          textAlign: "center",
          pointerEvents: "none",
          transition: "opacity 200ms ease",
          lineHeight: "1.35",
        });
        document.body.appendChild(bar);
      }
      bar.style.fontSize = fontSize;
      bar.style.padding = pad;
      bar.textContent = t;
      bar.style.opacity = "1";
    },
    {
      t: text,
      fontSize: style.captionSize || "17px",
      pad: style.captionPad || "12px 22px",
    },
  );
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
  await el.scrollIntoViewIfNeeded().catch(() => {});
  // Mobile layouts often stack sticky/overlapping form rows over CTAs.
  await el.click({ force: true });
  await el.page().waitForTimeout(hold);
}

async function fillEl(locator, text, { type = true } = {}) {
  const el = locator.first();
  await highlight(el, 500);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  if (type) {
    await el.click({ force: true });
    await el.pressSequentially(text, { delay: TYPE_DELAY });
  } else {
    // Mobile voucher lines can sit under sticky form rows; force avoids
    // actionability timeouts from overlapping controls.
    await el.fill(text, { force: true });
  }
  await el.page().waitForTimeout(450);
}

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
  await sel.page().waitForTimeout(450);
}

function panel(page, title) {
  return page.locator("section.panel", {
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function waitForServer(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("kite-server did not start");
}

function startServer(dataDir) {
  if (!existsSync(SERVER_BIN)) {
    throw new Error(`kite-server missing: ${SERVER_BIN}`);
  }
  const webDir = path.join(ROOT, "dist");
  if (!existsSync(path.join(webDir, "index.html"))) {
    throw new Error("dist/ missing — run npm run build first");
  }
  return spawn(
    SERVER_BIN,
    [
      "serve",
      "--data-dir",
      dataDir,
      "--web-dir",
      webDir,
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

function tryPoster(videoPath, posterPath) {
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-ss", "3", "-i", videoPath, "-frames:v", "1", "-q:v", "3", posterPath],
      { stdio: "ignore" },
    );
    log(`poster: ${posterPath}`);
  } catch {
    log("ffmpeg not available — skip poster");
  }
}

async function runWalkthrough(preset) {
  const dataDir = `/tmp/kite-demo-data-${preset.label}`;
  const profileDir = `/tmp/kite-demo-profile-${preset.label}`;
  const videoRaw = `/tmp/kite-demo-video-raw-${preset.label}`;
  for (const dir of [dataDir, profileDir, videoRaw]) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(path.join(OUT_DIR, "downloads"), { recursive: true });

  const server = startServer(dataDir);
  let context;
  try {
    await waitForServer(`${BASE}/api/health`);
    log(`${preset.label}: server up`);

    const browser = await chromium.launch({
      executablePath: browserPath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const contextOpts = {
      viewport: { width: preset.vw, height: preset.vh },
      recordVideo: { dir: videoRaw, size: { width: preset.vw, height: preset.vh } },
      acceptDownloads: true,
    };
    if (preset.isMobile) {
      contextOpts.isMobile = true;
      contextOpts.hasTouch = true;
      contextOpts.userAgent = preset.userAgent;
    }
    context = await browser.newContext(contextOpts);
    context.setDefaultTimeout(20000);
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));

    const cap = (t, ms) => caption(page, t, ms, preset);
    const short = preset.isMobile;

    log(`${preset.label}: open app`);
    await page.goto(BASE, { waitUntil: "networkidle" });
    await cap(
      short
        ? "Kite on a phone browser — same books as desktop, via Enterprise or phone-only mode."
        : "Kite — open-source books for Indian businesses. Desktop Solo UI (Enterprise web build).",
      short ? 2800 : 3200,
    );

    log(`${preset.label}: create company`);
    await clickEl(page.getByRole("link", { name: "Create a company" }));
    await page.waitForURL("**/companies");
    await cap("Create a company with GST and an Owner login.", short ? 2200 : 2600);
    const createForm = panel(page, "Create company");
    await fillEl(createForm.getByLabel("Company name"), "Madhur Traders");
    await fillEl(createForm.getByLabel(/GSTIN/), "29AABCM1234F1Z5");
    await fillEl(createForm.getByLabel("Owner password"), "owner@123");
    await cap(
      "Company DB created, Indian chart of accounts seeded, signed in as Owner.",
      short ? 2400 : 2800,
    );
    await clickEl(createForm.getByRole("button", { name: /Create & open/ }), { hold: 500 });
    await page.waitForURL("**/", { timeout: 25000 });
    await page.waitForTimeout(1200);
    await cap("Home — insights fill in as you post vouchers.", short ? 2200 : 2600);

    log(`${preset.label}: party`);
    await clickEl(page.getByRole("link", { name: "Ledgers" }));
    await cap("Ledgers — add a customer to bill.", short ? 2000 : 2400);
    await clickEl(page.getByRole("button", { name: "Add party" }));
    const partyForm = panel(page, "New party");
    await fillEl(partyForm.getByLabel("Name"), "Agarwal Electronics");
    await selectByText(partyForm.getByLabel("State"), "29 — Karnataka");
    await fillEl(partyForm.getByLabel(/GSTIN/), "29BBCDE4321G1Z3");
    if (!short) {
      await fillEl(partyForm.getByLabel(/Address/), "12, MG Road, Bengaluru 560001");
      await fillEl(partyForm.getByLabel(/Email/), "billing@agarwalelectronics.in");
    }
    await clickEl(partyForm.getByRole("button", { name: "Save party" }));
    await cap("Customer under Sundry Debtors — GSTIN feeds invoices & returns.", 2600);

    log(`${preset.label}: inventory`);
    await clickEl(page.getByRole("link", { name: "Inventory" }));
    await cap("Inventory — unit, godown, stock item.", 2200);
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
    await cap("Item ready — HSN and GST rate feed invoices and GSTR.", 2600);

    log(`${preset.label}: sales`);
    await clickEl(page.getByRole("link", { name: "Vouchers" }));
    await clickEl(page.getByRole("link", { name: "New voucher" }));
    await cap("New voucher — GST sales invoice.", 2000);
    const form = page.locator("form.panel");
    await selectByText(form.getByLabel("Type"), "Sales");
    await fillEl(form.getByLabel("Number"), "INV-0001", { type: false });
    await selectByText(form.getByLabel("Party"), "Agarwal Electronics");
    await selectByText(form.getByLabel("Place of supply"), "29 — Karnataka");
    await fillEl(form.getByLabel("HSN / SAC"), "8471", { type: false });
    await selectByText(form.getByLabel("GST rate"), "18%");
    await clickEl(form.getByRole("checkbox", { name: /Include stock items/ }));
    await cap("Stock lines update inventory on save.", 2200);
    const lineRow = page.locator("table.voucher-lines tbody tr").first();
    await selectByText(lineRow.locator("select").nth(0), "Wireless Mouse");
    await selectByText(lineRow.locator("select").nth(1), "Main Godown");
    await fillEl(lineRow.locator("input[type=number]").nth(0), "2", { type: false });
    if (!short) {
      const detailRow = page.locator("table.voucher-lines tbody tr").nth(1);
      await fillEl(detailRow.getByLabel(/Description/), "With 1-year warranty");
      await fillEl(detailRow.getByLabel("Batch no."), "B-0804");
      await fillEl(detailRow.getByLabel("Serial no."), "WM-1001 / WM-1002");
      await clickEl(page.getByRole("button", { name: /Show invoice details/ }));
      await fillEl(page.getByPlaceholder("UPI / Cash / NEFT"), "UPI", { type: false });
    }
    await fillEl(form.getByLabel("Narration"), "Walkthrough demo sale", { type: false });
    await cap("Tax split automatic — intra-state CGST + SGST.", 2600);
    await clickEl(form.getByRole("button", { name: /Accept voucher/ }), { hold: 400 });
    await page.waitForURL("**/vouchers/*/invoice**", { timeout: 25000 });
    await cap("Posted — ledgers, GST and stock updated together.", 2600);

    log(`${preset.label}: invoice`);
    await page.waitForTimeout(1400);
    await cap("Tax invoice — GSTIN, HSN, tax breakup, totals.", short ? 2800 : 3200);
    await page.evaluate(() => window.scrollTo({ top: 280, behavior: "smooth" }));
    await page.waitForTimeout(1400);
    if (!short) {
      await page.evaluate(() => window.scrollTo({ top: 700, behavior: "smooth" }));
      await page.waitForTimeout(1400);
    }
    await page.screenshot({
      path: path.join(OUT_DIR, `thumb-invoice-${preset.label}.png`),
    });
    await cap("PDF, print, email, e-way bill and e-invoice live here too.", 2800);
    await page.evaluate(() => window.scrollTo({ top: 0 }));

    log(`${preset.label}: reports`);
    await clickEl(page.getByRole("link", { name: "Reports" }));
    await page.waitForTimeout(900);
    await cap("Reports — trial balance already reflects the sale.", 2400);
    await clickEl(page.getByRole("button", { name: "Profit & loss" }));
    await cap("Profit & loss…", 1800);
    await clickEl(page.getByRole("button", { name: "Stock summary" }));
    await cap("…stock summary — 2 mice left Main Godown.", 2400);
    await clickEl(page.getByRole("button", { name: "GSTR-1", exact: true }));
    await page.waitForTimeout(900);
    await cap("GSTR-1 picked up INV-0001 — export Excel for your CA.", 2800);
    const gstr1 = panel(page, "GSTR-1 (sales)");
    await highlight(gstr1, 1200);
    if (!short) {
      await clickEl(gstr1.getByRole("button", { name: /Download Excel/ }), { hold: 2000 });
    }

    if (!short) {
      log(`${preset.label}: users`);
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await clickEl(page.getByRole("link", { name: "Users" }));
      await cap("Multi-user roles — Owner / Accountant / Data Entry + audit log.", 2800);
      const userForm = panel(page, "Add user");
      await fillEl(userForm.getByLabel("Username"), "priya");
      await fillEl(userForm.getByLabel("Display name"), "Priya Sharma");
      await selectByText(userForm.getByLabel("Role"), "Data Entry");
      await fillEl(userForm.getByLabel("Temporary password"), "welcome@123");
      await clickEl(userForm.getByRole("button", { name: "Create user" }));
      await page.waitForTimeout(900);
      await clickEl(page.getByRole("button", { name: "Log out" }));
      await cap("Signing in as Priya (Data Entry)…", 2000);
      await fillEl(page.getByLabel("Username"), "priya");
      await fillEl(page.getByLabel("Password"), "welcome@123");
      await clickEl(page.getByRole("button", { name: "Sign in" }), { hold: 1000 });
      await cap("Role-based access: she can post vouchers; Users stay hidden.", 3200);
    }

    await cap(
      short
        ? "Kite — phone PWA or Enterprise on LAN. Open source; your data stays yours."
        : "Kite — Solo on one desk, Enterprise for the office. Open source; your data stays yours.",
      3800,
    );
    await clearCaption(page);

    const video = page.video();
    await context.close();
    context = null;
    await browser.close();
    const videoPath = await video.path();
    const out = path.join(OUT_DIR, preset.out);
    copyFileSync(videoPath, out);
    if (preset.alias) {
      copyFileSync(out, path.join(OUT_DIR, preset.alias));
    }
    log(`video saved: ${out}`);
    tryPoster(out, path.join(OUT_DIR, preset.poster));
    // Also copy poster into site assets for landing page
    const sitePoster = path.join(ROOT, "site", "assets", preset.poster);
    if (existsSync(path.join(OUT_DIR, preset.poster))) {
      mkdirSync(path.dirname(sitePoster), { recursive: true });
      copyFileSync(path.join(OUT_DIR, preset.poster), sitePoster);
    }
  } finally {
    if (context) await context.close().catch(() => {});
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
    try {
      server.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
for (const m of MODES) {
  if (!PRESETS[m]) throw new Error(`Unknown mode: ${m}`);
  log(`=== recording ${m} ===`);
  await runWalkthrough(PRESETS[m]);
}
log("done");
