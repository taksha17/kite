/**
 * Generates PWA PNG icons from public/kite.svg using headless Brave.
 * - icon-192.png, icon-512.png      ("any" purpose, transparent outside the rounded tile)
 * - icon-maskable-192/512.png       (full-bleed square, glyph inside the 80% safe zone)
 *
 * Usage: node scripts/make-icons.mjs
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVG = readFileSync(path.join(ROOT, "public", "kite.svg"), "utf8");

const browser = await chromium.launch({
  executablePath: "/opt/brave.com/brave/brave",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await (await browser.newContext()).newPage();

async function shot(file, size, { maskable = false } = {}) {
  const html = maskable
    ? `<body style="margin:0;width:${size}px;height:${size}px;background:#0F7A8A;display:flex;align-items:center;justify-content:center">
         <div style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.8)}px">${SVG}</div>
       </body>`
    : `<body style="margin:0;width:${size}px;height:${size}px">${SVG}</body>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>svg{width:100%;height:100%;display:block}</style>${html}`,
  );
  await page.screenshot({
    path: path.join(ROOT, "public", file),
    omitBackground: !maskable,
  });
  console.log(`wrote public/${file}`);
}

await shot("icon-192.png", 192);
await shot("icon-512.png", 512);
await shot("icon-maskable-192.png", 192, { maskable: true });
await shot("icon-maskable-512.png", 512, { maskable: true });
await browser.close();
