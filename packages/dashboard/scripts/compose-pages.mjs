/**
 * Composes every dashboard page from ONE canonical header and footer.
 *
 * The pages previously carried their own copies of the shell, so the navigation
 * changed length between routes and the header reflowed on every page change.
 * This script is the single source of truth: it replaces the header/footer block
 * in each page with the same markup, only varying aria-current.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "src");

const SHIELD =
  '<svg class="brand-shield" viewBox="0 0 64 72" fill="none" aria-hidden="true"><path d="M32 2 60 12v22c0 17-11 30-28 38C15 64 4 51 4 34V12L32 2Z" fill="#d1fc70" stroke="#20251d" stroke-width="3"/><path d="M32 14 50 21v13c0 11-7 20-18 26-11-6-18-15-18-26V21l18-7Z" fill="#20251d"/><path d="M32 22v25m-8-16 8-3 8 3" stroke="#d1fc70" stroke-width="3.5" stroke-linecap="round"/></svg>';

const NAV = [
  ["Overview", "/app"],
  ["Live demo", "/demo"],
  ["Capital", "/capital"],
  ["Agent record", "/record"],
  ["Flow", "/flow"],
];

const RUN_LINKED = new Set(["/app", "/demo", "/capital", "/record", "/flow"]);

const navMarkup = (active) =>
  NAV.map(([label, href]) => {
    const current = href === active ? ' aria-current="page"' : "";
    const run = RUN_LINKED.has(href) ? ` data-run-link="${href}"` : "";
    return `<a href="${href}"${current}${run}>${label}</a>`;
  }).join("");

const header = (active) =>
  `<header class="site-header"><div class="shell header-inner"><a class="brand" href="/" aria-label="Repayd home">${SHIELD}<span>repayd<span class="brand-period">.</span></span></a><nav class="primary-nav" id="primary-nav" aria-label="Primary navigation">${navMarkup(
    active,
  )}</nav><div class="header-tools"><span class="network">Arc testnet</span><button class="theme-toggle icon-button" type="button" data-theme-toggle aria-label="Switch theme" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 15A8 8 0 1 1 9 4a8 8 0 0 0 11 11Z" stroke="currentColor" stroke-width="1.6"/></svg></button><button class="menu-toggle icon-button" type="button" data-menu-toggle aria-controls="primary-nav" aria-expanded="false" aria-label="Open navigation"><span></span><span></span></button></div></div></header>`;

const external = (label, href) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ↗<span class="sr-only"> (opens in a new tab)</span></a>`;

const FOOTER = `<footer class="site-footer"><div class="shell"><div class="footer-top"><div><p class="footer-brand">${SHIELD}<span>repayd<span class="brand-period">.</span></span></p><p class="section-label">THE CONTROL PLANE FOR AGENTS</p><p class="footer-lead">Let intelligence move.<br>Give risk a boundary.</p></div><nav class="footer-nav" aria-label="Footer navigation"><span class="section-label">Product</span>${NAV.map(
  ([label, href]) =>
    `<a href="${href}">${label} ↗</a>`,
).join("")}</nav><nav class="footer-nav" aria-label="Ecosystem links"><span class="section-label">Ecosystem</span>${external(
  "Circle",
  "https://www.circle.com/en/developer",
)}${external("The Graph", "https://thegraph.com/studio/")}${external(
  "Hedera",
  "https://hashscan.io/testnet",
)}${external(
  "ENS",
  "https://sepolia.app.ens.domains/name/atlasrepayd.eth",
)}</nav></div><div class="footer-bottom"><span>ETHOnline 2026 · Arc testnet · 5042002</span><span>Testnet prototype · Not a real-money insurance product.</span>${external(
  "Open source",
  "https://github.com/Repayd/repayd",
)}</div></div><div class="footer-watermark" aria-hidden="true">repayd<span>.</span></div></footer>`;

const ACTIVE = {
  "landing.html": null,
  "app.html": "/app",
  "demo.html": "/demo",
  "capital.html": "/capital",
  "record.html": "/record",
  "flow.html": "/flow",
};

const files = (await readdir(src)).filter((name) => name.endsWith(".html"));
let composed = 0;

for (const name of files) {
  const file = join(src, name);
  const html = await readFile(file, "utf8");
  const active = ACTIVE[name] ?? null;
  const next = html
    .replace(/<header class="site-header">[\s\S]*?<\/header>/, () => header(active))
    .replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, FOOTER);
  if (next === html) continue;
  await writeFile(file, next);
  composed += 1;
}

console.log(`composed canonical shell into ${composed} pages`);
