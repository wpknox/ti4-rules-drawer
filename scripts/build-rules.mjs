// Bundles the tirules-search pages into extension/rules.json.
// Usage: node scripts/build-rules.mjs [path/to/tirules-search]
//
// Each R_/F_/C_ page in the rules repo is plain HTML wrapped in two PHP
// include lines, so we strip those and keep the rest as-is. The extension
// renders that HTML directly and builds its search index in the browser.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(process.argv[2] ?? join(ROOT, "../ti4-rules/tirules"));
const OUT = join(ROOT, "extension/rules.json");

const KINDS = { R: "Rules", F: "Factions", C: "Components" };

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  times: "×",
  Omega: "Ω",
  omega: "ω",
};

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replace(/&(\w+);/g, (_, name) => ENTITIES[name] ?? " ");
}

function buildPage(file) {
  const id = file.replace(/\.php$/, "");
  let html = readFileSync(join(SRC, file), "utf8")
    .replace(/<\?php\s+include\s+"(prefix|suffix)\.php"\s*\?>\n?/g, "")
    .trim();

  const h1 = html.match(/<header>\s*<h1>(.*?)<\/h1>\s*<\/header>/is);
  if (!h1) throw new Error(`${file}: no <header><h1> found`);
  const sub = h1[1].match(/<sub>(.*?)<\/sub>/is);
  const title = decode(
    h1[1]
      .replace(/<sub>.*?<\/sub>/is, "")
      .replace(/<br\s*\/?>/gi, " / ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  const subtitle = sub
    ? decode(sub[1].replace(/<[^>]+>/g, ""))
        .replace(/^\(|\)$/g, "")
        .trim()
    : "";

  return { id, kind: KINDS[id[0]], title, subtitle, html };
}

const files = readdirSync(SRC).filter((f) => /^[RFC]_\w+\.php$/.test(f));
const sortKey = (p) => p.title.replace(/^[^\p{L}]+/u, "");
const pages = files
  .map(buildPage)
  .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: SRC })
    .toString()
    .trim();
} catch {}

const data = {
  source: {
    repo: "https://github.com/wpknox/tirules-search",
    commit,
    builtAt: new Date().toISOString(),
  },
  pages,
};
writeFileSync(OUT, JSON.stringify(data));

const counts = Object.values(KINDS).map(
  (k) => `${pages.filter((p) => p.kind === k).length} ${k.toLowerCase()}`,
);
console.log(
  `Wrote ${OUT}\n  ${pages.length} pages (${counts.join(", ")}) from ${SRC} @ ${commit}`,
);
