/**
 * Syncs the authored dashboard pages into the Next app.
 *
 * Emits, per route:
 *   content/<name>.json  { page, mainClass, main, scripts }
 *
 * The landing page is split around the ecosystem section so that section can be
 * rendered by a React/Motion component while every other section stays authored
 * markup verbatim.
 *
 * On hosts that upload only this package, the monorepo source is absent and the
 * committed outputs under content/ and public/ are used unchanged.
 */
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const repo = resolve(web, "..", "..");
const src = join(repo, "packages", "dashboard", "src");
const assets = join(web, "public", "assets");
const content = join(web, "content");

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(src))) {
  console.log(
    "legacy source not present (package-only checkout); using committed outputs",
  );
  process.exit(0);
}

await Promise.all([
  mkdir(assets, { recursive: true }),
  mkdir(content, { recursive: true }),
]);

const assetFiles = [
  "dashboard.css",
  "dashboard.js",
  "experience.js",
  "surfaces.js",
  "theater.js",
  "flow.js",
  "theme.js",
  "manrope-regular.ttf",
  "manrope-bold.ttf",
];

const pages = [
  ["landing", "landing.html"],
  ["app", "app.html"],
  ["demo", "demo.html"],
  ["capital", "capital.html"],
  ["record", "record.html"],
  ["flow", "flow.html"],
];

await Promise.all(
  assetFiles.map((name) => copyFile(join(src, name), join(assets, name))),
);

for (const [name, file] of pages) {
  const html = await readFile(join(src, file), "utf8");

  const page = html.match(/<body data-page="([a-z]+)"/)?.[1] ?? name;
  const mainTag = html.match(/<main([^>]*)>/)?.[1] ?? "";
  const mainClass = mainTag.match(/class="([^"]*)"/)?.[1] ?? "shell";
  const main = html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? "";
  const scripts = [
    ...html.matchAll(/<script type="module" src="([^"]+)"/g),
  ].map((match) => match[1]);

  const payload = { page, mainClass, main, scripts };

  if (name === "landing") {
    // Split so the ecosystem section can be a React component in place.
    const start = main.indexOf('<section id="ecosystem"');
    const end = start === -1 ? -1 : main.indexOf("</section>", start);
    payload.mainBefore = start === -1 ? main : main.slice(0, start);
    payload.mainAfter = start === -1 ? "" : main.slice(end + "</section>".length);
  }

  await writeFile(
    join(content, `${name}.json`),
    JSON.stringify(payload),
  );
}

console.log(
  `legacy synced: ${pages.length} routes, ${assetFiles.length} assets`,
);
