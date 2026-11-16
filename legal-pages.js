// Builds a public, no-login HTML page for each document in src/legalDocs.js,
// served at /more/legal/<slug> (e.g. the Admin Panel Privacy Policy that
// Google Play links to). Used by vite.config.js -- runs at build time only.
import { LEGAL_DOCS, legalDocPath } from "./src/legalDocs.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Escape, then turn bare URLs / email addresses into links (same as in-app).
const rich = (s) => esc(s)
  .replace(/(https?:\/\/[^\s)<]*[^\s)<.,;:])|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, (m, url, mail) =>
    url ? `<a href="${url}">${url}</a>` : `<a href="mailto:${mail}">${mail}</a>`)
  .replace(/\n/g, "<br>");

function blockHtml(b) {
  if (b.p) return `<p>${rich(b.p)}</p>`;
  if (b.list) return `<ul>${b.list.map((item) => {
    const k = item.indexOf(": ");
    return `<li>${k > 0 && k < 90 ? `<strong>${esc(item.slice(0, k))}:</strong> ${rich(item.slice(k + 2))}` : rich(item)}</li>`;
  }).join("")}</ul>`;
  if (b.table) return `<div class="tw"><table><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${rich(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return "";
}

export function legalPageHtml(doc) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} | EasyRepair</title>
<meta name="description" content="${esc(doc.title)} for EasyRepair (Easyplan LTD).">
<link rel="canonical" href="https://admin.easyrepair.co.uk${legalDocPath(doc)}">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #F1F5F9; font-family: Outfit, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.65; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 28px 20px 60px; }
  header { padding-bottom: 18px; border-bottom: 1px solid #262626; margin-bottom: 24px; }
  header img { height: 26px; width: auto; display: block; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 4px; }
  .updated { color: #94A3B8; font-size: 13px; margin: 0 0 26px; }
  h2 { color: #d4ff3c; font-size: 17px; margin: 26px 0 8px; }
  p, li { font-size: 15px; margin: 0 0 10px; }
  ul { padding-left: 20px; margin: 0 0 10px; }
  a { color: #d4ff3c; word-break: break-word; }
  .tw { overflow-x: auto; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; min-width: 480px; }
  th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid #262626; font-size: 14px; }
  th { color: #94A3B8; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
<header><img src="/logo.png" alt="EasyRepair"></header>
<main>
<h1>${esc(doc.title)}</h1>
<p class="updated">Last updated: ${esc(doc.updated)}</p>
${doc.sections.map((sec) => `<section><h2>${esc(sec.heading)}</h2>${sec.blocks.map(blockHtml).join("")}</section>`).join("\n")}
</main>
</div>
</body>
</html>
`;
}

// Vite plugin: emits more/legal/<slug>/index.html into the build output, and
// serves the same page from the dev server.
export function legalPagesPlugin() {
  return {
    name: "legal-pages",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0].replace(/\/$/, "");
        const doc = LEGAL_DOCS.find((d) => legalDocPath(d) === path);
        if (!doc) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(legalPageHtml(doc));
      });
    },
    generateBundle() {
      for (const doc of LEGAL_DOCS) {
        this.emitFile({ type: "asset", fileName: `${legalDocPath(doc).slice(1)}/index.html`, source: legalPageHtml(doc) });
      }
    },
  };
}
