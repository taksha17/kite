/**
 * AI-first capabilities walkthrough for LinkedIn / marketing.
 *
 * Records: BYOK setup → NL draft → Accept → Cmd-K → Ask my books → bill scan
 * → insights/follow-up peek.
 *
 * By default mocks `/api/company/ai/chat` so recording works without a provider
 * key (UI + draft application + real SQL for Ask still run). For a live-model
 * recording set OPENROUTER_API_KEY and KITE_DEMO_LIVE_AI=1.
 *
 * Usage:
 *   node scripts/demo-ai-walkthrough.mjs
 * Output: demo/kite-ai-first-walkthrough.webm
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
const PORT = Number(process.env.KITE_DEMO_PORT || 18110);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = "/tmp/kite-ai-demo-data";
const VIDEO_RAW = "/tmp/kite-ai-demo-video";
const OUT_DIR = path.join(ROOT, "demo");
const OUT = path.join(OUT_DIR, "kite-ai-first-walkthrough.webm");
const LIVE = process.env.KITE_DEMO_LIVE_AI === "1";
const API_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.KITE_OPENROUTER_API_KEY ||
  process.env.KITE_DEMO_OPENROUTER_KEY ||
  "";

const VW = 1600;
const VH = 900;
const PAUSE = 1200;
const TYPE_DELAY = 28;

function browserPath() {
  if (process.env.KITE_DEMO_BROWSER && existsSync(process.env.KITE_DEMO_BROWSER)) {
    return process.env.KITE_DEMO_BROWSER;
  }
  if (existsSync(BRAVE)) return BRAVE;
  if (existsSync(CHROME)) return CHROME;
  throw new Error("No Brave/Chrome found");
}

function log(s) {
  console.log(`[ai-demo] ${s}`);
}

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
        bottom: "26px",
        maxWidth: "84%",
        padding: "12px 22px",
        background: "rgba(6, 36, 40, 0.94)",
        color: "#f7fbfc",
        fontSize: "18px",
        fontFamily: "Figtree, system-ui, sans-serif",
        fontWeight: "700",
        borderRadius: "14px",
        boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
        zIndex: "2147483647",
        textAlign: "center",
        pointerEvents: "none",
        lineHeight: "1.35",
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

async function highlight(locator, ms = 700) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.evaluate((node) => {
    node.style.outline = "3px solid #f0a35e";
    node.style.outlineOffset = "2px";
  });
  await el.page().waitForTimeout(ms);
  await el.evaluate((node) => {
    node.style.outline = "";
  });
}

async function clickEl(locator, hold = 500) {
  const el = locator.first();
  await highlight(el, 450);
  await el.click({ force: true });
  await el.page().waitForTimeout(hold);
}

async function fillEl(locator, text, type = true) {
  const el = locator.first();
  await highlight(el, 350);
  await el.click({ force: true });
  if (type) await el.pressSequentially(text, { delay: TYPE_DELAY });
  else await el.fill(text, { force: true });
  await el.page().waitForTimeout(350);
}

async function selectByText(selectLocator, text) {
  const sel = selectLocator.first();
  await highlight(sel, 350);
  const value = await sel.evaluate((node, wanted) => {
    const opt = [...node.options].find((o) =>
      o.textContent.toLowerCase().includes(String(wanted).toLowerCase()),
    );
    if (!opt) throw new Error(`option "${wanted}" not found`);
    return opt.value;
  }, text);
  await sel.selectOption(value);
  await sel.page().waitForTimeout(350);
}

function panel(page, title) {
  return page.locator("section.panel", {
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function waitForServer(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("kite-server did not start");
}

function mockAiContent(body) {
  const system = String(body.system || "");
  const user = String(body.user || "");
  const hasImage = !!(body.imageDataUrl || body.image_data_url);

  if (
    system.includes("read-only SQL") ||
    system.includes("ONE read-only SQL") ||
    system.includes('"sql"')
  ) {
    return JSON.stringify({
      sql: `SELECT l.name AS party,
        ROUND(COALESCE(SUM(vl.debit),0) - COALESCE(SUM(vl.credit),0), 2) AS open_balance
      FROM ledger l
      LEFT JOIN voucher_line vl ON vl.ledger_id = l.id
      WHERE l.is_party = 1
      GROUP BY l.id
      ORDER BY open_balance DESC
      LIMIT 20`,
      title: "Open balances by party",
    });
  }

  // Only vision/bill capture — text prompts often mention invoice/purchase in examples.
  if (hasImage) {
    return JSON.stringify({
      voucherType: "purchase",
      partyName: "TechSource Distributors",
      partyGstin: "29AABCT1332L1ZV",
      placeOfSupply: "29",
      hsn: "8471",
      gstRate: 18,
      narration: "Purchase from scanned bill",
      paymentMode: "Credit",
      stockLines: [
        {
          itemName: "USB-C Hub",
          qty: 10,
          rate: 1200,
          hsn: "8471",
          gstRate: 18,
        },
      ],
      taxable: 12000,
    });
  }

  // Default: sales NL draft
  return JSON.stringify({
    voucherType: "sales",
    partyName: "Agarwal Electronics",
    placeOfSupply: "29",
    hsn: "8471",
    gstRate: 18,
    paymentMode: "UPI",
    narration: "AI-drafted demo sale",
    stockLines: [
      { itemName: "Wireless Mouse", qty: 2, rate: 799, hsn: "8471", gstRate: 18 },
    ],
    taxable: 1598,
  });
}

for (const dir of [DATA_DIR, VIDEO_RAW]) {
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(OUT_DIR, { recursive: true });

if (!existsSync(SERVER_BIN)) throw new Error(`Missing server: ${SERVER_BIN}`);
if (!existsSync(path.join(ROOT, "dist/index.html"))) {
  throw new Error("dist/ missing — run npm run build");
}

const server = spawn(
  SERVER_BIN,
  [
    "serve",
    "--data-dir",
    DATA_DIR,
    "--web-dir",
    path.join(ROOT, "dist"),
    "--host",
    "127.0.0.1",
    "--port",
    String(PORT),
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

let context;
try {
  await waitForServer(`${BASE}/api/health`);
  log("server up");

  const browser = await chromium.launch({
    executablePath: browserPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: VIDEO_RAW, size: { width: VW, height: VH } },
  });
  context.setDefaultTimeout(45000);
  const page = await context.newPage();

  if (!(LIVE && API_KEY)) {
    log("using mocked AI chat responses (set KITE_DEMO_LIVE_AI=1 + OPENROUTER_API_KEY for live)");
    await page.route("**/api/company/ai/chat", async (route) => {
      let body = {};
      try {
        body = route.request().postDataJSON() || {};
      } catch {
        body = {};
      }
      const content = mockAiContent(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ content }),
      });
    });
  } else {
    log("LIVE AI mode — real OpenRouter calls");
  }

  // ---- walkthrough ----
  await page.goto(BASE, { waitUntil: "networkidle" });
  await caption(
    page,
    "Kite — AI-first accounting. Prompt is the voucher screen. Draft only — you approve.",
    3200,
  );

  log("create company");
  await clickEl(page.getByRole("link", { name: "Create a company" }));
  await page.waitForURL("**/companies");
  const createForm = panel(page, "Create company");
  await fillEl(createForm.getByLabel("Company name"), "Madhur Traders");
  await fillEl(createForm.getByLabel(/GSTIN/), "29AABCM1234F1Z5");
  await fillEl(createForm.getByLabel("Owner password"), "owner@123");
  await clickEl(createForm.getByRole("button", { name: /Create & open/ }), 800);
  await page.waitForURL("**/", { timeout: 25000 });
  await page.waitForTimeout(800);

  // AI settings
  log("AI settings");
  await clickEl(page.getByRole("link", { name: "Companies" }));
  await page.waitForTimeout(600);
  await caption(page, "Bring your own key — OpenRouter free models work with no card.", 2600);
  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: "smooth" }));
  await page.waitForTimeout(900);
  const aiPanel = page.locator("section.panel", {
    has: page.getByRole("heading", { name: /AI quick entry/i }),
  });
  await aiPanel.scrollIntoViewIfNeeded();
  await selectByText(aiPanel.locator("select").first(), "OpenRouter");
  await fillEl(
    aiPanel.getByLabel("API key"),
    LIVE && API_KEY ? API_KEY : "sk-or-demo-mock-key-for-recording",
    false,
  );
  await clickEl(aiPanel.getByRole("button", { name: /Save AI settings/ }), 700);
  await caption(page, "Keys stay in your company settings — not a Kite cloud.", 2200);

  // Masters
  log("masters");
  await clickEl(page.getByRole("link", { name: "Ledgers" }));
  await clickEl(page.getByRole("button", { name: "Add party" }));
  const partyForm = panel(page, "New party");
  await fillEl(partyForm.getByLabel("Name"), "Agarwal Electronics");
  await selectByText(partyForm.getByLabel("State"), "29 — Karnataka");
  await fillEl(partyForm.getByLabel(/GSTIN/), "29BBCDE4321G1Z3");
  await clickEl(partyForm.getByRole("button", { name: "Save party" }), 700);

  await clickEl(page.getByRole("link", { name: "Inventory" }));
  await clickEl(page.getByRole("button", { name: "Units", exact: true }));
  const unitForm = panel(page, "Add unit");
  await fillEl(unitForm.locator("input").nth(0), "Pieces");
  await fillEl(unitForm.locator("input").nth(1), "pcs");
  await clickEl(unitForm.getByRole("button", { name: /Save|Add/ }), 500);
  await clickEl(page.getByRole("button", { name: "Godowns" }));
  await fillEl(panel(page, "Add godown").locator("input").first(), "Main Godown");
  await clickEl(panel(page, "Add godown").getByRole("button", { name: /Save|Add/ }), 500);
  await clickEl(page.getByRole("button", { name: "Items", exact: true }));
  const itemForm = panel(page, "Add item");
  await fillEl(itemForm.getByLabel("Name"), "Wireless Mouse");
  await fillEl(itemForm.getByLabel(/SKU/), "WM-100");
  await selectByText(itemForm.getByLabel("Unit"), "Pieces");
  await fillEl(itemForm.getByLabel("Purchase rate"), "450", false);
  await fillEl(itemForm.getByLabel("Sales rate"), "799", false);
  await fillEl(itemForm.getByLabel("Opening qty"), "40", false);
  await selectByText(itemForm.getByLabel("GST %"), "18%");
  await fillEl(itemForm.getByLabel("HSN / SAC"), "8471");
  await clickEl(itemForm.getByRole("button", { name: "Save item" }), 700);

  // NL draft
  log("NL draft");
  await clickEl(page.getByRole("link", { name: "Vouchers", exact: true }), 400);
  await clickEl(page.getByRole("link", { name: "New voucher" }), 600);
  await page.waitForURL("**/vouchers/new**");
  await caption(
    page,
    "Capability 1 — Natural language entry (English or Hinglish).",
    2600,
  );
  const hero = page.locator("section.ai-hero");
  await hero.waitFor({ state: "visible", timeout: 15000 });
  const sentence = "Sold 2 Wireless Mouse to Agarwal @799 on UPI";
  await fillEl(hero.locator("textarea"), sentence, true);
  await caption(page, "Describe the sale → Draft voucher. The model never posts.", 2400);
  await clickEl(hero.getByRole("button", { name: /Draft voucher/ }), 400);
  // wait until drafting finishes (button text back to "Draft voucher")
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /^\s*Draft voucher\s*$/i.test(b.textContent || ""),
    );
    return btn && !btn.disabled;
  }, null, { timeout: 60000 });
  await page.getByText(/Draft applied/i).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(800);
  await caption(page, "Form pre-filled — party, qty, rate, GST. You still press Accept.", 3000);
  const form = page.locator("form.panel");
  await form.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  // Ensure party is selected even if fuzzy match missed
  const partySel = form.getByLabel("Party");
  if (await partySel.count()) {
    const val = await partySel.inputValue().catch(() => "");
    if (!val) {
      await selectByText(partySel, "Agarwal").catch(() => {});
    }
  }
  const acceptBtn = form.getByRole("button", { name: /Accept voucher/ });
  await highlight(acceptBtn, 450);
  const preType = await form.getByLabel("Type").inputValue().catch(() => "?");
  log(`pre-accept type=${preType}`);
  await acceptBtn.click();
  await page.waitForURL("**/vouchers/*/invoice**", { timeout: 30000 });
  await caption(page, "Posted only after human Accept — AI stays on the draft path.", 2800);

  // Cmd-K
  log("Cmd-K");
  await page.keyboard.press("Control+K");
  await page.waitForTimeout(600);
  await caption(page, "Capability 2 — Cmd/Ctrl-K palette: draft or jump from anywhere.", 2800);
  const palette = page.locator('[role="dialog"], .palette, .command-palette').first();
  const paletteInput = page.locator('input[placeholder*="Ask"], input[placeholder*="draft"], .palette input, [role="dialog"] input').first();
  if (await paletteInput.count()) {
    await paletteInput.fill("How much does Agarwal owe");
    await page.waitForTimeout(800);
  }
  await caption(page, "Type a question or a voucher sentence — one box, many actions.", 2600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Ask my books
  log("Ask");
  await clickEl(page.getByRole("link", { name: "Ask", exact: true }), 600);
  await caption(page, "Capability 3 — Ask my books: NL → read-only SQL on YOUR SQLite.", 2800);
  const q = page.getByLabel("Your question");
  await fillEl(q, "How much does Agarwal owe me?", true);
  await clickEl(page.getByRole("button", { name: "Ask", exact: true }), 400);
  await page.waitForTimeout(2500);
  await caption(page, "Numbers come from the database — the model only writes the query.", 3000);

  // Bill capture
  log("bill");
  await clickEl(page.getByRole("link", { name: "Vouchers", exact: true }), 400);
  await clickEl(page.getByRole("link", { name: "New voucher" }), 600);
  await page.waitForURL("**/vouchers/new**");
  await caption(page, "Capability 4 — Snap a purchase bill (vision) → draft for review.", 2800);
  await page.locator("section.ai-hero").waitFor({ state: "visible", timeout: 15000 });
  const billPath = [
    path.join(OUT_DIR, "thumb-invoice-desktop.png"),
    path.join(ROOT, "docs/images/screenshot-invoice.png"),
    path.join(ROOT, "site/assets/screenshot-invoice.png"),
  ].find((p) => existsSync(p));
  if (billPath) {
    await page.locator('input[type=file][accept*="image"]').setInputFiles(billPath);
    await page.waitForTimeout(2000);
    await page.waitForFunction(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /Draft voucher/i.test(b.textContent || ""),
      );
      return btn && !/Drafting/i.test(btn.textContent || "");
    }, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await caption(page, "Vision drafts the purchase — create missing parties/items in one click.", 3200);
    await page.evaluate(() => window.scrollTo({ top: 380, behavior: "smooth" }));
    await page.waitForTimeout(1600);
  } else {
    await caption(page, "Scan bill attaches a photo — same draft-only path.", 2400);
  }

  // Insights / follow-up
  log("insights");
  await clickEl(page.getByRole("link", { name: "Home", exact: true }), 600);
  await caption(page, "Capability 5 — Home insights from your books (receivables, GST, stock).", 3000);
  await page.waitForTimeout(1600);
  if (await page.getByRole("link", { name: "Follow-up", exact: true }).count()) {
    await clickEl(page.getByRole("link", { name: "Follow-up", exact: true }), 700);
    await caption(page, "Follow-up drafts WhatsApp/email reminders — you always tap send.", 3000);
  }

  await caption(
    page,
    "Shipped AI-first end-to-end: draft ≠ post. Open source — github.com/taksha17/kite",
    4200,
  );
  await clearCaption(page);

  const video = page.video();
  await context.close();
  context = null;
  await browser.close();
  const videoPath = await video.path();
  copyFileSync(videoPath, OUT);
  log(`saved ${OUT}`);

  // Poster + optional mp4 for LinkedIn
  const poster = path.join(OUT_DIR, "kite-ai-first-poster.png");
  try {
    const pwFfmpeg = path.join(
      ROOT,
      "node_modules/playwright-core/.local-browsers",
    );
    // try system or npx
    execFileSync(
      "ffmpeg",
      ["-y", "-ss", "8", "-i", OUT, "-frames:v", "1", "-q:v", "3", poster],
      { stdio: "ignore" },
    );
    log(`poster ${poster}`);
  } catch {
    log("poster skipped (no ffmpeg)");
  }
  const mp4 = path.join(OUT_DIR, "kite-ai-first-walkthrough.mp4");
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-i", OUT, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", mp4],
      { stdio: "ignore" },
    );
    log(`mp4 ${mp4} (LinkedIn-friendly)`);
  } catch {
    log("mp4 skipped — upload the .webm or convert locally");
  }
} finally {
  if (context) await context.close().catch(() => {});
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  try {
    server.kill("SIGKILL");
  } catch {
    /* */
  }
}
